
Зафиксировать roadmap SoundSpa 2 в репозитории, чтобы он был общей инструкцией для нас и воркера.
Создать отдельное staging-окружение:test.soundspa.bodhemusic.com → отдельный контейнер soundspa-v2.Production v1 вообще не трогаем.
Отделить staging от production:отдельная ветка кода, позже отдельная staging DB, отдельные тестовые настройки.
Собрать минимальный MP3 prototype на существующем UI:один канал Divnitsa, 2–3 MP3, один ambient, новый независимый fetch → Blob → Audio engine.
Добавить current + next prefetch и последовательное воспроизведение 30-минутных миксов.
Добавить offline fallback:если сеть пропала, уже загруженные треки продолжают играть и при необходимости повторяются по кругу.
Протестировать стабильность:Safari, Chrome, несколько часов работы, отключение/возврат интернета, переключения каналов, память.
Добавить несколько playlists и ambient-каналов, но загружать только выбранный контент.
Подключить staging DB и backend catalog вместо hardcoded playlists.
Добавить device activation — устройство салона получает постоянный token без постоянных логинов.
Подключить существующий Prodamus billing и entitlements:бесплатный канал + платные каналы согласно подписке.
Добавить лёгкую серверную аналитику через обычные запросы плеера, без постоянного heartbeat.
Отдать v2 одному пилотному салону, при этом v1 остаётся мгновенным fallback.
Постепенно перевести остальные салоны только после доказанной стабильности.
После полного перехода оставить staging навсегда:все будущие изменения идут local → staging → production, и больше никаких экспериментов на живых клиентах.
То есть ближайшие реальные шаги сейчас всего три: roadmap → staging → минимальный MP3-плеер. Остальное пока не трогаем.


Offline / автономный режим
При потере интернета SoundSpa должен автоматически переходить в автономный режим и продолжать воспроизведение уже загруженных MP3 (например, циклически A → B → A → B), не прерывая музыку. В UI показывать ненавязчивый статус «Автономный режим — музыка продолжает играть». Пока соединение отсутствует, переключение музыкального канала блокируется; при попытке переключения показывается короткое сообщение «Нет интернета. Текущий канал продолжает играть». После восстановления сети плеер автоматически проверяет доступ/подписку, загружает следующие треки и возвращается в обычный режим без действий со стороны сотрудника салона.

Player UX / управление каналами
Сделать управление плеером более интуитивным: нажатие на карточку музыкального канала одновременно выбирает канал и запускает воспроизведение, а центральная кнопка Yin-Yang работает как глобальный Play/Pause текущего канала. На активной карточке предусмотреть понятный визуальный индикатор воспроизведения (Play/equalizer/animation). Для первого запуска добавить лёгкие одноразовые contextual-подсказки: «Нажмите на карточку, чтобы включить канал», «Yin-Yang — пауза/продолжить», «Ambient — добавьте звуки природы и настройте их громкость». Подсказки не должны мешать работе и после ознакомления больше не показываются.



03_09_2026 
Статус

Проверено: ветка soundspa-v2, HEAD 3361827a2874076c9f5ecb061cb6d516386dd37b, рабочее дерево чистое. Файлы не изменялись.
1. Как работает текущий engine
Текущий [mp3Engine.ts](/Users/bodhem3/Zavod/apps/soundspa-v2/app/lib/audio/mp3Engine.ts) хранит:
один активный Blob URL — currentObjectUrl;
один предварительно загруженный Blob URL — preparedTrack;
один HTMLAudioElement;
wantsPlayback для различения Play/Pause;
generation для защиты от результатов старых async-операций;
loadPromise и prefetchPromise для предотвращения параллельных одинаковых загрузок.
Последовательность:
play() загружает Track 0 целиком.
Создаёт Blob URL и Audio.
Начинает воспроизведение.
Запускает prefetch следующего трека.
На ended использует prepared Blob либо пытается скачать следующий трек.
После переключения старый активный Blob URL немедленно отзывается.
Текущие ограничения:
ошибка prefetch просто игнорируется;
retry отсутствует;
если загрузка на ended не удалась, engine переходит в error и сбрасывает wantsPlayback;
после успешного A → B Blob A удаляется, поэтому вернуться к нему offline невозможно;
generation полноценно меняется только при dispose();
незавершённый fetch не отменяется через AbortController.
2. Необходимое дополнительное состояние
Внутри Mp3Engine нужны:
type CachedTrack = {
  index: number;
  objectUrl: string;
};

