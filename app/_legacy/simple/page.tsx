'use client';

export default function AppSimplePage() {
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
      <h1 style={{ fontSize: "28px", marginBottom: "20px" }}>
        🎵 Sound Spa Player (Simple)
      </h1>
      
      <div style={{
        background: "rgba(255,255,255,0.1)",
        padding: "20px",
        borderRadius: "12px",
        maxWidth: "400px",
        width: "100%"
      }}>
        <p style={{ fontSize: "16px", marginBottom: "15px" }}>
          If you see this page, login worked!
        </p>
        
        <button
          onClick={() => {
            console.log('iOS test button clicked');
          }}
          style={{
            padding: "12px 24px",
            background: "#34C759",
            color: "white",
            border: "none",
            borderRadius: "8px",
            fontSize: "16px",
            marginBottom: "15px",
            width: "100%"
          }}
        >
          Test Button Click
        </button>
        
        <button 
          onClick={() => window.location.href = '/app'}
          style={{
            padding: "10px 20px",
            background: "transparent",
            color: "white",
            border: "1px solid rgba(255,255,255,0.3)",
            borderRadius: "6px",
            fontSize: "14px"
          }}
        >
          Try main /app page
        </button>
      </div>
      
      <div style={{ marginTop: "30px", fontSize: "12px", opacity: 0.5 }}>
        <p>iOS Safari test page</p>
      </div>
    </main>
  );
}