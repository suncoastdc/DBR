const { spawn } = require('node:child_process');
const electronPath = require('electron');
const path = require('node:path');
const fs = require('node:fs');

// Load .env.local if it exists
const envLocalPath = path.join(__dirname, '..', '.env.local');
if (fs.existsSync(envLocalPath)) {
  require('dotenv').config({ path: envLocalPath });
}

// Clone env and strip Electron's "run as node" flag if present
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electronPath, ['.'], {
  stdio: 'inherit',
  env,
});

child.on('exit', code => {
  process.exit(code ?? 0);
});
