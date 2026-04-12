'use client';

import { useEffect, useRef, useState } from 'react';

type Channel = {
  id: number;
  code: string;
  displayName: string;
  streamUrl: string;
  mood: string;
  description: string;
};

export default function NewIOSPlayer() {
  const [playing, setPlaying] = useState(false);
  const [currentChannel, setCurrentChannel] = useState(0);
  const [channels, setChannels] = useState<Channel[]>([
  
    {
      id: 1,
      code: 'relax',
      displayName: 'Relax',
      streamUrl: 'https://stream.bodhemusic.com/relax.mp3',
      mood: 'Calm & Peaceful',
      description: 'Gentle ambient textures for relaxation'
    },
    {
      id: 2,
      code: 'focus',
      displayName: 'Focus',
      streamUrl: 'https://stream.bodhemusic.com/focus.mp3',
      mood: 'Concentrated & Clear',
      description: 'Minimal beats for deep work'
    },
    {
      id: 3,
      code: 'energy',
      displayName: 'Energy',
      streamUrl: 'https://stream.bodhemusic.com/energy.mp3',
      mood: 'Vibrant & Alive',
      description: 'Upbeat rhythms for motivation'
    }
  ]);
  
  const audioRef = useRef<HTMLAudioElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number | null>(null);
  
  // Инициализация аудио с src сразу
  useEffect(() => {
    if (audioRef.current && channels.length > 0 && currentChannel < channels.length) {
      const audio = audioRef.current;
      const current = channels[currentChannel];
      console.log('🎵 Initializing audio with src:', current.streamUrl);
      audio.src = current.streamUrl;
      audio.preload = 'none'; // Не preload на iOS
    }
  }, [channels, currentChannel]);

  // Инициализация волны Canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const waveStart = () => {
      let time = 0;
      
      const drawWave = () => {
        if (!playing) return;
        
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = 'rgba(200, 192, 176, 0.7)';
        
        const bars = 15;
        const width = canvas.width / bars;
        
        for (let i = 0; i < bars; i++) {
          const height = Math.sin(time * 0.05 + i * 0.3) * 10 + 15;
          const x = i * width;
          const y = (canvas.height - height) / 2;
          
          ctx.fillRect(x, y, width - 2, height);
        }
        
        time += 0.1;
        animationRef.current = requestAnimationFrame(drawWave);
      };
      
      animationRef.current = requestAnimationFrame(drawWave);
    };
    
    const waveStop = () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
        animationRef.current = null;
      }
      
      if (canvas) {
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.clearRect(0, 0, canvas.width, canvas.height);
        }
      }
    };
    
    if (playing) {
      waveStart();
    } else {
      waveStop();
    }
    
    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [playing]);

  // Audio control - ВАЖНО: инициализируем src при монтировании
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !channels.length) return;
    
    const current = channels[currentChannel];
    if (current) {
      console.log('🎵 Setting audio src:', current.streamUrl);
      audio.src = current.streamUrl;
    }
  }, [currentChannel, channels]); // Только при изменении канала
  
  // Control play/pause
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    
    if (playing) {
      console.log('🎵 Playing audio...');
      audio.play().catch(err => {
        console.log('🎵 Audio play failed in useEffect:', err);
        setPlaying(false);
      });
    } else {
      console.log('🎵 Pausing audio');
      audio.pause();
    }
  }, [playing]);

  const [showIOSMessage, setShowIOSMessage] = useState(false);
  const [isIOS, setIsIOS] = useState(false);

  useEffect(() => {
    const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
    setIsIOS(ios);
    console.log('📱 iOS detection result:', ios, 'User agent:', navigator.userAgent);
    console.log('🎵 Audio element exists:', !!audioRef.current);
    console.log('🎵 Audio src:', audioRef.current?.src);
  }, []);

  const togglePlay = () => {
    const audio = audioRef.current;
    if (!audio) {
      console.log('❌ No audio element!');
      return;
    }

    const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent);

    console.log('🎵 togglePlay called, playing:', playing);
    console.log('🎵 Audio src:', audio.src);
    console.log('🎵 Audio readyState:', audio.readyState);
    console.log('📱 isIOS:', isIOS);

    // Если уже играем — просто пауза
    if (playing) {
      try {
        audio.pause();
      } catch (e) {
        console.log('⚠️ Pause error:', e);
      }
      setPlaying(false);
      setShowIOSMessage(false);
      console.log('⏸️ Paused');
      return;
    }

    // 👉 1. Сначала запускаем UI (луна + волна)
    setPlaying(true);
    setShowIOSMessage(false);

    // 👉 2. Потом пытаемся запустить звук
    try {
      const playResult = audio.play();

      // Если браузер вернул Promise — аккуратно обрабатываем
      if (playResult && typeof playResult.then === 'function') {
        playResult
          .then(() => {
            console.log('✅ Audio play SUCCESS');
            // Ничего не делаем: UI уже в состоянии playing
          })
          .catch(error => {
            console.log('❌ Audio play FAILED:', error.name, error.message);

            if (isIOS) {
              console.log('📱 Showing iOS help message');
              setShowIOSMessage(true);
              // НЕ откатываем setPlaying(false) — плеер визуально остаётся "играющим"
              setTimeout(() => {
                setShowIOSMessage(false);
              }, 5000);
            }
          });
      } else {
        // Быстрый sync-путь (некоторые браузеры так делают)
        console.log('✅ Audio.play() returned non-promise result');
      }
    } catch (error: any) {
      console.log('❌ Audio play threw synchronously:', error.name, error.message);

      if (isIOS) {
        console.log('📱 Showing iOS help message (sync error)');
        setShowIOSMessage(true);
        setTimeout(() => {
          setShowIOSMessage(false);
        }, 5000);
      }
      // UI оставляем в playing = true
    }
  };

  const switchChannel = (index: number) => {
    setCurrentChannel(index);
    // Если играет, переключить трек
    if (playing && audioRef.current) {
      const audio = audioRef.current;
      const newChannel = channels[index];
      if (newChannel) {
        audio.src = newChannel.streamUrl;
        audio.play().catch(err => {
          console.log('Channel switch audio error:', err);
        });
      }
    }
  };

  const current = channels[currentChannel];

  return (
    <>
      <audio ref={audioRef} preload="none" />
      
      {/* Сообщение для iOS если аудио заблокировано */}
      {showIOSMessage && (
        <div style={{
          position: 'fixed',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          background: 'rgba(0,0,0,0.9)',
          color: '#c8c0b0',
          padding: '20px',
          borderRadius: '12px',
          border: '1px solid rgba(200,192,176,0.3)',
          zIndex: 1000,
          textAlign: 'center',
          maxWidth: '300px',
          fontFamily: "'Jost', sans-serif"
        }}>
          <div style={{ marginBottom: '10px', fontSize: '16px' }}>🎵 iOS Safari</div>
          <div style={{ fontSize: '14px', marginBottom: '15px', opacity: 0.9 }}>
            Tap the play button directly to start audio
          </div>
          <button 
            onClick={() => setShowIOSMessage(false)}
            style={{
              background: 'rgba(200,192,176,0.2)',
              border: '1px solid rgba(200,192,176,0.4)',
              color: '#c8c0b0',
              padding: '8px 16px',
              borderRadius: '6px',
              cursor: 'pointer'
            }}
          >
            OK
          </button>
        </div>
      )}
      
      {/* Основная структура из макета */}
      <div className="phone">
        {/* Lotus background */}
        <div className="lotus-bg">
          <div className="lotus-svg">
            {/* Lotus SVG будет здесь */}
            <div style={{
              width: '280px',
              height: '280px',
              background: 'radial-gradient(circle, rgba(200,192,176,0.03) 0%, transparent 70%)',
              borderRadius: '50%'
            }} />
          </div>
        </div>
        
        {/* Header */}
        <header className="header">
          <div>
            <div className="salon-name">Spaquatoria</div>
            <div className="platform-tag">SOUND SPA</div>
          </div>
          
          <div className="header-right">
            <div className="sub-badge" style={{
              background: 'rgba(200,192,176,0.08)',
              color: '#c8c0b0',
              border: '1px solid rgba(200,192,176,0.2)'
            }}>
              TRIAL ACCESS
            </div>
            <div className="time-remaining">
              <span style={{ fontSize: '9px', letterSpacing: '0.1em', opacity: 0.6 }}>
                осталось 14 дн.
              </span>
            </div>
          </div>
        </header>
        
        {/* Main player section */}
        <main className="player-section">
          {/* Channel display */}
          <div className="now-playing">
            <div className="np-label">Now playing</div>
            <div className="channel-name">{current?.displayName || 'Relax'}</div>
            <div className="mood">{current?.mood || 'Calm & Peaceful'}</div>
          </div>
          
          {/* Player controls */}
          <div className="player-controls">
            {/* Wave canvas */}
            <div className="wave-container">
              <canvas 
                ref={canvasRef}
                width="200"
                height="40"
                className="wave-canvas"
                style={{
                  width: '200px',
                  height: '40px',
                  display: playing ? 'block' : 'none'
                }}
              />
              
              {!playing && (
                <div className="wave-placeholder">
                  <div className="wv-bar" style={{ height: '8px', background: 'rgba(200,192,176,0.1)' }} />
                  <div className="wv-bar" style={{ height: '18px', background: 'rgba(200,192,176,0.1)' }} />
                  <div className="wv-bar" style={{ height: '12px', background: 'rgba(200,192,176,0.1)' }} />
                  <div className="wv-bar" style={{ height: '22px', background: 'rgba(200,192,176,0.1)' }} />
                  <div className="wv-bar" style={{ height: '8px', background: 'rgba(200,192,176,0.1)' }} />
                </div>
              )}
            </div>
            
            {/* Play button - Yin Yang */}
            <button 
              className="play-btn"
              onClick={togglePlay}
              style={{
                width: '100px',
                height: '100px',
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                margin: '20px 0'
              }}
            >
              <img 
                src="/assets/yin-yang.png" 
                alt="Play/Pause"
                className="yy-svg"
                style={{
                  width: '100%',
                  height: '100%',
                  filter: playing ? 'brightness(1.1) saturate(1.2)' : 'brightness(0.9) saturate(0.9)',
                  transition: 'filter 0.3s ease'
                }}
              />
            </button>
            
            {/* Channel navigation */}
            <div className="channel-nav">
              <button 
                className="ch-prev"
                onClick={() => switchChannel((currentChannel - 1 + channels.length) % channels.length)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: '#c8c0b0',
                  fontSize: '14px',
                  cursor: 'pointer',
                  padding: '10px'
                }}
              >
                ←
              </button>
              
              <div className="channel-counter" style={{ fontSize: '12px', opacity: 0.7 }}>
                {currentChannel + 1} / {channels.length}
              </div>
              
              <button 
                className="ch-next"
                onClick={() => switchChannel((currentChannel + 1) % channels.length)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: '#c8c0b0',
                  fontSize: '14px',
                  cursor: 'pointer',
                  padding: '10px'
                }}
              >
                →
              </button>
            </div>
          </div>
          
          {/* Channel carousel */}
          <div className="channel-carousel">
            <div className="carousel-track">
              {channels.map((channel, index) => (
                <div 
                  key={channel.id}
                  className={`channel-card ${index === currentChannel ? 'active' : ''}`}
                  onClick={() => switchChannel(index)}
                  style={{
                    backgroundImage: `url(/assets/channel-${(index % 3) + 1}.jpg)`,
                    backgroundSize: 'cover',
                    backgroundPosition: 'center',
                    position: 'relative',
                    borderRadius: '12px',
                    overflow: 'hidden',
                    cursor: 'pointer',
                    minWidth: '140px',
                    height: '180px',
                    margin: '0 8px',
                    border: index === currentChannel ? '2px solid rgba(200,192,176,0.4)' : '2px solid transparent',
                    transition: 'all 0.3s ease'
                  }}
                >
                  {/* Dark overlay */}
                  <div style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    background: 'linear-gradient(to bottom, transparent 0%, rgba(0,0,0,0.7) 100%)'
                  }} />
                  
                  {/* Channel info */}
                  <div style={{
                    position: 'absolute',
                    bottom: '16px',
                    left: '16px',
                    right: '16px',
                    color: 'white'
                  }}>
                    <div style={{
                      fontSize: '16px',
                      fontWeight: '400',
                      marginBottom: '4px'
                    }}>
                      {channel.displayName}
                    </div>
                    <div style={{
                      fontSize: '11px',
                      opacity: 0.8
                    }}>
                      {channel.mood}
                    </div>
                    
                    {/* Playing indicator */}
                    {index === currentChannel && playing && (
                      <div style={{
                        position: 'absolute',
                        top: '-8px',
                        right: '12px',
                        background: 'rgba(200,192,176,0.9)',
                        color: '#060608',
                        fontSize: '8px',
                        padding: '2px 8px',
                        borderRadius: '10px',
                        letterSpacing: '0.1em'
                      }}>
                        LIVE
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </main>
        
        {/* Footer / Additional info */}
        <footer className="player-footer" style={{
          padding: '20px',
          textAlign: 'center',
          fontSize: '11px',
          opacity: 0.5,
          borderTop: '1px solid rgba(255,255,255,0.04)',
          marginTop: '20px'
        }}>
          <div>Sound Spa • iOS Player</div>
          <div style={{ fontSize: '9px', marginTop: '4px' }}>
            Tap play directly for audio on iOS
          </div>
        </footer>
      </div>
      
      {/* Стили из макета */}
      <style jsx>{`
        .phone {
          max-width: 390px;
          margin: 0 auto;
          background: #07070a;
          min-height: 100vh;
          display: flex;
          flex-direction: column;
          position: relative;
          overflow: hidden;
        }
        
        .lotus-bg {
          position: absolute;
          inset: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          pointer-events: none;
          z-index: 0;
          top: -60px;
        }
        
        .lotus-svg {
          animation: lotusBreathe 9s ease-in-out infinite;
        }
        
        @keyframes lotusBreathe {
          0%, 100% { opacity: 0.055; }
          50% { opacity: 0.095; }
        }
        
        .header {
          position: relative;
          z-index: 10;
          padding: 20px 22px 16px;
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          border-bottom: 1px solid rgba(255,255,255,0.04);
        }
        
        .salon-name {
          font-family: 'Cormorant Garamond', serif;
          font-size: 20px;
          font-weight: 400;
          letter-spacing: 0.04em;
          color: #d8d0c0;
          line-height: 1.1;
        }
        
        .platform-tag {
          font-size: 8px;
          letter-spacing: 0.32em;
          text-transform: uppercase;
          color: #3a3530;
          margin-top: 4px;
        }
        
        .header-right {
          display: flex;
          flex-direction: column;
          align-items: flex-end;
          gap: 7px;
        }
        
        .sub-badge {
          font-size: 8px;
          letter-spacing: 0.14em;
          text-transform: uppercase;
          padding: 4px 10px;
          border-radius: 20px;
        }
        
        .player-section {
          flex: 1;
          display: flex;
          flex-direction: column;
          padding: 30px 22px;
          position: relative;
          z-index: 5;
        }
        
        .now-playing {
          text-align: center;
          margin-bottom: 40px;
        }
        
        .np-label {
          font-size: 10px;
          letter-spacing: 0.32em;
          text-transform: uppercase;
          color: rgba(200,192,176,0.5);
          margin-bottom: 8px;
        }
        
        .channel-name {
          font-family: 'Cormorant Garamond', serif;
          font-size: 32px;
          font-weight: 400;
          color: #e8e0d0;
          margin-bottom: 6px;
          letter-spacing: 0.02em;
        }
        
        .mood {
          font-size: 13px;
          color: rgba(200,192,176,0.7);
          font-weight: 300;
        }
        
        .player-controls {
          display: flex;
          flex-direction: column;
          align-items: center;
          margin-bottom: 40px;
        }
        
        .wave-container {
          height: 40px;
          margin-bottom: 10px;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        
        .wave-placeholder {
          display: flex;
          align-items: flex-end;
          gap: 4px;
          height: 40px;
        }
        
        .wv-bar {
          width: 4px;
          border-radius: 2px;
        }
        
        .channel-nav {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 20px;
          margin-top: 10px;
        }
        
        .channel-carousel {
          overflow-x: auto;
          padding-bottom: 10px;
          margin-top: 20px;
        }
        
        .carousel-track {
          display: flex;
          gap: 12px;
          padding: 0 4px;
        }
        
        .channel-card {
          flex-shrink: 0;
        }
        
        .channel-card.active {
          transform: scale(1.05);
        }
        
        /* Scrollbar styling */
        .channel-carousel::-webkit-scrollbar {
          height: 4px;
        }
        
        .channel-carousel::-webkit-scrollbar-track {
          background: rgba(255,255,255,0.05);
          border-radius: 2px;
        }
        
        .channel-carousel::-webkit-scrollbar-thumb {
          background: rgba(200,192,176,0.3);
          border-radius: 2px;
        }
      `}</style>
    </>
  );
}