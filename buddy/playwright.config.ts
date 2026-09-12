import { defineConfig } from '@playwright/test';
const python = process.env.BUDDY_PYTHON ?? '../backend/optimizer/.venv/bin/python';
export default defineConfig({
  testDir: './tests/browser',
  timeout: 90000,
  expect: { timeout: 30000 },
  workers: 1,
  use: { baseURL: 'http://localhost:3101', viewport: { width: 1440, height: 1000 } },
  webServer: [
    { command: 'node tests/support/openai-server.mjs', url: 'http://127.0.0.1:8102', reuseExistingServer: false },
    { command: `"${python}" -m uvicorn api:app --app-dir ../backend/optimizer --host 127.0.0.1 --port 8101`, url: 'http://127.0.0.1:8101/health', timeout: 90000, reuseExistingServer: false, env: { BUDDY_SOLVE_SECONDS: '3', PYTHONPYCACHEPREFIX: '/tmp/buddy-test-pycache' } },
    { command: 'npm run build && npm run start -- --port 3101', url: 'http://localhost:3101', timeout: 120000, reuseExistingServer: false,
      env: { OPENAI_API_KEY: 'test-fixture', OPENAI_BASE_URL: 'http://127.0.0.1:8102/v1', FASTAPI_BASE_URL: 'http://127.0.0.1:8101' } },
  ],
});
