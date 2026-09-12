// ---------------------------------------------------------------------------
// Runtime config. Everything that differs between "dummy data" and "real
// backend" is read from env here and nowhere else, so the swap is one variable.
// ---------------------------------------------------------------------------

const env = import.meta.env ?? {};

function num(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export const config = {
  // 'mock' | 'live' — the gate. See src/lib/apiClient.js.
  apiMode: env.VITE_API_MODE === 'live' ? 'live' : 'mock',
  apiBaseUrl: env.VITE_API_BASE_URL ?? '/api',
  apiTimeoutMs: num(env.VITE_API_TIMEOUT, 15000),

  // Mock-mode only.
  mockLatencyMs: num(env.VITE_MOCK_LATENCY, 450),
  mockErrorRate: num(env.VITE_MOCK_ERROR_RATE, 0),
  mockSolveMs: num(env.VITE_MOCK_SOLVE_MS, 4200),

  // Shared by both modes — the generating screen polls at this cadence.
  runPollIntervalMs: num(env.VITE_RUN_POLL_INTERVAL, 1200),

  // Hard ceiling on how long the generating screen waits before offering a retry.
  runTimeoutMs: num(env.VITE_RUN_TIMEOUT, 90000),
};

export const isMock = () => config.apiMode === 'mock';
