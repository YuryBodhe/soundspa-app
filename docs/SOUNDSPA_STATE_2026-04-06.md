# Sound Spa — Текущее состояние (2026-04-06)

## 1. Auth и тенанты

### Signup и создание тенанта

- **Маршрут:** `GET /signup` → `app/signup/page.tsx` (форма: email, название салона, invite code).
- **Маршрут:** `POST /api/auth/signup`:
  - Создаёт запись в `tenants`:
    - `name` / `brandName` = название салона из формы.
    - `slug` — уникальный slug (на основе названия, с суффиксом при конфликте).
    - `trial_started_at = now`.
    - `trial_ends_at = now + 10 дней`.
    - `paid_till = NULL`.
  - Создаёт `user`:
    - `email` из формы.
    - `tenant_id` = только что созданный tenant.
    - `password` = техническое значение `"magic-link-only"` (почти не используется, вход по magic‑link).
  - Копирует каналы из эталонного `tenant_id = 1` (Spaquatoria) в `tenant_channels` нового тенанта:
    - Берёт все строки `tenant_channels` для Spaquatoria.
    - Для каждой вставляет такую же пару `channel_id`/`order`, но с `tenant_id = <новый>`.
  - Обновляет `invites`:
    - Находит invite по `code`.
    - Проверяет, что не истёк / не превышен `max_uses`.
    - Инкрементирует `used_count`.
  - Создаёт запись в `login_tokens`:
    - случайный hex‑токен.
    - `user_id` = новый пользователь.
    - `expires_at = now + 1 день`.
  - Формирует `magicLink` вида:
    - `http://localhost:3000/login?token=...` (или `NEXT_PUBLIC_APP_URL + "/login?token=..."` в проде).
  - Возвращает JSON с `magicLink` (в dev) и триггерит отправку письма (в проде через AgentMail).

### Login и consume magic link

- **Маршрут:** `GET /login` → `app/login/page.tsx`.
  - Client component (`"use client"`).
  - Использует `useRouter()` и `useSearchParams()` из `next/navigation`.
  - Поведение:
    - При наличии `token` в query (`/login?token=...`):
      - дергает `POST /api/auth/consume-magic-link` с `{ token }`.
      - на успех, если `data.tenantSlug` → `router.replace("/app/" + data.tenantSlug)`.
      - на ошибку показывает сообщение.
    - При отсутствии `token`:
      - рендерит форму email,
      - `POST /api/auth/request-magic-link` → создаёт новый login‑token и отправляет письмо (прод) или возвращает `magicLink` в JSON (dev).

- **Маршрут:** `POST /api/auth/consume-magic-link`:
  - Находит запись в `login_tokens` по `token`.
  - Проверяет:
    - существует ли запись,
    - `used_at IS NULL` (не использован ранее),
    - `expires_at > now`.
  - Находит `user` с этим `user_id` и связанного `tenant`.
  - Если ок:
    - ставит `used_at = now` для токена.
    - создаёт cookie `soundspa_session`:
      - payload вида `{ userId, tenantId, tenantSlug, iat }`, сериализованный в base64url.
      - TTL ≈ 30 дней (по реализациям из прошлых сессий).
    - отвечает JSON `{ ok: true, tenantSlug }`.

- **Маршрут:** `POST /api/auth/request-magic-link`:
  - Принимает `email`.
  - Находит `user` и его `tenant`.
  - Создаёт новый `login_token` (аналогично signup).
  - Формирует `magicLink` (на основе `NEXT_PUBLIC_APP_URL`).
  - В проде отправляет письмо через AgentMail; в dev — возвращает `magicLink` в JSON.

## 2. Кабинет и плееры

### Маршрут кабинета

- **Маршрут:** `GET /app/[tenantSlug]` → `app/app/[tenantSlug]/page.tsx`.

Поведение:

1. Читает `tenantSlug` из URL.
2. Через `getSession()` достаёт `soundspa_session`:
   - если сессии нет → `redirect(`/login?from=/app/${tenantSlug}`)`.
   - если `session.tenantSlug !== tenantSlug` → `redirect(`/app/${session.tenantSlug}`)`.
3. Параллельно грузит:
   - `channels` через `getChannelsForTenant(tenantSlug)`, основано на `tenant_channels` + `channels`.
   - `tenant` по `slug` из таблицы `tenants`.
4. Если `tenant` не найден → `notFound()`.
5. Вычисляет статус доступа:
   - `trial` / `active` / `expired` по `trialEndsAt` и `paidTill` относительно `now`:
     - `active`: `paidTill > now`.
     - `trial`: `trialEndsAt > now` и нет активной оплаты.
     - иначе `expired`.
6. Формирует `subscriptionDate` и `subscriptionWarn`:
   - `subscriptionDate`:
     - active → «Подписка активна до …».
     - trial → «Тестовый период до …».
     - expired → «Доступ неактивен».
   - `subscriptionWarn`:
     - true, если до конца **оплаты < 7 дней** или до конца **триала < 3 дней**.
7. По статусу:
   - `expired` → рендерит экран блокировки («Доступ приостановлен…»).
   - `trial` / `active` → рендерит мобильный плеер:

```tsx
import IosPlayer from "../ios-player/IosPlayer";

<IosPlayer
  tenantSlug={tenantSlug}
  salonName={salonName}
  channels={channels}
  promoCards={PROMO_CARDS}
  subscriptionDate={subscriptionDate}
  subscriptionWarn={subscriptionWarn}
/>
```

### Плееры

- **Путь к актуальным компонентам плеера:**
  - `app/app/ios-player/IosPlayer.tsx` — мобильный UI (iOS‑стиль устройства).
  - `app/app/ios-player/DesktopPlayer.tsx` — десктопный кабинет.

