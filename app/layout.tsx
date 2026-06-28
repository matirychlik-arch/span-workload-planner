import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'SPAN — Workload Planner',
  description: 'Planner workloadu zespołów SPAN'
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pl">
      <body>{children}</body>
    </html>
  );
}
