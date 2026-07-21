---
name: todo-sms-scheduling-setup
description: "OPEN TODO before publishing: finish SMS scheduling + two-way conversations setup (as of 2026-07-19)"
metadata:
  node_type: memory
  type: project
---

**Must be completed BEFORE publishing Pillar.** Open SMS setup steps (state as of 2026-07-19 — delete this note once all done). See [[pillar-sms-module]] for architecture.

Done already: edge functions `send-prospect-sms`, `send-scheduled-sms`, and `telnyx-inbound` all deployed/ACTIVE on project `dxiqhequrfdodeyqzowz` (`telnyx-inbound` deployed with `--no-verify-jwt`; CLI works via `npx supabase …`, user is logged in). SQL files printed but not confirmed run.

**Remaining (user must do — involve secrets / dashboard):**

1. **Telnyx secrets** — `secrets list` showed only built-in `SUPABASE_*`, so NO Telnyx creds set; ALL sends fail with "Telnyx not configured" until:
   `npx supabase secrets set TELNYX_API_KEY=<key> TELNYX_FROM_NUMBER=+1XXXXXXXXXX --project-ref dxiqhequrfdodeyqzowz`
2. **Run SQL migrations** in the SQL editor (confirm each): `sms-schema.sql`, `broadcast-schema.sql`, `sms-library-schema.sql`, `sms-inbound-schema.sql` (the last adds `direction`/`from_number`/`read_at` to sms_messages — conversations popup shows a "run sms-inbound-schema.sql" note until then), and `email-recap-schema.sql` (Greeter Ministry Recap saved greeters + send log — "Manage Saved Emails" shows a run-the-SQL note until then).
3. **pg_cron job** — enable pg_cron + pg_net, run the `cron.schedule('send-scheduled-sms','* * * * *', … net.http_post …)` block (commented at bottom of `sms-library-schema.sql`) with anon key from `.env`. Without it, scheduled texts stay `pending` forever.
4. **Telnyx inbound webhook** — set Messaging Profile → Inbound Webhook URL to `https://dxiqhequrfdodeyqzowz.supabase.co/functions/v1/telnyx-inbound` (Webhook API v2 / JSON). Without it, replies never arrive so no conversation threads appear.

**Hardening TODO (not blocking, but do before real use):** `telnyx-inbound` has NO Telnyx Ed25519 signature verification — anyone with the URL could POST fake inbound messages. Add signature check.

**Verify:** (a) schedule a text 2 min out → Library flips Scheduled→Sent (`select * from cron.job_run_details order by start_time desc limit 5;`); (b) text the Telnyx number from a phone → thread appears in Guests → View Conversations.