Основные моменты логики:

- Оба плеера используют два `useRef<HTMLAudioElement>`:
  - `audioRef` — основной поток (музыка, канал AzuraCast).
  - `noiseAudioRef` — дополнительный шумовой слой (forest/sea/…).
- Управление:
  - Play/Pause строго через `onClick` (важно для iOS WebKit).
  - Переключение каналов — с fade‑out/fade‑in по `audio.volume`.
  - Включение/выключение шума — аналогично с плавными fade‑in/fade‑out по `noiseAudio.volume`.
- Null‑safety (актуальное состояние):
  - В местах, где используются `audioRef.current` и `noiseAudioRef.current` внутри `requestAnimationFrame`‑коллбеков, введены локальные константы (`audioEl`, `noiseEl`) с `if (!audioEl) return;` / `if (!noiseEl) return;`, чтобы удовлетворить строгий TypeScript и избежать обращений к потенциально `null` ref’ам.
- Старый дубликат плееров:
  - Ранее существовали файлы в `app/ios-player/*`.
  - Они были историческим наследием и дублировали логику.
  - На текущий момент **вынесены из дерева `app/`**, чтобы Next.js не собирал их повторно и не тащил в type‑check.

## 3. Структура БД

### Основные таблицы

- `tenants`
  - `id` — PK.
  - `name` — внутреннее имя.
  - `slug` — URL‑часть (`spaquatoria`, `divnitsa`, ...).
  - `brand_name` — отображаемое название салона.
  - `trial_started_at` — дата старта триала.
  - `trial_ends_at` — дата окончания триала.
  - `paid_till` — дата окончания оплаченного периода (если есть).

- `users`
  - `id` — PK.
  - `email` — уникальный.
  - `password` — сейчас `"magic-link-only"` (login по ссылкам).
  - `tenant_id` — FK → `tenants.id`.

- `channels`
  - Справочник всех музыкальных и шумовых каналов: id, title, mood, streamUrl, и пр.

- `tenant_channels`
  - `tenant_id` — FK → `tenants.id`.
  - `channel_id` — FK → `channels.id`.
  - `order` — порядок в плеере.
  - Используется для формирования списка каналов в `getChannelsForTenant(tenantSlug)`.

- `invites`
  - `id`.
  - `code` — строковый invite (например, `SOUNDSPA-TEST`).
  - `max_uses` — максимум использований (или `NULL` без ограничения).
  - `used_count` — счётчик использований.
  - `expires_at` — опциональный срок действия.

- `login_tokens`
  - `id`.
  - `token` — одноразовый hex‑токен для magic‑link.
  - `user_id` — FK → `users.id`.
  - `expires_at` — срок действия ссылки.
  - `used_at` — когда токен был использован (или `NULL`).

### Эталонный tenant

- **Spaquatoria**:
  - `tenant_id = 1` (по договорённости и по прошлым сессиям).
  - Является шаблонным кабинетом:
    - При каждом signup новый tenant копирует его `tenant_channels`.
    - В результате новый салон сразу получает стартовый набор каналов Spaquatoria (минимум 3 music‑канала; в будущем сюда могут добавляться шумовые каналы).

## 4. Почта и magic links (AgentMail)

На основе `2026-04-06-soundspa-deploy.md` и текущего кода в "чистом" репо `soundspa-app`:

- В проекте есть `lib/agentmail.ts` — обёртка над AgentMail API.
- `app/api/auth/signup/route.ts` и `app/api/auth/request-magic-link/route.ts`:
  - При успешном signup / запросе magic‑link формируют `magicLink`.
  - В production используют AgentMail для отправки email‑сообщения с кнопкой/ссылкой вида `https://<NEXT_PUBLIC_APP_URL>/login?token=...`.
  - В dev окружении возвращают `magicLink` в JSON, чтобы можно было быстро скопировать ссылку из Network‑лога.
- ENV для почты и базы в проде:
  - `SESSION_SECRET` — секрет для сессионных cookie.
  - `DATABASE_URL` — строка подключения к SQLite или другой БД.
  - `AGENTMAIL_API_KEY`, `AGENTMAIL_FROM`, `AGENTMAIL_BASE_URL` — конфиг для AgentMail.
  - `NEXT_PUBLIC_APP_URL` — публичный URL веб‑приложения (используется при генерации ссылок).

## 5. Админка и прочие части `app/`

- В `app/app/` находятся:
  - `[tenantSlug]/page.tsx` — кабинет салона (описан выше).
  - `ios-player/` — мобильный и десктопный плееры.
  - `admin/` — админские страницы (список тенантов, статусы trial/active/expired и т.п.).
  - `daily-messages.ts`, `page.tsx` — общие части приложения.
- Админка опирается на те же таблицы `tenants`, `users`, `tenant_channels` и статусную логику trial/active/expired, но в рамках текущего блокера сборки напрямую не задействована.

## 6. Текущее состояние сборки (2026-04-06)

- После правок:
  - Типы по плеерам (`IosPlayer`/`DesktopPlayer`) приведены в соответствие со строгим TS (null‑safety ref’ов).
  - Исторический дубликат плееров `app/ios-player/*` вынесен из дерева `app/` и больше не участвует в сборке.
- На момент фиксации:
  - Главное архитектурное поведение signup/login/tenant‑кабинета работает и подтверждено прошлыми сессиями.
  - Единственный известный blocker для `npm run build` связан не с бизнес‑логикой, а с требованиями Next.js 16 к странице `/login`:
    - компонент, использующий `useSearchParams()`, должен быть обёрнут в `<Suspense>` при prerender’е.
  - Этот вопрос отложен на следующий шаг, чтобы не трогать логику, пока фиксируется текущее состояние.
