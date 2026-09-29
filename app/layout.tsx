import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Nishikigoi / Nagomi — Procedural Koi Pond',
  description:
    'Nagomi - Interactive, procedurally animated 3D koi pond simulation with autonomous swimming, traveling body wave mechanics, underwater lighting, floating lotus, duckweed, darting minnows, butterflies, dynamic weather, and calming audio.',
  openGraph: {
    title: 'Nishikigoi / Nagomi — Procedural Koi Pond',
    description:
      'Nagomi - Interactive, procedurally animated 3D koi pond simulation with autonomous swimming, traveling body wave mechanics, underwater lighting, floating lotus, duckweed, darting minnows, butterflies, dynamic weather, and calming audio.',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Nishikigoi / Nagomi — Procedural Koi Pond',
    description:
      'Nagomi - Interactive, procedurally animated 3D koi pond simulation with autonomous swimming, traveling body wave mechanics, underwater lighting, floating lotus, duckweed, darting minnows, butterflies, dynamic weather, and calming audio.',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark" style={{ colorScheme: 'dark' }}>
      <head>
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
      </head>
      <body className="dark bg-[#09090b] text-white antialiased overflow-hidden m-0 p-0" suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
