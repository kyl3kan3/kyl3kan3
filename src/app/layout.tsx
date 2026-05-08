import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Alert Triage",
  description: "Incident triage and ticket orchestration console.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
