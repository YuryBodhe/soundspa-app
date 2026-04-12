'use client';

import { useEffect, useState, useRef } from 'react';

type SpaChannel = {
  id: number;
  code: string;
  displayName: string;
  streamUrl: string;
};

export default function SpaquatoriaClientOriginal() {
  const [channels, setChannels] = useState<SpaChannel[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentChannelCode, setCurrentChannelCode] = useState<string>('');
  const [isPlaying, setIsPlaying] = useState(false);
  const [brandName, setBrandName] = useState('Sound Spa');
  const [accessLabel, setAccessLabel] = useState('sound spa');
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const backgroundUrl = "/soundspa_bg.jpg";

  useEffect(() => {
    async function loadAppData() {
      try {
        const response = await fetch('/api/app-data', {
          credentials: 'include'
        });
        
        if (response.ok) {
          const data = await response.json();
          setChannels(data.channels || []);
          setBrandName(data.tenant?.brandName || 'Sound Spa');
          
          if (data.channels && data.channels.length > 0) {
            setCurrentChannelCode(data.channels[0].code);
          }
          
          // Calculate access label
          const paidTillMs = data.tenant?.paidTill;
          if (paidTillMs) {
            const now = Date.now();
            if (paidTillMs > now) {
              const diffDays = Math.ceil((paidTillMs - now) / (24 * 60 * 60 * 1000));
              setAccessLabel(`sound spa · trial access · осталось ${diffDays} дн.`);
            } else {
              setAccessLabel('sound spa · access expired');
            }
          } else {
            setAccessLabel('sound spa · access');
          }
          
          setLoading(false);
        } else {
          // Fallback to mock data for testing
          setChannels([
            { id: 1, code: 'chill', displayName: 'CHILL', streamUrl: 'https://stream.bodhemusic.com/chill.mp3' },
            { id: 2, code: 'focus', displayName: 'FOCUS', streamUrl: 'https://stream.bodhemusic.com/focus.mp3' },
            { id: 3, code: 'energy', displayName: 'ENERGY', streamUrl: 'https://stream.bodhemusic.com/energy.mp3' },
            { id: 4, code: 'sleep', displayName: 'SLEEP', streamUrl: 'https://stream.bodhemusic.com/sleep.mp3' },
          ]);
          setCurrentChannelCode('chill');
          setBrandName('Spaquatoria');
          setAccessLabel('sound spa · access');
          setLoading(false);
        }
      } catch (error) {
        console.error('Failed to load app data:', error);
        setLoading(false);
      }
    }

    loadAppData();
  }, []);

  useEffect(() => {
    if (!audioRef.current || !currentChannelCode || !channels.length) return;
    
    const channel = channels.find(c => c.code === currentChannelCode);
    if (!channel) return;
    
    if (audioRef.current.src !== channel.streamUrl) {
      audioRef.current.src = channel.streamUrl;
    }
  }, [currentChannelCode, channels]);

  const togglePlay = () => {
    const audio = audioRef.current;
    if (!audio) return;

    if (isPlaying) {
      audio.pause();
      setIsPlaying(false);
    } else {
      // iOS requires direct user interaction for audio.play()
      audio.play().then(() => {
        setIsPlaying(true);
      }).catch(err => {
        console.log('Audio play failed (iOS restriction):', err);
        // Show user-friendly message for iOS
        alert('Tap the play button directly to start audio on iOS');
      });
    }
  };

  const currentChannel = channels.find(c => c.code === currentChannelCode);

  if (loading) {
    return (
      <main style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "#07060a",
        fontFamily: "sans-serif",
      }}>
        <p style={{
          fontSize: 10,
          letterSpacing: "0.38em",
          textTransform: "uppercase",
          fontWeight: 300,
          color: "rgba(195,168,108,0.5)",
        }}>
          Loading...
        </p>
      </main>
    );
  }

  return (
    <>
      <audio ref={audioRef} preload="none" />
      
      <div style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 0,
        backgroundColor: '#07060a'
      }}>
        {backgroundUrl && (
          <div style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundImage: `url(${backgroundUrl})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            opacity: 0.2,
            filter: 'blur(12px)'
          }} />
        )}
      </div>

      <main style={{
        position: 'relative',
        zIndex: 1,
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: "20px",
        fontFamily: "sans-serif",
        color: "white"
      }}>
        {/* Header */}
        <header style={{
          width: '100%',
          maxWidth: '420px',
          marginBottom: '30px',
          paddingTop: '20px'
        }}>
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '8px'
          }}>
            <h1 style={{
              fontSize: "18px",
              fontWeight: 500,
              margin: 0,
              letterSpacing: "0.02em",
              color: "white"
            }}>
              {brandName}
            </h1>
          </div>
          
          <p style={{
            fontSize: "10px",
            letterSpacing: "0.38em",
            textTransform: "uppercase",
            fontWeight: 300,
            color: "rgba(195,168,108,0.5)",
            margin: 0
          }}>
            {accessLabel}
          </p>
        </header>

        {/* Main content */}
        <div style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          width: '100%',
          maxWidth: '420px'
        }}>
          {/* Play button with wave animation */}
          <div style={{
            marginBottom: '40px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center'
          }}>
            <button
              onClick={togglePlay}
              style={{
                width: "68px",
                height: "68px",
                borderRadius: "50%",
                border: "1px solid rgba(195,168,108,0.55)",
                background: "rgba(7,6,10,0.45)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
                marginBottom: "20px",
                transition: "border-color 0.3s, background 0.3s"
              }}
            >
              {isPlaying ? (
                <div style={{ color: '#c8a84b', fontSize: '24px' }}>⏸️</div>
              ) : (
                <div style={{ 
                  color: '#c8a84b', 
                  fontSize: '24px',
                  marginLeft: '4px' 
                }}>▶️</div>
              )}
            </button>

            {/* Wave animation when playing */}
            {isPlaying && (
              <div className="sq-wave playing" style={{
                display: 'flex',
                alignItems: 'flex-end',
                height: '32px',
                gap: '2px',
                marginBottom: '10px'
              }}>
                {Array.from({ length: 15 }).map((_, i) => (
                  <span key={i} style={{
                    display: 'block',
                    width: '2px',
                    background: '#c8aa68',
                    borderRadius: '2px',
                    height: `${10 + Math.random() * 22}px`,
                    opacity: 0.7
                  }} />
                ))}
              </div>
            )}

            {/* Current channel name */}
            {currentChannel && (
              <div style={{
                fontSize: '14px',
                fontWeight: 300,
                color: 'rgba(255,255,255,0.7)',
                textAlign: 'center',
                marginBottom: '5px'
              }}>
                {currentChannel.displayName}
              </div>
            )}
          </div>

          {/* Channel list */}
          <div style={{
            width: '100%',
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
            marginBottom: '40px'
          }}>
            {channels.map((channel, index) => (
              <button
                key={channel.id}
                onClick={() => setCurrentChannelCode(channel.code)}
                style={{
                  width: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  padding: '12px 16px',
                  cursor: 'pointer',
                  border: currentChannelCode === channel.code 
                    ? '1px solid rgba(195,168,108,0.35)' 
                    : '1px solid rgba(195,168,108,0.1)',
                  background: currentChannelCode === channel.code
                    ? 'rgba(195,168,108,0.08)'
                    : 'rgba(195,168,108,0.03)',
                  borderRadius: '8px',
                  transition: 'border-color 0.25s, background 0.25s, opacity 0.25s',
                  opacity: currentChannelCode === channel.code ? 1 : 0.5
                }}
              >
                {/* Active dot */}
                <div style={{
                  width: '5px',
                  height: '5px',
                  borderRadius: '50%',
                  background: '#c8a84b',
                  opacity: currentChannelCode === channel.code ? 1 : 0,
                  flexShrink: 0,
                  transition: 'opacity 0.25s'
                }} />

                {/* Track number */}
                <div style={{
                  fontSize: '10px',
                  letterSpacing: '0.15em',
                  color: currentChannelCode === channel.code 
                    ? 'rgba(195,168,108,0.6)' 
                    : 'rgba(195,168,108,0.35)',
                  fontWeight: 200,
                  flexShrink: 0,
                  width: '18px',
                  transition: 'color 0.25s'
                }}>
                  {(index + 1).toString().padStart(2, '0')}
                </div>

                {/* Track name */}
                <div style={{
                  flex: 1,
                  fontSize: '14px',
                  fontWeight: 300,
                  color: 'white',
                  textAlign: 'left'
                }}>
                  {channel.displayName}
                </div>

                {/* Live indicator for active track */}
                {currentChannelCode === channel.code && isPlaying && (
                  <div style={{
                    fontSize: '9px',
                    letterSpacing: '0.2em',
                    textTransform: 'uppercase',
                    color: 'rgba(195,168,108,0.4)',
                    fontWeight: 200,
                    flexShrink: 0,
                    opacity: 1,
                    transition: 'opacity 0.25s'
                  }}>
                    LIVE
                  </div>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Footer */}
        <footer style={{
          width: '100%',
          maxWidth: '420px',
          paddingBottom: '20px',
          textAlign: 'center'
        }}>
          <div style={{
            fontSize: '10px',
            letterSpacing: '0.38em',
            textTransform: 'uppercase',
            fontWeight: 300,
            color: 'rgba(195,168,108,0.3)',
            marginBottom: '8px'
          }}>
            iOS Safari optimized
          </div>
          
          <div style={{
            fontSize: '9px',
            letterSpacing: '0.2em',
            textTransform: 'uppercase',
            fontWeight: 200,
            color: 'rgba(255,255,255,0.2)'
          }}>
            {isPlaying ? 'Now playing' : 'Paused'} • Tap play to start
          </div>
        </footer>

        {/* Wave animation keyframes */}
        <style>{`
          @keyframes sqW {
            0%, 100% { transform: scaleY(0.25); }
            50% { transform: scaleY(1); }
          }
          
          .sq-wave.playing span:nth-child(1)  { animation: sqW 1.4s ease-in-out infinite 0s; }
          .sq-wave.playing span:nth-child(2)  { animation: sqW 1.4s ease-in-out infinite .08s; }
          .sq-wave.playing span:nth-child(3)  { animation: sqW 1.4s ease-in-out infinite .16s; }
          .sq-wave.playing span:nth-child(4)  { animation: sqW 1.4s ease-in-out infinite .24s; }
          .sq-wave.playing span:nth-child(5)  { animation: sqW 1.4s ease-in-out infinite .32s; }
          .sq-wave.playing span:nth-child(6)  { animation: sqW 1.4s ease-in-out infinite .40s; }
          .sq-wave.playing span:nth-child(7)  { animation: sqW 1.4s ease-in-out infinite .48s; }
          .sq-wave.playing span:nth-child(8)  { animation: sqW 1.4s ease-in-out infinite .56s; }
          .sq-wave.playing span:nth-child(9)  { animation: sqW 1.4s ease-in-out infinite .48s; }
          .sq-wave.playing span:nth-child(10) { animation: sqW 1.4s ease-in-out infinite .40s; }
          .sq-wave.playing span:nth-child(11) { animation: sqW 1.4s ease-in-out infinite .32s; }
          .sq-wave.playing span:nth-child(12) { animation: sqW 1.4s ease-in-out infinite .24s; }
          .sq-wave.playing span:nth-child(13) { animation: sqW 1.4s ease-in-out infinite .16s; }
          .sq-wave.playing span:nth-child(14) { animation: sqW 1.4s ease-in-out infinite .08s; }
          .sq-wave.playing span:nth-child(15) { animation: sqW 1.4s ease-in-out infinite 0s; }
        `}</style>
      </main>
    </>
  );
}