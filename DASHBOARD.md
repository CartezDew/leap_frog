# Dashboard Notes

This file documents the current Leapfrog dashboard behavior, language, and visual guardrails.

## Product Purpose

The dashboard turns raw GA4 and Semrush exports into browser-only analytics views for client strategy work. It should explain what the uploaded data supports directly and clearly label anything that is modeled from aggregate data.

## Data Model

The dashboard calculates from raw tabs:

- `Source`
- `Medium`
- `Device`
- `City`
- `New - Est. Users`
- `Page Path`
- `Contact`
- `Source-Medium-Device`
- `User`
- `Consolidated Data`

Report-style tabs are reference material. They are preserved for comparison, but they do not drive dashboard KPIs.

## Bot And Bounce Language

Use neutral, data-dependent language.

Good:

- “Confirmed bot removal changes city-classified bounce to X%.”
- “Confirmed + likely automated city traffic removal changes it to Y%.”
- “Page-level bot cleanup requires row-level session data.”
- “AI/AEO sources are reported separately from spam bots.”

Avoid:

- Fixed numbers in static copy.
- “True homepage bounce” unless row-level page + city/source data exists.
- Claims that city and source bot sessions are unioned from aggregate tabs.

## Measured Versus Modeled

Measured values come directly from raw tabs after parser/analyzer aggregation.

Modeled values are allowed only when the UI makes the limitation clear. Current limitation: `Page Path`, `City`, and `Source` are separate aggregate tabs, so the dashboard cannot prove which page sessions came from bot cities or bot sources without row-level data.

## AI / AEO Distinction

Traffic from ChatGPT, Claude, Gemini, Perplexity, Copilot, and similar tools can look automated because sessions may be short or high bounce. The dashboard separates these sources from spam/datacenter bots and frames them as discovery traffic.

## UI Tone

The dashboard should be:

- Informational
- Plainspoken
- Client-safe
- Clear about assumptions
- Specific about what the current upload supports

Avoid copy that appears to defend a prior strategy claim. The same dashboard must work for different reports with different values.

## Styling Guardrails

- No inline styles in JSX.
- Use `src/styles/global.css` for all visual styling.
- Use existing card, table, badge, and lever-card patterns before adding new UI primitives.
- Use `KpiCard`, `DataTable`, `PageHeader`, and existing status badges for consistency.
- Keep exportable data in tables where possible.

## Implementation References

- `src/lib/parser.js`: sheet classification, raw/reference separation, reshaping.
- `src/lib/analyzer.js`: core calculations, bot scoring, cleaned bounce views, page rankings.
- `src/lib/levers.js`: cross-page derived insight helpers.
- `src/pages/BounceRate.jsx`: cleaned bounce panel and high-reach engaged pages.
- `src/pages/BotTraffic.jsx`: bot/AEO explanation, measured-vs-modeled note, row-level data recommendation.
- `src/pages/About.jsx`: user-facing help and glossary.
- `DEVELOPMENT_HANDOFF.md`: developer implementation contract.