currentSlot: CachedTrack | null;
standbySlot: CachedTrack | null;
desiredNextIndex: number;

downloadController: AbortController | null;
downloadPromise: Promise<void> | null;

retryAttempt: number;
retryTimer: ReturnType<typeof setTimeout> | null;
lastFailureAt: number | null;

generation: number;
wantsPlayback: boolean;
disposed: boolean;
Ключевое поле — desiredNextIndex. Его нельзя каждый раз вычислять как currentTrackIndex + 1, потому что во время offline fallback фактически играющий трек может двигаться назад:
A → B → A → B
При этом логически ожидаемым следующим новым треком всё ещё может оставаться C.
Публичный Mp3EngineState необязательно расширять. Для диагностики можно позднее добавить fallbackMode и desiredNextIndex, но playback можно реализовать полностью внутренним состоянием.
3. Предлагаемая A/B state machine
EMPTY
  └─ download A success → CURRENT_ONLY(A)
  └─ download A failure → INITIAL_RETRY_WAIT

CURRENT_ONLY(A)
  ├─ play A
  └─ download B
       ├─ success → READY(A, B)
       └─ failure → FALLBACK_SINGLE(A)

READY(A, B)
  ├─ A ends → play B
  └─ while B plays, download desired C into temporary Blob
       ├─ success → replace standby A with C → READY(B, C)
       └─ failure → keep A → FALLBACK_PAIR(B, A)

FALLBACK_PAIR(B, A)
  ├─ B ends → play cached A
  ├─ A ends → play cached B
  └─ controlled retries continue for desired C

RECOVERY
  └─ C fully downloaded
       ├─ keep current track playing
       ├─ atomically replace standby slot with C
       └─ at current track end play C and resume normal progression
Recovery must never cause an immediate switch. A newly downloaded track only becomes the next standby track.
4. Exact behavior
Initial load failure
There is no playable Blob, so playback cannot begin.
Set status to error or a more specific future waiting.
Keep wantsPlayback=true if the user still wants playback.
Schedule controlled retry.
On successful complete download, create Blob URL and begin playback.
If the user presses Pause, cancel scheduled retries.
A later Play initiates a fresh attempt immediately.
No partially downloaded response is retained.
Prefetch failure
Do not pause or otherwise touch the active Audio.
Keep all successfully cached slots unchanged.
Preserve desiredNextIndex.
Schedule a retry with backoff.
Do not set the overall playback status to error while the current Blob is playing.
This is a degraded/offline condition, not a playback failure.
Network loss during current playback
Nothing happens to the current track because Audio reads from its complete Blob.
Only the current or next prefetch request may fail. That failure must not call the current handlePlayError(), because that method currently disables playback globally.
Playback and download failures need separate handling.
Track ending while offline
If two cached Blobs exist:
switch immediately to the other slot;
reset the reused audio source to the beginning;
call play();
keep desiredNextIndex unchanged;
continue controlled recovery attempts while the fallback track plays.
Example:
Cached: A + B
Desired network track: C

A → B → A → B
        ↑ C remains the desired download
