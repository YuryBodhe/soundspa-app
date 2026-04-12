"use client";

import { useEffect, useRef, useState } from "react";

export type SpaChannel = {
  id: number;
  code: string;
  displayName: string;
  streamUrl: string;
};

type Props = {
  brandName: string;
  channels: SpaChannel[];
  accessLabel: string;
  backgroundUrl?: string; // необязательный — если не передан, фон просто тёмный
};

export function SpaquatoriaClient({ brandName, channels, accessLabel, backgroundUrl }: Props) {
  const [currentChannelCode, setCurrentChannelCode] = useState<string>(
    channels[0]?.code ?? ""
  );
  const [isPlaying, setIsPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const currentChannel = channels.find((c) => c.code === currentChannelCode);

  useEffect(() => {
    if (!audioRef.current || !currentChannel) return;
    audioRef.current.src = currentChannel.streamUrl;
    if (isPlaying) {
      void audioRef.current.play().catch(() => {
        setIsPlaying(false);
      });
    }
  }, [currentChannelCode, currentChannel?.streamUrl, isPlaying, currentChannel]);

  function togglePlay() {
    const audio = audioRef.current;
    if (!audio || !currentChannel) return;

    if (!isPlaying) {
      audio
        .play()
        .then(() => setIsPlaying(true))
        .catch(() => setIsPlaying(false));
    } else {
      audio.pause();
      setIsPlaying(false);
    }
  }

  function handleChannelClick(code: string) {
    setCurrentChannelCode(code);
  }

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@300;400&family=Montserrat:wght@200;300&display=swap');

        .sq-root {
          min-height: 100vh;
          position: relative;
          display: flex;
          align-items: center;
          justify-content: center;
          background-color: #07060a;
          overflow: hidden;
          font-family: 'Montserrat', sans-serif;
          color: #e2ceaa;
          padding: 48px 24px 40px;
        }

        /* Фото-фон — отдельный слой, управляется через CSS-переменную */
        .sq-bg {
          position: absolute;
          inset: 0;
          background-size: cover;
          background-position: center 48%;
          background-repeat: no-repeat;
          opacity: 0.28;
          pointer-events: none;
        }

        /* Затемнение поверх фото */
        .sq-dim {
          position: absolute;
          inset: 0;
          background:
            radial-gradient(ellipse 50% 45% at 50% 52%, transparent 0%, rgba(7,6,10,0.55) 100%),
            linear-gradient(to bottom, rgba(7,6,10,0.75) 0%, rgba(7,6,10,0.35) 35%, rgba(7,6,10,0.35) 65%, rgba(7,6,10,0.8) 100%);
          pointer-events: none;
        }

        .sq-content {
          position: relative;
          z-index: 2;
          display: flex;
          flex-direction: column;
          align-items: center;
          width: 100%;
          max-width: 420px;
        }

        .sq-track {
          width: 100%;
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 12px 16px;
          cursor: pointer;
          border: 1px solid rgba(195,168,108,0.1);
          background: rgba(195,168,108,0.03);
          transition: border-color 0.25s, background 0.25s, opacity 0.25s;
          opacity: 0.5;
        }
        .sq-track:hover {
          opacity: 0.85;
          border-color: rgba(195,168,108,0.25);
          background: rgba(195,168,108,0.06);
        }
        .sq-track.active {
          opacity: 1;
          border-color: rgba(195,168,108,0.35);
          background: rgba(195,168,108,0.08);
        }
        .sq-track-dot {
          width: 5px; height: 5px; border-radius: 50%;
          background: #c8a84b;
          opacity: 0; flex-shrink: 0;
          transition: opacity 0.25s;
        }
        .sq-track.active .sq-track-dot { opacity: 1; }
        .sq-track-num {
          font-size: 10px; letter-spacing: 0.15em;
          color: rgba(195,168,108,0.35); font-weight: 200;
          flex-shrink: 0; width: 18px;
          transition: color 0.25s;
        }
        .sq-track.active .sq-track-num { color: rgba(195,168,108,0.6); }
        .sq-track-live {
          font-size: 9px; letter-spacing: 0.2em; text-transform: uppercase;
          color: rgba(195,168,108,0.4); font-weight: 200;
          flex-shrink: 0; opacity: 0; transition: opacity 0.25s;
        }
        .sq-track.active .sq-track-live { opacity: 1; }

        .sq-play-btn {
          width: 68px; height: 68px; border-radius: 50%;
          border: 1px solid rgba(195,168,108,0.55);
          background: rgba(7,6,10,0.45);
          display: flex; align-items: center; justify-content: center;
          cursor: pointer;
          transition: border-color 0.3s, background 0.3s;
          flex-shrink: 0;
        }
        .sq-play-btn:hover {
          border-color: rgba(195,168,108,0.9);
          background: rgba(20,16,8,0.6);
        }

        .sq-wave span {
          display: block; width: 2px;
          background: #c8aa68; border-radius: 2px;
          transform: scaleY(0.15); opacity: 0.2;
          transition: transform 0.5s ease, opacity 0.5s ease;
        }
        .sq-wave.playing span { opacity: 0.7; }
        .sq-wave.playing span:nth-child(1)  { animation: sqW 1.4s ease-in-out infinite 0s;   height: 10px; }
        .sq-wave.playing span:nth-child(2)  { animation: sqW 1.4s ease-in-out infinite .08s; height: 18px; }
        .sq-wave.playing span:nth-child(3)  { animation: sqW 1.4s ease-in-out infinite .16s; height: 26px; }
        .sq-wave.playing span:nth-child(4)  { animation: sqW 1.4s ease-in-out infinite .24s; height: 20px; }
        .sq-wave.playing span:nth-child(5)  { animation: sqW 1.4s ease-in-out infinite .32s; height: 30px; }
        .sq-wave.playing span:nth-child(6)  { animation: sqW 1.4s ease-in-out infinite .40s; height: 32px; }
        .sq-wave.playing span:nth-child(7)  { animation: sqW 1.4s ease-in-out infinite .48s; height: 28px; }
        .sq-wave.playing span:nth-child(8)  { animation: sqW 1.4s ease-in-out infinite .56s; height: 22px; }
        .sq-wave.playing span:nth-child(9)  { animation: sqW 1.4s ease-in-out infinite .48s; height: 32px; }
        .sq-wave.playing span:nth-child(10) { animation: sqW 1.4s ease-in-out infinite .40s; height: 24px; }
        .sq-wave.playing span:nth-child(11) { animation: sqW 1.4s ease-in-out infinite .32s; height: 18px; }
        .sq-wave.playing span:nth-child(12) { animation: sqW 1.4s ease-in-out infinite .24s; height: 28px; }
        .sq-wave.playing span:nth-child(13) { animation: sqW 1.4s ease-in-out infinite .16s; height: 14px; }
        .sq-wave.playing span:nth-child(14) { animation: sqW 1.4s ease-in-out infinite .08s; height: 22px; }
        .sq-wave.playing span:nth-child(15) { animation: sqW 1.4s ease-in-out infinite 0s;   height: 10px; }

        @keyframes sqW {
          0%, 100% { transform: scaleY(0.25); }
          50%       { transform: scaleY(1); }
        }
      `}</style>

      <div className="sq-root">

        {/* Фото-фон — рендерится только если передан backgroundUrl */}
        {backgroundUrl && (
          <div
            className="sq-bg"
            style={{ backgroundImage: `url(${backgroundUrl})` }}
          />
        )}

        {/* Затемнение — всегда поверх, независимо от наличия фото */}
        <div className="sq-dim" />

        <div className="sq-content">

          {/* Скрытый аудио-элемент */}
          <audio ref={audioRef} />

          {/* Бренд сервиса */}
          <div
            style={{
              fontFamily: "'Cormorant Garamond', serif",
              fontWeight: 300,
              fontSize: 32,
              letterSpacing: "0.34em",
              textTransform: "uppercase",
              color: "#f2dfc0",
              marginBottom: 6,
              textAlign: "center",
            }}
          >
            Sound Spa
          </div>

          {/* Название салона */}
          <div
            style={{
              fontSize: 11,
              letterSpacing: "0.22em",
              textTransform: "uppercase",
              color: "rgba(240,214,168,0.95)",
              fontWeight: 300,
              marginBottom: 26,
              textAlign: "center",
              whiteSpace: "nowrap",
            }}
          >
            {brandName}
          </div>

          {/* Разделитель */}
          <div
            style={{
              width: 1,
              height: 24,
              background:
                "linear-gradient(to bottom, transparent, rgba(195,168,108,0.4), transparent)",
              marginBottom: 30,
            }}
          />

          {/* Каналы */}
          {channels.length > 0 ? (
            <div style={{
              width: "100%",
              display: "flex",
              flexDirection: "column",
              gap: 6,
              marginBottom: 36,
            }}>
              {channels.map((c, i) => (
                <div
                  key={c.id}
                  className={`sq-track${c.code === currentChannelCode ? " active" : ""}`}
                  onClick={() => handleChannelClick(c.code)}
                >
                  <div className="sq-track-dot" />
                  <div className="sq-track-num">{String(i + 1).padStart(2, "0")}</div>
                  <div style={{
                    fontSize: 11,
                    letterSpacing: "0.28em",
                    textTransform: "uppercase",
                    fontWeight: 300,
                    color: "#e2ceaa",
                    flex: 1,
                  }}>
                    {c.displayName}
                  </div>
                  <div className="sq-track-live">live</div>
                </div>
              ))}
            </div>
          ) : (
            <p style={{
              fontSize: 11,
              letterSpacing: "0.3em",
              color: "rgba(200,178,130,0.3)",
              marginBottom: 36,
            }}>
              Каналы не подключены
            </p>
          )}

          {/* Кнопка Play / Pause */}
          <button
            type="button"
            aria-label={isPlaying ? "Pause" : "Play"}
            className="sq-play-btn"
            style={{ marginBottom: 22 }}
            onClick={togglePlay}
          >
            {isPlaying ? (
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                <rect x="4"  y="2" width="4" height="16" rx="1.5" fill="rgba(220,196,138,0.9)" />
                <rect x="12" y="2" width="4" height="16" rx="1.5" fill="rgba(220,196,138,0.9)" />
              </svg>
            ) : (
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                <polygon points="6,2 18,10 6,18" fill="rgba(220,196,138,0.9)" />
              </svg>
            )}
          </button>

          {/* Now playing */}
          <div
            style={{
              fontSize: 10,
              letterSpacing: "0.42em",
              textTransform: "uppercase",
              color: isPlaying
                ? "rgba(240,214,168,0.95)"
                : "rgba(215,190,145,0.75)",
              fontWeight: 200,
              marginBottom: 16,
              transition: "color 0.4s",
            }}
          >
            Now playing — Live stream
          </div>

          {/* Waveform */}
          <div
            className={`sq-wave${isPlaying ? " playing" : ""}`}
            aria-hidden="true"
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 3,
              height: 32,
              marginBottom: 32,
            }}
          >
            {Array.from({ length: 15 }).map((_, i) => (
              <span key={i} />
            ))}
          </div>

          {/* Подпись */}
          <footer
            style={{
              fontSize: 11,
              letterSpacing: "0.35em",
              textTransform: "lowercase",
              color: "rgba(240,214,168,0.95)",
              fontWeight: 200,
              textAlign: "center",
            }}
          >
            {accessLabel}
          </footer>

        </div>
      </div>
    </>
  );
}
