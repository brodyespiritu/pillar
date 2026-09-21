# Member sign-in for the Bethesda app

Members sign in to the app with a **one-time code** that the church emails to the address
**already on their `church_members` record**. There are no passwords.

Texting codes is built in too, but it's **switched off**. US carriers only deliver sign-in codes from
a number whose 10DLC campaign includes 2FA. The church's current Telnyx campaign is Low Volume Mixed
with no sub use cases, so it doesn't. See [Texting, later](#texting-later) for how to turn it on.

The church issues and checks the codes itself. Supabase Auth only keeps a dedicated login for each
record: a random address like `m-…@members.invalid`, with no real email, phone or password. It also
issues the session. This design came out of a source-level review of Supabase Auth v2.193.0, which
found that Supabase's own phone and email one-time codes are unsafe here:
- Its public endpoints reveal which contacts have logins.
- Codes can be guessed without an attempt limit.
- A session can move its login onto someone else's phone number.

| Piece | What it does |
| --- | --- |
| `member-app-auth.sql` | Staff-only data rules, member record columns and trigger, contact matching, eligibility, rate limits, codes, "which one is you?" tickets, login minting, session binding, and the member functions (`member_me`, `member_update_me`, `member_directory`, `member_directory_photo`, `member_directory_family`, `member_family`, `member_bind_session`). |
| `member-directory-everyone.sql` | The live-database update for the directory (2026-09-15): every eligible adult member is listed by default; members hide themselves from My Profile (`directory_hidden`), the office keeps anyone out with "Include on Directory"; contact details and photos only where shared and the member's login is intact; tapping someone shows their household and deacon's name (`member_directory_family`). Same definitions as `member-app-auth.sql`. |
| `functions/member-request-code` | Replies the same way whether or not the email is on file, then looks it up in the background and emails a code (Resend). It texts codes (Telnyx) only once texting is switched on. |
| `functions/member-verify-code` | Checks the code (5 tries), then signs the member in to their record's own login. If a family shares one email, it asks which person is signing in. |
| `functions/member-delete-account` | A member deletes their app sign-in (App Store rule). Their church record stays. |
| `functions/member-contact-request` | "Contact the church office" form. |
| `tests/` | `member-auth.test.mjs` (SQL), `member-functions.test.mjs` (functions + SQL end to end), `pillar-sql-rerun.test.mjs` (every other Pillar SQL file stays staff-only). |

The app side lives in the BethesdaApp repo: `context/AccountContext.js`, `screens/AuthModal.js`,
`screens/ProfileModal.js`, the directory in `screens/DirectoryScreen.js` (with `components/MemberProfileSheet.js`), and the directory switch on `screens/ProfileScreen.js`. The sign-in screen asks
the server which ways of signing in are on. It shows only email, unless texting has been switched on.

---

## 1. Decide, then check the data (read-only)

**Decisions** (the SQL has defaults you can change):
- **Who may sign in.** `app_member_is_eligible` allows active records. It excludes prospects,
  members marked inactive, anyone whose family position is Child, and anyone with a birthday showing
  under 18. Visitors and regular attenders are allowed. Change the function if that's wrong.
- **Members need an email on their record.** Anyone without one taps "Not on file, or have new
  contact details?" in the app, which sends the office a request.

**Data checks.** Run each one in Supabase → SQL Editor. They only read.

```sql
-- A. What the status and family fields contain
select 'status' field, coalesce(status,'(null)') value, count(*) from church_members group by 2
union all select 'record_type', coalesce(record_type,'(null)'), count(*) from church_members group by 2
union all select 'member_status', coalesce(member_status,'(null)'), count(*) from church_members group by 2
union all select 'family_position', coalesce(family_position,'(null)'), count(*) from church_members group by 2
union all select 'active', coalesce(active::text,'(null)'), count(*) from church_members group by 2
union all select 'include_directory', coalesce(include_directory::text,'(null)'), count(*) from church_members group by 2
order by 1, 3 desc;

-- B. Emails shared by several records (fill in Family Position for these before launch)
select lower(btrim(email)) email, count(*) records,
       count(distinct coalesce(nullif(btrim(family_id),''), id::text)) households,
       string_agg(name || coalesce(' ('||nullif(family_position,'')||')',''), ', ' order by name) who
  from church_members where nullif(btrim(email),'') is not null
 group by 1 having count(*) > 1 order by households desc, records desc;

-- C. Inline photos (directory photos load one at a time)
select count(*) filter (where photo_url like 'data:%') inline_photos,
       pg_size_pretty(coalesce(sum(length(photo_url)) filter (where photo_url like 'data:%'),0)) total
  from church_members;

-- D. People who could sign in but have no usable email yet   (run after step 3)
select count(*) filter (where public.app_member_is_eligible(m)) eligible,
       count(*) filter (where public.app_member_is_eligible(m) and public.app_norm_email(m.email) is null) no_email
  from church_members m;
```

