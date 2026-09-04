SoundSpa 2 — Roadmap & Architecture
1. Цель SoundSpa 2
SoundSpa 2 — новая версия плеера для SPA-салонов, построенная вокруг предварительной загрузки обычных MP3-файлов вместо постоянного live-streaming через AzuraCast.
Главные цели:
максимально стабильное воспроизведение даже при нестабильном интернете;
минимальная нагрузка на браузер;
простая и предсказуемая audio-архитектура;
сохранение существующего дизайна SoundSpa;
масштабирование до десятков музыкальных и ambient-каналов;
поддержка рекуррентных подписок;
доступ к каналам в зависимости от подписки;
простая серверная аналитика;
отсутствие обязательного heartbeat/ping из браузера;
постепенная миграция без риска для работающего SoundSpa v1.
SoundSpa v1 остаётся production-системой до тех пор, пока SoundSpa 2 не будет полностью протестирован.

2. Основной архитектурный принцип
SoundSpa 2 не использует постоянный интернет-радиострим для музыкальных каналов.
Музыкальный контент состоит из обычных MP3-файлов.
Основной playback flow:
получить разрешённый playlist
↓
fetch Track A полностью
↓
создать Blob URL
↓
play Track A

пока играет Track A
↓
fetch Track B полностью
↓
держать Track B готовым в памяти

Track A ended
↓
play Track B
↓
fetch Track C
На первом этапе треки играют последовательно без crossfade.
Crossfade может быть добавлен позже, но не является обязательной частью SoundSpa 2.

3. Формат музыкального контента
Предпочтительный формат музыкальных блоков:
MP3;
ориентировочная продолжительность около 30 минут;
каждый mix имеет собственный fade-in / fade-out;
ориентировочный bitrate 128–160 kbps;
музыкальные блоки готовятся заранее как законченные миксы.
30-минутный формат даёт несколько преимуществ:
меньше переключений;
меньше запросов;
проще prefetch;
при временной потере интернета один загруженный файл даёт около 30 минут воспроизведения;
current + next дают примерно час готового контента.
Количество каналов архитектурно практически не ограничивается.
Например:
20 Music Channels
20 Ambient Channels
не означает загрузку 40 каналов одновременно.
Браузер работает только с выбранными каналами.

4. Управление памятью
Для музыкального playback браузер должен в нормальном режиме держать только:
Current Track Blob
Next Track Blob
Старые Blob URL после использования освобождаются через:
URL.revokeObjectURL()
Необходимо избегать загрузки всего каталога или всего playlist в память.

5. Работа при потере интернета
SoundSpa 2 должен быть устойчив к кратковременным и продолжительным сбоям интернета.
Если интернет исчезает:
уже скачанный Current Track продолжает играть
↓
если Next Track уже скачан
↓
играет Next Track
Если новый контент загрузить невозможно, допустим emergency fallback:
последние доступные MP3
→ повторяются
→ пока интернет не восстановится
Главная задача — не допустить внезапной тишины в салоне.
SoundSpa 2 при этом не является полноценным offline-приложением.
После закрытия/перезапуска браузера постоянное хранение всей музыкальной библиотеки не гарантируется.
На первом этапе:
не использовать большой persistent offline cache;
не строить сложную offline licensing system;
не хранить весь каталог локально.
В будущем Cache Storage / IndexedDB могут быть рассмотрены отдельно.

6. Ambient / Noise Engine
Музыкальный playback и ambient playback должны быть независимыми.
Примеры ambient-каналов:
Rain
Ocean
Forest
Fireplace
Birds
White/Pink/Brown noise и т.д.
Ambient может быть реализован как отдельный MP3 Blob.
Если файл подготовлен как seamless loop:
fetch ambient file
↓
Blob
↓
Audio.loop = true
Музыка и noise должны использовать отдельные Audio instances.
Ошибка noise не должна останавливать музыку.
Ошибка music не должна останавливать noise.

7. UI
SoundSpa 2 должен максимально использовать существующий дизайн SoundSpa.
Сохраняются:
визуальный стиль;
карточки музыкальных каналов;
карточки ambient/noise;
Play/Pause;
volume controls;
выбранный музыкальный канал;
выбранный ambient-канал.
Но новый player не должен наследовать старую сложную live-stream audio architecture.
Новый audio engine строится отдельно.

