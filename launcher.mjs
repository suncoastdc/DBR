#!/usr/bin/env node
import { readFileSync, existsSync } from 'fs';
import { request } from 'https';
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const REPO_SLUG = 'suncoastdc/DBR';
const DEFAULT_BRANCH = 'main';
const REMOTE_PACKAGE_URL = `https://api.github.com/repos/${REPO_SLUG}/contents/package.json?ref=${DEFAULT_BRANCH}`;
const RELEASE_URL = `https://github.com/${REPO_SLUG}/releases/latest`;
const DEV_SERVER_URL = 'http://localhost:3000';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf-8'));
const currentVersion = pkg.version || '0.0.0';
const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const electronCmd = path.join(
  ROOT,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'electron.cmd' : 'electron'
);
const useShell = process.platform === 'win32';

let activeDevServer = null;

function compareVersions(a, b) {
  const pa = a.split('.').map(n => parseInt(n, 10));
  const pb = b.split('.').map(n => parseInt(n, 10));
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const av = pa[i] ?? 0;
    const bv = pb[i] ?? 0;
    if (av > bv) return 1;
    if (av < bv) return -1;
  }
  return 0;
}

function getGithubToken() {
  const envToken = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  if (envToken) return envToken;

  const tokenPath = path.join(ROOT, 'build', 'update-token.json');
  if (existsSync(tokenPath)) {
    try {
      const parsed = JSON.parse(readFileSync(tokenPath, 'utf8'));
      if (parsed?.token) return parsed.token;
    } catch (err) {
      console.warn(`Failed to read GitHub token from ${tokenPath}:`, err);
    }
  }

  return null;
}

function fetchJson(url, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const headers = {
      'Cache-Control': 'no-cache',
      'User-Agent': 'dbr-launcher',
      ...extraHeaders,
    };
    const req = request(
      url,
      { headers, timeout: 4000 },
      res => {
        if (res.statusCode && res.statusCode >= 400) {
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }
        let body = '';
        res.setEncoding('utf8');
        res.on('data', chunk => (body += chunk));
        res.on('end', () => {
          try {
            resolve(JSON.parse(body));
          } catch (err) {
            reject(err);
          }
        });
      }
    );
    req.on('timeout', () => {
      req.destroy(new Error('Request timed out'));
    });
    req.on('error', reject);
    req.end();
  });
}

async function checkForUpdate() {
  try {
    const token = getGithubToken();
    const remote = await fetchJson(REMOTE_PACKAGE_URL, {
      Accept: 'application/vnd.github.v3.raw',
      ...(token ? { Authorization: `token ${token}` } : {}),
    });
    const latest = remote.version || '0.0.0';
    const updateAvailable = compareVersions(latest, currentVersion) > 0;
    return { latest, updateAvailable };
  } catch (err) {
    const message = err?.message || 'Failed to check updates';
    return {
      latest: null,
      updateAvailable: false,
      error: /HTTP 404/.test(message) ? `${message} (repo may be private or token missing)` : message,
    };
  }
}

function openUrl(url) {
  spawn('cmd', ['/c', 'start', '', url], { stdio: 'ignore', detached: true });
}

function prompt(question) {
  return new Promise(resolve => {
    process.stdout.write(question);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');
    process.stdin.once('data', data => resolve(data.trim()));
  });
}

function ensureDeps() {
  const bins = ['concurrently', 'electron'];
  const missingBin = bins.find(bin => {
    const binPath = path.join(ROOT, 'node_modules', '.bin', bin + (process.platform === 'win32' ? '.cmd' : ''));
    return !existsSync(binPath);
  });

  if (!missingBin && existsSync(path.join(ROOT, 'node_modules'))) return Promise.resolve();

  console.log('\nInstalling dependencies (this may take a minute)...');
  return new Promise((resolve, reject) => {
    const child = spawn(npmCmd, ['install'], { stdio: 'inherit', cwd: ROOT, shell: useShell });
    child.on('exit', code => {
      if (code === 0) resolve();
      else reject(new Error(`npm install failed with code ${code}`));
    });
    child.on('error', reject);
  });
}

