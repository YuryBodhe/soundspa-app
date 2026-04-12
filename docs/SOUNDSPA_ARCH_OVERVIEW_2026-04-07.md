# Sound Spa — Обзор архитектуры и работоспособности (2026-04-07)

## 1. Хранилище данных и ORM

### 1.1. Текущий стор
- Основное хранилище: **Postgres** (боевой стор на VPS).
- Исторически использовался **SQLite** (`soundspa.sqlite` и бэкапы в корне `/opt/soundspa-app`), сейчас служит как резерв/наследие.

### 1.2. Слой доступа к данным
- Используется **Drizzle ORM**.
- Основная схема под Postgres: `db/schema.pg.ts` и `drizzle/schema.pg.ts`.
- Описание ключевых таблиц в `db/schema.pg.ts`:
  - `tenants` — салоны/кабинеты:
    - `id`, `name`, `slug`, `brandName`.
    - `trialStartedAt`, `trialEndsAt`, `paidTill` (timestamptz, `mode: "string"`).
  - `users` — пользователи внутри тенантов:
    - `id`, `email`, `password` (техническое значение `"magic-link-only"`), `tenantId` (FK → `tenants.id`).
    - Уникальный индекс `unique_email_tenant` по `(email, tenantId)`.
  - `channels` — глобальный справочник каналов:
    - `id`, `code`, `slug`, `displayName`, `mood`.
    - `kind` (`"music"`/`"noise"` и др.), `streamUrl`, `image`.
    - `order` (глобальный порядок), `isNew` (бейдж "новый").
  - `tenant_channels` — связь кабинета и каналов:
    - `tenantId` (FK → `tenants.id`).
    - `channelId` (FK → `channels.id`).
    - `order` — порядок для конкретного тенанта.
    - Уникальный индекс по `(tenantId, channelId)`.
  - `invites` — инвайт‑коды:
    - `code`, `maxUses`, `usedCount`, `expiresAt`.
  - `login_tokens` — одноразовые токены для magic‑link входа:
    - `token`, `userId`, `expiresAt`, `usedAt`.

### 1.3. Отношения
- `tenantRelations`, `userRelations`, `channelRelations`, `tenantChannelsRelations` описаны через `relations` из `drizzle-orm` и используются в query‑слое.

**Вывод:**
- Архитектура БД уже переведена на Postgres‑ориентированную схему с аккуратными связями и индексами.
- Единственное, чего пока нет в схеме каналов — флагов активности/дефолта (`is_active`, `is_default`), о которых говорили в продуктовой части.

---

## 2. Auth, signup и сессии

### 2.1. Регистрация (signup)
- **Форма:** `GET /signup` → `app/signup/page.tsx`.
  - Поля: `email`, `salonName`, `inviteCode`.
- **API:** `POST /api/auth/signup` → `app/api/auth/signup/route.ts`.

Флоу `POST /api/auth/signup`:
1. Парсинг и валидация тела запроса:
   - `email`, `salonName`, `inviteCode` — обязательны.
2. Проверка инвайта в `invites`:
   - По коду `invites.code`.
   - Проверка `expiresAt` и лимита `maxUses` / `usedCount`.
3. Проверка уникальности пользователя:
   - По `users.email` (без учёта тенанта).
4. Транзакция в Postgres:
   - Создаёт `tenants`:
     - `name` и `brandName` = `salonName`.
     - `slug` — уникализированный через `generateUniqueSlug`.
     - `trialStartedAt = now`, `trialEndsAt = now + TRIAL_DAYS`, `paidTill = null`.
   - Создаёт `users`:
     - `email`.
     - `password = "magic-link-only"` (технический, NOT NULL).
     - `tenantId` = id нового `tenant`.
   - Копирует каналы из шаблонного `TEMPLATE_TENANT_ID = 1` (Spaquatoria):
     - Читает все строки из `tenant_channels` для тенанта `#1`.
     - Для каждой создаёт запись `tenant_channels` для нового `tenantId` с тем же `channelId` и `order`.
   - Обновляет `invites.usedCount`.
5. Создаёт запись в `login_tokens` для нового пользователя:
   - `token` — случайный 32‑байтовый hex.
   - `expiresAt = now + 1 день`.
6. Формирует `magicLink`:
   - `${NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/login?token=${token}`.
7. Отправляет письмо через AgentMail (`sendMagicLinkEmail`), контекст `"signup"`.
8. Возвращает JSON с успехом/ошибкой.

**Важно:**
- На данный момент стартовый набор каналов жёстко завязан на содержимое кабинета `tenant_id = 1` (Spaquatoria) через `tenant_channels`, а не на флаги в `channels`.