8. SoundSpa v1 и SoundSpa v2
На этапе разработки две системы существуют параллельно.
SoundSpa v1
AzuraCast
existing production
active salons
        │
        │ НЕ ТРОГАЕМ
        │
        └──────────────┐
                       ↓
                SoundSpa v2
                MP3 / Fetch / Blob
                отдельный test environment
SoundSpa v2 должен иметь отдельную точку входа.
Например:
player2.soundspa.bodhemusic.com
или:
test.soundspa.bodhemusic.com
Допустим отдельный container / port.
Production v1 нельзя использовать как площадку для разработки v2.

9. Первый прототип
Первая версия должна быть максимально маленькой.
Не строить сразу всю систему.
Prototype 1:
существующий UI;
без существующей авторизации;
без Prodamus;
без полноценной DB-интеграции;
без AzuraCast;
без старого soundEngine;
без heartbeat;
без analytics;
один музыкальный канал;
2–3 MP3-файла;
один ambient channel;
fetch → Blob → Audio;
current + next prefetch;
последовательное воспроизведение.
Первый тестовый музыкальный канал:
Divnitsa
Доступные тестовые файлы могут использовать существующие static MP3.
Главная задача Prototype 1:
доказать стабильность нового playback engine.
Проверить:
Chrome;
Safari;
desktop;
iPhone/iPad при возможности;
переключение Play/Pause;
смену канала;
работу несколько часов;
временное отключение интернета;
восстановление интернета;
переход между MP3;
освобождение старых Blob.

10. Авторизация: разделить User и Device
SoundSpa 2 должен разделять:
OWNER / ADMIN AUTH
и:
PLAYER DEVICE AUTH
Это разные задачи.
Owner/Admin
Владелец салона может использовать обычную защищённую авторизацию.
Существующую magic-link систему можно пока сохранить, если она работает надёжно.
Позже можно рассмотреть:
Google login;
passkeys;
другие способы входа.
Но это не является задачей первого этапа.
Player Device
Плеер салона не должен требовать ежедневного login.
Предпочтительная архитектура:
новое устройство
↓
получает activation code
↓
владелец подтверждает устройство
↓
backend выдаёт device token
↓
device token хранится локально
↓
player работает самостоятельно
Device authentication отвечает только на вопрос:
Какому салону принадлежит это устройство?
Она не определяет подписку.

11. Subscription и Device — независимые сущности
Необходимо чётко разделить:
DEVICE
"Кто ты?"
и:
SUBSCRIPTION / ENTITLEMENTS
"Что тебе разрешено?"
Device token может оставаться действительным длительное время.
Если подписка закончилась, устройство не должно обязательно разлогиниваться.
Оно просто теряет premium entitlements.

12. Новая коммерческая модель
Каждый новый салон получает бесплатный доступ к SoundSpa.
Минимальный вариант:
1 Free Music Channel
Дополнительно можно предоставить несколько бесплатных ambient/noise.
Остальные музыкальные каналы доступны по подписке.
Пример модели:
1 канал      Free
3 канала     paid
5 каналов    paid
10 каналов   paid
All channels paid
Конкретные цены определяются отдельно.
Архитектурно желательно не зашивать цены в Player.

13. Entitlements
Player не должен самостоятельно решать, какой канал является платным.
Backend является источником истины.
Например:
Tenant: Lotus Spa

Free Relax       ✓
Divnitsa         ✓
Deep Relax       ✓
Indian Spa       ✕
Organic Lounge   ✕
При запросе конфигурации backend возвращает только доступные каналы или статус доступа для каждого канала.
Основные сущности могут выглядеть так:
subscriptions
tenant_channels
channels
devices
Пример subscription:
tenant_id
status
paid_until
channel_limit
Пример tenant_channels:
tenant_id
channel_id
enabled

14. Рекуррентные платежи
Работающая Prodamus recurring payment architecture должна быть сохранена насколько возможно.
Не переписывать работающую billing-систему без необходимости.
Типичный flow:
Prodamus
↓
recurring charge
↓
Webhook
↓
SoundSpa backend
↓
payments/subscriptions DB
↓
entitlements
↓
Player
Успешный платёж:
subscription_status = active
paid_until = next billing date
Неуспешный платёж:
subscription_status = past_due
После допустимого grace period:
subscription_status = expired / canceled
Тогда premium channels больше не выдаются.
Free channel остаётся доступным.

