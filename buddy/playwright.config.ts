import { defineConfig } from '@playwright/test';
// Same per-platform venv layout scripts/venv.mjs resolves for the demo runner
// (Scripts\python.exe on Windows, bin/python on macOS and Linux); inlined because
// Playwright loads this config from buddy/, outside that module's reach.
const venvPython =
  process.platform === 'win32'
    ? '../backend/optimizer/.venv/Scripts/python.exe'
    : '../backend/optimizer/.venv/bin/python';
const python = process.env.BUDDY_PYTHON ?? venvPython;
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
      // The suite drives the calendar, not the sign-in screen. `npm start` runs
      // NODE_ENV=production, where missing Google credentials deliberately fail
      // closed, so the demo bypass is what keeps these tests testing the app.
      env: { OPENAI_API_KEY: 'test-fixture', OPENAI_BASE_URL: 'http://127.0.0.1:8102/v1', FASTAPI_BASE_URL: 'http://127.0.0.1:8101', BUDDY_ALLOW_DEMO: '1' } },
  ],
});
