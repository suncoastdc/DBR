# DBR Dentrix Bank Reconciler

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/drive/1EFNUUXsrx-JVAk-PX9HSHyj1k6YxGlzG

## Run Locally

**Prerequisites:** Node.js 20+

1. Install dependencies: `npm install`
2. Set `GEMINI_API_KEY` in [.env.local](.env.local)
3. Dev web/Electron: `npm run dev` (Vite) and `npm run electron:dev` to open Electron shell
4. Package Windows locally: `npm run build:win` (outputs to `release/`)

## Release & Auto-Update (GitHub Actions)

The `Release` workflow builds Windows NSIS and publishes update assets to GitHub Releases.

1. Ensure `GH_TOKEN` repository secret exists (PAT with `repo`, `workflow` scopes).
2. Bump version in `package.json` (e.g., `1.0.4`) so app/build artifacts match the tag.
3. Commit and push `main`.
4. Tag and push: `git tag v1.0.4 && git push origin main v1.0.4`.
5. Workflow runs on the tag, uploads `MyElectronApp Setup <version>.exe`, `.blockmap`, and `latest.yml`.

Auto-updater uses GitHub releases; app icon is `build/icon.ico` packaged via electron-builder.

See contributor guide: [AGENTS.md](AGENTS.md)
