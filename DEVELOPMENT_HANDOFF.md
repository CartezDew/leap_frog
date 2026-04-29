# Development Handoff: Dashboard Logic

This document summarizes the completed dashboard logic for future development work.

## Source Of Truth

Dashboard calculations are driven by raw GA4 export tabs, not manually calculated report tabs.

Raw calculation tabs include:

- `Source`
- `Medium`
- `Device`
- `City`
- `New - Est. Users`
- `Page Path`
- `Contact`
- `Source-Medium-Device`
- `User`
- `Consolidated Data`, when present

Report-style sheets such as `Executive Summary`, `Bounce Rate Analysis`, `Traffic Sources`, `User ID Engagement`, `Contact Form Intel`, or `Bot Traffic Intelligence` may be present in a workbook, but they are reference material only. They should not override raw-derived dashboard calculations.

## Parser Rules

`src/lib/parser.js` classifies sheets in this order:

1. Detect report/calculation tabs with banner-style titles and preserve them as analysis/reference sheets.
2. Classify raw tabs by sheet name.
3. Classify raw tabs by header fingerprint.
4. Mark unmatched sheets as unrecognized.

Wide monthly GA4 tabs are reshaped into long format before analysis. Flat tabs such as `User`, `Contact`, and `Consolidated Data` use their own readers.

## Bounce Rate Logic

Bounce rate is recalculated from raw counts:

```text
Bounce Rate = 1 - (Engaged Sessions / Sessions)
```

Do not average monthly bounce-rate percentages for annual reporting. Sum sessions and engaged sessions first, then calculate bounce.

The Bounce Rate page now distinguishes:

- Reported site bounce from raw site totals.
- City-classified bounce from the `City` partition.
- Confirmed-bot removed bounce.
- Confirmed + likely bot removed bounce.
- Human-only city bounce.

Page-level bot removal cannot be measured exactly from the standard aggregate tabs because `Page Path`, `City`, and `Source` are separate views. Page-level cleanup should be described as modeled unless a row-level session export is provided.

## Bot Intelligence Logic

Bot scoring is calculated from three independent lenses:

- City scoring: datacenter and behavior signals by city.
- Source scoring: spam/referrer and behavior signals by session source.
- User-ID scoring: cookie/user behavior from the `User` tab.

Headline session metrics use the `City` tab because city rows form a real session partition. Source scoring remains a supporting evidence lens. Do not union city and source bot sessions from aggregates; that requires row-level session data.

AI/AEO traffic is separated from spam bots. Sources such as ChatGPT, Claude, Gemini, Perplexity, Copilot, and similar tools may show bot-like engagement, but they are discovery traffic and should be reported separately.

## Row-Level Data Needed For Exact Cleanup

To move from modeled page-level cleanup to measured page-level cleanup, request a row-level session export with:

- Page path
- Landing page
- Session source/medium
- City
- Device
- User or session ID
- Engaged-session flag
- Event count
- Engagement time

With that export, each visit can be classified as true bot, AI/AEO discovery, or human, and page-level bounce can be recalculated after excluding confirmed bot sessions.

## Communication Guidance

Use measured numbers when the raw tabs directly support them. Use modeled language when a claim depends on linking dimensions that are only available in separate aggregate tabs.

Recommended phrasing:

- “Confirmed bot removal changes city-classified bounce to X%.”
- “Confirmed + likely bot removal changes city-classified bounce to Y%.”
- “Homepage cleanup is modeled from aggregate data unless row-level page + source + city data is provided.”
- “AI/AEO tools are reported separately from spam bots.”

Avoid phrasing modeled page-level numbers as exact measured truth.

## Files To Review When Updating Logic

- `src/lib/parser.js`
- `src/lib/analyzer.js`
- `src/lib/levers.js`
- `src/pages/BounceRate.jsx`
- `src/pages/BotTraffic.jsx`
- `src/pages/About.jsx`
- `SKILL.md`
- `README.md`