15. Проверка срока доступа
Не использовать JavaScript timer на 30 дней внутри браузера.
Срок доступа хранится на сервере.
Например:
paid_until
Backend при обычном запросе проверяет:
NOW() < paid_until
Если подписка активна:
premium access allowed
Если срок закончился:
premium access denied
free access remains
Отдельный worker может периодически обновлять статусы subscription в DB, но безопасность не должна зависеть исключительно от worker.
Backend также проверяет дату непосредственно.

16. Что происходит при потере интернета после окончания подписки
Это не рассматривается как серьёзная угроза.
Если browser уже скачал Current + Next:
они могут продолжить воспроизводиться
Но новый premium content без соединения с backend получить нельзя.
После восстановления связи:
backend проверяет subscription
↓
если expired
↓
не выдаёт новые premium tracks
Не требуется немедленно обрывать уже играющий MP3 в момент истечения подписки.

17. Analytics philosophy
SoundSpa 2 должен избегать постоянной фоновой телеметрии.
Основной принцип:
Browser отвечает за playback.Server отвечает за business state и analytics.
На первом этапе:
никаких ping каждые 10–60 секунд;
heartbeat не обязателен;
analytics не должна влиять на playback;
ошибка analytics никогда не должна останавливать музыку.

18. Analytics через обычные backend-запросы
Backend может обновлять usage information во время запросов, которые Player всё равно выполняет.
Например:
player/config requested
→ update last_seen_at

playlist requested
→ update last_channel_id
→ update last_activity_at

track access requested
→ update last_track_requested_at
Таким образом браузер не выполняет отдельные analytics requests.

19. Ограничение server-only analytics
Если Player ничего не сообщает во время локального playback, сервер не может достоверно знать:
играет ли звук именно в эту секунду.
Это считается допустимым компромиссом.
Для бизнеса важнее показатели:
сколько салонов использовали SoundSpa сегодня
сколько использовали за неделю
какие каналы запрашиваются
сколько активных подписок
сколько expired / past_due
чем абсолютно точный realtime counter.

20. Опциональные playback events
Если позже потребуется более точная информация, можно добавить редкие события:
player_opened
track_started
channel_changed
playback_error
Но они НЕ являются обязательными для первого playback prototype.
Не создавать сложную event telemetry system преждевременно.

21. Analytics Worker
Анализ данных может выполняться отдельным worker process.
Схема:
Player
↓
обычные Backend requests
↓
PostgreSQL
↓
Analytics Worker
↓
aggregated metrics
↓
Admin Dashboard
Worker не должен общаться напрямую с браузерами.
Worker читает и агрегирует данные из DB.

22. Будущая admin analytics
В перспективе администратор SoundSpa должен видеть:
Total salons
Active subscriptions
Past due subscriptions
Expired subscriptions

Used SoundSpa today
Used SoundSpa this week

Most requested music channels
Most requested ambient channels

Last activity per salon/device
Playback/download errors
Realtime online now не является обязательной метрикой.

23. Player должен быть независим от аналитики
Критический принцип:
analytics server down
→ music continues

worker down
→ music continues

Prodamus temporarily unavailable
→ currently validated session continues

backend temporarily unavailable
→ already fetched music continues

internet temporarily unavailable
→ fetched MP3 continues
Playback является главным приоритетом системы.

24. Backend responsibilities
Backend SoundSpa 2 отвечает за:
Device authentication
Tenant identification
Subscriptions
Payments
Entitlements
Channel catalog
Playlists
Track metadata/access
Usage state
Analytics source data
Backend не занимается непосредственным streaming audio.

25. Player responsibilities
Player должен быть максимально лёгким.
Он отвечает только за:
получить конфигурацию
получить доступные channels
получить playlist
fetch MP3
создать Blob
play MP3
prefetch next
Play/Pause
music volume
noise playback
noise volume
смена channel
обработка временной потери сети
Не переносить business logic в browser.

26. Media storage
MP3-файлы должны храниться отдельно от Git repository.
Текущая схема может использовать:
/var/lib/soundspa-media/
Пример:
/var/lib/soundspa-media/
    divnitsa/
        mix-001.mp3
        mix-002.mp3
        mix-003.mp3

    deep-relax/
        mix-001.mp3
        mix-002.mp3

    ambient/
        rain.mp3
        ocean.mp3
Git хранит код и metadata/configuration.
Git не должен использоваться для хранения основной MP3-библиотеки.

27. Доступ к MP3
На самом первом playback prototype допустимы обычные static URLs.
После доказательства стабильности необходимо определить production access model.
Возможные варианты:
authenticated media endpoint;
short-lived signed URLs;
другой простой access token mechanism.
Не усложнять первый playback test защитой media URL.
Сначала доказать audio architecture.

