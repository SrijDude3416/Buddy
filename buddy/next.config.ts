import type { NextConfig } from "next";
import path from "node:path";
const nextConfig: NextConfig = {
  outputFileTracingRoot: path.resolve(__dirname, ".."),
  webpack(config) {
    config.resolve.alias[path.resolve(__dirname, "../frontend/src/lib/config.js")] = path.resolve(__dirname, "lib/frontend-config.js");
    config.resolve.alias['react$'] = require.resolve('react');
    config.resolve.alias['react-dom$'] = require.resolve('react-dom');
    config.resolve.modules.push(path.resolve(__dirname, "node_modules"));
    return config;
  },
};
export default nextConfig;