### 2.2. Magic‑link login и сессии
- **Запрос повторной ссылки:** `POST /api/auth/request-magic-link`.
  - Ищет `user` по email; если не находит — отвечает безопасным сообщением без утечки.
  - Если находит — создаёт `login_tokens` с коротким TTL (порядка 30 минут), формирует `magicLink` и отправляет через AgentMail с контекстом `"login"`.
- **Потребление magic‑link:** `POST /api/auth/consume-magic-link`.
  - Валидирует `token` в `login_tokens` (наличие, не использован, не истёк).
  - Находит `user` и связанный `tenant`.
  - Помечает токен использованным (`usedAt = now`).
  - Создаёт cookie `soundspa_session` с payload `{ userId, tenantId, tenantSlug, iat }`.
  - Возвращает `tenantSlug` — фронт редиректит в `/app/<tenantSlug>`.

**Итог по auth:**
- Полный end‑to‑end по signup + приглашения + email‑магия на базе AgentMail.
- Авторизация полностью cookie‑based, без JWT.
- Хранение пользователей жёстко привязано к тенантам (multi‑tenant модель, email может теоретически существовать в разных тенантах через комбинированный индекс).

---

## 3. Кабинет салона и плееры

### 3.1. Маршрут кабинета
- **Путь:** `GET /app/[tenantSlug]` → `app/app/[tenantSlug]/page.tsx`.

Основной флоу:
1. Получает `tenantSlug` из URL.
2. Через `getSession()` извлекает `soundspa_session`:
   - Если сессии нет — редиректит на `/login?from=/app/${tenantSlug}`.
   - Если `session.tenantSlug !== tenantSlug` — редиректит на `/app/${session.tenantSlug}`.
3. Грузит данные:
   - `tenant` по `tenants.slug`.
   - `channels` через `getChannelsForTenant(tenantSlug)` (join `tenant_channels` + `channels` + сортировка по порядку).
4. Если `tenant` не найден — `notFound()`.
5. Вычисляет статус подписки по дате:
   - `active` — `paidTill > now`.
   - `trial` — нет `paidTill`, но `trialEndsAt > now`.
   - `expired` — иначе.
6. Формирует текстовый статус:
   - `subscriptionDate`: текст про дату окончания подписки/триала.
   - `subscriptionWarn`: флаг предупреждения (когда до конца периода мало времени).
7. Ветвление по статусу:
   - `expired` → экран блокировки без плеера.
   - `trial`/`active` → рендер мобильного iOS‑подобного плеера (`IosPlayer`) / десктопной версии.

### 3.2. Плееры (мобильный и десктопный)
- Компоненты в `app/app/ios-player/`:
  - `IosPlayer.tsx` — основной мобильный UI с макетом iPhone.
  - `DesktopPlayer.tsx` — десктопная версия.

Ключевые моменты:
- Используются два `HTMLAudioElement`:
  - `audioRef` — основной музыкальный поток (каналы AzuraCast).
  - `noiseAudioRef` — шумовой слой (лес, дождь и т.п.).
- Управление воспроизведением:
  - Все play/pause — по пользовательскому действию (`onClick`), важно для iOS WebKit.
  - Переключение каналов с плавным `fade-out/fade-in` по `volume`.
  - Включение/выключение шума — отдельное управление, тоже с fade.
- Null‑safety и TS‑строгость:
  - Во всех местах, где участвуют `ref.current` внутри `requestAnimationFrame` и других колбеков, используются локальные константы с проверками на `null` — текущий код собирается в strict‑режиме.
- Исторический дубликат старых плееров `app/ios-player/*` убран из `app/`, чтобы не ломать Next 16 и не плодить дубли.

**Итог по кабинету:**
- Логика статуса подписки и доступа работает на Postgres‑данных.
- Плеер уже готов к работе с двумя слоями (музыка + шум) и опирается на поля `channels`, включая `kind`.

---

## 4. Админка и служебные разделы

### 4.1. Структура `app/`
- В корне `app/`:
  - `page.tsx` — лэндинг/промо.
  - `signup/` — форма регистрации.
  - `login/` — взаимодействие с magic‑link входом.
  - `admin-login/` — отдельный вход в админку.
  - `no-auth/`, `check-app-access/`, `consume/` — служебные маршруты.
  - `app/` — "внутреннее" приложение (кабинет салона, админка и т.п.).

### 4.2. Админка `/app/admin`
- Внутри `app/app/admin/`:
  - Страницы и компоненты для управления:
    - списком тенантов,
    - пользователями,
    - каналами,
    - статусами trial/active/expired.
