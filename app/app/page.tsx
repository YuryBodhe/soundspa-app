'use client';

import { useEffect, useState } from 'react';

function IOSAppPage() {
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
      <div style={{
        width: "60px",
        height: "60px",
        border: "3px solid rgba(255,255,255,0.3)",
        borderTop: "3px solid white",
        borderRadius: "50%",
        margin: "0 auto 20px",
        animation: "spin 1s linear infinite"
      }} />
      <style>{`
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      `}</style>
      
      <p style={{
        fontSize: 10,
        letterSpacing: "0.38em",
        textTransform: "uppercase",
        fontWeight: 300,
        color: "rgba(195,168,108,0.5)",
      }}>
        Loading full iOS player...
      </p>
    </main>
  );
}

function DesktopAppPage() {
  const [Component, setComponent] = useState<React.ComponentType | null>(null);

  useEffect(() => {
    // Динамически импортируем серверный компонент
    import('../_legacy/server/page-simple').then(module => {
      setComponent(() => module.default);
    }).catch(err => {
      console.error('Failed to load server component:', err);
    });
  }, []);

  if (!Component) {
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

  return <Component />;
}

export default function AppPage() {
  const [isIOS, setIsIOS] = useState(false);
  const [detected, setDetected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function initApp() {
      try {
        // 1. Сначала проверяем доступ через API
        const response = await fetch('/api/check-app-access', { 
          cache: 'no-store',
          credentials: 'include' 
        });
        
        if (response.status === 403) {
          // Триал истек — редирект на страницу с ошибкой доступа
          window.location.href = '/app-index';
          return;
        }

        if (response.status !== 200) {
          // Не авторизован — редирект на логин
          window.location.href = '/login';
          return;
        }

        // 2. Если доступ есть, запускаем твою логику детекции устройства
        const userAgent = navigator.userAgent || '';
        const platform = navigator.platform || '';
        
        const isIPhone = /iPhone/i.test(userAgent);
        const isIPad = /iPad/i.test(userAgent);
        const isIPod = /iPod/i.test(userAgent);
        const isIOSBase = isIPhone || isIPad || isIPod;
        const isMac = /Mac/i.test(platform) && !/like Mac/i.test(userAgent);
        
        const isIOSDevice = isIOSBase || (isMac && 'maxTouchPoints' in navigator && navigator.maxTouchPoints > 1);
        
        console.log('📱 Access granted. Platform detection:', { isIOS: isIOSDevice });
        
        setIsIOS(isIOSDevice);
        setDetected(true);

      } catch (err) {
        console.error('Failed to init app:', err);
        setError('Connection error');
      }
    }

    initApp();
  }, []);

  if (error) {
    return (
      <main style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", backgroundColor: "#07060a", color: "white" }}>
        <p>Ошибка подключения. Попробуйте обновить страницу.</p>
      </main>
    );
  }

  if (!detected) {
    return (
      <main style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "#07060a",
        fontFamily: "sans-serif",
      }}>
        <div style={{
          width: "30px",
          height: "30px",
          border: "2px solid rgba(255,255,255,0.3)",
          borderTop: "2px solid white",
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

  if (isIOS) {
    if (typeof window !== 'undefined') {
      const currentPath = window.location.pathname;
      if (currentPath === '/app' || currentPath === '/app/') {
        window.location.href = '/app/ios-player';
        return null;
      }
    }
    return <IOSAppPage />;
  }
  return <DesktopAppPage />;
}