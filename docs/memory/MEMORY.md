# Memory Index

- [Skip browser verification](skip-browser-verification.md) — don't drive the browser to verify every Pillar build; just build and tell the user what to check.

- [Calendly UI/UX system](calendly-ui-ux-system.md) — authoritative design/interaction reference (exact colors, type, buttons, layout, UX principles) for all Pillar UI decisions.
- [Pillar design reference](pillar-design-reference.md) — how the Calendly language maps to Pillar's tokens/components; replicate the "Open roles" careers-page pattern.
- [Pillar email module](pillar-email-module.md) — email connects Gmail/Yahoo via app-password IMAP/SMTP in a Tauri Rust bridge; live only in the desktop build, sample data in browser.
- [TODO before publishing: SMS setup](todo-sms-scheduling-setup.md) — OPEN, must finish before publishing: Telnyx secrets, run 4 SQL migrations, pg_cron job for scheduled texts, Telnyx inbound webhook for two-way conversations (+ signature-verification hardening).
- [Pillar SMS module](pillar-sms-module.md) — Telnyx broadcast + schedule + Library + two-way conversations.
- [Pillar admin: add-user + control](pillar-admin-users-control.md) — Admin "Add user" 5-step wizard (edge fn creates auth+staff, permissions model) and user-row "Control" live co-session (Supabase Realtime cursor/nav mirroring with consent).
- [Pillar settings page](pillar-settings-page.md) — system-wide /settings (general, notifications matrix, email groups, security, integrations); ALL gear/settings buttons route here via `navigate('/settings', {state:{section}})`.
- [Pillar email editor](pillar-email-editor.md) — Mailchimp-style block template editor (Email page → "Email Editor"); shared block model + email-safe HTML renderer in lib/emailTemplates.js. Next: composer template-picker + HTML send in mail.rs.
- [Pillar email recap](pillar-email-recap.md) — Guests "Send Email" → Greeter Ministry Recap template: chip recipients (+Staff/+Greeters), live weekly stats, print-to-PDF recap, SMTP send + log.
- [Pillar attendance](pillar-attendance-heatmap.md) — dashboard attendance card → full-screen fan-shaped worship-center map + trends with area filters; Claude-vision-from-livestream-screenshot pipeline (edge function + attendance schema) estimates per-zone headcount.
