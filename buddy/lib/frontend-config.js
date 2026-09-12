// Same-origin Next.js demo routes, independent of the legacy Vite mock mode.
export const config = {
  apiMode: 'demo', apiBaseUrl: '/api', apiTimeoutMs: 130000,
  mockLatencyMs: 0, mockErrorRate: 0, mockSolveMs: 0,
  runPollIntervalMs: 1000, runTimeoutMs: 60000,
};
export const isMock = () => false;
