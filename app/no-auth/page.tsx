export default function NoAuthPage() {
  return (
    <main style={{ padding: "20px", fontFamily: "sans-serif" }}>
      <h1>No Auth Test Page</h1>
      <p>This page doesn t require authentication.</p>
      <div style={{ marginTop: "20px" }}>
        <a href="/app" style={{
          display: "inline-block",
          padding: "10px 20px",
          background: "#007AFF",
          color: "white",
          textDecoration: "none",
          borderRadius: "6px"
        }}>
          Try /app page (redirects to login)
        </a>
      </div>
    </main>
  );
}
