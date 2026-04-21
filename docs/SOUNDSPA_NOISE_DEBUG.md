# Sound Spa — починка шумовых каналов (CORS + WebAudio)

## Симптомы

- Основные каналы (верхние карточки) играют нормально.
- Шумовые каналы (Forest / Sea / Night) **не дают звук**.
- В DevTools → Console сообщение:
  > MediaElementAudioSource outputs zeroes due to CORS access restrictions for https://radio.bodhemusic.com/listen/forest_ambience/radio.mp3
- На десктопе вместо DesktopPlayer иногда продолжал показываться мобильный IosPlayer (отдельная тема).

## Причина

Мы сменили архитектуру шумов:

- **Раньше:** шумы проигрывались как обычный `<audio src="...">` без WebAudio.
- **Теперь:** шумы идут через WebAudio:
  - `AudioContext`
  - `createMediaElementSource(noiseAudio)`
  - `GainNode` для регулировки громкости.

Для WebAudio браузеру нужен **полный CORS-доступ** к аудиопотоку. Если:

- нет корректных CORS-заголовков на `radio.bodhemusic.com`, и/или
- `<audio>` не помечен `crossOrigin="anonymous"`,

то браузер блокирует доступ к буферу и выдаёт `MediaElementAudioSource outputs zeroes`.

## Решение

### 1. Настроить CORS на радио (`radio.bodhemusic.com`)

На уровне nginx/прокси/AzuraCast для стримов добавлены заголовки:

```nginx
add_header 'Access-Control-Allow-Origin' '*';
add_header 'Access-Control-Allow-Methods' 'GET, OPTIONS';
add_header 'Access-Control-Allow-Headers' 'Range';
add_header 'Access-Control-Expose-Headers' 'Content-Length,Content-Range';
```

Важно:

- Эти заголовки должны реально **присутствовать в ответе на стрим**  
  `https://radio.bodhemusic.com/listen/<noise>/radio.mp3`
- После правки — перезапустить nginx/прокси/службу, чтобы заголовки начали отдаваться.

### 2. Включить `crossOrigin="anonymous"` на фронте

#### 2.1. Мобильный плеер (`IosPlayer.tsx`)

Файл:  
`apps/soundspa-app/app/app/ios-player/IosPlayer.tsx`

Было:

```tsx
return (
  <div className={s.phone}>

    {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
    <audio ref={audioRef} preload="none" />
    {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
    <audio ref={noiseAudioRef} preload="none" />

    {/* ── LOTUS BACKGROUND ── */}
```

Стало:

```tsx
return (
  <div className={s.phone}>

    {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
    <audio ref={audioRef} crossOrigin="anonymous" preload="none" />
    {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
    <audio ref={noiseAudioRef} crossOrigin="anonymous" preload="none" />

    {/* ── LOTUS BACKGROUND ── */}
```

#### 2.2. Десктопный плеер (`DesktopPlayer.tsx`)

Файл:  
`apps/soundspa-app/app/app/ios-player/DesktopPlayer.tsx`

Было:

```tsx
return (
  <div className={s.desktopShell}>
    {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
    <audio ref={audioRef} preload="none" />
    {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
    <audio ref={noiseAudioRef} preload="none" />

    {/* Lotus — позиционируется за всем контентом */}
```

Стало:

```tsx
return (
  <div className={s.desktopShell}>
    {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
    <audio ref={audioRef} crossOrigin="anonymous" preload="none" />
    {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
    <audio ref={noiseAudioRef} crossOrigin="anonymous" preload="none" />

    {/* Lotus — позиционируется за всем контентом */}
```

### 3. Проверка после фикса

Проверяем на десктопе (Chrome/Safari):

1. Открыть плеер (можно с `?player=v2`, если используем v2-режим).
2. Включить один из основных каналов — музыка должна играть.
3. Включить шум **Forest ambience**:
   - В DevTools → Console:
     - **нет** ошибки `MediaElementAudioSource outputs zeroes due to CORS`.
   - В DevTools → Network по запросу `forest_ambience/radio.mp3`:
     - видны заголовки `Access-Control-Allow-Origin`, и т.д.
   - В ушах:
     - слышен лес поверх основного канала.

После добавления CORS на уровне сервера заголовки распространились и на остальные шумовые каналы (Sea, Night), поэтому они тоже начали работать без дополнительных изменений.

## Как решать такие проблемы в будущем

Чеклист:

1. Если WebAudio (`AudioContext` + `createMediaElementSource`) даёт `outputs zeroes`:
   - Проверить **CORS** на сервере (заголовки в ответе стрима).
   - Проверить, что на `<audio>` есть `crossOrigin="anonymous"`.

2. Если раньше всё работало, а теперь сломалось:
   - Вспомнить, не меняли ли:
     - способ воспроизведения (plain `<audio>` → WebAudio),
     - домен/прокси/HTTPS,
     - политику браузера (обновления).

3. Для новых аудиопотоков/шумов:
   - сразу:
     - настроить CORS (минимум `Access-Control-Allow-Origin`),
     - добавить `crossOrigin="anonymous"` на `<audio>`.

## Итог

- Шумовые каналы **Forest / Sea / Night** теперь играют поверх основного потока.
- Консоль чистая от CORS-ошибок.
- Архитектура WebAudio с `GainNode` для шумов остаётся, но теперь официально «узаконена» через CORS + `crossOrigin`.
