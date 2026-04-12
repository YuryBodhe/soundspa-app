'use client';

export default function AppClientSimplePage() {
  return (
    <main style={{
      minHeight: "100vh",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: "#07060a",
      fontFamily: "sans-serif",
      color: "white",
      padding: "20px",
      textAlign: "center"
    }}>
      <div>
        <h1 style={{ fontSize: "28px", marginBottom: "20px" }}>
          🎵 Sound Spa Player
        </h1>
        
        <p style={{ fontSize: "16px", marginBottom: "30px", opacity: 0.8 }}>
          Welcome to the player! This is the client-side version.
        </p>
        
        <div style={{
          background: "rgba(255,255,255,0.1)",
          padding: "20px",
          borderRadius: "12px",
          maxWidth: "400px",
          margin: "0 auto"
        }}>
          <h2 style={{ fontSize: "18px", marginBottom: "15px" }}>
            Channel List
          </h2>
          
          <div style={{ marginBottom: "20px" }}>
            <button
              style={{
                padding: "10px 20px",
                background: "#34C759",
                color: "white",
                border: "none",
                borderRadius: "6px",
                fontSize: "14px",
                margin: "5px"
              }}
            >
              Channel 1
            </button>
            
            <button
              style={{
                padding: "10px 20px",
                background: "#34C759",
                color: "white",
                border: "none",
                borderRadius: "6px",
                fontSize: "14px",
                margin: "5px"
              }}
            >
              Channel 2
            </button>
          </div>
          
          <button
            onClick={() => {
              // Audio test без auto-play для iOS
              const audio = new Audio('https://stream.bodhemusic.com/radio.mp3');
              audio.play().catch(err => {
                console.log('Audio blocked:', err);
                alert('iOS requires direct tap to play audio');
              });
            }}
            style={{
              padding: "12px 24px",
              background: "#007AFF",
              color: "white",
              border: "none",
              borderRadius: "8px",
              fontSize: "16px",
              width: "100%"
            }}
          >
            Play Audio (Tap required on iOS)
          </button>
          
          <p style={{ fontSize: "12px", opacity: 0.5, marginTop: "15px" }}>
            iOS Safari: Audio requires user interaction
          </p>
        </div>
        
        <div style={{ marginTop: "30px" }}>
          <button 
            onClick={() => window.location.href = '/login'}
            style={{
              padding: "8px 16px",
              background: "transparent",
              color: "white",
              border: "1px solid rgba(255,255,255,0.3)",
              borderRadius: "4px",
              fontSize: "12px"
            }}
          >
            Back to Login
          </button>
        </div>
      </div>
    </main>
  );
}