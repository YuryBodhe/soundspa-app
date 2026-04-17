import type { Metadata, Viewport } from "next";
import Script from "next/script"; // 1. ДОБАВЬ ЭТОТ ИМПОРТ
import "./globals.css";

export const metadata: Metadata = {
  title: "Sound Spa — Cabinet",
  description: "Sound Spa music service for premium spa.",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Sound Spa",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru">
      <head>
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="format-detection" content="telephone=no" />
      </head>
      <body>
        {/* 2. ПЕРЕНЕСИ СКРИПТ СЮДА И ЗАМЕНИ НА <Script> */}
        <Script
          id="lock-orientation"
          strategy="afterInteractive"
          dangerouslySetInnerHTML={{
            __html: `
              if (screen.orientation && screen.orientation.lock) {
                screen.orientation.lock('portrait').catch(() => {});
              }
            `,
          }}
        />
        {children}
      </body>
    </html>
  );
}