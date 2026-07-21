---
name: calendly-ui-ux-system
description: Detailed Calendly.com UI/UX design system (computed styles) — the reference for all Pillar visual + interaction decisions
metadata: 
  node_type: memory
  type: reference
  originSessionId: fdeb5a91-334c-43dd-a52f-6a18d2214770
---

Studied from live calendly.com computed styles (Jul 2026). This is the **authoritative UI/UX reference for Pillar** — consult it before designing any new screen or component. Pairs with [[pillar-design-reference]] (which maps these to Pillar's tokens) and [[pillar-cares-module]].

## Color (exact values)
- **Navy ink** `#0B3558` (rgb 11,53,88) — all headings & primary text on light.
- **Muted slate** `#476788` (rgb 71,103,136) — body/secondary text, subtitles.
- **Accent blue** `#006BFF` (rgb 0,107,255) — primary buttons, links, active states. Only ONE accent; don't introduce competing brand hues.
- **Page bg white** `#FFFFFF`; **alt section bg** `#F8F9FB` (rgb 248,249,251) — sections alternate white / near-white for rhythm.
- **Tint panel** `#F4F8FF` (rgb 244,248,255) — soft blue fill behind icons/feature callouts.
- **Border** `#D4E0ED` (rgb 212,224,237) — hairline card/divider border.
- **Dark section** `#0B3558` (navy used as full-bleed dark band).
- Shadows are used sparingly — many cards are **border-only, no shadow**.

## Typography
- Face: **Gilroy** (rounded geometric). Pillar substitutes **Inter** (closest CSP-loadable match).
- **H1 hero ~68px / weight 700 / line-height 1.2 / navy**, letter-spacing normal. Big and confident.
- Section **H2 ~40–44px / 700 / navy** (site scales down; smaller supporting H2s exist at 18/400).
- **Body/subtitle ~20px / #476788 / line-height 1.4** under heroes; standard body 16px.
- Buttons/nav/labels: **14px / weight 600**.
- Headings are sentence-case statements of value ("Securely powering millions of connections", "Security at scale") — declarative, benefit-led, never feature-jargon.

## Buttons
- **Primary**: bg `#006BFF`, white text, **radius 8px**, padding **10px 16px**, weight 600, 14px, 1px border same as bg. Hover darkens.
- **Secondary/tertiary**: transparent, navy text, no border (plain text link) OR thin-outlined variant. Understated next to the primary.
- One primary per view; secondary sits beside it ("Get a demo" next to "Sign up for free").

## Shape & spacing
- **Radii: 8px** controls (buttons/inputs), **24px** large cards/containers. (Pillar: 8 / 16 / 24.)
- Content is **centered in a max-width column**; heroes are centered text with the CTA pair centered under the subtitle.
- Sections stack full-width with alternating bg; generous vertical whitespace; a section = eyebrow/label → big H2 → supporting copy → cards/visual.
- Cards: 24px radius, 1px `#D4E0ED` border, often **no shadow**, white or transparent bg.

## Layout & IA patterns
- **Top nav**: white, ~59–64px, hairline bottom border, logo left, 14px/600 dropdown menu items, right side = text "Log In" + filled blue CTA. Mega-menu dropdowns are two-column (Product / Platform) with icon + title + one-line description rows.
- **Hero-first pages**: pill/eyebrow → oversized headline → 2-line subtitle → CTA pair, all centered.
- **Feature sections**: recurring rhythm of headline + copy + supporting card grid or product screenshot; consistent icon-in-tinted-square treatment.
- Icon treatment: rounded square, **`#F4F8FF` fill**, blue glyph, subtle **inset glow** (`inset 0 0 8px rgba(184,220,255,.75)`).

## UX principles to carry into Pillar
1. **Calm, trustworthy, spacious** — lots of whitespace, restrained palette, one accent. Never busy.
2. **Benefit-led copy** — name what the user gets, sentence case, active voice; labels say exactly what happens.
3. **Clear hierarchy** — one dominant headline per section, muted supporting text, a single obvious primary action.
4. **Consistency over novelty** — same radii, same border color, same icon treatment, same button system everywhere. Repetition = polish.
5. **Progressive disclosure** — mega-menus, multi-step flows, and "learn more" reveal detail on demand instead of crowding the first view.
6. **Border-first, shadow-sparingly** — prefer 1px `#D4E0ED` borders; reserve shadows for hover lift / overlays.
7. **Accessible contrast** — navy on white, blue accent that passes on white; keep it in dark mode too.

When building new Pillar screens: reach for this palette, this type scale, 8/24px radii, the centered-hero + alternating-section rhythm for marketing/overview pages, and the tool-dense layout (rail + main + sidebar) for operational apps — but keep the same tokens, icon treatment, and single-accent discipline throughout.
