# Sound Spa — Auth + Email MVP (2026-04-06)

## 1. Что сделано в этой версии

### 1.1. Регистрация и кабинеты
- Эндпоинт: `POST /api/auth/signup`
- Флоу:
  - Валидирует `email`, `salonName`, `inviteCode`.
  - Проверяет инвайт в таблице `invites` (код, срок действия, лимит использований).
  - Проверяет, что `users.email` ещё не существует.
  - В транзакции создаёт:
    - `tenants`:
      - `name` / `brandName` = `salonName`,
      - `slug` = уникальный slug на основе `salonName`,
      - `trialStartedAt = now`,
      - `trialEndsAt = now + 10 дней`,
      - `paidTill = null`.
    - `users`:
      - `email`,
      - `password = "magic-link-only"` (техническое значение для NOT NULL),
      - `tenantId` = id нового тенанта.
    - `tenant_channels`:
      - копирует все записи для `tenant_id = 1` (Spaquatoria-шаблон),
      - создаёт такой же набор каналов для нового `tenantId`.
    - обновляет счётчик `invites.usedCount`.
  - После транзакции создаёт запись в `login_tokens`:
    - `token` = случайный 32-байтовый hex,
    - `userId` = id нового пользователя,
    - `expiresAt = now + 1 день`.
  - Формирует `magicLink`:
    - `${NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/login?token=${token}`.
  - Отправляет письмо с magic link через AgentMail (см. ниже).
  - Возвращает JSON:
    - `ok: true`,
    - `message: "Кабинет создан. Мы отправили письмо со ссылкой для входа на указанный email."`,
    - в dev-режиме (`NODE_ENV !== "production"`) дополнительно включает `magicLink` в ответ.

### 1.2. Повторный вход по email
- Эндпоинт: `POST /api/auth/request-magic-link`
- Флоу:
  - Принимает `email`.
  - Ищет `user` по `users.email`.
  - Если пользователя нет — отвечает мягко, без утечки:
    - `ok: true`,
    - `message: "Если такой email зарегистрирован, мы отправили на него ссылку для входа."`.
  - Если пользователь есть:
    - создаёт новую запись в `login_tokens`:
      - `token` = случайный 32-байтовый hex,
      - `expiresAt = now + 30 минут` (TTL отдельный от signup),
    - формирует `magicLink` аналогично signup,
    - отправляет письмо через AgentMail с контекстом `login`.
  - В обеих ветках (есть/нет пользователя) фронт получает один и тот же безопасный текст.

### 1.3. Обработка magic link
- Эндпоинт: `POST /api/auth/consume-magic-link` (существовал ранее, не менялся логически в этой сессии).
- Флоу:
  - Проверяет `token` в `login_tokens`:
    - наличие,
    - `usedAt` ещё не установлен,
    - `expiresAt > now`.
  - Находит `user` + связанный `tenant`.
  - Помечает токен как использованный (`usedAt = now`).
  - Создаёт сессионную cookie `soundspa_session` с payload:
    - `{ userId, tenantId, tenantSlug, iat }`.
  - Возвращает `tenantSlug` в ответе.
  - Фронт после этого редиректит на `/app/<tenantSlug>`.

### 1.4. Кабинет салона и плеер
- Страница кабинета: `app/app/[tenantSlug]/page.tsx`.
- Флоу:
  - Через `getSession()` проверяет текущую сессию:
    - если нет сессии — `redirect(/login?from=/app/${tenantSlug})`.
    - если `session.tenantSlug !== tenantSlug` — редиректит на `/app/${session.tenantSlug}`.
  - Параллельно загружает:
    - `channels` через `getChannelsForTenant(tenantSlug)` (набор каналов из `tenant_channels` + `channels`),
    - `tenant` по `tenants.slug`.
  - Статусы доступа:
    - `active` — если `paidTill > now`,
    - `trial` — если нет `paidTill`, но `trialEndsAt > now`,
    - `expired` — иначе.
  - Для `expired` рендерит экран блокировки (без плеера).
  - Для `trial`/`active`:
    - считает `subscriptionDate` ("Подписка активна до …" / "Тестовый период до …"),
    - `subscriptionWarn` (флаг для скоро-истекающих периодов),
    - рендерит `ResponsivePlayer` (новый iOS-подобный плеер) с:
      - `tenantSlug`,
      - `salonName` (brandName/name/slug),
      - `channels`,
      - `promoCards`,
      - `subscriptionDate`,
      - `subscriptionWarn`,
      - `dailyMessage`.

