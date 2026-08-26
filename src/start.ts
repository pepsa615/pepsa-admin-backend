import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';

type ManagedProcess = { name: string; process: ChildProcess; exited: boolean };

const managed: ManagedProcess[] = [
  ['api', new URL('./server.js', import.meta.url)],
  ['worker', new URL('./worker.js', import.meta.url)],
].map(([name, url]) => ({
  name: String(name),
  process: spawn(process.execPath, [fileURLToPath(url as URL)], {
    env: process.env,
    stdio: 'inherit',
  }),
  exited: false,
}));

let stopping = false;
let exitCode = 0;
let forceTimer: NodeJS.Timeout | undefined;

function stop(signal: NodeJS.Signals, code = 0) {
  if (stopping) return;
  stopping = true;
  exitCode = code;
  for (const child of managed) if (!child.exited) child.process.kill(signal);
  forceTimer = setTimeout(() => {
    for (const child of managed) if (!child.exited) child.process.kill('SIGKILL');
  }, 40_000);
  forceTimer.unref();
}

function finishIfStopped() {
  if (!managed.every((child) => child.exited)) return;
  if (forceTimer) clearTimeout(forceTimer);
  process.exit(exitCode);
}

for (const child of managed) {
  child.process.once('error', (error) => {
    console.error(`${child.name} failed to start`, error);
    stop('SIGTERM', 1);
  });
  child.process.once('close', (code, signal) => {
    child.exited = true;
    if (!stopping) {
      console.error(`${child.name} exited unexpectedly (code=${code}, signal=${signal})`);
      stop('SIGTERM', code || 1);
    }
    finishIfStopped();
  });
}

process.once('SIGINT', () => stop('SIGINT'));
process.once('SIGTERM', () => stop('SIGTERM'));