**Before launch, have the office:**
- Fill in **Family Position** (Head, Spouse, Child) for the households in check B. When several
  records share one email, only known adults of a single household are offered, so an unmarked
  household can't sign in with that email.
- Add emails for members who want the app (check D shows how many have none).
- Blocklist any shared placeholder address typed onto many records, such as the office's own email.
  Write it in lowercase; anything else is refused:
  `insert into app_contact_blocklist (contact_norm, note) values ('<email in lowercase>', 'office inbox');`
  Blocklisting a contact also ends any app session that came through it.

## 2. Email: Resend

1. In Resend, confirm **bethesdaupdates.app** shows *Verified* (its DNS records already exist).
2. Create an API key with **Sending access** only, restricted to bethesdaupdates.app (a key limited to another domain is refused with 403). It is `RESEND_API_KEY` in step 4.
3. Check the plan. The free plan allows **100 emails a day** (3,000 a month) for the whole account,
   including anything else the church sends through Resend. For launch, either move to Pro ($20 a
   month, 50,000 emails, no daily limit), or keep `email_per_day` in `app_auth_settings` below what's
   left of the free allowance.

## 3. Supabase: Auth settings, then the SQL

**Authentication settings.** These keep Supabase's own sign-in routes closed to member logins:
- Sign In / Providers → **Allow new users to sign up: OFF**
- Email provider: **ON** (staff sign in to Pillar with it). **Confirm email: ON**. **Secure email change: ON**.
  **Email OTP Expiration: 600** or less.
- Phone provider: **OFF**, and leave it off. Remove any test phone numbers. Don't add a Send SMS hook.
- Emails → SMTP: leave on Supabase's built-in mailer. Member logins then can't receive Supabase's
  own emails. The member functions don't depend on this (codes go out through Resend), but it's an
  extra layer.
- Rate Limits → **token verifications**: raise to about 150 per 5 minutes. Members on church Wi-Fi
  share one IP address.
- Confirm anonymous sign-ins and manual identity linking are off (they are by default).

**SQL** (SQL Editor):
1. Run the **pre-flight SELECT** at the top of `member-app-auth.sql` by itself. Every login it lists
   loses access to Pillar's data, so make sure no real staff member is on it.
2. Run all of `member-app-auth.sql`. It is safe to run again. Sign-in starts with email on and texting off.
3. Run the **after-run checks** at the bottom of the file and review every row.

## 4. Secrets (run these yourself, in your own terminal, from the Pillar folder)

```bash
npx supabase secrets set MEMBER_AUTH_KEY="$(openssl rand -base64 32)"
```

Then, with the key from Resend (never paste it into a chat):

```bash
npx supabase secrets set RESEND_API_KEY=… MEMBER_CODE_FROM="Bethesda Baptist Church <signin@bethesdaupdates.app>"
```

Optional: `MEMBER_LOGIN_DOMAIN=…` replaces the default `members.invalid`. Use a domain that can never
receive mail.

Keep `MEMBER_AUTH_KEY` stable. Changing it cancels live codes and resets the rate-limit history.

## 5. Deploy the functions

```bash
npx supabase functions deploy member-request-code --no-verify-jwt
npx supabase functions deploy member-verify-code --no-verify-jwt
npx supabase functions deploy member-delete-account --no-verify-jwt
npx supabase functions deploy member-contact-request --no-verify-jwt
```

All four check their callers themselves. `member-delete-account` accepts only a member session that
came through the code flow.

## 6. Try it

Use a staff member's own church record:
1. Sign in with that record's **email**. The email should arrive within a minute (check spam), with no
   links and no code in its subject, and the app should say "Welcome, …".
2. On a household whose records share an email, check that "Which one is you?" appears.
3. In Pillar, change that record's email. The app should sign them out on its next check.
   Signing in with the new email works.
4. Delete the app account from the Profile screen. The church record stays.
5. Check `select event, channel, outcome, provider_code, created_at from member_auth_events order by id desc limit 20;`

---

## Day to day

- **"Contact the church office" requests** land in `member_access_requests` (Table Editor).
  **Confirm the person out of band before adding a contact** (call a number already on file, or talk
  in person). A contact on a record is a sign-in credential. Then set `handled_at`.
- **Sign someone out of the app everywhere:** `select app_member_revoke_login('<member id>');`
- **Keep someone out of the app:** `update church_members set app_access = 'deny' where id = '<member id>';`
  (or ban their app login in Authentication → Users; a ban is honoured, not repaired).
- **After running any other Pillar SQL file**, re-run `member-app-auth.sql` and its after-run checks 1 and 2.
  The other files are written staff-only too, but this keeps the sign-in rules current.
- **Changing a member's email in Pillar** signs out their app sessions (changing only its capital
  letters doesn't), and so does anything that changes who that email leads to: moving someone to
  another household, changing a Family Position, or making a record inactive.