Only one Blob available
Replay the same Blob from the beginning:
A → A → A
This is preferable to silence.
The engine should set currentTime = 0 and replay the same object URL without revoking or recreating it. Controlled download attempts for B continue in the background.
Recovery
Suppose cached A/B are alternating and C is still desired:
A or B continues playing uninterrupted.
Retry successfully downloads C completely.
Create the C object URL.
Replace only the non-current standby slot.
Revoke the displaced standby URL.
When the current track naturally ends, play C.
Advance desiredNextIndex.
Begin downloading the following playlist track.
If a cached slot already contains the desired playlist track, reuse it instead of downloading it again.
Pause/Resume
Pause:
set wantsPlayback=false;
call audio.pause();
preserve current position;
preserve both cached Blobs;
cancel scheduled retry timers;
an already-running download may either finish and be cached or be aborted. Finishing it is closer to current behavior and usually preferable.
Resume:
call play() on the existing audio element;
do not refetch the active track;
do not reset currentTime;
resume missing prefetch/recovery work after playback succeeds.
Channel switch / stop
Current V2Player does not dispose the engine when selecting Relax or 432 Hz. It only calls pause(). Therefore:
Divnitsa position and cached Blobs remain available;
returning to Divnitsa resumes from the same position;
this existing behavior should remain unchanged.
A true stop/dispose must:
stop audio;
remove listeners;
cancel retry timers;
abort in-flight fetch;
increment generation;
revoke both cached Blob URLs;
clear pending promises and slots.
Stale async fetch after stop/switch
Each download must capture both:
current generation;
its requested playlist index or unique request ID.
After response.blob() resolves, the result may be committed only if:
engine is not disposed;
generation still matches;
request is still the active download;
the requested index is still the desired replacement.
Otherwise, any newly created object URL must be revoked immediately.
Using an AbortController reduces wasted traffic, but generation validation remains necessary because abort and completion can race.
5. Retry/backoff strategy
Recommended sequence:
5s → 15s → 30s → 60s → 120s maximum
Add approximately ±20% jitter so multiple players do not retry simultaneously.
Rules:
only one download may be active;
only one retry timer may exist;
reset retry count after a complete successful Blob download;
no retry timer while paused or disposed;
window.online may trigger one earlier attempt, but must not create a retry loop;
navigator.onLine should be treated only as a hint, not proof of connectivity;
an online event must not interrupt or replace the active track.
Error classification:
retry network errors, timeouts, HTTP 408, 429 and 5xx;
avoid endless automatic retry for permanent 4xx responses such as 404;
Play can initiate another explicit attempt after a terminal configuration error.
This uses normal browser connectivity signals, not a heartbeat.
6. Blob URL lifecycle
The safe lifecycle is:
Keep current Blob URL until it is replaced or engine is disposed.
Keep standby Blob URL even after fallback switching.
Download a replacement into temporary memory first.
Only after the new Blob is complete:
create its object URL;
atomically install it into the non-current slot;
revoke the displaced standby URL.
Never revoke the URL currently assigned to audio.src.
A stale completed fetch must revoke its newly created URL.
dispose() must revoke both unique slot URLs exactly once.
During replacement, memory temporarily contains three complete MP3 Blobs:
current + fallback standby + newly downloaded candidate
That temporary peak is necessary to guarantee uninterrupted offline fallback. After the candidate is committed, memory returns to two Blobs.
7. Files that would need changes
Required:
[mp3Engine.ts](/Users/bodhem3/Zavod/apps/soundspa-v2/app/lib/audio/mp3Engine.ts)
Probably no changes required:
[V2Player.tsx](/Users/bodhem3/Zavod/apps/soundspa-v2/app/v2/V2Player.tsx)
[divnitsaPlaylist.ts](/Users/bodhem3/Zavod/apps/soundspa-v2/app/v2/divnitsaPlaylist.ts)
ambientEngine.ts
Optional only if UI diagnostics are desired later:
V2Player.tsx to display fallback/recovery status.
A dedicated test file for deterministic A/B transition and retry tests.
The smallest production implementation can remain isolated to mp3Engine.ts.
8. Edge cases and risks
Two 30-minute MP3 Blobs can consume significant memory, with a temporary third Blob during replacement.
Audio.src switching is immediate but not sample-accurate gapless playback.
Safari may delay or reject play() after an ended transition; this must be handled without deleting cached Blobs.
A hanging fetch may require a generous timeout or abort policy.
Duplicate playlist URLs/indices need deduplication so both slots do not accidentally reference redundant downloads.
Playlist length 1 must deliberately reuse the same Blob.
Playlist length 2 naturally becomes permanent A/B without downloading replacements.
A pause arriving during ended or audio.play() must win: check wantsPlayback after every awaited operation.
Audio decode errors are different from network failures. A corrupt cached Blob should not be alternated forever.
Recovery should advance the logical playlist cursor only when the desired track actually becomes current, not merely when its download completes.
preparedTrackIndex will need carefully defined semantics: it should represent the next standby candidate, including an offline fallback track.
No files were edited, committed, pushed, or deployed.

3:41 PM





