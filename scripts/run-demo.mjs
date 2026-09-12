import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
const root = fileURLToPath(new URL('../', import.meta.url));
const mode = process.argv[2] ?? 'dev';
const python = process.env.BUDDY_PYTHON ?? path.join(root, 'backend/optimizer/.venv/bin/python');
const external = process.env.FASTAPI_BASE_URL;
if (!external && !existsSync(python)) { console.error('Run npm run setup, or set BUDDY_PYTHON to your virtualenv Python.'); process.exit(1); }
const children = [];
let stopping = false;
function stop(code = 0) { if (stopping) return; stopping = true; for (const child of children) child.kill('SIGTERM'); process.exitCode = code; }
function start(command, args) {
  const child = spawn(command, args, { cwd: root, stdio: 'inherit', env: process.env });
  children.push(child);
  child.on('error', error => { console.error(error.message); stop(1); });
  child.on('exit', code => stop(code ?? 0));
}
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
if (!external) {
  start(python, ['-m', 'uvicorn', 'api:app', '--app-dir', 'backend/optimizer', '--host', '127.0.0.1', '--port', '8000']);
  let ready = false;
  for (let attempt = 0; attempt < 120 && !stopping; attempt++) {
    try { ready = (await fetch('http://127.0.0.1:8000/health', { signal: AbortSignal.timeout(500) })).ok; } catch {}
    if (ready) break;
    await delay(250);
  }
  if (!ready) { console.error('The Python optimizer did not start.'); stop(1); }
}
// `npm start` runs NODE_ENV=production, where the app deliberately fails closed
// if Google credentials are missing (see buddy/lib/auth/env.ts). This script is
// the *local* demo runner, so when there is plainly no OAuth client configured,
// opt into the no-login demo explicitly rather than presenting a sign-in wall
// the README says isn't required. A real deploy never runs this file, so a
// Vercel instance that loses its env vars still fails closed.
//
// Next loads buddy/.env.local itself, after this process has already started, so
// checking process.env alone would wrongly conclude "no OAuth configured" and
// bypass a sign-in the user had in fact set up. Read the file too.
function envFileHas(name) {
  try {
    return readFileSync(path.join(root, 'buddy/.env.local'), 'utf8')
      .split('\n')
      .some((line) => new RegExp(`^\\s*${name}\\s*=\\s*\\S`).test(line));
  } catch {
    return false;
  }
}
if (!process.env.BUDDY_ALLOW_DEMO && !process.env.GOOGLE_CLIENT_ID && !envFileHas('GOOGLE_CLIENT_ID')) {
  process.env.BUDDY_ALLOW_DEMO = '1';
}
if (!stopping) start('npm', ['run', mode, '--prefix', 'buddy', '--', ...process.argv.slice(3)]);
