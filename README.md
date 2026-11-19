# NumPy Nebula 2.0

Restore a colony ship by writing real Python and NumPy. The campaign has seven sectors and 15 short checkpoints. Boot Bay unlocks Free Lab and completing the campaign unlocks seven Nebula challenges. Use the Array Inspector to compare shapes, values, dimensions, and slices, and the Ship Log to revisit what you repaired. Progress, code, and settings save locally in the browser.

## Run locally

Use Node.js 24 and npm.

```powershell
npm ci
npm run dev
```

The first run fetches and SHA-256 verifies the pinned NumPy wheel. The game serves Python, NumPy, fonts, and art from its own origin. All Python evaluation happens in the browser. Stop restarts the Python worker and keeps the current draft.

## Build and qualify

```powershell
npm run typecheck
npx playwright install chromium firefox webkit
$env:NEBULA_BROWSER = 'all'
npm run test:regression
node scripts/performance-check.mjs
```

The regression builds and serves the production artifact under a repository-style subpath. Its HTTP server uses normal gzip encoding for text assets, and the worker can stream-decompress its pinned same-origin Wasm asset. Set `NEBULA_SHOTS` to capture screenshots in a directory of your choice. The deployment workflow runs verification again before uploading the static artifact. Use `npm run build` followed by `npm run serve` to preview the artifact locally. Serve `dist` over HTTP or HTTPS with WebAssembly MIME support.

## Project map

- `src/curriculum.ts` owns the story, stage inputs, hints, and validation expressions. Each authored check runs on the visible input and, after those checks pass, a second fixture.
- `src/campaign.ts` owns progression and the versioned browser save. Each stage and Lab dataset has a separate draft.
- `src/engine.ts`, `src/python-worker.ts`, and `src/runner.py` handle worker lifecycle, execution, and bounded previews.
- `src/main.ts`, `src/editor.ts`, `src/inspection.ts`, and `src/ship.ts` adapt the game state to the editor, DOM, and Canvas 2D.
- `scripts/solutions.ts` contains the regression solutions. It is excluded from the browser bundle.

The browser playtest hooks are `window.render_game_to_text()` and `window.advanceTime(ms)`. Keep stage IDs stable so browser saves can be restored. If adding a stage, author both fixtures and a regression solution.

The original ship cutaway is generated raster artwork, exported as a web-optimized WebP. The app draws room light states and repair effects over the cutaway. Press Start 2P, Barlow, and Space Mono are distributed through Fontsource under the SIL Open Font License.
