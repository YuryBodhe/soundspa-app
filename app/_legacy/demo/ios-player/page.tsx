'use client';

import { useEffect, useRef, useState } from 'react';

export default function IOSDemoPlayer() {
  const [playing, setPlaying] = useState(false);
  const [showIOSMessage, setShowIOSMessage] = useState(false);
  const [currentChannel, setCurrentChannel] = useState(0);
  
  const audioRef = useRef<HTMLAudioElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number | null>(null);
  
  // Каналы для теста
  const channels = [
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
  ];
  
  // Инициализация аудио
  useEffect(() => {
    if (audioRef.current && channels.length > 0 && currentChannel < channels.length) {
      const audio = audioRef.current;
      const current = channels[currentChannel];
      console.log('🎵 Demo: Initializing audio with src:', current.streamUrl);
      audio.src = current.streamUrl;
      audio.preload = 'none';
    }
  }, [currentChannel]);
  
  // Canvas wave animation
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
  
  // Логика кнопки от Гарри
  const togglePlay = () => {
    const audio = audioRef.current;
    if (!audio) {
      console.log('❌ No audio element!');
      return;
    }

    const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent);

    console.log('🎵 Demo togglePlay called, playing:', playing);
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

  const current = channels[currentChannel];

  return (
    <>
      <audio ref={audioRef} preload="none" />
      
      {/* Сообщение для iOS */}
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
      
      {/* Макет дизайнера */}
      <div style={{
        maxWidth: '390px',
        margin: '0 auto',
        background: '#07070a',
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        position: 'relative',
        overflow: 'hidden'
      }}>
        {/* Lotus background */}
        <div style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          pointerEvents: 'none',
          zIndex: 0
        }}>
          <div style={{
            animation: 'lotusBreathe 9s ease-in-out infinite',
            width: '280px',
            height: '280px',
            background: 'radial-gradient(circle, rgba(200,192,176,0.03) 0%, transparent 70%)',
            borderRadius: '50%'
          }} />
        </div>
        
        {/* Header */}
        <header style={{
          position: 'relative',
          zIndex: 10,
          padding: '20px 22px 16px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          borderBottom: '1px solid rgba(255,255,255,0.04)'
        }}>
          <div>
            <div style={{
              fontFamily: "'Cormorant Garamond', serif",
              fontSize: '20px',
              fontWeight: 400,
              letterSpacing: '0.04em',
              color: '#d8d0c0',
              lineHeight: '1.1'
            }}>
              Spaquatoria
            </div>
            <div style={{
              fontSize: '8px',
              letterSpacing: '0.32em',
              textTransform: 'uppercase',
              color: '#3a3530',
              marginTop: '4px'
            }}>
              DEMO iOS PLAYER
            </div>
          </div>
          
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'flex-end',
            gap: '7px'
          }}>
            <div style={{
              fontSize: '8px',
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
              padding: '4px 10px',
              borderRadius: '20px',
              background: 'rgba(200,192,176,0.08)',
              color: '#c8c0b0',
              border: '1px solid rgba(200,192,176,0.2)'
            }}>
              DEMO MODE
            </div>
          </div>
        </header>
        
        {/* Main player */}
        <main style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          padding: '30px 22px',
          position: 'relative',
          zIndex: 5
        }}>
          {/* Now playing */}
          <div style={{ textAlign: 'center', marginBottom: '40px' }}>
            <div style={{
              fontSize: '10px',
              letterSpacing: '0.32em',
              textTransform: 'uppercase',
              color: 'rgba(200,192,176,0.5)',
              marginBottom: '8px'
            }}>
              Now playing
            </div>
            <div style={{
              fontFamily: "'Cormorant Garamond', serif",
              fontSize: '32px',
              fontWeight: 400,
              color: '#e8e0d0',
              marginBottom: '6px',
              letterSpacing: '0.02em'
            }}>
              {current?.displayName || 'Relax'}
            </div>
            <div style={{
              fontSize: '13px',
              color: 'rgba(200,192,176,0.7)',
              fontWeight: 300
            }}>
              {current?.mood || 'Calm & Peaceful'}
            </div>
          </div>
          
          {/* Player controls */}
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            marginBottom: '40px'
          }}>
            {/* Wave canvas */}
            <div style={{
              height: '40px',
              marginBottom: '10px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}>
              <canvas 
                ref={canvasRef}
                width="200"
                height="40"
                style={{
                  width: '200px',
                  height: '40px',
                  display: playing ? 'block' : 'none'
                }}
              />
              
              {!playing && (
                <div style={{
                  display: 'flex',
                  alignItems: 'flex-end',
                  gap: '4px',
                  height: '40px'
                }}>
                  <div style={{ width: '4px', height: '8px', background: 'rgba(200,192,176,0.1)', borderRadius: '2px' }} />
                  <div style={{ width: '4px', height: '18px', background: 'rgba(200,192,176,0.1)', borderRadius: '2px' }} />
                  <div style={{ width: '4px', height: '12px', background: 'rgba(200,192,176,0.1)', borderRadius: '2px' }} />
                  <div style={{ width: '4px', height: '22px', background: 'rgba(200,192,176,0.1)', borderRadius: '2px' }} />
                  <div style={{ width: '4px', height: '8px', background: 'rgba(200,192,176,0.1)', borderRadius: '2px' }} />
                </div>
              )}
            </div>
            
            {/* Play button - Yin Yang */}
            <button 
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
                style={{
                  width: '100%',
                  height: '100%',
                  filter: playing ? 'brightness(1.1) saturate(1.2)' : 'brightness(0.9) saturate(0.9)',
                  transition: 'filter 0.3s ease'
                }}
              />
            </button>
            
            {/* Channel navigation */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '20px',
              marginTop: '10px'
            }}>
              <button 
                onClick={() => setCurrentChannel((prev) => (prev - 1 + channels.length) % channels.length)}
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
              
              <div style={{ fontSize: '12px', opacity: 0.7 }}>
                {currentChannel + 1} / {channels.length}
              </div>
              
              <button 
                onClick={() => setCurrentChannel((prev) => (prev + 1) % channels.length)}
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
          
          {/* Status info */}
          <div style={{
            textAlign: 'center',
            fontSize: '11px',
            opacity: 0.5,
            marginTop: '20px'
          }}>
            <div>🎯 Clean Demo Page - No Middleware</div>
            <div style={{ fontSize: '9px', marginTop: '4px' }}>
              Tap play button - UI should respond immediately
            </div>
          </div>
        </main>
        
        <style>{`
          @keyframes lotusBreathe {
            0%, 100% { opacity: 0.055; }
            50% { opacity: 0.095; }
          }
        `}</style>
      </div>
    </>
  );
}