'use client';

import { useEffect, useState } from 'react';

export default function AppClientPage() {
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    console.log('🔵 AppClientPage mounted on iOS');
    setLoaded(true);
  }, []);

  if (!loaded) {
    return (
      <main style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "#07060a",
        fontFamily: "sans-serif",
      }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{
            width: "30px",
            height: "30px",
            border: "2px solid rgba(255,255,255,0.3)",
            borderTop: "2px solid white",
            borderRadius: "50%",
            margin: "0 auto 20px",
            animation: "spin 1s linear infinite"
          }} />
          <p style={{
            fontSize: 10,
            letterSpacing: "0.38em",
            textTransform: "uppercase",
            fontWeight: 300,
            color: "rgba(195,168,108,0.5)",
          }}>
            Loading player
          </p>
          <style>{`
            @keyframes spin {
              0% { transform: rotate(0deg); }
              100% { transform: rotate(360deg); }
            }
          `}</style>
        </div>
      </main>
    );
  }

  return (
    <main style={{
      minHeight: "100vh",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: "#07060a",
      fontFamily: "sans-serif",
      color: "white",
      padding: "20px"
    }}>
      <h1 style={{ fontSize: "28px", marginBottom: "10px" }}>
        🎵 Sound Spa Player
      </h1>
      <p style={{ fontSize: "14px", opacity: 0.7, marginBottom: "30px" }}>
        Client-side version for iOS Safari
      </p>
      
      <div style={{
        background: "rgba(255,255,255,0.1)",
        padding: "20px",
        borderRadius: "12px",
        maxWidth: "400px",
        width: "100%"
      }}>
        <h2 style={{ fontSize: "18px", marginBottom: "15px" }}>
          Test Player
        </h2>
        
        <button
          onClick={() => {
            console.log('Play button clicked');
            alert('Audio would play here on iOS with user interaction');
          }}
          style={{
            padding: "12px 24px",
            background: "#34C759",
            color: "white",
            border: "none",
            borderRadius: "8px",
            fontSize: "16px",
            width: "100%",
            marginBottom: "10px"
          }}
        >
          Play Music
        </button>
        
        <button
          onClick={() => window.location.reload()}
          style={{
            padding: "8px 16px",
            background: "transparent",
            color: "white",
            border: "1px solid rgba(255,255,255,0.3)",
            borderRadius: "4px",
            fontSize: "12px"
          }}
        >
          Reload Page
        </button>
      </div>
      
      <div style={{ marginTop: "30px", fontSize: "12px", opacity: 0.5 }}>
        <p>Loaded successfully: {new Date().toLocaleTimeString()}</p>
      </div>
    </main>
  );
}