### 1.5. Email-рассылка через AgentMail
- Конфигурация (`apps/soundspa-app/.env.local`):
  - `AGENTMAIL_API_KEY=...`
  - `AGENTMAIL_FROM=soundspa@agentmail.to`
  - `AGENTMAIL_BASE_URL=https://api.agentmail.to/v0/`
- Код: `lib/agentmail.ts`:
  - Использует официальный Node SDK:
    - `import { AgentMailClient } from "agentmail";`
    - `const client = new AgentMailClient({ apiKey: AGENTMAIL_API_KEY })`.
  - Экспортирует `sendMagicLinkEmail({ to, magicLink, salonName, context })`:
    - `context` — `"signup"` или `"login"`.
    - `subject`:
      - signup → `"Добро пожаловать в Sound Spa"`,
      - login → `"Вход в Sound Spa"`.
    - `text` и `html`:
      - текст/HTML письма с описанием салона (для signup),
      - кнопкой "Открыть кабинет Sound Spa" и фоллбек-ссылкой.
    - Вызов SDK:
      - `client.inboxes.messages.send(AGENTMAIL_FROM, { to, subject, text, html })`.
    - Логирование в консоль:
      - `[agentmail] message sent <id>`.
  - Signup и request-magic-link:
    - вызывают `sendMagicLinkEmail(...)`;
    - в случае ошибки отправки письма возвращают 500 и сообщение:
      - signup: "Кабинет создан, но не удалось отправить письмо со ссылкой для входа. Свяжитесь с поддержкой Sound Spa.",
      - login:  "Мы создали ссылку для входа, но не смогли отправить письмо. Свяжитесь с поддержкой Sound Spa."

### 1.6. Проверено вручную (Smoke-тесты)
- Регистрация по адресу `/signup`:
  - форма: email + название салона + инвайт `SOUNDSPA-TEST`,
  - письмо приходит на указанный email от `soundspa@agentmail.to`,
  - клик по кнопке/ссылке → `/login?token=...` → редирект в `/app/<slug>`,
  - в новом кабинете сразу доступны 3 музыкальных канала (как у Spaquatoria),
  - статус: "Тестовый период до …".
- Повторный вход через `/login` + "Отправить ссылку для входа":
  - приходит отдельное письмо с login magic-link,
  - клик ведёт в уже существующий кабинет.

---

## 2. Рекомендованный git-коммит

### 2.1. Изменённые файлы (ключевые)
- `app/api/auth/signup/route.ts`
  - Импорт `sendMagicLinkEmail` из `@/lib/agentmail`.
  - Удалён TODO про "реальную отправку email".
  - После создания `login_tokens`:
    - формирует `magicLink`,
    - вызывает `sendMagicLinkEmail({ to: email, magicLink, salonName, context: "signup" })`.
  - Ответ API:
    - теперь говорит о письме (и в dev может возвращать `magicLink`).

- `app/api/auth/request-magic-link/route.ts`
  - Импорт `sendMagicLinkEmail` из `@/lib/agentmail`.
  - После создания `login_tokens`:
    - формирует `magicLink`,
    - вызывает `sendMagicLinkEmail({ to: email, magicLink, context: "login" })`.
  - Ответ API:
    - всегда мягкий, без утечки, но с реальной отправкой письма когда пользователь существует.

- `lib/agentmail.ts`
  - Новый файл (или сильно обновлённый) с интеграцией Node SDK.

- `package.json` / `package-lock.json`
  - Добавлены зависимости:
    - `agentmail`,
    - `@x402/fetch` (транзитивная зависимость SDK).

### 2.2. Предлагаемый commit message

```text
feat(auth): add AgentMail magic-link emails for signup and login

- integrate AgentMail Node SDK via lib/agentmail.ts
- send branded magic link emails from soundspa@agentmail.to on signup
- send login magic link emails for existing users via request-magic-link
- keep dev magicLink in JSON response (NODE_ENV !== "production") for easier local testing
- ensure new tenants copy template channels from Spaquatoria and get 10-day trial
```

---

## 3. Локальный бэкап проекта

### 3.1. Текущая точка сохранения
- Предыдущий зафиксированный бэкап: `soundspa-app-2026-04-04-working-auth`.
- Новый бэкап, который логично сделать сейчас:
  - `soundspa-app-2026-04-06-auth-email-magic-links`

### 3.2. Ориентировочная команда бэкапа (архив)

> NB: команду выполняет человек (или отдельный скрипт), здесь просто фиксируется протокол.

