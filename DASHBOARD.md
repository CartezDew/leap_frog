---
name: dashboard-style-test
description: A polished dark-mode house style for HTML dashboards, briefings, reports, and visual pages. Ships with a warm dark default palette (dark brown background, cream cards, orange accent, serif headings) that you can override by telling Claude your brand colors, fonts, or preferences. Use whenever generating HTML — dashboards, briefings, reports, wrapups, analytics pages, visual explainers, audit panels, pipeline views, resource landing pages. Trigger words include "dashboard", "briefing", "report", "html page", "visual page", "end of day", "wrapup", "morning briefing", "stats", "analytics".
---

# Dashboard Style

A house design system for HTML pages. Ships with a default warm dark palette and serif/sans type pairing — swap any of it for your own brand by telling Claude (e.g. "use my brand colors: #XYZ and #ABC" or "swap the serif headings for Inter bold").

## When to use

**Default for HTML output.** Morning briefings, wrapups, pipeline views, research dashboards, stats pages, analytics reports, audit panels, visual explainers, resource landing pages — all of them. The exceptions:
- Slideshows → use a slideshow skill instead (they have their own theme)
- PowerPoint `.pptx` → use the pptx skill
- Single static infographic images → use an image-generation skill

## Customizing for your brand

This skill has sensible defaults, but you can override any of it:
- **Colors:** "Use my brand colors — navy #0a2540 and lime #c6f432" → skill uses those instead of the defaults
- **Fonts:** "Use Inter for everything" or "Use Playfair Display for headings"
- **Mode:** "Make it light mode" — skill flips the background/surface relationship
- **Motion:** "No animations" — skill strips the orb drift and pulses

If you don't specify, it ships with the defaults below.

## Default design tokens

### Colors (warm dark default)
```
--bg: #1a1714             /* dark page background */
--bg-2: #211e1a           /* slightly lifted dark surface */
--surface: #faf5ef        /* cream card background */
--surface-hover: #f5ede4  /* cream card on hover */
--surface-dark: #2a2520   /* dark inputs, inset panels */
--border: #e8ddd0         /* light border on cream cards */
--border-dark: #3a332c    /* subtle divider on dark bg */
--text-dark: #1a1714      /* body text on cream cards */
--text-light: #f5ede4     /* body text on dark bg */
--text-secondary-light: #a89a8c
--text-muted-light: #6b5f53
--text-secondary-dark: #5c4f42
--accent: #D97757         /* default warm orange accent */
--accent-light: #e8956e
--accent-dark: #c4613f
--accent-glow: rgba(217, 119, 87, 0.15)
--accent-cream: #f7efe7
--warm-gold: #c4a265
```

### Typography (default)
- **Headings:** `'Instrument Serif', Georgia, serif` — 400 weight, tight tracking, one word per heading italicized in the accent color (e.g. "Your *morning* briefing").
- **Body:** `'Inter', -apple-system, sans-serif` — weights 400/500/600/700
- **Monospace:** `'SF Mono', 'Fira Code', monospace` — slash commands, code
- **Hero h1 sizing:** `clamp(38px, 5.5vw, 72px)`

### Google Fonts import
```html
<link href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
```

## Signature visual elements (default flavor — optional)

1. **Starburst SVG mark** — a decorative sun/spark icon for the header. Spins slowly (20s). Swap for your own logo SVG if you have one.
2. **Ambient orbs** — three blurred colored orbs drifting behind the content: `filter: blur(150px); opacity: 0.06; animation: drift 25s`. Skip if you want a flat page.
3. **Badge with pulsing dot** — small accent-colored pill at the top with a pulsing dot. Used for timestamps or live status.
4. **Italic accent in every heading** — one word italicized in the accent color per heading.

## Standard page skeleton (recommended order)

1. **Ambient orbs** (fixed, behind everything) — optional
2. **Header** — logo/mark + wordmark + badge + serif h1 + subtitle + stats bar + divider
3. **Main content** — the dashboard body (sections, cards, metrics)
4. **Footer** — small centered credit line

## Default patterns

1. Dark page background with cream cards laid on top. (Flip for light mode if requested.)
2. Accent color is for highlights only — italicized heading words, stat numbers, CTA pills, hover borders, icons. Never flood with accent.
3. One serif for headings, one sans for body — pair them cleanly.
4. Rounded corners: cards = 14px, modal = 20px, inputs = 12px, pills = 100px.
5. Subtle animations: `fade-in` on sections, `drift` on orbs, `spin-slow` on the logo, `pulse-dot` on badges.

## What to include by dashboard type

- **Morning briefing:** Badge (`Today&#39;s briefing`), hero ("Your *morning* briefing"), stats bar (emails/calendar/priorities), category sections for each block.
- **Pipeline dashboard:** Badge (`Pipeline`), hero ("*Content* pipeline"), stats bar (posted/ready/filmed/ideas), card grid grouped by status.
- **Wrapup / end-of-day:** Badge (`End of day`), hero ("Today&#39;s *wrapup*"), stats bar (wins/filmed/posted/shipped), category sections.
- **Research / analytics:** Badge (`Research`), hero with topic italicized, stats bar of key metrics, findings as cards.
- **Audit / weekly review:** Big score ring and priority-tagged recs. Use the audit panel pattern in `references/components.md`.

## Files in this skill

- `SKILL.md` — this file
- `template.html` — the starter template. Copy this as your base for every new dashboard.
- `references/components.md` — copy-paste HTML for common components (stat bar, card, category section, modal, audit panel).

## Guardrails

- No Tailwind, Bootstrap, or CSS frameworks — this is vanilla custom CSS so it's easy to inspect and edit.
- Use lucide-style line SVGs for section icons (cleaner than emoji for dashboards).
- If a user specifies their own brand, honor their palette/fonts over the defaults.
