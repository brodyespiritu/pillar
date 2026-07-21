// IMAP fetch + SMTP send bridge for connected Gmail / Yahoo accounts (app passwords).
use serde::{Deserialize, Serialize};

/// A file attached to an outgoing email (content is base64-encoded).
#[derive(Deserialize)]
pub struct EmailAttachment {
    filename: String,
    mime: String,
    content: String,
}

#[derive(Serialize)]
pub struct MailMessage {
    id: String,
    from_name: String,
    from_addr: String,
    subject: String,
    date: String,
    preview: String,
    body: String,
    unread: bool,
    starred: bool,
}

/// Map generic folder keys to provider-specific IMAP mailbox names.
fn map_folder(host: &str, folder: &str) -> String {
    let gmail = host.contains("gmail");
    match folder {
        "INBOX" => "INBOX".to_string(),
        "Sent" => if gmail { "[Gmail]/Sent Mail".into() } else { "Sent".into() },
        "Drafts" => if gmail { "[Gmail]/Drafts".into() } else { "Draft".into() },
        "Spam" => if gmail { "[Gmail]/Spam".into() } else { "Bulk Mail".into() },
        "Trash" => if gmail { "[Gmail]/Trash".into() } else { "Trash".into() },
        other => other.to_string(),
    }
}

fn parse_from(raw: &str) -> (String, String) {
    // "Display Name <addr@host>"  or  "addr@host"
    if let Some(lt) = raw.find('<') {
        let name = raw[..lt].trim().trim_matches('"').to_string();
        let addr = raw[lt + 1..].trim_end_matches('>').trim().to_string();
        let name = if name.is_empty() { addr.clone() } else { name };
        (name, addr)
    } else {
        (raw.trim().to_string(), raw.trim().to_string())
    }
}

fn text_body(parsed: &mailparse::ParsedMail) -> String {
    // Prefer text/plain; walk subparts.
    if parsed.subparts.is_empty() {
        let ct = parsed.ctype.mimetype.to_lowercase();
        if ct.starts_with("text/") {
            return parsed.get_body().unwrap_or_default();
        }
        return String::new();
    }
    for part in &parsed.subparts {
        if part.ctype.mimetype.eq_ignore_ascii_case("text/plain") {
            if let Ok(b) = part.get_body() {
                if !b.trim().is_empty() { return b; }
            }
        }
    }
    // fallback: first text part anywhere
    for part in &parsed.subparts {
        let t = text_body(part);
        if !t.trim().is_empty() { return t; }
    }
    String::new()
}

/// Verify login only.
#[tauri::command]
pub async fn email_test(host: String, port: u16, email: String, password: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || test_blocking(host, port, email, password))
        .await
        .map_err(|e| e.to_string())?
}

fn test_blocking(host: String, port: u16, email: String, password: String) -> Result<(), String> {
    let tls = native_tls::TlsConnector::builder().build().map_err(|e| e.to_string())?;
    let client = imap::connect((host.as_str(), port), host.as_str(), &tls).map_err(|e| e.to_string())?;
    let mut session = client.login(&email, &password).map_err(|e| e.0.to_string())?;
    let _ = session.logout();
    Ok(())
}

/// Fetch the latest `limit` messages from a folder → JSON string.
#[tauri::command]
pub async fn email_fetch(host: String, port: u16, email: String, password: String, folder: String, limit: u32) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || fetch_blocking(host, port, email, password, folder, limit))
        .await
        .map_err(|e| e.to_string())?
}

fn fetch_blocking(host: String, port: u16, email: String, password: String, folder: String, limit: u32) -> Result<String, String> {
    let tls = native_tls::TlsConnector::builder().build().map_err(|e| e.to_string())?;
    let client = imap::connect((host.as_str(), port), host.as_str(), &tls).map_err(|e| e.to_string())?;
    let mut session = client.login(&email, &password).map_err(|e| e.0.to_string())?;

    let mailbox_name = map_folder(&host, &folder);
    let mailbox = session.select(&mailbox_name).map_err(|e| e.to_string())?;
    let total = mailbox.exists;
    if total == 0 {
        let _ = session.logout();
        return Ok("{\"messages\":[]}".to_string());
    }
    let start = if total > limit { total - limit + 1 } else { 1 };
    let seq = format!("{}:{}", start, total);

    let fetches = session
        .fetch(seq, "(FLAGS INTERNALDATE RFC822)")
        .map_err(|e| e.to_string())?;

    let mut out: Vec<MailMessage> = Vec::new();
    for f in fetches.iter() {
        let flags: Vec<String> = f.flags().iter().map(|fl| format!("{:?}", fl)).collect();
        let unread = !flags.iter().any(|x| x.contains("Seen"));
        let starred = flags.iter().any(|x| x.contains("Flagged"));
        let raw = f.body().or_else(|| f.text()).unwrap_or_default();
        let parsed = mailparse::parse_mail(raw).map_err(|e| e.to_string())?;

        let mut subject = String::new();
        let mut from_raw = String::new();
        let mut date = String::new();
        for h in &parsed.headers {
            let key = h.get_key();
            match key.to_lowercase().as_str() {
                "subject" => subject = h.get_value(),
                "from" => from_raw = h.get_value(),
                "date" => date = h.get_value(),
                _ => {}
            }
        }
        let (from_name, from_addr) = parse_from(&from_raw);
        let body = text_body(&parsed);
        let preview: String = body.split_whitespace().collect::<Vec<_>>().join(" ").chars().take(120).collect();

        out.push(MailMessage {
            id: format!("{}", f.message),
            from_name, from_addr, subject, date, preview, body, unread, starred,
        });
    }
    out.reverse(); // newest first
    let _ = session.logout();

    serde_json::to_string(&serde_json::json!({ "messages": out })).map_err(|e| e.to_string())
}

