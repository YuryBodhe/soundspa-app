'use client';

import { useState } from 'react';

export default function DebugPage() {
  const [log, setLog] = useState<string>('Debug page loaded\n');
  
  const testFetch = async () => {
    setLog(prev => prev + 'Testing fetch API...\n');
    
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'test@test.com', password: 'wrong' })
      });
      
      const resultText = await response.text();
      setLog(prev => prev + `Fetch result: Status ${response.status}, Response: ${resultText}\n`);
      
    } catch (error) {
      setLog(prev => prev + `Fetch error: ${error instanceof Error ? error.message : 'Unknown error'}\n`);
    }
  };
  
  const testRedirect = () => {
    setLog(prev => prev + 'Testing redirect to /app...\n');
    window.location.href = '/app';
  };
  
  const checkCookies = () => {
    setLog(prev => prev + `Cookies enabled: ${navigator.cookieEnabled}\n`);
    setLog(prev => prev + `User Agent: ${navigator.userAgent}\n`);
  };
  
  return (
    <main style={{ padding: '20px', fontFamily: 'sans-serif' }}>
      <h1>Soundspa Debug Page</h1>
      
      <div style={{ margin: '20px 0' }}>
        <h3>Log:</h3>
        <pre style={{ background: '#f0f0f0', padding: '10px', borderRadius: '5px' }}>
          {log}
        </pre>
      </div>
      
      <div style={{ margin: '20px 0' }}>
        <button 
          onClick={checkCookies}
          style={{ padding: '10px 20px', margin: '10px', fontSize: '16px' }}
        >
          Check Browser Info
        </button>
        
        <button 
          onClick={testFetch}
          style={{ padding: '10px 20px', margin: '10px', fontSize: '16px' }}
        >
          Test Fetch API
        </button>
        
        <button 
          onClick={testRedirect}
          style={{ padding: '10px 20px', margin: '10px', fontSize: '16px' }}
        >
          Test Redirect to /app
        </button>
      </div>
    </main>
  );
}