'use client';

import { useEffect, useState, useRef } from 'react';

type SpaChannel = {
  id: number;
  code: string;
  displayName: string;
  streamUrl: string;
};

export default function FullAppPage() {
  const [channels, setChannels] = useState<SpaChannel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentChannelCode, setCurrentChannelCode] = useState<string>('');
  const [isPlaying, setIsPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    async function loadData() {
      try {
        const response = await fetch('/api/app-data', {
          credentials: 'include'
        });
        
        if (response.ok) {
          const data = await response.json();
          setChannels(data.channels || []);
          if (data.channels && data.channels.length > 0) {
            setCurrentChannelCode(data.channels[0].code);
          }
          setLoading(false);
        } else {
          setError('Failed to load data');
          setLoading(false);
        }
      } catch (err) {
        setError('Connection error');
        setLoading(false);
      }
    }

    loadData();
  }, []);

  useEffect(() => {
    if (!audioRef.current || !currentChannelCode || !channels.length) return;
    
    const channel = channels.find(c => c.code === currentChannelCode);
    if (!channel) return;
    
    if (audioRef.current.src !== channel.streamUrl) {
      audioRef.current.src = channel.streamUrl;
    }
  }, [currentChannelCode, channels]);

  function togglePlay() {
    if (!audioRef.current) return;
    
    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      // iOS требует user interaction для audio play
      audioRef.current.play().then(() => {
        setIsPlaying(true);
      }).catch(err => {
        console.log('Audio play failed (iOS restriction):', err);
        alert('Please tap the play button directly on iOS');
      });
    }
  }

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
          Loading player...
        </p>
      </main>
    );
  }

  if (error || !channels.length) {
    return (
      <main style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "#07060a",
        fontFamily: "sans-serif",
        color: "white"
      }}>
        <div>
          <p style={{ marginBottom: "20px" }}>{error || 'No channels available'}</p>
          <button
            onClick={() => window.location.href = '/app'}
            style={{
              padding: "10px 20px",
              background: "#007AFF",
              color: "white",
              border: "none",
              borderRadius: "6px"
            }}
          >
            Back
          </button>
        </div>
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
        padding: "20px"
      }}>
        <header style={{ marginBottom: "30px" }}>
          <h1 style={{ fontSize: "24px", marginBottom: "5px" }}>
            🎵 Sound Spa
          </h1>
          <p style={{ fontSize: "12px", opacity: 0.7 }}>
            Full iOS compatible player
          </p>
        </header>
        
        <div style={{ marginBottom: "30px" }}>
          <div style={{
            background: "rgba(255,255,255,0.1)",
            padding: "20px",
            borderRadius: "12px"
          }}>
            <h2 style={{ fontSize: "16px", marginBottom: "15px" }}>
              Channels
            </h2>
            
            <div style={{ marginBottom: "20px" }}>
              {channels.map(channel => (
                <button
                  key={channel.id}
                  onClick={() => setCurrentChannelCode(channel.code)}
                  style={{
                    display: "block",
                    width: "100%",
                    padding: "12px",
                    marginBottom: "8px",
                    background: currentChannelCode === channel.code ? "#34C759" : "rgba(255,255,255,0.1)",
                    color: "white",
                    border: "none",
                    borderRadius: "6px",
                    fontSize: "14px",
                    textAlign: "left"
                  }}
                >
                  {channel.displayName}
                </button>
              ))}
            </div>
            
            <button
              onClick={togglePlay}
              style={{
                width: "100%",
                padding: "15px",
                background: isPlaying ? "#FF3B30" : "#34C759",
                color: "white",
                border: "none",
                borderRadius: "8px",
                fontSize: "16px",
                fontWeight: "bold"
              }}
            >
              {isPlaying ? "⏸️ Pause" : "▶️ Play"} {channels.find(c => c.code === currentChannelCode)?.displayName || ''}
            </button>
            
            <p style={{ fontSize: "12px", opacity: 0.5, marginTop: "10px" }}>
              iOS: Requires direct tap to play audio
            </p>
          </div>
        </div>
        
        <div style={{ textAlign: 'center', marginTop: "20px" }}>
          <button
            onClick={() => window.location.href = '/app'}
            style={{
              padding: "8px 16px",
              background: "transparent",
              color: "white",
              border: "1px solid rgba(255,255,255,0.3)",
              borderRadius: "4px",
              fontSize: "12px"
            }}
          >
            Back to Main
          </button>
        </div>
      </main>
    </>
  );
}