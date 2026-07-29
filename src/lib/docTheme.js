/*
 * The shared look for Pillar's printed/emailed documents.
 *
 * The Weekly Recap defined this design; the guest and prospect exports now
 * render from the same helpers so the printed list and the emailed recap can't
 * drift apart. Everything is table-based with inline styles — flexbox and CSS
 * grid are ignored by Outlook and several webmail clients, and the same markup
 * has to survive both the browser print engine and an email client.
 */

export const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export const C = {
  ink: '#1a1a1a', mute: '#555', faint: '#888', line: '#ddd', rule: '#ccc',
  gray: '#f0f0f0', soft: '#f7f7f7', green: '#e8f5e9', blue: '#e3f2fd',
};
export const FONT = "-apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

export const h2 = t => `<h2 style="font-size:11pt;margin:0 0 8px;padding-bottom:4px;border-bottom:1px solid ${C.rule};font-family:${FONT};color:${C.ink};">${t}</h2>`;
export const emptyNote = (text = 'None this week.') => `<p style="color:#999;font-style:italic;margin:0;font-size:9pt;">${text}</p>`;

/* A card. `tone` picks the background. */
export const card = (inner, tone = 'soft') => `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:separate;margin-bottom:7px;">
    <tr><td style="background:${C[tone]};border-radius:6px;padding:8px 10px;font-family:${FONT};font-size:9pt;color:${C.ink};">${inner}</td></tr></table>`;
export const name = t => `<div style="font-weight:700;font-size:9.5pt;">${t}</div>`;
export const meta = t => (t ? `<div style="color:${C.mute};margin-top:2px;">${t}</div>` : '');
export const notes = t => (t ? `<div style="font-style:italic;color:#444;margin-top:4px;">${t}</div>` : '');
export const tag = (t, green) => `<span style="display:inline-block;font-size:7pt;font-weight:600;background:${green ? '#c8e6c9' : '#fff'};border:1px solid ${green ? '#a5d6a7' : C.rule};border-radius:999px;padding:1px 8px;margin-top:5px;">${t}</span>`;
export const contact = g => [g.phone, g.email].filter(Boolean).map(esc).join(' · ');

/* Lay a list of cards into two columns, the way the printed recap reads. */
export const twoCol = (items, empty = 'None this week.') => {
  if (!items.length) return emptyNote(empty);
  let out = '<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;">';
  for (let i = 0; i < items.length; i += 2) {
    out += `<tr><td width="50%" valign="top" style="padding-right:4px;">${items[i]}</td>`
      + `<td width="50%" valign="top" style="padding-left:4px;">${items[i + 1] || ''}</td></tr>`;
  }
  return out + '</table>';
};

export const metric = (n, label) => `<td width="25%" valign="top" style="padding:0 5px;">
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:separate;">
      <tr><td align="center" style="border:1px solid ${C.line};border-radius:6px;padding:10px;font-family:${FONT};">
        <div style="font-size:20pt;font-weight:700;line-height:1;color:${C.ink};">${n}</div>
        <div style="font-size:7pt;text-transform:uppercase;letter-spacing:0.5px;color:#666;margin-top:5px;">${label}</div>
      </td></tr></table></td>`;

/* Page chrome: header, metric row, body sections, Confidential footer. */
export function docShell({ docTitle, heading, subheading, today, metricsRow = '', body = '' }) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
  <title>${docTitle}</title>
  <style>@page { size: letter portrait; margin: 0.5in; }</style></head>
  <body style="margin:0;padding:0;background:#fff;">
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;max-width:760px;margin:0 auto;font-family:${FONT};font-size:9pt;color:${C.ink};">

    <tr><td style="border-bottom:2px solid #111;padding-bottom:10px;">
      <table role="presentation" cellpadding="0" cellspacing="0" width="100%"><tr>
        <td valign="bottom"><div style="font-size:24pt;font-weight:700;letter-spacing:-0.5px;">${heading}</div>
          <div style="font-size:9pt;color:${C.mute};margin-top:2px;">${subheading}</div></td>
        <td valign="bottom" align="right" style="font-size:9pt;color:#444;line-height:1.5;">
          <b style="color:#111;">Bethesda Baptist Church</b><br>${today}</td>
      </tr></table>
    </td></tr>
${metricsRow ? `
    <tr><td style="padding-top:14px;">
      <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;"><tr>
        ${metricsRow}
      </tr></table>
    </td></tr>
` : ''}${body}
    <tr><td style="padding-top:22px;">
      <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-top:1px solid ${C.line};font-size:7.5pt;color:${C.faint};">
        <tr><td style="padding-top:8px;">Confidential</td><td align="right" style="padding-top:8px;">${today}</td></tr>
      </table>
    </td></tr>

  </table></body></html>`;
}

/* A titled block inside the shell body. */
export const section = (title, inner) => (inner
  ? `<tr><td style="padding-top:18px;">${h2(title)}${inner}</td></tr>` : '');
