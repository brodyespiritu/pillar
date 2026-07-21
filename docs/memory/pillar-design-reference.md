---
name: pillar-design-reference
description: Visual design language for the Pillar desktop app (Tauri + React) — Calendly-inspired
metadata: 
  node_type: memory
  type: project
  originSessionId: fdeb5a91-334c-43dd-a52f-6a18d2214770
---

Pillar's UI follows a **Calendly-inspired design system**. Use this as the reference for all new screens.

**Design tokens** (defined in `src/styles/global.css`):
- Font: Inter (400–800). Headings heavy (700–800), tight letter-spacing (-0.3 to -0.6px).
- Colors: navy text `#0B3558` (--text), muted `#476788` (--text-2), accent blue `#006BFF` (--accent), border `#E7EDF6`, bg `#F8FAFD`, surface white.
- Radius: 8px small, 16px cards, 24px large. Buttons/inputs 8px.
- Shadow: soft `rgba(71,103,136,0.06) 0 15px 30px`.

**Reference layout — Calendly careers page ("Open roles")**, the pattern the user wants replicated across the app:
- Centered hero: small pill badge (light blue bg `#EFF5FF`, blue text, rounded-full) → huge bold navy title (~56–64px) → gray subtitle, all center-aligned.
- Search row: search input (with magnifier icon) + a dropdown filter side by side, centered, max-width ~640px.
- Horizontal tab nav: text tabs with the active one in accent blue + a blue underline; full-width hairline border under the row.
- Card grid: 3 columns, white cards with light border, ~12–16px radius, subtle hover. Each card: bold navy title, gray meta line, blue "Apply →" style action with arrow.

**Icon boxes** (menu + tiles): 56px, bg `#F4F8FF`, 8px radius, `box-shadow: inset 0 0 8px rgba(184,220,255,0.75)` for the soft inner glow. Homepage tiles tint this per-app color.

**Mega-menu** (`src/components/TopNav.jsx`): hovering a left item swaps the right column to that item's contextual actions and stays put when the cursor moves right; page dims with a `rgba(11,53,88,0.18)` backdrop.

See [[pillar-cares-module]] for how this was applied to the Cares page.
