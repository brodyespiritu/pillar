---
name: pillar-email-module
description: "How Pillar's Email module connects Gmail/Yahoo and sends/receives — Tauri Rust IMAP/SMTP bridge"
metadata: 
  node_type: memory
  type: project
  originSessionId: fdeb5a91-334c-43dd-a52f-6a18d2214770
---

Pillar's **Email module** (`src/pages/email/`, route `/email`) is a 3-pane mail client (folder sidebar → message list → reading pane) styled per [[calendly-ui-ux-system]], modeled on a Cyprode/Superhuman-style reference.

**How real mail works (non-obvious):**
- Accounts connect via **app-password IMAP/SMTP**, NOT OAuth — works for both Gmail and Yahoo, no hosted backend, credentials stay local. Provider presets (hosts/ports/help links) live in `src/lib/email.js` `PROVIDERS`.
- Send/receive is implemented in **Rust/Tauri** at `src-tauri/src/mail.rs` — commands `email_test`, `email_fetch`, `email_send` (crates: `imap`, `native-tls`, `mailparse`, `lettre`, `base64`). Registered in `src-tauri/src/lib.rs`. Compiles clean. `email_send` now takes an `attachments: Vec<EmailAttachment>{filename,mime,content(base64)}` param and builds `MultiPart::mixed()` (plain-text body + attachments) when non-empty — used by the Greeter Recap ([[pillar-email-recap]]) to attach the PDF. Body is still plain text (no HTML).
- The frontend only calls these via `invoke` when `isDesktop()` (checks `window.__TAURI_INTERNALS__`). **In the vite browser preview there is no Tauri, so it falls back to `sampleMessages()`** — that's why the browser shows sample mail with a banner. To exercise real send/receive you must run `npm run tauri dev` and connect a real account with an app password (the user enters it themselves; never auto-fill credentials).
- Account rows stored in Supabase `email_accounts` (RLS: owner-only). `app_password` is plaintext for v1 — flagged in `supabase/email-schema.sql` to move to OS keychain / pgsodium later.

**Scaffolded / not yet built:** archive/delete/move actions, inbound attachment viewing (outbound send-attachments now work), threading, search across server (currently client-side over fetched list), drafts persistence, per-folder provider mailbox edge cases beyond the Gmail/Yahoo mapping in `map_folder()`.

Requires running `supabase/email-schema.sql`. Same connect/verify pattern (test creds before saving) is reusable for future integrations (SMS, calendars).
