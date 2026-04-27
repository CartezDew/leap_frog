# Upload DATA

Drop your GA4 Excel exports (`.xlsx` / `.xls`) into this folder. The dashboard
reads files **directly from this folder** and runs the analysis on whichever
file you select.

## How it works

The Vite dev server (and the production build) auto-discovers every workbook
in this folder and exposes them to the React app:

1. The Vite plugin in `vite-plugins/upload-data.js` watches this folder.
2. On `npm run dev` and `npm run build`, the plugin publishes a manifest at
   `/__upload_data_manifest.json` listing every `.xlsx` / `.xls` file (name,
   size, last-modified timestamp).
3. The Upload page in the dashboard fetches that manifest and shows the files
   in a "Files in Upload DATA/" picker. Click *Run analysis* and the browser:
   - Fetches the file's bytes over the dev server,
   - Parses it with SheetJS in `src/lib/parser.js`,
   - Runs the full analysis pipeline in `src/lib/analyzer.js`,
   - Stores the result in React Context **and** `localStorage`
     (`leapfrog_data`) so a refresh keeps you on the dashboard.

The original `.xlsx` file stays in this folder and is never copied or modified
by the dashboard — the dashboard only reads it.

## Workflow

1. Drop a fresh GA4 export into this folder, e.g.
   `leapfrog-2026-q1.xlsx`.
2. In the dashboard, click *Refresh* on the **Files in Upload DATA/** card
   (or just reload the page) so the manifest picks it up.
3. Click *Run analysis* on the file you want.
4. Navigate the dashboard pages — Executive Summary, Bounce Rate, Bot Traffic,
   etc.

To swap workbooks: drop a new file in, click *Refresh*, click *Run analysis*
on the new one. To wipe state entirely: **Clear Data & Re-upload** in the
sidebar.

## Privacy

`.xlsx` and `.xls` files placed in this folder are **gitignored** — see the
root `.gitignore`. Only this README and `.gitkeep` are tracked, so client
data won't be committed by accident.

If you want to share a sanitized synthetic sample with collaborators, place
it in `/sample-data/` instead — that folder is tracked and is what
`scripts/smoke_test.mjs` runs against.

## Drag-drop fallback

The Upload page also keeps a drag-drop zone for one-off files you don't want
to save here. Files dropped that way go straight through the same
parser → analyzer pipeline, just without being persisted to disk.
