'use client';

import { useEffect, useState } from 'react';

export default function AppClientPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<any>(null);

  useEffect(() => {
    async function loadData() {
      try {
        // Проверяем сессию через API endpoint
        const response = await fetch('/api/check-session', {
          credentials: 'include'
        });
        
        if (response.status === 200) {
          const data = await response.json();
          setData(data);
          setLoading(false);
        } else {
          setError('No valid session');
          setLoading(false);
        }
      } catch (err) {
        setError('Failed to check session');
        setLoading(false);
      }
    }

    loadData();
  }, []);

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

  if (error || !data) {
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
          {error || 'No access — try logging in again'}
        </p>
      </main>
    );
  }

  return (
    <main style={{
      minHeight: "100vh",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: "#07060a",
      fontFamily: "sans-serif",
      color: "white",
      padding: "20px"
    }}>
      <div style={{
        background: "rgba(255,255,255,0.1)",
        padding: "20px",
        borderRadius: "12px",
        maxWidth: "400px",
        width: "100%"
      }}>
        <h1 style={{ fontSize: "24px", marginBottom: "20px" }}>
          🎵 Sound Spa (Client Version)
        </h1>
        
        <p style={{ fontSize: "16px", marginBottom: "15px", opacity: 0.8 }}>
          Session loaded successfully!
        </p>
        
        <button
          onClick={() => window.location.href = '/app'}
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
          Try original /app page
        </button>
        
        <p style={{ fontSize: "12px", opacity: 0.5, marginTop: "20px" }}>
          iOS Safari compatible client component
        </p>
      </div>
    </main>
  );
}