/// Send a message via SMTP (STARTTLS).
#[tauri::command]
pub async fn email_send(host: String, port: u16, email: String, password: String, from: String, to: String, cc: String, subject: String, body: String, html_body: String, attachments: Vec<EmailAttachment>) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || send_blocking(host, port, email, password, from, to, cc, subject, body, html_body, attachments))
        .await
        .map_err(|e| e.to_string())?
}

fn send_blocking(host: String, port: u16, email: String, password: String, from: String, to: String, cc: String, subject: String, body: String, html_body: String, attachments: Vec<EmailAttachment>) -> Result<(), String> {
    use lettre::message::{header::ContentType, Attachment, Mailbox, Message, MultiPart, SinglePart};
    use lettre::transport::smtp::authentication::Credentials;
    use base64::Engine as _;
    use lettre::{Address, SmtpTransport, Transport};

    // Parse "addr" or "Name <addr>" into a Mailbox robustly.
    fn parse_mailbox(raw: &str) -> Result<Mailbox, String> {
        let raw = raw.trim();
        if let Ok(m) = raw.parse::<Mailbox>() {
            return Ok(m);
        }
        let addr: Address = raw.parse().map_err(|e| format!("{raw}: {e}"))?;
        Ok(Mailbox::new(None, addr))
    }

    // From: only attach a display name if it's a real name (not the email itself).
    let addr: Address = email.parse().map_err(|e| format!("bad email address {email}: {e}"))?;
    let name = {
        let t = from.trim();
        if t.is_empty() || t.eq_ignore_ascii_case(email.trim()) { None } else { Some(t.to_string()) }
    };
    let from_mbox = Mailbox::new(name, addr);
    let mut builder = Message::builder().from(from_mbox).subject(subject);

    for a in to.split(',').map(|s| s.trim()).filter(|s| !s.is_empty()) {
        builder = builder.to(parse_mailbox(a).map_err(|e| format!("bad recipient {e}"))?);
    }
    for a in cc.split(',').map(|s| s.trim()).filter(|s| !s.is_empty()) {
        if let Ok(m) = parse_mailbox(a) { builder = builder.cc(m); }
    }

    // Build the attachment parts once (used by the mixed variants below).
    fn attach_part(a: &EmailAttachment) -> Result<SinglePart, String> {
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(a.content.as_bytes())
            .map_err(|e| format!("attachment decode failed: {e}"))?;
        let ct = ContentType::parse(&a.mime)
            .map_err(|e| format!("bad attachment type {}: {e}", a.mime))?;
        Ok(Attachment::new(a.filename.clone()).body(bytes, ct))
    }

    let has_html = !html_body.trim().is_empty();
    // The message content: plain text, or a plain+html alternative.
    let content = || -> MultiPart {
        MultiPart::alternative()
            .singlepart(SinglePart::plain(body.clone()))
            .singlepart(SinglePart::html(html_body.clone()))
    };

    let message = if has_html && !attachments.is_empty() {
        let mut mixed = MultiPart::mixed().multipart(content());
        for a in &attachments { mixed = mixed.singlepart(attach_part(a)?); }
        builder.multipart(mixed).map_err(|e| e.to_string())?
    } else if has_html {
        builder.multipart(content()).map_err(|e| e.to_string())?
    } else if !attachments.is_empty() {
        let mut mixed = MultiPart::mixed().singlepart(SinglePart::plain(body));
        for a in &attachments { mixed = mixed.singlepart(attach_part(a)?); }
        builder.multipart(mixed).map_err(|e| e.to_string())?
    } else {
        builder.header(ContentType::TEXT_PLAIN).body(body).map_err(|e| e.to_string())?
    };

    let creds = Credentials::new(email.clone(), password);
    let mailer = SmtpTransport::starttls_relay(&host)
        .map_err(|e| e.to_string())?
        .port(port)
        .credentials(creds)
        .build();

    mailer.send(&message).map_err(|e| e.to_string())?;
    Ok(())
}
