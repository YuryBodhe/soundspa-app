'use client';

export default function IOSTestPage() {
  return (
    <div style={{
      padding: '40px',
      backgroundColor: '#07070a',
      color: '#c8c0b0',
      minHeight: '100vh',
      fontFamily: 'sans-serif'
    }}>
      <h1>✅ iOS Test Page</h1>
      <p>Если эта страница открывается - проблема в middleware или авторизации</p>
      <p>Путь: /app/ios-test</p>
      <p>Time: {new Date().toISOString()}</p>
    </div>
  );
}