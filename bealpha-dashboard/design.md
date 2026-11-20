<!-- Hallmark · pre-emit critique: P5 H5 E4 S5 R5 V4 -->
# Design — BeAlpha Workbench

Locked visual system for BeAlpha's music operations dashboard. Four business levels maximum: BeAlpha operations, distributor, managed label, client account. Super Admin remains separate.
Pages inherit this system; business logic and permission boundaries remain unchanged.

## Genre

Modern-minimal operational workbench.

## Macrostructure family

- App pages: Workbench — compact rail, contextual command bar, task-first canvas.
- Auth pages: Focused gateway — one primary action and restrained brand proof.
- Content pages: Long document — narrow reading measure and persistent local context.

## Theme

- Paper: neutral near-black / cool white.
- Ink: high-contrast neutral; secondary copy remains WCAG-readable.
- Accent: cobalt, reserved for navigation state, focus, and primary actions.
- Status: green success, amber attention, red failure, blue information.
- No gradients, decorative glass, ambient glows, or platform-colour decoration.

## Typography

- Display and body: Manrope, weights 400–700.
- Data and identifiers: system monospace, weight 500.
- Titles use sentence case, tight tracking, and compact line height.
- Labels describe operator questions; avoid decorative uppercase eyebrows.

## Spacing and shape

- 4px base scale; use semantic variables from `tokens.css`.
- Dense controls, comfortable reading areas, 10px default control radius.
- Panels use rules and tonal separation before shadows.
- Pills reserved for statuses, filters, and compact metadata.

## Motion

- `--ease-out`, `--ease-in`, `--ease-in-out`; transform and opacity only.
- Hover/focus feedback: 120–180ms. Panel transition: 220ms.
- Reduced motion: no spatial movement; opacity ≤150ms.

## Interaction stance

- Silent success when state is visible; toast only for async/background results.
- Visible 2px focus ring with 3:1 contrast.
- Destructive actions remain explicit and never rely on colour alone.
- Minimum touch target: 40px on narrow viewports.

## Role-first home

- SUPER_ADMIN: network health, dispatch, approvals, finance ingestion.
- SYSTEM_ADMIN: BeAlpha operations, submissions from distributors, review and support.
- ORGANIZATION: distributor (level 2) or managed label business (level 3), release readiness, metadata QC, team and catalog.
- SUB_ACCOUNT: single-person client account, release drafts, assigned labels/artists, submissions, own analytics and statements.

## Shared app contract

- Sidebar exposes only capability-authorized destinations.
- Command bar keeps global search, quick actions, theme, notifications.
- Home prioritizes actionable release work; never invent counters or duplicate catalog tables.
- Dense data pages may vary layout but not tokens, type, control voice, or status semantics.

## Route inventory

- `/`: authenticated workbench and panel host.
- `/artists`, `/labels`: deep-linked roster and label views.
- `/settings`: profile, security, tenant, and preference settings.
- `/login`, `/invite/[token]`: authentication and invitation gateways.
- `/forbidden`, `/banned`: access-state pages.

## Exports

- CSS tokens: `tokens.css`.
- Tailwind consumes the same semantic variables through `app/globals.css`.

### Tailwind v4

```css
@theme inline {
  --color-workbench: var(--color-paper);
  --color-workbench-surface: var(--color-paper-2);
  --color-workbench-elevated: var(--color-paper-3);
  --color-workbench-ink: var(--color-ink);
  --color-workbench-muted: var(--color-ink-2);
  --color-workbench-rule: var(--color-rule);
  --color-workbench-accent: var(--color-accent);
  --color-workbench-focus: var(--color-focus);
  --font-workbench-display: var(--font-display);
  --font-workbench-body: var(--font-body);
  --font-workbench-data: var(--font-outlier);
  --spacing-3xs: var(--space-3xs);
  --spacing-2xs: var(--space-2xs);
  --spacing-xs: var(--space-xs);
  --spacing-sm: var(--space-sm);
  --spacing-md: var(--space-md);
  --spacing-lg: var(--space-lg);
  --spacing-xl: var(--space-xl);
  --radius-card: var(--radius-card);
  --radius-input: var(--radius-input);
  --ease-out: var(--ease-out);
  --ease-in: var(--ease-in);
  --ease-in-out: var(--ease-in-out);
}
```

### DTCG

```json
{
  "$schema": "https://design-tokens.github.io/community-group/format/",
  "color": {
    "paper": { "$value": "oklch(0.145 0.006 255)", "$type": "color" },
    "paper-2": { "$value": "oklch(0.185 0.008 255)", "$type": "color" },
    "ink": { "$value": "oklch(0.965 0.004 255)", "$type": "color" },
    "accent": { "$value": "oklch(0.64 0.19 255)", "$type": "color" },
    "focus": { "$value": "oklch(0.72 0.16 250)", "$type": "color" }
  },
  "font": {
    "display": { "$value": "Manrope, Avenir Next, Segoe UI Variable, sans-serif", "$type": "fontFamily" },
    "body": { "$value": "Manrope, Avenir Next, Segoe UI Variable, sans-serif", "$type": "fontFamily" },
    "outlier": { "$value": "SFMono-Regular, Consolas, Liberation Mono, monospace", "$type": "fontFamily" }
  },
  "space": {
    "3xs": { "$value": "0.25rem", "$type": "dimension" },
    "2xs": { "$value": "0.5rem", "$type": "dimension" },
    "xs": { "$value": "0.75rem", "$type": "dimension" },
    "sm": { "$value": "1rem", "$type": "dimension" },
    "md": { "$value": "1.5rem", "$type": "dimension" },
    "lg": { "$value": "2rem", "$type": "dimension" }
  }
}
```

### shadcn/ui bridge

```css
:root {
  --background: var(--color-paper);
  --foreground: var(--color-ink);
  --card: var(--color-paper-2);
  --card-foreground: var(--color-ink);
  --primary: var(--color-accent);
  --primary-foreground: var(--color-accent-ink);
  --muted: var(--color-paper-3);
  --muted-foreground: var(--color-ink-2);
  --border: var(--color-rule);
  --ring: var(--color-focus);
  --radius: var(--radius-input);
}
```
