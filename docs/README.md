## SoundSpa — рабочая документация по развёртыванию (2026-05)

Этот файл описывает, как сейчас устроено боевое окружение SoundSpa и как его обслуживать.
Для полного обзора архитектуры см. `docs/SOUNDSPA_ARCH_OVERVIEW_2026-04-07.md`.

### 1. Краткая схема окружения

- **Боевая VPS:** `5.42.111.201` (в РФ).
- На сервере одновременно живут два приложения:
  1. **Azuracast** (`/var/azuracast`) — источники музыкальных потоков.
  2. **SoundSpa** (`/var/www/soundspa`) — фронтенд/кабинет/админка (Next.js + docker-compose).
- Внешние домены и маршрутизация:
  - `https://soundspa.bodhemusic.com` → фронтенд SoundSpa.
  - `https://radio.bodhemusic.com` → панель Azuracast.
- Трафик приходит через Cloudflare → системный nginx на хосте → проксируется внутрь Docker.

### 2. Порты и проксирование

| Сервис              | Внутренняя точка | Внешний доступ        | Комментарий                          |
|---------------------|------------------|-----------------------|--------------------------------------|
| Azuracast (HTTP)    | `127.0.0.1:9000` | `https://radio…`      | nginx на хосте проксирует на 9000    |
| Azuracast (HTTPS)   | `127.0.0.1:9443` | (не используется)     | оставлен для внутреннего TLS         |
| SoundSpa nginx      | `0.0.0.0:8081`   | `https://soundspa…`   | системный nginx → docker-proxy:8081 |
| SoundSpa app (Next) | `app:3000`       | только внутри сети    | контейнер `soundspa-app`            |

`/etc/nginx/sites-available/` содержит два vhost’а: `soundspa.bodhemusic.com.conf` и `radio.bodhemusic.com.conf`. Они подключены через симлинки в `sites-enabled/`. Дефолтный nginx-сайт отключён.

### 3. SSL-сертификаты

- Используется Let’s Encrypt (certbot).
- Файлы:
  - `/etc/letsencrypt/live/soundspa.bodhemusic.com/fullchain.pem` + `privkey.pem`.
  - `/etc/letsencrypt/live/radio.bodhemusic.com/fullchain.pem` + `privkey.pem`.
- Certbot настроен на автопродление (systemd timer). При ручном выпуске пользуемся webroot-режимом:

```bash
sudo certbot certonly --webroot -w /var/www/html \
  -d radio.bodhemusic.com \
  --non-interactive --agree-tos -m admin@radio.bodhemusic.com
```

После продления сертификатов — `sudo nginx -t && sudo systemctl reload nginx`.

### 4. docker-compose SoundSpa

Рабочие файлы — `/var/www/soundspa/docker-compose.yml` + `nginx/conf.d/default.conf`.

Основные сервисы:

```yaml
services:
  nginx:  # фронтовой прокси внутри docker-compose
    ports:
      - "8081:80"
      - "8444:443"  # оставлено для совместимости, сейчас не используется
    volumes:
      - ./nginx/conf.d:/etc/nginx/conf.d:ro
      - /etc/letsencrypt:/etc/letsencrypt:ro

  app:    # Next.js (prod build, npm run start)
    expose:
      - "3000"

  worker: # фоновые задания

  postgres:  # основной стор
```

Внутренний nginx (в docker-compose) теперь проксирует напрямую на `app:3000` (см. `nginx/conf.d/default.conf`). Внешний системный nginx больше не должен проксировать на 8444 — всё идёт через 8081.

### 5. Как обновлять и перезапускать SoundSpa

```bash
cd /var/www/soundspa

# 1. Внести изменения в репозиторий (git pull, правки env и т.д.)

# 2. Пересобрать и перезапустить
docker compose build app worker
docker compose up -d

# 3. Проверить статус
docker compose ps
```

Если правили только конфиг nginx внутри docker-compose, достаточно `docker compose restart nginx`.

### 6. Как обновлять Azuracast (кратко)

```bash
cd /var/azuracast
docker compose pull
docker compose up -d
```

Порты 80/443 у Azuracast теперь **не** пробрасываются наружу; слушает только `127.0.0.1:9000/9443`.

### 7. Диагностика (чек-лист)

| Симптом                                             | Что проверить                                                                                  |
|-----------------------------------------------------|------------------------------------------------------------------------------------------------|
| `soundspa…` → открывается админка Azura             | Убедиться, что внешние nginx-конфиги задействованы (sites-enabled) и Azura не слушает 80/443.  |
| `soundspa…` даёт 502                                | `docker compose ps` (контейнер `soundspa-nginx-1` должен быть Up). `curl http://127.0.0.1:8081` |
| `soundspa…` 502, а `127.0.0.1:8081` 502             | Проверить `nginx/conf.d/default.conf` (должен проксировать на `app:3000`).                     |
| `soundspa…` 200, но каналы не играют                | Проверить Azuracast (панель `radio.bodhemusic.com`, станции, порты 8000+).                    |
| `radio…` не открывается                            | `curl -I https://radio.bodhemusic.com`, статус nginx, certbot, порты `127.0.0.1:9000`.         |
| SSL ругается                                        | Проверить `/etc/letsencrypt/live/...`, дату истечения. При необходимости перевыпустить cert.  |

### 8. Полезные команды

```bash
# Проверить, кто слушает порт 80/443/8081/9000
sudo ss -tulpn | grep -E ':80|:443|:8081|:9000'

# Проверить nginx-конфиг на хосте
sudo nginx -T | less

# Логи системного nginx
sudo journalctl -u nginx -f

# Логи docker-compose nginx (SoundSpa)
cd /var/www/soundspa
docker compose logs --tail=100 nginx
```

### 9. ENV и секреты

- SoundSpa (фронт/бэкенд): `.env` в корне `/var/www/soundspa` (подгружается в docker-compose).
- Azuracast: `.env`, `azuracast.env` внутри `/var/azuracast`.
- Почта AgentMail: ключи в `.env` SoundSpa (см. архитектурный документ).

### 10. Что ещё нужно знать

- Весь входящий трафик идёт через Cloudflare. Если снаружи домен не открывается, проверьте DNS-записи (A → `5.42.111.201`) и статус проксирования.
- Сервер физически в РФ, прямые обращения на внешние API могут требовать VPN — это причина, почему всё хостится локально.
- При изменении nginx-конфигов **всегда** делаем `sudo nginx -t` перед `reload`, иначе можно уронить все домены сразу.

---

Если нужно более детальное описание таблиц, потоков и auth-флоу — смотрите `docs/SOUNDSPA_ARCH_OVERVIEW_2026-04-07.md`.
