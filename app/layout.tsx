import type { Metadata, Viewport } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';
import { SettingsProvider } from '@/context/SettingsContext';

/* Geist carries both the body and the instrument-label voice — it has no
   condensed cut, so --font-condensed points at the same family (tracked
   out via --tracking-label rather than a narrower face). */
const geistSans = Geist({
  subsets: ['latin'],
  display: 'swap',
  weight: ['400', '500', '600'],
  variable: '--font-geist-sans',
});

/* Every number in the app is set in this face, with tabular figures
   so latency columns align. */
const geistMono = Geist_Mono({
  subsets: ['latin'],
  display: 'swap',
  weight: ['400', '500', '600'],
  variable: '--font-geist-mono',
});

export const metadata: Metadata = {
  title: 'Provider Validator',
  description:
    'Paste an endpoint and key to find out which model a provider actually serves, and whether it matches the one advertised.',
  applicationName: 'Provider Validator',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#000000',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // Lumosel is the only theme, so [data-theme] is fixed on the root rather
    // than resolved at runtime — no pre-paint script, no flash, no toggle.
    <html
      lang="en"
      data-theme="lumosel"
      className={`${geistSans.variable} ${geistMono.variable}`}
    >
      <body>
        <SettingsProvider>{children}</SettingsProvider>
      </body>
    </html>
  );
}