import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {
  title: 'Microtek+ WiFi',
  icons: { icon: '/icon-192.png', apple: '/apple-touch-icon.png' },
  description: 'Monitor and control your Microtek inverter.',
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    title: 'Microtek+ WiFi',
    statusBarStyle: 'default',
  },
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