- Работает поверх тех же таблиц `tenants`, `users`, `channels`, `tenant_channels`.
- На момент фиксации:
  - CRUD по users/tenants/channels уже завязан на Postgres и успешно отрабатывает на боевом сервере.
  - Управление каналами пока **не** включает флаги `is_active`/`is_default` (их ещё нет в схеме), но базовые операции создания/редактирования/удаления работают.

**Роль админки:**
- Позволяет руками приводить данные к нужному виду, управлять кабинетами и каналами.
- В следующем цикле работы планируется добавить управление базовым шаблоном каналов через UI (флажки активный/дефолтный).

---

## 5. Интеграция с почтой (AgentMail)

- Конфигурация в ENV (`.env.local`/`.env.production` в `app/`):
  - `AGENTMAIL_API_KEY`.
  - `AGENTMAIL_FROM = soundspa@agentmail.to`.
  - `AGENTMAIL_BASE_URL = https://api.agentmail.to/v0/`.
  - `NEXT_PUBLIC_APP_URL` — базовый URL приложения.
- Обёртка: `lib/agentmail.ts`:
  - Инициализирует `AgentMailClient`.
  - Экспортирует `sendMagicLinkEmail({ to, magicLink, salonName?, context })`.
  - Используется в `signup` и `request-magic-link` для отправки писем.
- Проверено вручную (по состоянию на 2026-04-06):
  - Письма приходят с корректным текстом и ссылкой.
  - Переход по ссылке приводит к успешному входу и редиректу в кабинет.

---

## 6. Работоспособность системы после переезда на Postgres

### 6.1. Что уже проверено
- Регистрация нового кабинета через `/signup` на боевом сервере:
  - Создаются записи в `tenants`, `users`, `tenant_channels`, `invites`, `login_tokens` в Postgres.
  - Почта с magic‑link уходит через AgentMail.
  - Переход по ссылке ведёт к успешному логину и открытию `/app/<slug>`.
  - Новый кабинет получает набор каналов из шаблонного `tenant_id = 1`.
- Повторный вход через `/login`:
  - Генерируется новый `login_token`.
  - Почта уходит, ссылка работает.
- Кабинет `/app/[tenantSlug]`:
  - Корректно проверяет сессию.
  - Правильно определяет статус trial/active/expired по полям в `tenants`.
  - Рендерит плеер и список каналов через `tenant_channels` + `channels`.
- Админка `/app/admin`:
  - Вход по админ‑паролю работает.
  - CRUD по tenants/users/channels работает поверх Postgres.

### 6.2. Известные технические нюансы
- Исторический блокер `npm run build` из прошлых сессий был связан с требованиями Next 16 к `useSearchParams()` на `/login` (нужен `<Suspense>`). Архитектурно это локальная проблема страницы, а не модели данных.
- Главный архитектурный долг, который остаётся:
  - Стартовый набор каналов для нового кабинета всё ещё определяется содержимым `tenant_id = 1` (Spaquatoria), а не декларативными флагами в `channels`.

---

## 7. Краткие выводы и следующие логические шаги

1. **Архитектура сейчас:**
   - Полноценное multi-tenant веб‑приложение на Next.js с Postgres + Drizzle.
   - Auth по magic-link через AgentMail.
   - Кабинет и плееры уже опираются на Postgres‑данные и работают на боевом сервере.
   - Админка позволяет управлять ключевыми сущностями.

2. **Где всё ещё завязка на "наследие":**
   - Механизм шаблона каналов (`TEMPLATE_TENANT_ID = 1`) — продуктовая логика в данных, а не в схеме.
   - Отсутствуют флаги `is_active`/`is_default` в `channels`, из-за чего:
     - нельзя декларативно описать базовый набор каналов,
     - нельзя стандартно скрыть старые/ненужные каналы без удаления.

3. **Логичные следующие шаги (в отдельных задачах):**
   - Расширить таблицу `channels` флагами `is_active` и `is_default` + миграция под Postgres.
   - Переписать `signup` так, чтобы он:
     - больше не копировал каналы из `tenant_id = 1`,
     - а выбирал `channels` с `is_active = true AND is_default = true` и создавал по ним `tenant_channels`.
   - Обновить `/app/admin/channels`:
     - добавить чекбоксы для `Active`/`Default`;
     - позволить через UI управлять шаблонным набором без правок кода.
   - После этого зафиксировать новое состояние в отдельном документе ("SOUNDSPA_STATE_*" / "*_MIGRATION_*"), чтобы был чёткий трек эволюции.