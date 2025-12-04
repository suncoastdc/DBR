#!/usr/bin/env node
import { readFileSync, existsSync } from 'fs';
import { request } from 'https';
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const REPO_SLUG = 'suncoastdc/DBR';
const REMOTE_PACKAGE_URL = `https://raw.githubusercontent.com/${REPO_SLUG}/main/package.json`;
const RELEASE_URL = `https://github.com/${REPO_SLUG}/releases/latest`;
const FALLBACK_ZIP = `https://github.com/${REPO_SLUG}/archive/refs/heads/main.zip`;

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf-8'));
const currentVersion = pkg.version || '0.0.0';

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

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const req = request(url, { headers: { 'Cache-Control': 'no-cache' } }, res => {
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
    });
    req.on('error', reject);
    req.end();
  });
}

async function checkForUpdate() {
  try {
    const remote = await fetchJson(REMOTE_PACKAGE_URL);
    const latest = remote.version || '0.0.0';
    const updateAvailable = compareVersions(latest, currentVersion) > 0;
    return { latest, updateAvailable };
  } catch (err) {
    return { latest: null, updateAvailable: false, error: err?.message || 'Failed to check updates' };
  }
}

function openUrl(url) {
  spawn('cmd', ['/c', 'start', '', url], { stdio: 'ignore', detached: true });
}

function launchApp() {
  return new Promise(resolve => {
    console.log('\nLaunching app... (Ctrl+C to stop)\n');
    const child = spawn('npm', ['run', 'electron:dev'], { stdio: 'inherit', shell: true, cwd: ROOT });
    child.on('exit', code => resolve(code ?? 0));
  });
}

function prompt(question) {
  return new Promise(resolve => {
    process.stdout.write(question);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');
    process.stdin.once('data', data => {
      resolve(data.trim());
    });
  });
}

function ensureDeps() {
  const bins = ['concurrently', 'electron'];
  const missingBin = bins.find(bin => {
    const binPath = path.join(ROOT, 'node_modules', '.bin', bin + (process.platform === 'win32' ? '.cmd' : ''));
    return !existsSync(binPath);
  });

  if (!missingBin && existsSync(path.join(ROOT, 'node_modules'))) return Promise.resolve();

  console.log('Installing dependencies (this may take a minute)...');
  return new Promise((resolve, reject) => {
    const child = spawn('npm', ['install'], { stdio: 'inherit', shell: true, cwd: ROOT });
    child.on('exit', code => {
      if (code === 0) resolve();
      else reject(new Error(`npm install failed with code ${code}`));
    });
  });
}

async function main() {
  console.log('Dentrix Bank Reconciler Launcher');
  console.log(`Current version: ${currentVersion}`);
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
  const exitCode = await launchApp();
  await prompt('\nApp closed. Press Enter to exit launcher...');
  process.exit(exitCode);
}

main().catch(err => {
  console.error('Launcher error:', err);
  prompt('\nPress Enter to close...').then(() => process.exit(1));
});
