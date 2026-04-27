# Leapfrog Services Analytics Dashboard

A frontend-only React analytics dashboard for Leapfrog Services. Drop a Google
Analytics 4 (GA4) Excel export onto the upload page and the browser:

1. Reads the file with `FileReader` + SheetJS (`xlsx`).
2. Classifies every sheet (sheet name → header fingerprint).
3. Reshapes the GA4 wide-monthly format into long format in plain JavaScript.
4. Runs bounce-rate, engagement, bot scoring, user-persona, unicorn-page, and
   contact-form classification entirely in the browser.
5. Stores the resulting dataset in React Context **and** `localStorage`
   (`leapfrog_data`) so a refresh keeps you on the dashboard.

There is **no backend, no API, no Python at runtime, and no network requests
after the initial page load**. The file you upload never leaves your machine.

The data parsing rules, bot/user-engagement scoring methodology, calculation
formulas, and styling tokens all live in [`SKILL.md`](./SKILL.md). The visual
language is in [`DASHBOARD.md`](./DASHBOARD.md). Both files are treated as
"skills" — keep them as the source of truth and update the code when they
change.

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
│   └── smoke_test.mjs     Node script that runs the parser+analyzer on the sample file
├── src/
│   ├── main.jsx           ReactDOM root + DataProvider + Router
│   ├── App.jsx            Route table
│   ├── styles/global.css  All visual tokens, components, and utilities
│   ├── lib/
│   │   ├── skillConfig.js   Constants ported from SKILL.md
│   │   ├── parser.js        Sheet classification + wide→long reshaping
│   │   ├── analyzer.js      Bot scoring, personas, unicorns, contact intel
│   │   ├── validator.js     Validation report builder
│   │   ├── sheetReader.js   FileReader → XLSX.read → parser → analyzer
│   │   └── formatters.js    Display helpers (numbers, percents, durations)
│   ├── context/
│   │   └── DataContext.jsx  Global state, localStorage hydration, ingest, clear
│   ├── components/        Sidebar, UploadZone, ValidationReport, KpiCard,
│   │                      DataTable, StatusBadge, ChartWrapper, EmptyState,
│   │                      Layout, PageHeader
│   └── pages/             Upload + 9 report pages (Executive Summary, etc.)
├── SKILL.md               Data parsing & analysis specification
├── DASHBOARD.md           Visual design notes
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

### Smoke test the parser

```bash
node scripts/smoke_test.mjs
```

Runs the browser parser + analyzer + validator over `sample-data/synthetic_ga4.xlsx`
in plain Node. Use this when you change `src/lib/parser.js` or `src/lib/analyzer.js`
to confirm the wide-to-long reshape and aggregations still match SKILL.md.

---

## How It Works

1. Open the dashboard. With no data, the home page shows an empty state with a
   **Go to Upload** CTA.
2. On the Upload page, drop a GA4 `.xlsx` export (or click *Choose File*).
3. The browser reads it, classifies every sheet, reshapes wide monthly data into
   long form, and runs the full analysis pipeline — all in JavaScript, all
   client-side.
4. A validation report shows what was detected, what was missing, and any
   warnings. The full dataset is persisted to `localStorage`.
5. Navigate the nine report pages from the sidebar:
   - Executive Summary
   - Actionable Insights
   - Bounce Rate
   - User ID Engagement
   - Traffic Sources
   - Page Path Analysis
   - Unicorn Pages
   - Contact Form Intel
   - Bot Traffic Intelligence
6. Click **Clear Data & Re-upload** in the sidebar (or on the Upload page) to
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

## When the spec changes

If `SKILL.md` is updated (new metric alias, new bot rule, threshold tweak):

1. Update the matching constant in `src/lib/skillConfig.js`.
2. Update the relevant calculation in `src/lib/analyzer.js` or `src/lib/parser.js`.
3. Re-run `node scripts/smoke_test.mjs` against the sample workbook.
4. Re-run `npm run build` to confirm everything compiles.