28. Этапы разработки
Phase 0 — Architecture
Зафиксировать данный roadmap.
Не менять production.

Phase 1 — Isolated MP3 Prototype
Создать отдельный SoundSpa 2 test environment.
Функции:
existing UI;
one music channel;
2–3 MP3;
one ambient;
no auth;
no billing;
no analytics;
no Azura;
new MP3 engine;
current + next prefetch.
Success criteria:
стабильное воспроизведение;
Safari работает;
Chrome работает;
нет reconnect loops;
временное отсутствие интернета не останавливает уже скачанный track;
последовательный переход между tracks работает.

Phase 2 — Multiple Playlists
Добавить:
несколько музыкальных каналов;
несколько ambient channels;
playlist abstraction;
channel switching;
track rotation;
memory cleanup;
emergency fallback на уже скачанные MP3.

Phase 3 — Backend Catalog
Перенести hardcoded playlists в backend/DB.
Добавить:
channels
tracks
playlists
playlist_tracks
Player получает каталог через API.

Phase 4 — Device Activation
Добавить:
device registration;
activation code;
device token;
tenant binding;
revoke device.
Player больше не требует обычную пользовательскую авторизацию.

Phase 5 — Subscription + Entitlements
Интегрировать существующую billing system.
Добавить правила:
free channel всегда доступен;
premium channels выдаются согласно subscription;
channel limit / selected channels;
paid_until validation;
fallback на Free после expiry.

Phase 6 — Server Analytics
Добавить минимальные поля activity в DB.
Analytics строится преимущественно на обычных backend requests.
Без обязательного heartbeat.
Добавить analytics worker и admin summary.

Phase 7 — Reliability Testing
Длительные тесты:
8+ часов playback;
Safari;
Chrome;
desktop;
mobile/tablet;
плохой Wi-Fi;
краткий offline;
длительный offline;
backend restart;
network restore;
repeated channel switching;
memory usage;
Blob cleanup.

Phase 8 — Pilot Salon
Выбрать один реальный салон для controlled pilot.
SoundSpa v1 остаётся доступным как fallback.
Наблюдать несколько дней.

Phase 9 — Gradual Migration
После подтверждения стабильности:
1 salon
↓
несколько salons
↓
часть production clients
↓
all clients
AzuraCast не отключать до завершения миграции.

Phase 10 — Retire v1
Только после доказанной стабильности SoundSpa 2:
отключить старый live soundEngine;
убрать Azura dependency для музыкальных каналов;
очистить legacy code;
окончательно перевести production на MP3 architecture.

29. Что НЕ делать на ранних этапах
До доказательства playback architecture НЕ добавлять:
сложный offline cache;
Service Worker ради offline music;
IndexedDB music library;
crossfade;
realtime websocket analytics;
heartbeat каждые несколько секунд;
новый сложный admin panel;
переписывание Prodamus;
сложные pricing rules;
AI analytics;
massive playlist management UI;
DRM.
Сначала:
простой MP3 playback должен работать абсолютно стабильно.

30. Главные архитектурные принципы
Playback важнее всего.
Уже скачанная музыка не должна останавливаться из-за проблем backend/analytics/network.
Browser должен быть максимально лёгким.
Business logic находится на сервере.
Device authentication отделена от subscription.
Subscription отделена от конкретного playback engine.
Entitlements определяют доступ к контенту.
Analytics строится на сервере и не должна мешать playback.
SoundSpa v1 остаётся untouched, пока v2 не доказан.
Новые функции вводятся постепенно и изолированно.
Не оптимизировать и не усложнять систему до того, как доказан простой вариант.
Основной playback mechanism SoundSpa 2:
Fetch → Blob → Audio → Prefetch Next

31. Первый следующий шаг
Создать отдельную ветку / рабочую область SoundSpa 2 на основе существующего проекта.
Первый эксперимент:
existing SoundSpa player UI
+
Divnitsa channel
+
3 static MP3
+
1 ambient noise
+
new isolated MP3 engine
+
no auth
+
no billing
+
no analytics
+
no Azura
Разместить отдельно от production и проверить стабильность playback.
До успешного завершения этого эксперимента не начинать следующие этапы.


SoundSpa must always maintain an isolated staging environment. No experimental build, database migration, playback-engine change or unverified feature may be tested directly on production. Production and staging must use separate application containers and separate databases.