function pipeWithPrefix(stream, prefix, onData) {
  stream.on('data', chunk => {
    const lines = chunk.toString().split(/\r?\n/).filter(Boolean);
    lines.forEach(line => {
      console.log(`${prefix} ${line}`);
      onData?.(line);
    });
  });
}

function startDevServer() {
  return new Promise((resolve, reject) => {
    const dev = spawn(
      npmCmd,
      ['run', 'dev', '--', '--host', '0.0.0.0', '--port', '3000', '--clearScreen', 'false'],
      { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], shell: useShell }
    );

    let ready = false;
    const finish = (value, isError) => {
      if (ready) return;
      ready = true;
      if (isError && dev.exitCode === null) dev.kill('SIGINT');
      isError ? reject(value) : resolve(dev);
    };

    const checkReady = text => {
      if (
        text.includes('ready in') ||
        text.includes('Local:   http://localhost:3000') ||
        text.includes('Local:   http://127.0.0.1:3000')
      ) {
        finish(dev, false);
      }
    };

    pipeWithPrefix(dev.stdout, '[dev]', checkReady);
    pipeWithPrefix(dev.stderr, '[dev]', checkReady);

    dev.on('error', err => finish(err, true));
    dev.on('exit', code => {
      if (!ready) finish(new Error(`Dev server exited early (code ${code ?? 'unknown'})`), true);
    });

    setTimeout(() => {
      if (!ready) finish(new Error('Dev server did not become ready within 30s'), true);
    }, 30000);
  });
}

function stopProcess(child) {
  return new Promise(resolve => {
    if (!child || child.killed || child.exitCode !== null) return resolve();
    const timeout = setTimeout(() => {
      if (child.exitCode === null) child.kill('SIGTERM');
    }, 3000);
    child.once('exit', () => {
      clearTimeout(timeout);
      resolve();
    });
    child.kill('SIGINT');
  });
}

function startElectron() {
  return new Promise((resolve, reject) => {
    const electronExecutable = existsSync(electronCmd) ? electronCmd : 'electron';
    console.log(`Using Electron executable: ${electronExecutable}`);
    const child = spawn(
      electronExecutable,
      ['.'],
      {
        cwd: ROOT,
        stdio: 'inherit',
        env: { ...process.env, ELECTRON_START_URL: DEV_SERVER_URL },
        shell: useShell,
      }
    );
    child.on('exit', code => resolve(code ?? 0));
    child.on('error', reject);
  });
}

async function launchApp() {
  console.log('\nStarting Vite dev server (this is the longest part)...');
  activeDevServer = await startDevServer();
  console.log('✓ Dev server ready at http://localhost:3000');

  console.log('Starting Electron shell...');
  try {
    return await startElectron();
  } finally {
    console.log('Closing dev server...');
    await stopProcess(activeDevServer);
    activeDevServer = null;
  }
}

async function main() {
  console.log('Dentrix Bank Reconciler Launcher');
  console.log(`Current version: ${currentVersion}`);

  console.log('\nChecking for updates...');
  const result = await checkForUpdate();

  if (result.error) {
    console.log(`Update check failed: ${result.error}`);
  } else if (result.updateAvailable) {
    console.log(`Update available! Latest: ${result.latest}`);
    console.log('Press U to open the latest installer/release page, or Enter to launch current version.');
    const choice = (await prompt('> ')).toLowerCase();
    if (choice === 'u') {
      console.log('Opening download page...');
      openUrl(RELEASE_URL);
      return;
    }
  } else {
    console.log('You are up to date.');
  }

  await ensureDeps();

  try {
    const exitCode = await launchApp();
    await prompt('\nApp closed. Press Enter to exit launcher...');
    process.exit(exitCode);
  } catch (err) {
    console.error(`\nLaunch failed: ${err.message}`);
    await prompt('\nPress Enter to close...');
    process.exit(1);
  }
}

process.on('SIGINT', async () => {
  if (activeDevServer) await stopProcess(activeDevServer);
  process.exit(0);
});

main().catch(async err => {
  console.error('Launcher error:', err);
  await prompt('\nPress Enter to close...');
  process.exit(1);
});
