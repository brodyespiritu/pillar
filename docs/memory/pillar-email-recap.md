---
name: pillar-email-recap
description: Guests "Send Email" → Greeter Ministry Recap template (Pillar-native adaptation)
metadata:
  node_type: memory
  type: project
---

Guests page **Send Email** button → `EmailTemplatePicker` (template list + "Manage Saved Emails") → `GreeterRecapModal` (Template A). Files in `src/pages/guests/` + logic in `src/lib/recap.js`; schema `supabase/email-recap-schema.sql` (`email_config` shared saved greeters, `recap_sends` log).

**Stack adaptation** (spec was written for a Zite/Sequelize/Resend/Gmail app; mapped to Pillar):
- EmailConfig/RecapEmailSends tables → Supabase `email_config` / `recap_sends`.
- `generateRecapPdf` + ZitePdf HTML-to-PDF → TWO renderers in `recap.js`: `buildRecapHtml()`+`openRecapPdf()` (browser print, used for the on-screen **Preview PDF** button) AND `buildRecapPdf()` which generates a **real PDF file with jsPDF** (programmatic, single-column cards + pagination) returning `{filename, mime, content(base64)}`.
- Resend/Gmail fallback → the connected account via the **Tauri SMTP bridge** (`sendMessage` in [email.js](../../src/lib/email.js)). The recap PDF is now **automatically attached** to the sent email (no manual download). This required extending the mail bridge: `mail.rs` `email_send` gained an `attachments: Vec<EmailAttachment>{filename,mime,content(b64)}` param and builds a `MultiPart::mixed()` (plain-text body + `Attachment`), using the `base64` crate; `sendMessage` passes `attachments` through (defaults `[]`, so Composer/RemindersTab unaffected). Body is still plain text. **Sending + attachment is desktop-only** (needs a Tauri rebuild after these Rust changes); browser shows a "connect an account" warning but Preview PDF still works. Verified: `cargo check` passes, jsPDF added to package.json.

**Recap grouping** (this week = Sun–Sat, `weekRange`): salvations/baptisms/new members by `type` + `last_visit` this week; prospects by `isProspect` + created/visited this week; first-timers = visited this week & first_visit this week (green cards); returning = visited, not first-timer/own-section; absence badges from guest `absence_type` ('Long'→red, 'Brief'→orange); Pathway-to-Belonging from `greeter_comments` this week.

**NOT built (spec's other pieces, deferred):** the block-based visual email template builder / `EmailTemplates` guest_recap rendering; the RecapPreviewModal (drag-reorder, per-section/per-person toggles, live preview, History); the Saturday-8pm `archiveWeeklyRecap` cron (which also DELETES the week's salvation/baptism/new-member rows + all greeter comments — destructive, needs explicit sign-off before building); "Viewed Recap" open-tracking (`recap_sends` is the logging foundation for it).

Setup: run `email-recap-schema.sql`. See [[pillar-sms-module]] for the email/SMTP context and [[todo-sms-scheduling-setup]] for the pre-publish migration list.
