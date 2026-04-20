'use client';

import { useEffect, useState } from 'react';

export default function AppPage() {
  const [status, setStatus] = useState<'loading' | 'error'>('loading');

  useEffect(() => {
    async function initApp() {
      try {
        // 1. Проверяем доступ через API
        const response = await fetch('/api/check-app-access', { 
          cache: 'no-store',
          credentials: 'include' 
        });
        
        if (response.status === 403) {
          window.location.href = '/app-index'; // Триал истек
          return;
        }

        if (response.status !== 200) {
          window.location.href = '/login'; // Не авторизован
          return;
        }

        // 2. Если доступ есть — всегда отправляем на /app/ios-player
        // Там уже твоя логика внутри выберет между Mobile и DesktopPlayer.tsx
        window.location.href = '/app/ios-player';

      } catch (err) {
        console.error('Failed to init app:', err);
        setStatus('error');
      }
    }

    initApp();
  }, []);

  if (status === 'error') {
    return (
      <main style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", backgroundColor: "#07060a", color: "white" }}>
        <p>Ошибка подключения. Пожалуйста, обновите страницу.</p>
      </main>
    );
  }

  // Лаконичный лоадер в твоем стиле
  return (
    <main style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", backgroundColor: "#07060a" }}>
      <div style={{
        width: "30px",
        height: "30px",
        border: "2px solid rgba(195,168,108,0.1)",
        borderTop: "2px solid #c3a86c",
        borderRadius: "50%",
        animation: "spin 1s linear infinite"
      }} />
      <style>{`@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }`}</style>
    </main>
  );
}