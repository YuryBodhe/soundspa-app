import type { Metadata, Viewport } from "next";
import Script from "next/script";
import "./globals.css";

// 1. Указываем базовый URL твоего сайта (замени на свой, если он другой)
const APP_URL = "https://soundspa.bodhemusic.com";

export const metadata: Metadata = {
  title: "Sound Spa — Cabinet",
  description: "Music streaming for premium spa.",
  
  // 2. Добавляем настройки для соцсетей (Open Graph)
  openGraph: {
    title: "Sound Spa — Музыка для SPA пространств",
    description: "Профессиональный саунд-дизайн и музыкальный сервис для премиальных SPA.",
    url: APP_URL,
    siteName: "Sound Spa",
    // Ссылка на файл из папки public/og-preview.jpg
    images: [
      {
        url: `${APP_URL}/og-preview.jpg`, 
        width: 1200,
        height: 630,
        alt: "Sound Spa Preview",
      },
    ],
    locale: "ru_RU",
    type: "website",
  },

  // 3. Настройки для Twitter (X) и Telegram
  twitter: {
    card: "summary_large_image",
    title: "Sound Spa",
    description: "Sound Spa music service for premium spa.",
    images: [`${APP_URL}/og-preview.jpg`],
  },

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