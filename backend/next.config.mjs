/** @type {import('next').NextConfig} */
const nextConfig = {
  // API-only app. The Vite frontend proxies /api here in dev (see
  // frontend/vite.config.js) and both deploy to the same Vercel project in prod,
  // so there is no cross-origin case to configure.
  reactStrictMode: true,
};

export default nextConfig;
