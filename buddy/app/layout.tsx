import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Buddy",
  description: "Your semester, solved by math you can talk to.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
