import { supabase } from './supabase';

/*
 * Block-based email model — shared by the editor and (next) the composer.
 * A template = ordered `blocks` + a `theme`. One renderer turns blocks into
 * email-safe HTML (table layout + inline CSS, so it survives Outlook/Gmail).
 */

export const DEFAULT_THEME = { accent: '#006BFF', pageBg: '#F1F4F9', cardBg: '#FFFFFF', text: '#0B3558' };

export const BLOCK_TYPES = [
  { type: 'heading', label: 'Heading', icon: 'H' },
  { type: 'text',    label: 'Text',    icon: '¶' },
  { type: 'button',  label: 'Button',  icon: '▭' },
  { type: 'image',   label: 'Image',   icon: '▣' },
  { type: 'columns', label: 'Columns', icon: '▥' },
  { type: 'divider', label: 'Divider', icon: '—' },
  { type: 'spacer',  label: 'Spacer',  icon: '↕' },
];

let seq = 0;
const uid = () => `b${Date.now().toString(36)}${(seq++).toString(36)}`;

export function newBlock(type, theme = DEFAULT_THEME) {
  const base = { id: uid(), type, align: 'left' };
  switch (type) {
    case 'heading': return { ...base, text: 'Your headline', color: theme.text, size: 26 };
    case 'text':    return { ...base, text: 'Write your message here. Keep it warm and clear.', color: '#475569', size: 15 };
    case 'button':  return { ...base, text: 'Learn more', url: 'https://', bg: theme.accent, color: '#FFFFFF', align: 'center', radius: 8, fullWidth: false };
    case 'image':   return { ...base, src: '', alt: '', width: 560, href: '', fullWidth: false };
    case 'columns': return { ...base, cols: [{ text: 'Left column.' }, { text: 'Right column.' }], gap: 24, color: '#475569', size: 14 };
    case 'divider': return { ...base, color: '#E7EDF6' };
    case 'spacer':  return { ...base, height: 24 };
    default:        return base;
  }
}

export function starterBlocks(theme = DEFAULT_THEME) {
  return [
    { ...newBlock('heading', theme), text: 'Bethesda Church' },
    { ...newBlock('text', theme), text: 'Hi there,\n\nHere is what is happening this week at Bethesda.' },
    newBlock('button', theme),
  ];
}

/* ── Rendering ── */
const esc = (s = '') => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const nl2br = s => esc(s).replace(/\n/g, '<br>');

/** Inner HTML for one block (used by both the canvas and the full document). */
export function renderBlockContent(b, theme = DEFAULT_THEME) {
  const align = b.align || 'left';
  switch (b.type) {
    case 'heading':
      return `<h1 style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:${b.size || 26}px;font-weight:800;line-height:1.25;color:${b.color || theme.text};text-align:${align};">${nl2br(b.text)}</h1>`;
    case 'text':
      return `<p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:${b.size || 15}px;line-height:1.6;color:${b.color || '#475569'};text-align:${align};">${nl2br(b.text)}</p>`;
    case 'button': {
      const radius = b.radius ?? 8;
      const shape = b.fullWidth
        ? `display:block;width:100%;box-sizing:border-box;text-align:center;`
        : `display:inline-block;`;
      return `<div style="text-align:${align};"><a href="${esc(b.url)}" style="${shape}background:${b.bg || theme.accent};color:${b.color || '#fff'};font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:700;text-decoration:none;padding:12px 26px;border-radius:${radius}px;">${esc(b.text)}</a></div>`;
    }
    case 'image': {
      if (!b.src) return `<div style="border:1px dashed #C3D0E2;border-radius:8px;padding:34px;text-align:center;color:#94A3B8;font-family:Arial,sans-serif;font-size:13px;">Image — add a URL</div>`;
      const w = b.fullWidth ? '100%' : (b.width || 560);
      const img = `<img src="${esc(b.src)}" alt="${esc(b.alt)}" width="${w}" style="display:block;border:0;max-width:100%;height:auto;margin:${align === 'center' ? '0 auto' : align === 'right' ? '0 0 0 auto' : '0'};${b.fullWidth ? 'width:100%;' : ''}" />`;
      return b.href ? `<a href="${esc(b.href)}">${img}</a>` : img;
    }
    case 'columns': {
      const half = Math.round((b.gap || 24) / 2);
      const cell = (c, i) => `<td width="50%" valign="top" style="padding:0 ${i === 0 ? half : 0}px 0 ${i === 0 ? 0 : half}px;font-family:Arial,Helvetica,sans-serif;font-size:${b.size || 14}px;line-height:1.6;color:${b.color || '#475569'};">${nl2br(c.text || '')}</td>`;
      return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${(b.cols || []).map(cell).join('')}</tr></table>`;
    }
    case 'divider':
      return `<hr style="border:0;border-top:1px solid ${b.color || '#E7EDF6'};margin:0;" />`;
    case 'spacer':
      return `<div style="height:${b.height || 24}px;line-height:${b.height || 24}px;font-size:1px;">&nbsp;</div>`;
    default:
      return '';
  }
}

/** Full email document HTML from blocks + theme. */
export function renderEmailHtml(blocks, theme = DEFAULT_THEME) {
  const rows = (blocks || [])
    .map(b => {
      const padY = b.padY ?? (b.type === 'spacer' ? 0 : 10);
      const bg = b.bg ? `background:${b.bg};` : '';
      return `<tr><td style="padding:${padY}px 28px;${bg}">${renderBlockContent(b, theme)}</td></tr>`;
    })
    .join('');
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:${theme.pageBg};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${theme.pageBg};">
    <tr><td align="center" style="padding:28px 12px;">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:600px;background:${theme.cardBg};border-radius:14px;overflow:hidden;">
        <tr><td style="height:14px;"></td></tr>
        ${rows}
        <tr><td style="height:14px;"></td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

/** Plain-text fallback for the multipart/alternative send. */
export function renderEmailText(blocks) {
  return (blocks || []).map(b => {
    if (b.type === 'heading' || b.type === 'text') return b.text;
    if (b.type === 'button') return `${b.text}: ${b.url}`;
    if (b.type === 'image') return b.alt || '';
    if (b.type === 'columns') return (b.cols || []).map(c => c.text).filter(Boolean).join('\n\n');
    if (b.type === 'divider') return '——————';
    return '';
  }).filter(Boolean).join('\n\n');
}

/* ── CRUD ── */
export async function fetchTemplates(category) {
  let q = supabase.from('email_templates').select('*').order('updated_at', { ascending: false });
  if (category) q = q.eq('category', category);
  const { data, error } = await q;
  if (error) return { rows: [], missing: /relation|does not exist/i.test(error.message || '') };
  return { rows: data || [], missing: false };
}
export async function saveTemplate(t) {
  const row = { name: t.name, category: t.category || 'general', blocks: t.blocks, theme: t.theme, updated_at: new Date().toISOString() };
  if (t.id) return supabase.from('email_templates').update(row).eq('id', t.id).select().single();
  return supabase.from('email_templates').insert({ ...row, created_by: t.created_by || null }).select().single();
}
export async function deleteTemplate(id) {
  return supabase.from('email_templates').delete().eq('id', id);
}
