# DBR Dentrix Bank Reconciler

This repository contains everything you need to run DBR locally or package the Electron desktop app.

View your app in AI Studio: https://ai.studio/apps/drive/1EFNUUXsrx-JVAk-PX9HSHyj1k6YxGlzG

## Run Locally

**Prerequisites:** Node.js 20+

1. Install dependencies: `npm install`
2. Copy `env.example` to `.env.local`, then set `GEMINI_API_KEY`
3. Start the Vite dev server: `npm run dev` (http://localhost:5173)
4. Launch the Electron shell (optional): `npm run electron:dev`
5. Build the desktop installer:
   - All platforms: `npm run build`
   - Windows x64 only: `npm run build:win`

## Release & Auto-Update (GitHub Actions)

There are two release workflows:

- **Auto build and release on approval or push** (`auto-build-release.yml`) runs on pushes to `main` or approved PRs from this repo. It bumps the patch version, tags the release, then builds and publishes the Windows installer.
- **Release** (`release.yml`) is a manual workflow that builds and publishes from the selected ref when you click **Run workflow** in GitHub Actions.

### Auto Release (Default)

1. Ensure `GH_TOKEN` repository secret exists (PAT with `repo`, `workflow` scopes).
2. Ensure `AUTO_UPDATE_TOKEN` is set for private repo updates (public repos can omit it).
3. Merge or push to `main` (or approve a PR from this repo).
4. The workflow bumps `package.json`, tags `v<version>`, and publishes `MyElectronApp Setup <version>.exe`, `.blockmap`, and `latest.yml`.

### Manual Trigger (Fallback)

If you need to force a release without the auto workflow:
1. Go to **Actions** tab on GitHub.
2. Select **Release** workflow.
3. Click **Run workflow** -> Select the branch/ref -> **Run workflow**.
4. This runs the Windows build and publishes artifacts for that ref.

Auto-updater uses GitHub releases; app icon is `build/icon.ico` packaged via electron-builder.

See contributor guide: [AGENTS.md](AGENTS.md)
