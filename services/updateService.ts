export type UpdateCheckResult = {
  current: string;
  latest?: string;
  updateAvailable: boolean;
  downloadUrl?: string;
  error?: string;
};

const REPO_SLUG = 'suncoastdc/DBR';
const DEFAULT_BRANCH = 'main';
const REMOTE_PACKAGE_URL = `https://api.github.com/repos/${REPO_SLUG}/contents/package.json?ref=${DEFAULT_BRANCH}`;
const RELEASE_PAGE = `https://github.com/${REPO_SLUG}/releases/latest`;
const FALLBACK_DOWNLOAD = RELEASE_PAGE;

const currentVersion = (import.meta.env.APP_VERSION as string) || '0.0.0';
const RAW_ACCEPT_HEADER = 'application/vnd.github.v3.raw';

function getNodeRequire(): any {
  if (typeof window !== 'undefined' && (window as any).require) {
    return (window as any).require;
  }
  if (typeof globalThis !== 'undefined' && (globalThis as any).require) {
    return (globalThis as any).require;
  }
  return null;
}

function loadGithubToken(): string | undefined {
  const envToken = (import.meta.env.VITE_GITHUB_TOKEN as string) || '';
  if (envToken) return envToken;

  if (typeof process !== 'undefined' && process?.env) {
    const procToken = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
    if (procToken) return procToken;
  }

  try {
    const nodeRequire = getNodeRequire();
    if (!nodeRequire) return undefined;

    const fs = nodeRequire('fs') as typeof import('fs');
    const path = nodeRequire('path') as typeof import('path');
    const candidatePaths: string[] = [];

    if (typeof process !== 'undefined' && (process as any).resourcesPath) {
      candidatePaths.push(path.join((process as any).resourcesPath, 'update-token.json'));
    }

    if (typeof process !== 'undefined' && typeof process.cwd === 'function') {
      candidatePaths.push(path.join(process.cwd(), 'build', 'update-token.json'));
    }

    for (const tokenPath of candidatePaths) {
      if (fs.existsSync(tokenPath)) {
        const raw = fs.readFileSync(tokenPath, 'utf8');
        const parsed = JSON.parse(raw);
        if (parsed?.token) return parsed.token as string;
      }
    }
  } catch (err) {
    console.warn('Failed to load GitHub token for update check', err);
  }

  return undefined;
}

function compareVersions(a: string, b: string): number {
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

export async function checkForUpdate(): Promise<UpdateCheckResult> {
  try {
    const headers: Record<string, string> = {
      'Cache-Control': 'no-cache',
      Accept: RAW_ACCEPT_HEADER,
    };
    const token = loadGithubToken();
    if (token) headers.Authorization = `token ${token}`;

    const resp = await fetch(REMOTE_PACKAGE_URL, { headers });
    if (!resp.ok) {
      const hint = resp.status === 404 ? ' (repo may be private or token missing)' : '';
      throw new Error(`GitHub responded ${resp.status}${hint}`);
    }

    const packageJsonText = await resp.text();
    const data = JSON.parse(packageJsonText);
    const latest = data.version as string;
    const updateAvailable = compareVersions(latest, currentVersion) > 0;

    return {
      current: currentVersion,
      latest,
      updateAvailable,
      downloadUrl: data.downloadUrl || RELEASE_PAGE,
    };
  } catch (err: any) {
    return {
      current: currentVersion,
      updateAvailable: false,
      error: err?.message || 'Failed to check for updates',
      downloadUrl: FALLBACK_DOWNLOAD,
    };
  }
}
