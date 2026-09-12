// Bundles scripts/smoke.mjs with esbuild (so import.meta.env is defined the way
// Vite would define it) and runs it in node. Keeps the data layer testable
// without a browser or a test framework.
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const env = {
  VITE_API_MODE: 'mock',
  VITE_MOCK_LATENCY: '10',
  VITE_MOCK_ERROR_RATE: '0',
  VITE_MOCK_SOLVE_MS: '900',
  VITE_RUN_POLL_INTERVAL: '100',
  DEV: false,
};

const entry = process.argv[2] ?? 'scripts/smoke.mjs';
// Inside the project so node can resolve react/react-dom from node_modules when
// the bundle leaves them external.
const dir = 'node_modules/.cache/buddy-smoke';
mkdirSync(dir, { recursive: true });
const outfile = join(dir, 'smoke.mjs');

await build({
  entryPoints: [entry],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile,
  jsx: 'automatic',
  // Let node resolve the real packages from node_modules — bundling react-dom's
  // CJS server build breaks its internal requires.
  packages: 'external',
  define: { 'import.meta.env': JSON.stringify(env) },
  logLevel: 'error',
});

writeFileSync(join(dir, 'package.json'), '{"type":"module"}');
execFileSync(process.execPath, [outfile], { stdio: 'inherit' });
