'use client';

export default function AppTempPage() {
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
      padding: "20px",
      textAlign: "center"
    }}>
      <h1 style={{ fontSize: "28px", marginBottom: "20px" }}>
        🎵 Sound Spa
      </h1>
      
      <div style={{
        background: "rgba(255,255,255,0.1)",
        padding: "20px",
        borderRadius: "12px",
        maxWidth: "400px"
      }}>
        <p style={{ fontSize: "16px", marginBottom: "15px" }}>
          iOS Safari version (temporary)
        </p>
        
        <button
          onClick={() => window.location.href = '/app/simple'}
          style={{
            padding: "12px 24px",
            background: "#34C759",
            color: "white",
            border: "none",
            borderRadius: "8px",
            fontSize: "16px",
            margin: "10px",
            width: "100%"
          }}
        >
          Go to Simple Version
        </button>
        
        <button
          onClick={() => window.location.href = '/app/test'}
          style={{
            padding: "12px 24px",
            background: "#007AFF",
            color: "white",
            border: "none",
            borderRadius: "8px",
            fontSize: "16px",
            margin: "10px",
            width: "100%"
          }}
        >
          Go to Test Version
        </button>
      </div>
      
      <div style={{ marginTop: "30px", fontSize: "12px", opacity: 0.5 }}>
        <p>Working around iOS Safari first-load issue</p>
      </div>
    </main>
  );
}