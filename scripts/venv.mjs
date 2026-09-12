// A virtualenv's interpreter does not live in the same place on every platform:
// Windows puts it in `Scripts\python.exe`, POSIX (macOS, Linux) in `bin/python`.
// Hardcoding either layout is what breaks the launcher for everyone on the other
// one, so resolve it from `process.platform` in one shared place.
import path from 'node:path';

export const isWindows = process.platform === 'win32';

/** The virtualenv `npm run setup` creates, relative to the repository root. */
export const venvDir = 'backend/optimizer/.venv';

/** Path to this platform's interpreter inside `root`'s optimizer virtualenv. */
export function venvPython(root) {
  return isWindows
    ? path.join(root, venvDir, 'Scripts', 'python.exe')
    : path.join(root, venvDir, 'bin', 'python');
}

/**
 * The interpreter the optimizer should run under: an explicit `BUDDY_PYTHON`
 * wins, otherwise this platform's venv interpreter.
 */
export function resolvePython(root) {
  return process.env.BUDDY_PYTHON ?? venvPython(root);
}

/**
 * What to tell a user whose venv is missing. package.json carries one setup
 * command per platform, so name the one they can actually run rather than the
 * other platform's — the failure this whole module exists to prevent.
 */
export function missingVenvMessage(python) {
  const setup = isWindows ? 'npm run setup:win' : 'npm run setup';
  return [
    `No Python interpreter at ${python}.`,
    `Run \`${setup}\` from the repository root, or set BUDDY_PYTHON to an existing virtualenv Python.`,
  ].join('\n');
}
