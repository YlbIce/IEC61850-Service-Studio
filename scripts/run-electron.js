const { spawn, spawnSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const root = path.resolve(__dirname, '..');
const dev = process.argv.includes('--dev');
if (dev || !fs.existsSync(path.join(root, 'backend/bin/iec61850-service-backend.exe'))) {
  const r = spawnSync(process.execPath, [path.join(__dirname, 'build-backend.js')], { stdio: 'inherit' });
  if (r.status !== 0) process.exit(r.status || 1);
}
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(require('electron'), [root, ...(dev ? ['--dev'] : [])], { cwd: root, stdio: 'inherit', env });
child.on('error', e => { console.error(e); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code || 0; });