- **Realm imports** add new people and refresh names and addresses, but never overwrite an email or phone
  the office already has, never reactivate someone marked inactive, and keep households made in Pillar.
- **Two devices at once:** if a member signs in on two devices within a few seconds, the second waits
  for the first to finish.
- **Pause sign-in:** `update app_auth_settings set signin_enabled = false;`
  Per channel: `email_enabled` / `sms_enabled`.
- **Launch day:** raise `email_per_hour` and `email_per_day` in `app_auth_settings` if you expect a
  rush, and make sure the Resend plan covers it (step 2).
- **Breaker:** if many wrong codes are tried within an hour, new codes stop for an hour
  (`breaker_open_until`). Clear it once you've looked at `member_auth_events`.
- **A member locked out by rate limits:** find their `contact_ref` in `member_auth_events`, then clear
  all their limits (`select app_rate_clear('<full key>')` needs the full HMAC, so use
  `delete from app_rate_events where key_hash like '<contact_ref>%';`).
- **Logins whose record was deleted:** `select * from app_orphan_member_logins();`. Delete them in
  Authentication → Users.

## When a code doesn't arrive

| `member_auth_events` shows | Meaning |
| --- | --- |
| `request_no_match` | Not an eligible record with that email (or blocklisted, a shared email without known adults, or a child). |
| `send_failed` · `resend_…` | Resend refused it (domain not verified, key, or the plan's daily/monthly quota). |
| `send_ok`, but nothing in the inbox | Check spam/junk; some church and work inboxes quarantine automated mail. |
| `send_capped` | The hourly or daily send limit in `app_auth_settings` was reached. |
| `request_rate_limited` | Too many requests for that email or network. |
| `verify_invalid` · `live` | Wrong code typed (5 tries per code). |
| `mint_busy` | Two sign-ins for one record at once, or a record changed mid-sign-in. Try again. |

## Texting, later

Signing in by text is built and tested, but off (`app_auth_settings.sms_enabled = false`). Once it's
on, the app offers "Mobile number" as a second tab, after Email.

1. **A Telnyx campaign that includes 2FA.** The church's current campaign is Low Volume Mixed with no
   sub use cases, so it doesn't qualify, and Telnyx doesn't let you change a registered campaign's
   use case. Either:
   - **(simplest)** buy a second number, register a campaign with use case **2FA** under the church's
     brand ($15 review, then $10 a month plus the number), and assign the number to it; or
   - register a new Low Volume Mixed campaign with 2FA among its sub use cases (plus the kinds of
     texts the church already sends, each with a sample), and move the current number onto it.

   Campaign wording:
   - Description: "Bethesda Baptist Church sends one-time sign-in codes to members who request them in
     the church's mobile app. Codes are sent only to the mobile number already on the member's church record."
   - Message flow: "In the Bethesda Baptist Church app, a member taps Sign In, enters the mobile number
     on their church record, and taps 'Text me a code.' The screen states 'Message and data rates may
     apply.' One code is sent per request."
   - Samples: `123456 is your Bethesda Baptist Church app sign-in code. It expires in 5 minutes. Never
     share it.` and the same text ending "Reply STOP to opt out."
2. **After approval**, if the codes come from a second number, set it (run it yourself):
   `npx supabase secrets set TELNYX_CODE_FROM_NUMBER=+1…`
   Otherwise the number in `TELNYX_FROM_NUMBER` is used.
3. **Check the phones on file.** Numbers with extensions, several numbers or placeholders can never
   be used:
   `select id, name, phone from church_members where nullif(btrim(phone),'') is not null and public.app_norm_phone(phone) is null;`
   Blocklist the church office's own number if it's typed onto records, as its 10 digits:
   `insert into app_contact_blocklist (contact_norm, note) values ('<10 digits>', 'office line');`
4. **Switch it on:** `update app_auth_settings set sms_enabled = true;` Raise `sms_per_hour` and
   `sms_per_day` for a launch rush.

Notes: Canadian numbers are allowed; Caribbean countries that share +1 are not (billed as
international). People who ever texted **STOP** to the church's messaging profile get no codes; the
app tells them to reply START or use email.

| `member_auth_events` shows (texting) | Meaning |
| --- | --- |
| `send_failed` · `blocked_stop` | They texted STOP to the church. They can reply START, or use email. |
| `send_failed` · `telnyx_40010` | The texting number isn't registered for 10DLC. |

## Tests

```bash
cd supabase/tests && npm i --no-save @electric-sql/pglite
node member-auth.test.mjs          # SQL: rules, trigger, codes, tickets, minting, the member gate, permissions
node member-functions.test.mjs     # the functions on Node with the real SQL (about a minute)
node pillar-sql-rerun.test.mjs     # re-running any Pillar SQL file never reopens staff data to member logins
```

The app's tests are in the BethesdaApp repo: `node tests/member-sign-in.test.cjs`.
