# Leapfrog Services Analytics Dashboard

A frontend-only React analytics dashboard for Leapfrog Services. Upload raw
Google Analytics 4 (GA4) Excel tabs and optional Semrush keyword PDFs, and the browser:

1. Reads the file with `FileReader` + SheetJS (`xlsx`).
2. Classifies every sheet (sheet name → header fingerprint).
3. Reshapes the GA4 wide-monthly format into long format in plain JavaScript.
4. Runs bounce-rate, engagement, bot scoring, AI/AEO source detection,
   user-persona, unicorn-page, keyword, and contact-form analysis in the browser.
5. Stores the resulting dataset in React Context **and** `localStorage`
   (`leapfrog_data`) so a refresh keeps you on the dashboard.

There is **no backend, no API, and no Python at runtime**. Uploaded workbook
analysis happens in the browser. Optional built-in upload data and SEO/AEO crawl
features may fetch selected local/static assets or the public website when used.

The data parsing rules, bot/user-engagement scoring methodology, calculation
formulas, and styling tokens live in [`SKILL.md`](./SKILL.md). The development
handoff and source-of-truth rules live in [`DEVELOPMENT_HANDOFF.md`](./DEVELOPMENT_HANDOFF.md).

---

## Tech Stack

| Layer    | Stack                                                                  |
| -------- | ---------------------------------------------------------------------- |
| Frontend | React 18, Vite, React Router, Recharts, react-icons (Lucide)           |
| Parsing  | SheetJS (`xlsx`) + plain JavaScript (`Array#map`/`reduce`/`groupBy`)   |
| State    | React Context + `localStorage` for persistence                         |
| Styling  | Plain CSS only — **no inline styles, no CSS-in-JS, no Tailwind**       |

---

## Project Structure

```
leap_frog/
├── index.html             Vite HTML entry
├── vite.config.js         Vite config (React plugin, dev server :5173)
├── package.json           Dependencies (xlsx, recharts, react-router-dom, react-icons)
├── public/                Static assets served at root
├── sample-data/           Drop sample GA4 .xlsx files here for dev testing
├── scripts/
│   ├── build-synthetic-semrush.mjs
│   └── smoke-synthetic-keywords.mjs
├── src/
│   ├── main.jsx           ReactDOM root + DataProvider + Router
│   ├── App.jsx            Route table
│   ├── styles/global.css  All visual tokens, components, and utilities
│   ├── lib/
│   │   ├── skillConfig.js   Constants ported from SKILL.md
│   │   ├── parser.js        Sheet classification + wide→long reshaping
│   │   ├── analyzer.js      Bot scoring, personas, cleaned bounce, pages, contact intel
│   │   ├── validator.js     Validation report builder
│   │   ├── sheetReader.js   FileReader → XLSX.read → parser → analyzer
│   │   └── formatters.js    Display helpers (numbers, percents, durations)
│   ├── context/
│   │   └── DataContext.jsx  Global state, localStorage hydration, ingest, clear
│   ├── components/        Sidebar, UploadZone, ValidationReport, KpiCard,
│   │                      DataTable, StatusBadge, ChartWrapper, EmptyState,
│   │                      Layout, PageHeader
│   └── pages/             Upload, help, GA4 report pages, SEO/AEO, Keywords
├── SKILL.md               Data parsing & analysis specification
├── DASHBOARD.md           Dashboard behavior and UI notes
├── DEVELOPMENT_HANDOFF.md Current implementation logic for developers
└── README.md              You are here
```

---

## Getting Started

### Prerequisites
- Node.js 18+
- npm 9+

### Install & run

```bash
npm install
npm run dev
```

The dashboard is served at <http://localhost:5173>.

### Production build

```bash
npm run build
npm run preview
```

### Smoke test keyword parsing

```bash
npm run smoke:synthetic-semrush
```

Runs the synthetic Semrush keyword smoke check. For GA4 calculation changes,
use the sample workbook in `src/Excel/` or a client-safe fixture and run the
parser/analyzer directly through Node.

---

## Deploy to Netlify

The dashboard is a pure client-side SPA, so Netlify hosting is essentially
free and zero-config. The repo already includes:

- `netlify.toml` — sets `npm run build` as the build command, `dist` as the
  publish directory, Node 20, the SPA fallback redirect, and asset cache
  headers.
- `public/_redirects` — duplicates the SPA fallback so React Router routes
  (`/upload`, `/bounce`, etc.) keep working on a hard refresh.

### Option A — Connect the GitHub repo (recommended)

1. Push your latest commit to GitHub.
2. In Netlify: **Add new site → Import an existing project → GitHub →
   `CartezDew/leap_frog`**.
3. Accept the defaults (Netlify reads `netlify.toml`):
   - Build command: `npm run build`
   - Publish directory: `dist`
4. Click **Deploy site**. Every push to `main` will trigger a new deploy.

### Option B — Drag-and-drop deploy

1. Run `npm run build` locally.
2. Open <https://app.netlify.com/drop> and drop the generated `dist/` folder
   onto the page.

### Option C — Netlify CLI

```bash
npm install -g netlify-cli
netlify login
netlify init      # link the repo to a new or existing Netlify site
netlify deploy --build --prod
```

### About the `Upload DATA/` folder

`Upload DATA/*.xlsx` is git-ignored (client data stays off GitHub), so those
files will not exist during a Netlify build. That is fine — the dashboard
prompts the user to drop their own GA4 export on the Upload page. The custom
Vite plugin (`vite-plugins/upload-data.js`) simply emits an empty manifest
when the folder is empty, so the build still succeeds.

If you want a sample workbook to ship with the deployed site, copy it into
`Upload DATA/` and commit it (or add it to a separate, non-ignored folder).

---

## How It Works

1. Open the dashboard. With no data, the home page shows an empty state with a
   **Go to Upload** CTA.
2. On the Upload page, drop a GA4 `.xlsx` export or select an available Upload DATA file.
3. The browser reads it, classifies every sheet, reshapes wide monthly data into
   long form, and runs the full analysis pipeline — all in JavaScript, all
   client-side.
4. Raw GA4 tabs are used as the source of truth. Report-style/calculated tabs
   are preserved as reference material and can be compared against raw-derived
   results, but they do not drive dashboard metrics.
5. A validation report shows what was detected, what was missing, and any
   warnings. The full dataset is persisted to `localStorage`.
6. Navigate the report pages from the sidebar:
   - Executive Summary
   - Actionable Insights
   - Bounce Rate
   - User ID Engagement
   - Traffic Sources
   - Page Path Analysis
   - Unicorn Pages
   - Contact Form Intel
   - Bot Traffic Intelligence
   - Keywords
   - SEO / AEO
   - About / How to Use
7. Click **Clear Data & Re-upload** in the sidebar (or on the Upload page) to
   wipe `localStorage` and start over.

A refresh of the page rehydrates Context from `localStorage` instantly — no
re-upload needed.

---

## Styling Rules (Hard Constraints)

- Never use `style={{}}` props or any other inline styling — every visual
  property lives in `src/styles/global.css`.
- All colors reference CSS custom properties defined at the top of
  `global.css`.
- Bounce-rate and bot-classification color coding is class-driven, not
  value-driven (see `bounceClass` / `BotBadge` / `BounceBadge`).

---

## Current Calculation Contract

- Raw GA4 tabs are the source of truth.
- Annual bounce rate is `1 - engaged_sessions / sessions` after summing raw counts.
- Bot session KPIs use the `City` partition because source + city aggregates cannot be unioned without row-level session data.
- Source-level bot scoring remains a supporting evidence lens.
- AI/AEO traffic is separated from spam bots.
- Page-level bot cleanup is modeled unless the upload includes row-level sessions with page, city, source, device, and engagement fields.

See [`DEVELOPMENT_HANDOFF.md`](./DEVELOPMENT_HANDOFF.md) for the full implementation notes.

---

## When the spec changes

If `SKILL.md` is updated (new metric alias, new bot rule, threshold tweak):

1. Update the matching constant in `src/lib/skillConfig.js`.
2. Update the relevant calculation in `src/lib/analyzer.js` or `src/lib/parser.js`.
3. Re-run the relevant parser/analyzer check against a safe fixture.
4. Re-run `npm run build` to confirm everything compiles.
