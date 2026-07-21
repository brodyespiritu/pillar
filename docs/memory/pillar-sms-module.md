---
name: pillar-sms-module
description: SMS module — Telnyx broadcast, scheduled sends via cron-driven edge function, message Library
metadata:
  node_type: memory
  type: project
---

Pillar's **SMS module** (`src/pages/sms/`, route `/sms`, tabs centered): Broadcast · Library · Contacts · Groups.

**How sending works:** frontend → `send-prospect-sms` edge function → Telnyx (one thread per person, no group texts); logs to `sms_messages`. Contacts/groups are **owner-scoped** RLS; message log + library + scheduled are shared (`authenticated`).

**Scheduling (non-obvious):** "Schedule for later" (left of Send) snapshots recipients into `sms_scheduled` (jsonb) with a `send_at`. Actual delivery is done by the **`send-scheduled-sms` edge function, which must be invoked by cron every minute** — pg_cron + pg_net `net.http_post` block is commented at the bottom of `supabase/sms-library-schema.sql` (needs project ref + anon key filled in). Without the cron job, scheduled texts sit at `pending` forever. The function claims rows by flipping `pending→processing` (prevents double-send on overlapping runs), texts via Telnyx, logs to `sms_messages`, marks `sent/failed`, and upserts the message into the library.

**Library:** `sms_library` — every successful broadcast is auto-recorded (`recordSend()` in `src/lib/broadcast.js`, deduped by identical body → updates `last_sent_at`); the schedule modal also offers "Save to Library" + optional name. "Use" on a library row remounts the Broadcast compose (`key`-bump draft in `SmsPage`) with the body prefilled.

**Two-way conversations (Guests → "View Conversations"):** `ConversationsModal.jsx` is an iMessage-style popup (left thread list + right bubbles + compose), threaded by the other party's phone (`normPhone` last-10) via `src/lib/conversations.js`. Outbound rows already exist in `sms_messages`; **inbound replies** arrive via the public `telnyx-inbound` edge function (deployed `--no-verify-jwt`), which inserts `direction='in', status='Received'`. Requires `sms-inbound-schema.sql` (adds `direction`/`from_number`/`read_at` to sms_messages) AND the Telnyx Messaging Profile **Inbound Webhook URL** set to `https://<ref>.supabase.co/functions/v1/telnyx-inbound`. The list only shows threads with ≥1 inbound (spec: mass text sent AND receiver replied → appears). Modal polls every 12s for new replies. Telnyx signature verification is NOT implemented (v1 hardening TODO).

**Setup order:** `sms-schema.sql` → `broadcast-schema.sql` → `sms-library-schema.sql` → `sms-inbound-schema.sql`; deploy `send-prospect-sms`, `send-scheduled-sms`, `telnyx-inbound`; set Telnyx secrets; create the cron job; set the Telnyx inbound webhook URL.
