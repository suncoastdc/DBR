# Repository Guidelines

## Project Structure & Module Organization
- `App.tsx` is the React entry point that routes between reconciliation, bank import, and deposit capture views.
- Reusable UI lives in `components/` (BankImport, DepositProcessor, ReconciliationView, Redactor, ScreenCropper). Keep new screens in this folder and wire them through `App.tsx`.
- `services/geminiService.ts` contains API helpers; extend it for any external calls to keep side effects out of components.
- `electron/main.js` owns the desktop shell and packaging config; keep Electron-only code here.
- Static assets and PWA scaffolding sit in `index.html`, `manifest.json`, and `public/` (icon referenced in `package.json`).

## Build, Test, and Development Commands
- `npm install` — install dependencies (Node.js required).
- `npm run dev` — start Vite dev server at http://localhost:5173.
- `npm run electron:dev` — run Vite dev server and attach the Electron shell for desktop testing.
- `npm run build` — type-check with `tsc` then produce a production Vite build in `dist/`.
- `npm run preview` — serve the built `dist/` bundle locally.
- `npm run dist` — build the web app then create an Electron installer (outputs to `release/`).

## Coding Style & Naming Conventions
- TypeScript + React 18 + Vite + Electron; prefer functional components with hooks over classes.
- Use 2-space indentation and keep imports ordered (react, third-party, local).
- Components and TypeScript types/interfaces are PascalCase; variables, props, and functions are camelCase; file names match the exported component.
- Keep network/file system logic in `services/`; keep presentational components pure and side-effect-free.

## Testing Guidelines
- Automated tests are not set up yet; when adding, prefer a Vite-friendly runner (e.g., Vitest) and place specs alongside code (`components/__tests__/ComponentName.test.tsx`).
- Add targeted unit tests for helpers and regression tests for reconciliation math; keep fixtures small and anonymized.
- Minimum manual smoke before merging: run `npm run dev`, import bank data, add deposits, and confirm reconciliation totals persist across reloads.

## Commit & Pull Request Guidelines
- Write concise, imperative commit subjects ("Add reconciliation validation"), optionally with Conventional Commit prefixes (`feat:`, `fix:`) for clarity.
- PRs should summarize the change, list test steps/results, note any Electron-specific checks, and attach screenshots/GIFs for UI-impacting changes.
- Link related issues or tasks; call out breaking changes or new environment variables explicitly.

## Security & Configuration Tips
- Store secrets such as `GEMINI_API_KEY` in `.env.local`; do not commit `.env*` files.
- User data is cached in `localStorage`; avoid logging PHI/PII and sanitize any data before exporting.
- Installer metadata (appId/productName/icon) is defined in `package.json`; keep branding changes synchronized there and in `public/` assets.
