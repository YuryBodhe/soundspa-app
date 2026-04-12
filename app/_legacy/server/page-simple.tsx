export default function ServerAppPageSimple() {
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
      <div style={{ textAlign: 'center' }}>
        <h1 style={{ fontSize: "24px", marginBottom: "10px" }}>
          🎵 Sound Spa (Server Version)
        </h1>
        <p style={{ fontSize: "14px", opacity: 0.7 }}>
          Original server-side player
        </p>
        <div style={{ marginTop: "20px" }}>
          <button
            onClick={() => {
              if (typeof window !== 'undefined') {
                window.location.href = '/app/simple';
              }
            }}
            style={{
              padding: "10px 20px",
              background: "#007AFF",
              color: "white",
              border: "none",
              borderRadius: "6px",
              fontSize: "14px"
            }}
          >
            Switch to iOS Version
          </button>
        </div>
      </div>
    </main>
  );
}