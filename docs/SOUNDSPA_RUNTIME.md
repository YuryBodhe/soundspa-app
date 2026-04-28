SOUNDSPA_RUNTIME

Copy
# SOUNDSPA_RUNTIME.md — Руководство по рантайму Sound Spa

## 1. Где код (Mac)

- Репозиторий: `/Users/bodhem3/Zavod/apps/soundspa-app`
- Основной frontend-вход:
  - `app/app/[tenantSlug]/page.tsx` → логика загрузки тенанта
  - `app/app/[tenantSlug]/ResponsivePlayer.tsx` → переключатель Desktop/Mobile
- iOS-плеер (боевой):
  - `app/app/ios-player/IosPlayer.tsx`
- WebAudio-песочница (v2):
  - `app/app/ios-player-v2/IosPlayer.v2.tsx`
- Общие стили плеера:
  - `app/app/ios-player/player.module.css`

> Правило: любые новые эксперименты с плеером сначала делаем в `ios-player-v2`, а потом уже переносим в `ios-player` после проверки.

---

## 2. Подключение к серверу (Sound Spa VPS)

### 2.1. SSH-алиас

На Маке в `~/.ssh/config`:

```ssh
Host soundspa-vps
  HostName 46.224.171.149
  User root
  IdentityFile ~/.ssh/id_ed25519_garry_soundspa
  IdentitiesOnly yes
3. Запуск и перезапуск (docker-compose + PM2 worker)

### 3.1. Основной веб (Next.js)
- контейнер `soundspa-app-app-1`, стартует через `docker-compose up -d app`
- внутри контейнера командой по умолчанию остаётся `npm run start` → `next start` (порт 3000)
- никаких pm2-конфигов для веба больше нет: веб всегда поднимается docker-compose

### 3.2. Фоновый воркер (PM2)
- внутри контейнера используется только один процесс `soundspa-worker`
- запускаем через `npx pm2 start scripts/worker.ts --name soundspa-worker --interpreter npx --interpreter-args "tsx"`
- чтобы автоматизировать post-deploy, есть скрипт `/opt/soundspa-app/scripts/post-deploy.sh`

### 3.3. Post-deploy сценарий
```
cd /opt/soundspa-app
./scripts/post-deploy.sh
```
Скрипт делает:
1. `docker-compose pull app` и `docker-compose up -d app` (поднимает веб, пока он не ответит)
2. `docker-compose exec app npx pm2 kill || true` — останавливает старый воркер
3. `docker-compose exec app npx pm2 start scripts/worker.ts --name soundspa-worker --interpreter npx --interpreter-args "tsx"`
4. `docker-compose exec app npx pm2 save`
5. `docker-compose exec app npx pm2 status` — выводит текущее состояние (должен быть только `soundspa-worker`)
Базовые команды:
Copy
# статус
pm2 status

# перезапуск фронта
cd /opt/soundspa-app
pm2 restart ecosystem.config.js --update-env

# логи
pm2 logs soundspa-app --lines 50
4. Билд фронтенда

На сервере:
Copy
cd /opt/soundspa-app

# подтянуть изменения из репо (если правили на Маке)
git pull

# собрать прод-бандл Next
npm run build
Типичный успешный билд:
Creating an optimized production build ...
✓ Compiled successfully in XXs
Running TypeScript ... (без ошибок)
Если после pm2 restart в логах:
Error: Could not find a production build in the '.next' directory
→ значит npm run build не был выполнен или упал.
5. Маршруты плеера (прод)

5.1. Логин по токену

Ссылка в Telegram/почте обычно такая:
Copy
https://soundspa.bodhemusic.com/login?token=...
Поток:
Пользователь открывает ссылку .../login?token=....
Next валидирует токен и кладёт в сессию tenantSlug.
Редирект на:
Copy
https://soundspa.bodhemusic.com/app/[tenantSlug]
например:
Copy
https://soundspa.bodhemusic.com/app/salon-test-3
5.2. Основной плеер (v1)

Маршрут:
https://soundspa.bodhemusic.com/app/[tenantSlug]
Рендерит:
на сервере: мобильный IosPlayer (для SSR),
на клиенте:
при ширине окна ≥ 1024px → DesktopPlayer,
иначе → IosPlayer.
5.3. Экспериментальный режим (v2, WebAudio-шумы)

Маршрут:
https://soundspa.bodhemusic.com/app/[tenantSlug]?player=v2
На мобильном:
через ResponsivePlayer рендерит IosPlayer.v2 (версия с WebAudio‑gain для шумов).
На десктопе:
если ширина ≥ 1024, всё ещё может рендериться DesktopPlayer — зависит от логики ResponsivePlayer.
6. Что уже закреплено (состояние на 2026‑04‑08)

Eruda / debug‑мусор:
полностью убран из IosPlayer (и v1, и v2).
Фейдер шумов:
.noiseRange в player.module.css больше не имеет display: none → UI ожил;
работает на v1 и v2.
v2 (IosPlayer.v2.tsx):
использует WebAudio (AudioContext + GainNode) для шумов,
фейдер крутит gain.gain (с fallback на noiseAudio.volume),
импорты channels/noiseConfig/useWaveCanvas/CSS идут из ../ios-player/....
Конфликты запуска:
soundspa-app.service (systemd) остановлен/отключён, чтобы не драться за порт 3000 с pm2;
прод сейчас поднимается только через pm2.
7. Правила для будущих изменений

Никогда не править прод напрямую, минуя этот файл.
Если меняем:
способ запуска (next start → standalone),
структуру папок (ios-player/ios-player-v2),
systemd/pm2,
→ обязательно обновлять SOUNDSPA_RUNTIME.md.
WebAudio и новые фичи — сначала в v2 / test‑роутах.
IosPlayer.v2.tsx и отдельный маршрут (/app/noise-test и т.п.) — первая линия.
Только после проверки на десктопе и iOS — перенос в IosPlayer.tsx / DesktopPlayer.
Диагностика 502 / «ничего не грузится»:
Проверить pm2:
Copy
export PATH=$PATH:/root/.nvm/versions/node/v24.14.0/bin
pm2 status
pm2 logs soundspa-app --lines 50
Проверить билд:
Copy
cd /opt/soundspa-app
npm run build
Проверить порт:
Copy
ss -lntp | grep 3000 || echo none
8. Быстрый чеклист «как зайти и перезапустить»

На Маке:
Copy
ssh soundspa-vps
На сервере:
Copy
cd /opt/soundspa-app
export PATH=$PATH:/root/.nvm/versions/node/v24.14.0/bin
npm run build
pm2 restart ecosystem.config.js --update-env
pm2 status
Проверка в браузере:
Логин по токену → .../login?token=...
Плеер: .../app/[tenantSlug]
Песочница WebAudio: .../app/[tenantSlug]?player=v2