// Sends email over SMTP from a connected Pillar mail account.
// Cloud path so email works in BOTH the web app and the desktop app
// (the desktop shell loads the hosted site, where native IPC isn't available).
//
// Deploy: npx supabase functions deploy send-email --use-api
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { SMTPClient } from 'https://deno.land/x/denomailer@1.6.0/mod.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const toList = (v: string) => (v || '').split(/[,;]/).map(s => s.trim()).filter(Boolean);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const b = await req.json();
    if (!b.account_id) throw new Error('Missing account_id.');
    const recipients = toList(b.to);
    if (!recipients.length) throw new Error('No recipients.');

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);
    const { data: acct, error: aErr } = await supabase
      .from('email_accounts').select('*').eq('id', b.account_id).single();
    if (aErr || !acct) throw new Error('Mail account not found.');
    if (!acct.app_password) throw new Error('This mail account has no app password set.');

    const port = Number(acct.smtp_port) || 587;
    const client = new SMTPClient({
      connection: {
        hostname: acct.smtp_host,
        port,
        tls: port === 465,          // 465 = implicit TLS; 587 = STARTTLS
        auth: { username: acct.email, password: acct.app_password },
      },
    });

    const attachments = (b.attachments || []).map((a: any) => ({
      filename: a.filename,
      content: a.content,           // base64 string
      encoding: 'base64',
      contentType: a.mime || 'application/octet-stream',
    }));

    await client.send({
      from: acct.display_name ? `${acct.display_name} <${acct.email}>` : acct.email,
      to: recipients,
      cc: toList(b.cc),
      subject: b.subject || '',
      content: b.body || ' ',
      html: b.htmlBody || undefined,
      attachments: attachments.length ? attachments : undefined,
    });
    await client.close();

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String((e as Error).message || e) }), {
      status: 400, headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }
});
