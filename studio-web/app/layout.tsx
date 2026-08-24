import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Repple Studio',
  description: 'The desk where a gym is run.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
