-- ============================================================
--  PILLAR · SMS TWO-WAY CONVERSATIONS
--  Adds inbound replies to the existing sms_messages table so the
--  Guests → Conversations popup can show back-and-forth threads.
--  Run in Supabase → SQL Editor  (needs sms-schema.sql).
-- ============================================================

alter table sms_messages add column if not exists direction   text default 'out'; -- 'out' (we sent) | 'in' (they replied)
alter table sms_messages add column if not exists from_number text;                 -- sender number on inbound
alter table sms_messages add column if not exists read_at     timestamptz;          -- when staff read an inbound reply

create index if not exists idx_sms_thread on sms_messages(to_number, created_at);

-- ============================================================
--  Receiving replies:
--  1) Deploy the webhook:   supabase functions deploy telnyx-inbound
--  2) In the Telnyx Portal → Messaging → your Messaging Profile →
--     Inbound Settings → Webhook URL, set:
--       https://<PROJECT_REF>.supabase.co/functions/v1/telnyx-inbound
--     (Format: Webhook API v2 / JSON.)
--  The function needs no JWT — it's called by Telnyx, not the app.
--  Deploy it with:  supabase functions deploy telnyx-inbound --no-verify-jwt
-- ============================================================
