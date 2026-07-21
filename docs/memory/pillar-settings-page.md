---
name: pillar-settings-page
description: System-wide Settings page at /settings — the single destination for all gear/settings buttons
metadata:
  node_type: memory
  type: project
---

Pillar has ONE system-wide **Settings modal** — a slide-up card with an X (NOT a full page / NOT a route). `src/pages/settings/SettingsModal.jsx` + `Settings.css` (`.setm-overlay`/`.setm-card` shell, left section nav + main content). Opened globally via **`SettingsContext`** (`src/context/SettingsContext.jsx`): `SettingsProvider` wraps the routes in `App.jsx` and renders the modal; **every gear/settings button calls `useSettings().openSettings('<section>')`** to slide it up on the current section. The Email sidebar gear opens `'groups'`. (There is no `/settings` route; the old full-page `SettingsPage` and the `EmailSettings` modal were both deleted.)

Sections: **general** (org name, timezone, week-start — persisted to localStorage via `useLocalState`), **notifications** (Email/Desktop toggle matrix grouped by Care/Guests/Communications/Calendar; prefs in localStorage; "Enable" calls `Notification.requestPermission()`; toggles are UI-wired but not yet hooked to real notification delivery), **groups** (email recipient groups — functional, reuses `src/lib/emailGroups.js` + `email_config` table; same lists used by the composer "Group" picker and Greeter Recap), **security** (change own PIN → updates `staff.pin_hash`; sign out), **integrations** (informational cards: SMTP, Telnyx, Attendance AI, Supabase).

Uses system accent blue for toggles (not the reference's purple). To add a section: add to `SECTIONS` + a component. Notification prefs and General are localStorage-only for now (no server persistence yet).
