---
name: pillar-email-editor
description: Block-based email template editor (Mailchimp-style) in the Email module
metadata:
  node_type: memory
  type: project
---

Pillar has a **block-based email template editor** — the foundation for designed (HTML) emails. Reached from the **Email Editor** button below the Accounts list on the Email page (`EmailPage.jsx`); opens `src/pages/email/EmailEditor.jsx` (full-screen overlay).

**Architecture (deliberate — the Mailchimp model, not fill-in-tokens):** shared block model in `src/lib/emailTemplates.js`. A template = ordered `blocks` + a `theme` ({accent, pageBg, cardBg, text}). Block types: heading, text, button, image, **columns** (2-col), divider, spacer. Blocks also carry per-block `bg` + `padY`; buttons carry `radius`/`fullWidth`; images carry `fullWidth`. **One renderer** (`renderBlockContent` per block; `renderEmailHtml` full doc; `renderEmailText` plain-text fallback) outputs **email-safe HTML** (600px table layout, inline CSS). The editor canvas injects `renderBlockContent` per block so WYSIWYG == sent output. Stored in Supabase `email_templates` (jsonb blocks/theme, shared RLS) — run `supabase/email-templates-schema.sql`.

Editor UI (`EmailEditor.jsx`): 3 columns — left rail (add-block palette + theme colors), center canvas (click block → select; move up/down, **duplicate**, delete), right inspector (per-block fields incl. Block-style bg/padding, toggle switches). Top bar: name, Open menu (list/new/delete), Save. **Reusable:** accepts `initial={id?,name,blocks,theme}` + `onApply(blocks,theme)` → shows a "Use in email" button (used by the composer).

**Composer integration (DONE):** `Composer.jsx` has a template row **below the subject** — "Blank" + each saved template. Clicking applies a deep-copied design → replaces the plain textarea with a live `<iframe srcDoc>` preview + "Edit design" (opens `EmailEditor` with `initial`/`onApply` to edit the working copy) + "Remove". Send: if a design is applied → `htmlBody = renderEmailHtml`, `body = renderEmailText` fallback; else plain text.

**HTML send (DONE):** `mail.rs email_send` now takes `html_body: String`; builds `multipart/alternative` (plain+html), and nests it in `multipart/mixed` when attachments are also present. `sendMessage` passes `htmlBody`. Verified `cargo check`. **Desktop-only** (needs Tauri rebuild).

**Still not built:** image upload/hosting (inspector takes a public URL only — Supabase Storage bucket would add uploads); more block types (logo header, social row).

See [[pillar-email-module]] (SMTP bridge) and [[pillar-email-recap]] (attachments + multipart precedent).
