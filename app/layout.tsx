import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Sound Spa — Cabinet",
  description: "Sound Spa music service for salons and spas.",
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
      
  {/* Lock to portrait mode on iOS */}
  <script
    dangerouslySetInnerHTML={{
      __html: `
        if (screen.orientation && screen.orientation.lock) {
          screen.orientation.lock('portrait').catch(() => {});
        }
      `,
    }}
  />

</head>
      <body>{children}</body>
    </html>
  );
}
