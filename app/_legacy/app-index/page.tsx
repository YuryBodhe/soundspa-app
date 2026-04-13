'use client';

import { useEffect, useState } from 'react';

export default function AppIndexPage() {
  const [status, setStatus] = useState('loading');

  useEffect(() => {
    async function checkAndRedirect() {
      try {
        const response = await fetch('/api/check-app-access', {
          credentials: 'include',
          headers: {
            'Cache-Control': 'no-cache',
            'Pragma': 'no-cache'
          }
        });
        
        console.log('Check response status:', response.status);
        
        if (response.status === 200) {
          const timestamp = Date.now();
          window.location.href = `/app?t=${timestamp}`;
        } else if (response.status === 403) {
          // Наш новый случай — доступ ограничен по времени
          setStatus('expired');
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

  // Состояние загрузки (оставляем без изменений)
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
        <h1 style={{ fontSize: "20px", marginBottom: "20px" }}>🎵 Sound Spa</h1>
        <div className="spinner" />
        <style>{`
          .spinner {
            width: 40px; height: 40px;
            border: 3px solid rgba(255,255,255,0.3);
            border-top: 3px solid white;
            border-radius: 50%;
            animation: spin 1s linear infinite;
          }
          @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
        `}</style>
      </main>
    );
  }

  // Отрисовка ошибок
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
      <div style={{ textAlign: 'center', maxWidth: "400px" }}>
        <h1 style={{ fontSize: "24px", marginBottom: "16px" }}>
          {status === 'expired' ? '⏱️ Срок доступа истек' : 'Ошибка доступа'}
        </h1>
        
        <p style={{ opacity: 0.8, marginBottom: "30px", lineHeight: "1.5" }}>
          {status === 'expired' 
            ? 'Ваш бесплатный период (30 дней) или оплаченная подписка закончились. Чтобы продолжить пользоваться Sound Spa, пожалуйста, свяжитесь с нами.' 
            : status === 'no-access' 
              ? 'Похоже, вы не авторизованы или сессия истекла.' 
              : 'Произошла ошибка при подключении к серверу.'}
        </p>

        <button
          onClick={() => window.location.href = status === 'expired' ? 'https://t.me/yury_bodhe' : '/login'}
          style={{
            padding: "12px 24px",
            background: status === 'expired' ? "#34C759" : "#007AFF",
            color: "white",
            border: "none",
            borderRadius: "8px",
            fontSize: "16px",
            fontWeight: "bold",
            cursor: "pointer"
          }}
        >
          {status === 'expired' ? 'Связаться в Telegram' : 'Перейти к логину'}
        </button>
      </div>
    </main>
  );
}