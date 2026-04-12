'use client';

import { useEffect, useState } from 'react';

export default function AppIndexPage() {
  const [status, setStatus] = useState('loading');

  useEffect(() => {
    async function checkAndRedirect() {
      try {
        // Проверяем доступ к /app через fetch
        const response = await fetch('/api/check-app-access', {
          credentials: 'include',
          headers: {
            'Cache-Control': 'no-cache',
            'Pragma': 'no-cache'
          }
        });
        
        console.log('Check response:', response.status);
        
        if (response.status === 200) {
          // Если доступ есть, редирект на /app с кеш-бастером
          const timestamp = Date.now();
          window.location.href = `/app?t=${timestamp}`;
        } else {
          setStatus('no-access');
        }
      } catch (error) {
        console.error('Check failed:', error);
        setStatus('error');
      }
    }

    checkAndRedirect();
  }, []);

  if (status === 'loading') {
    return (
      <main style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "#07060a",
        fontFamily: "sans-serif",
        color: "white"
      }}>
        <h1 style={{ fontSize: "20px", marginBottom: "20px" }}>
          🎵 Sound Spa
        </h1>
        <div style={{
          width: "40px",
          height: "40px",
          border: "3px solid rgba(255,255,255,0.3)",
          borderTop: "3px solid white",
          borderRadius: "50%",
          animation: "spin 1s linear infinite"
        }} />
        <style>{`
          @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }
        `}</style>
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
      color: "white"
    }}>
      <div style={{ textAlign: 'center' }}>
        <h1 style={{ fontSize: "20px", marginBottom: "10px" }}>
          Access Error
        </h1>
        <p style={{ opacity: 0.7, marginBottom: "20px" }}>
          {status === 'no-access' ? 'Please log in first' : 'Connection error'}
        </p>
        <button
          onClick={() => window.location.href = '/login'}
          style={{
            padding: "10px 20px",
            background: "#007AFF",
            color: "white",
            border: "none",
            borderRadius: "6px",
            fontSize: "14px"
          }}
        >
          Go to Login
        </button>
      </div>
    </main>
  );
}