Из корня репозитория `~/Zavod`:

```bash
cd ~/Zavod
# Архивируем текущую версию soundspa-app в backups/ или аналогичную папку
mkdir -p BACKUP\ FILES/soundspa-app
 tar czf "BACKUP FILES/soundspa-app/soundspa-app-2026-04-06-auth-email-magic-links.tgz" \
  apps/soundspa-app
```

Можно также сделать git-тег после пуша на GitHub:

```bash
cd ~/Zavod
# после коммита и пуша
 git tag -a soundspa-auth-email-mvp-2026-04-06 -m "Sound Spa auth+email MVP (magic links)"
 git push origin soundspa-auth-email-mvp-2026-04-06
```

---

## 4. План деплоя MVP на сервер

### 4.1. Подготовка окружения
1. **Сервер**
   - Hetzner VPS (тот же, где крутится AzuraCast) или отдельный инстанс.
   - Установлены:
     - Node.js (LTS, напр. 20.x),
     - npm.

2. **Исходный код**
   - Клонировать репозиторий из GitHub:
     ```bash
     git clone <repo-url> /opt/soundspa-app
     cd /opt/soundspa-app
     git checkout <ветка/тег с auth-email-MVP>
     ```

3. **Зависимости**
   - В каталоге `apps/soundspa-app`:
     ```bash
     cd /opt/soundspa-app/apps/soundspa-app
     npm install
     ```

### 4.2. Конфигурация прод-окружения
1. **Env-файл на сервере**
   - Создать `/opt/soundspa-app/apps/soundspa-app/.env.production` (или `.env.local`, если прод окружение единое) с переменными:
     - `SESSION_SECRET=...` (уникальный сильный ключ),
     - `DATABASE_URL=file:///opt/soundspa-app/soundspa.sqlite` (или путь к прод-DB),
     - `AGENTMAIL_API_KEY=...` (продовый ключ из AgentMail),
     - `AGENTMAIL_FROM=soundspa@agentmail.to`,
     - `AGENTMAIL_BASE_URL=https://api.agentmail.to/v0/`,
     - `NEXT_PUBLIC_APP_URL=https://<prod-domain>` (например, `https://app.soundspa.yourdomain.com`).

2. **База данных**
   - Либо перенести текущий SQLite-файл (бэкап/миграция),
   - либо инициализировать прод-BD скриптами (`init-db.ts`, `seed-spaquatoria.js`) и создать шаблонный tenant для Spaquatoria.

### 4.3. Сборка и запуск
1. **Сборка**
   ```bash
   cd /opt/soundspa-app/apps/soundspa-app
   npm run build
   ```

2. **Запуск в проде**
   - Простой способ (для MVP):
     ```bash
     NODE_ENV=production npm run start -- -p 3000
     ```
   - Для постоянной работы:
     - через `pm2`:
       ```bash
       pm2 start npm --name soundspa-app -- run start -- -p 3000
       pm2 save
       ```
     - или через `systemd` юнит (отдельный `soundspa-app.service`).

3. **Reverse proxy / HTTPS**
   - Настроить Nginx/Traefik/Apache:
     - домен: `app.soundspa.<домен>`,
     - proxy_pass → `http://127.0.0.1:3000`,
     - HTTPS (Let’s Encrypt или существующий сертификат).

### 4.4. Smoke-тесты на проде
1. **Signup**
   - Открыть `https://app.soundspa.<домен>/signup`.
   - Пройти регистрацию с тестовым email и валидным инвайтом.
   - Проверить:
     - письмо от `soundspa@agentmail.to` приходит на внешний адрес,
     - кнопка/ссылка ведёт на `https://app.soundspa.<домен>/login?token=...`,
     - после клика → `/app/<slug>` с iOS-плеером и триалом.

2. **Повторный вход**
   - Открыть `https://app.soundspa.<домен>/login`.
   - Запросить ссылку для входа через форму (тот же email).
   - Проверить, что письмо приходит и ведёт в тот же кабинет.

3. **Базовые проверки безопасности**
   - Невалидный/просроченный `token` → аккуратная ошибка, без утечки деталей.
   - Попытка зайти под чужим `/app/<slug>` → редиректит в свой кабинет.

---

Этот файл фиксирует текущее состояние MVP (auth + magic link email) и даёт понятный сценарий: 
1) сделать git-коммит и локальный архив, 
2) подготовить сервер, 
3) выкатить MVP на прод и провести первые тесты с реальными письмами.
