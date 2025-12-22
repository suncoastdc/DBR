# API Keys Setup Documentation

## What I Want to Achieve

I want to run the DBR (Dentrix Bank Reconciler) app in development mode with both API keys automatically loaded from environment variables, so I don't have to manually enter them in the Settings UI every time.

## What I'm Trying to Do

1. **Load Gemini API Key** - The app needs a Gemini API key to parse deposit slips using Google's Gemini AI model
2. **Load GitHub Token** - The app needs a GitHub token to check for auto-updates from the GitHub releases

Both keys should be automatically available when running `npm run electron:dev` without requiring manual entry in the Settings modal.

## Where the Keys Are Located

### Current Key Locations:

1. **`.env.local` file** (project root: `C:\DBR\DBR\.env.local`)
   - Contains: `GEMINI_API_KEY=your_gemini_api_key_here`
   - Contains: `VITE_GITHUB_TOKEN=your_github_token_here`
   - Contains: `GH_TOKEN=your_github_token_here`

2. **`update-token.json` file** (project root: `C:\DBR\DBR\update-token.json`)
   - Contains: `{"token":"your_github_token_here"}`

3. **`build/update-token.json` file** (project root: `C:\DBR\DBR\build\update-token.json`)
   - Contains: `{ "token": "" }` (empty)

## How the App Currently Loads Keys

### Gemini API Key Loading (in `services/geminiService.ts`):
The service checks for the key in this order:
1. `getApiKey()` from localStorage (Settings UI)
2. `import.meta.env.GEMINI_API_KEY` (from Vite env vars)
3. `process.env.GEMINI_API_KEY` (from Node.js env vars)
4. `process.env.API_KEY` (fallback)

### GitHub Token Loading (in `services/updateService.ts` and `electron/main.js`):
The service checks for the token in this order:
1. `import.meta.env.VITE_GITHUB_TOKEN` (from Vite env vars)
2. `process.env.GH_TOKEN` or `process.env.GITHUB_TOKEN` (from Node.js env vars)
3. `update-token.json` files in various locations

## Current Configuration

### Vite Config (`vite.config.ts`):
- Uses `loadEnv(mode || 'development', process.cwd(), '')` to load `.env.local`
- Defines `import.meta.env.GEMINI_API_KEY` and `process.env.GEMINI_API_KEY` in the `define` section
- Defines `import.meta.env.VITE_GITHUB_TOKEN` for GitHub token

### Electron Runner (`scripts/run-electron.js`):
- Uses `dotenv` to load `.env.local` before spawning Electron
- Passes environment variables to the Electron process

## The Problem

When running `npm run electron:dev`, the app is not seeing the API keys from `.env.local`. The keys are present in the file, but they're not being loaded into the app's runtime environment.

## Expected Behavior

When I run `npm run electron:dev`:
1. Vite dev server should start and load `.env.local`
2. The Gemini API key should be available via `import.meta.env.GEMINI_API_KEY`
3. The GitHub token should be available via `import.meta.env.VITE_GITHUB_TOKEN`
4. The app should work without requiring manual key entry in Settings

## Files Modified to Fix This

1. **`scripts/run-electron.js`** - Added dotenv to load `.env.local` for Electron process
2. **`vite.config.ts`** - Updated to use `process.cwd()` and added `import.meta.env.GEMINI_API_KEY` to define
3. **`services/geminiService.ts`** - Added check for `import.meta.env.GEMINI_API_KEY` and debug logging
4. **`.env.local`** - Contains both API keys

## Next Steps to Debug

1. Check Vite dev server console for the debug message: "✓ GEMINI_API_KEY loaded from .env.local"
2. Check browser console for API key check debug output
3. Verify that Vite's `loadEnv` is actually finding and loading `.env.local`
4. Ensure the dev server is restarted after `.env.local` changes

