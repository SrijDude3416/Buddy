import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Buddy | Schedule optimizer",
  description: "Gemini-powered schedule optimization workflow",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
