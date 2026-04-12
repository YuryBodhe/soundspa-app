'use client';

export default function AppTestPage() {
  return (
    <main style={{
      minHeight: "100vh",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: "#07060a",
      fontFamily: "sans-serif",
      padding: "20px"
    }}>
      <h1 style={{ color: "white", fontSize: "24px" }}>
        ✅ Successfully logged in!
      </h1>
      
      <div style={{ margin: "20px 0" }}>
        <button 
          onClick={() => window.location.href = '/login'}
          style={{
            padding: "15px 30px",
            background: "#007AFF",
            color: "white",
            border: "none",
            borderRadius: "8px",
            fontSize: "16px"
          }}
        >
          Go back to login
        </button>
      </div>
      
      <div style={{ margin: "20px 0", color: "rgba(255,255,255,0.7)" }}>
        <p>If you see this page, the login worked correctly.</p>
        <p>Now check the main /app page.</p>
      </div>
    </main>
  );
}