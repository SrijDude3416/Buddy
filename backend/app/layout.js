export const metadata = {
  title: 'Buddy API',
  description: 'API for Buddy — semester optimization for students',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
