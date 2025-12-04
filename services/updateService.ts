export type UpdateCheckResult = {
  current: string;
  latest?: string;
  updateAvailable: boolean;
  downloadUrl?: string;
  error?: string;
};

const REPO_SLUG = 'suncoastdc/DBR';
const REMOTE_PACKAGE_URL = `https://raw.githubusercontent.com/${REPO_SLUG}/main/package.json`;
const FALLBACK_DOWNLOAD = `https://github.com/${REPO_SLUG}/archive/refs/heads/main.zip`;

const currentVersion = (import.meta.env.APP_VERSION as string) || '0.0.0';

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
    const headers: Record<string, string> = { 'Cache-Control': 'no-cache' };
    const token = import.meta.env.VITE_GITHUB_TOKEN as string;
    if (token) headers.Authorization = `Bearer ${token}`;

    const resp = await fetch(REMOTE_PACKAGE_URL, { headers });
    if (!resp.ok) throw new Error(`GitHub responded ${resp.status}`);

    const data = await resp.json();
    const latest = data.version as string;
    const updateAvailable = compareVersions(latest, currentVersion) > 0;

    return {
      current: currentVersion,
      latest,
      updateAvailable,
      downloadUrl: data.downloadUrl || FALLBACK_DOWNLOAD,
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
