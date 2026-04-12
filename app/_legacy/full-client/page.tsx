'use client';

import { useEffect, useState, useRef } from 'react';

type SpaChannel = {
  id: number;
  code: string;
  displayName: string;
  streamUrl: string;
};

export default function FullClientAppPage() {
  const [channels, setChannels] = useState<SpaChannel[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentChannelCode, setCurrentChannelCode] = useState<string>('');
  const [isPlaying, setIsPlaying] = useState(false);
  const [brandName, setBrandName] = useState('Sound Spa');
  const [accessLabel, setAccessLabel] = useState('sound spa');
  const audioRef = useRef<HTMLAudioElement | null>(null);

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
          // Fallback to mock data
          setChannels([
            { id: 1, code: 'chill', displayName: 'Chill', streamUrl: 'https://stream.bodhemusic.com/chill.mp3' },
            { id: 2, code: 'focus', displayName: 'Focus', streamUrl: 'https://stream.bodhemusic.com/focus.mp3' },
          ]);
          setCurrentChannelCode('chill');
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
      
      <main style={{
        minHeight: "100vh",
        backgroundColor: "#07060a",
        fontFamily: "sans-serif",
        color: "white",
        display: "flex",
        flexDirection: "column"
      }}>
        {/* Header */}
        <header style={{
          padding: "20px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          borderBottom: "1px solid rgba(255,255,255,0.1)"
        }}>
          <div>
            <h1 style={{
              fontSize: "18px",
              fontWeight: 500,
              margin: 0,
              letterSpacing: "0.02em"
            }}>
              {brandName}
            </h1>
            <p style={{
              fontSize: "10px",
              opacity: 0.7,
              margin: "4px 0 0 0",
              letterSpacing: "0.38em",
              textTransform: "uppercase",
              fontWeight: 300,
            }}>
              {accessLabel}
            </p>
          </div>
          
          {/* Channel selector would go here */}
        </header>

        {/* Main content */}
        <div style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "20px",
          position: "relative"
        }}>
          {/* Background would be here */}
          
          {/* Play button */}
          <button
            onClick={togglePlay}
            style={{
              width: "80px",
              height: "80px",
              borderRadius: "50%",
              background: isPlaying ? "#FF3B30" : "#34C759",
              border: "none",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              marginBottom: "30px",
              boxShadow: "0 8px 32px rgba(0,0,0,0.3)"
            }}
          >
            <span style={{
              fontSize: "28px",
              color: "white",
              marginLeft: isPlaying ? "0" : "4px"
            }}>
              {isPlaying ? "⏸️" : "▶️"}
            </span>
          </button>

          {/* Current channel info */}
          {currentChannel && (
            <div style={{ textAlign: "center", marginBottom: "30px" }}>
              <h2 style={{
                fontSize: "20px",
                margin: "0 0 8px 0",
                fontWeight: 500
              }}>
                {currentChannel.displayName}
              </h2>
              <p style={{
                fontSize: "14px",
                opacity: 0.7,
                margin: 0
              }}>
                {isPlaying ? "Now playing" : "Paused"}
              </p>
            </div>
          )}

          {/* Channel list */}
          <div style={{
            width: "100%",
            maxWidth: "400px",
            marginTop: "20px"
          }}>
            <div style={{
              display: "grid",
              gridTemplateColumns: "repeat(2, 1fr)",
              gap: "12px"
            }}>
              {channels.map(channel => (
                <button
                  key={channel.id}
                  onClick={() => setCurrentChannelCode(channel.code)}
                  style={{
                    padding: "16px",
                    background: currentChannelCode === channel.code 
                      ? "rgba(52, 199, 89, 0.2)" 
                      : "rgba(255,255,255,0.05)",
                    color: "white",
                    border: currentChannelCode === channel.code
                      ? "1px solid #34C759"
                      : "1px solid rgba(255,255,255,0.1)",
                    borderRadius: "8px",
                    fontSize: "14px",
                    cursor: "pointer",
                    transition: "all 0.2s",
                    textAlign: "center"
                  }}
                >
                  {channel.displayName}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* iOS notice */}
        <div style={{
          padding: "16px 20px",
          borderTop: "1px solid rgba(255,255,255,0.1)",
          fontSize: "12px",
          opacity: 0.5,
          textAlign: "center"
        }}>
          <p style={{ margin: 0 }}>
            iOS Safari compatible player • Tap play directly
          </p>
        </div>
      </main>
    </>
  );
}