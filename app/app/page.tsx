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

  useEffect(() => {
    // Надежная детекция iOS устройств
    const userAgent = navigator.userAgent || '';
    const platform = navigator.platform || '';
    
    // Проверяем разные признаки iOS
    const isIPhone = /iPhone/i.test(userAgent);
    const isIPad = /iPad/i.test(userAgent);
    const isIPod = /iPod/i.test(userAgent);
    const isIOS = isIPhone || isIPad || isIPod;
    const isMac = /Mac/i.test(platform) && !/like Mac/i.test(userAgent);
    
    // Для iPad на iOS 13+ нужно дополнительная проверка
    const isIOSDevice = isIOS || (isMac && 'maxTouchPoints' in navigator && navigator.maxTouchPoints > 1);
    
    console.log('📱 Platform detection:', {
      userAgent,
      platform,
      isIPhone,
      isIPad, 
      isIPod,
      isMac,
      maxTouchPoints: navigator.maxTouchPoints,
      isIOS: isIOSDevice
    });
    
    setIsIOS(isIOSDevice);
    setDetected(true);
  }, []);

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
      // Если уже на /app/что-то — не редиректим повторно
      if (currentPath === '/app' || currentPath === '/app/') {
        window.location.href = '/app/ios-player';
        return null;
      }
    }
    return <IOSAppPage />;
  }
  return <DesktopAppPage />;
}