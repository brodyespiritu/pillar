import { supabase } from './supabase';

/* ── Provider presets (app-password IMAP/SMTP) ── */
export const PROVIDERS = {
  gmail: {
    key: 'gmail', label: 'Gmail',
    imap_host: 'imap.gmail.com', imap_port: 993,
    smtp_host: 'smtp.gmail.com', smtp_port: 587,
    color: '#EA4335',
    help: 'https://myaccount.google.com/apppasswords',
    steps: [
      'Enable 2-Step Verification on your Google account',
      'Go to myaccount.google.com/apppasswords',
      'Create an app password for "Mail"',
      'Paste the 16-character password below',
    ],
  },
  yahoo: {
    key: 'yahoo', label: 'Yahoo Mail',
    imap_host: 'imap.mail.yahoo.com', imap_port: 993,
    smtp_host: 'smtp.mail.yahoo.com', smtp_port: 587,
    color: '#6001D2',
    help: 'https://login.yahoo.com/account/security/app-passwords',
    steps: [
      'Go to Yahoo Account Security',
      'Select "Generate app password"',
      'Choose "Other app" and name it Pillar',
      'Paste the generated password below',
    ],
  },
};

/* ── Is this running inside the Tauri desktop shell? ── */
export const isDesktop = () =>
  typeof window !== 'undefined' && (
    '__TAURI_INTERNALS__' in window ||
    '__TAURI__' in window ||
    window.isTauri === true
  );

// True only when the invoke fails because there's no Tauri bridge (i.e. a browser tab).
function isNoBridgeError(e) {
  const m = String(e?.message || e || '');
  return m.includes('__TAURI') || m.includes('not a function') ||
         m.includes('undefined') || m.includes('Cannot read') || m.includes('is not defined');
}

async function invoke(cmd, args) {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke(cmd, args);
}

/* ── Account CRUD ── */
export async function fetchAccounts() {
  const { data } = await supabase.from('email_accounts').select('*').order('created_at');
  return data || [];
}

export async function connectAccount({ provider, email, display_name, app_password, owner }) {
  const p = PROVIDERS[provider];
  const row = {
    owner, provider, email: String(email || '').trim(), display_name: display_name || email,
    imap_host: p.imap_host, imap_port: p.imap_port,
    smtp_host: p.smtp_host, smtp_port: p.smtp_port,
    // Google shows app passwords as "abcd efgh ijkl mnop" — the spaces are
    // display-only and SMTP rejects them, so strip all whitespace.
    app_password: String(app_password || '').replace(/\s+/g, ''),
  };
  // Credentials are validated on first send (via the cloud mail function),
  // so we just save the account here — works on web and desktop alike.
  //
  // Upsert on (owner, email): reconnecting the same address updates it — most
  // often to replace an expired app password — instead of failing on the
  // table's unique constraint.
  const { data, error } = await supabase
    .from('email_accounts')
    .upsert(row, { onConflict: 'owner,email' })
    .select()
    .single();
  return { data, error };
}

export async function removeAccount(id) {
  return supabase.from('email_accounts').delete().eq('id', id);
}

/* ── Folders ── */
export const FOLDERS = [
  { key: 'INBOX',   label: 'Inbox',      icon: 'mail' },
  { key: 'Sent',    label: 'Sent Mails', icon: 'send' },
  { key: 'Drafts',  label: 'Drafts',     icon: 'edit' },
  { key: 'Spam',    label: 'Spam',       icon: 'spam' },
  { key: 'Trash',   label: 'Trash',      icon: 'trash' },
];

/* ── Fetch messages (live in desktop, sample in browser) ── */
export async function fetchMessages(account, folder = 'INBOX') {
  if (account?.app_password) {
    try {
      const raw = await invoke('email_fetch', {
        host: account.imap_host, port: account.imap_port,
        email: account.email, password: account.app_password,
        folder, limit: 25,
      });
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
      return { ...parsed, live: true };
    } catch (e) {
      if (isNoBridgeError(e)) {
        // In a browser tab (no Tauri) — show sample mail
        return { sample: true, messages: sampleMessages(folder) };
      }
      return { error: String(e?.message || e), messages: [] };
    }
  }
  return { sample: true, messages: sampleMessages(folder) };
}

export async function sendMessage(account, { to, cc, bcc, subject, body, htmlBody, attachments }) {
  // SMTP runs in a Vercel serverless function (same origin) — works in the web
  // app and the desktop app, and reliably holds the TCP socket SMTP needs.
  //
  // Send from the user's own connected account when they have one; otherwise
  // send nothing and let the server use the church-wide account.
  const payload = {
    to, cc: cc || '', bcc: bcc || '', subject,
    text: body || '', html: htmlBody || '',
    attachments: attachments || [],
  };
  if (account?.app_password) {
    payload.host = account.smtp_host;
    payload.port = account.smtp_port;
    payload.user = account.email;
    payload.pass = account.app_password;
    payload.from = account.display_name ? `${account.display_name} <${account.email}>` : account.email;
  }

  let res, data;
  try {
    res = await fetch('/api/send-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch {
    throw new Error('Could not reach the mail service. Are you on the hosted app (not the dev server)?');
  }
  try { data = await res.json(); } catch { data = {}; }
  if (!res.ok || data.error) throw new Error(data.error || `Email failed to send (${res.status}).`);
  return data;
}

/* ── Sample data for browser preview / design ── */
function sampleMessages(folder) {
  if (folder !== 'INBOX') return [];
  const now = Date.now();
  const h = n => new Date(now - n * 3600e3).toISOString();
  return [
    { id: '1', from_name: 'Dribbble', from_addr: 'noreply@dribbble.com', subject: 'Password Reset Request', preview: 'Hello, you have requested to reset your password. Click on the link below to…', date: h(3), unread: false, starred: false, body: 'Hello,\n\nYou have requested to reset your password. Click on the link below to continue.\n\nThanks,\nDribbble' },
    { id: '2', from_name: 'Cyprode', from_addr: 'hello@cyprode.com', subject: 'Welcome to Pillar Mail!', preview: 'Welcome to Pillar Mail! We are thrilled to have you join us. Get ready for a se…', date: h(3), unread: true, starred: false, body: 'Hello,\n\nWelcome to Pillar Mail! We are thrilled to have you join us. This is a preview of how connected mail will appear here once you link a Gmail or Yahoo account.\n\nA few reminders and tips:\n1. Inbox: view, reply to, and organize your mail.\n2. Folders: switch between Inbox, Sent, Drafts, Spam, and Trash.\n3. Compose: hit New Mail to write a message.\n\nWishing you a great email experience!' },
    { id: '3', from_name: 'Google', from_addr: 'no-reply@accounts.google.com', subject: 'Account Verification Request', preview: 'Hello, please complete the verification steps for the security of your account. Enter…', date: h(3), unread: false, starred: true, body: 'Hello,\n\nPlease complete the verification steps for the security of your account.' },
    { id: '4', from_name: 'Netflix', from_addr: 'info@netflix.com', subject: 'Payment Received', preview: 'Hello, your payment has been successfully received. We are sending this email to…', date: h(3), unread: false, starred: false, body: 'Hello,\n\nYour payment has been successfully received.' },
    { id: '5', from_name: 'Twitter', from_addr: 'notify@twitter.com', subject: 'Subscription Renewal Reminder', preview: 'Your subscription will renew soon. No action is needed to continue…', date: h(3), unread: false, starred: false, body: 'Your subscription will renew soon.' },
  ];
}
