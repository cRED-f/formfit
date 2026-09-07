// Starts the Astro dev server on the port the harness assigns (PORT env var),
// falling back to 4325. `astro dev` does not read PORT itself on Windows, so
// this wrapper forwards it to `--port`. Only used by the in-app Browser preview.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const astroCli = fileURLToPath(new URL('../node_modules/astro/bin/astro.mjs', import.meta.url));
const port = process.env.PORT || '4325';
const child = spawn(process.execPath, [astroCli, 'dev', '--port', port, '--host', '--force'], {
  stdio: 'inherit',
  cwd: fileURLToPath(new URL('..', import.meta.url)),
});

child.on('error', (err) => {
  console.error('[preview-dev] failed to start astro dev:', err);
  process.exit(1);
});
child.on('exit', (code) => {
  process.exit(code ?? 0);
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => child.kill(sig));
}