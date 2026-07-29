import { useState, useMemo } from 'react';
import { P, Icon } from '../../lib/icons';
import { alertDialog } from '../../lib/dialog';
import { printHtml } from '../../lib/printDoc';
import {
  decideTimeOff, createTimeOff, updateStaff, ptoDays, timeAgo,
} from '../../lib/admin';
import '../care/Modal.css';

const STATUS_COLORS = { Pending: 'var(--yellow)', Approved: 'var(--green)', Denied: 'var(--red)' };

export default function TimeOffTab({ data, staff, testMode, reload, reloadStaff }) {
  const [editingPto, setEditingPto] = useState(null);   // { id, field }
  const [ptoDraft, setPtoDraft] = useState('');
  const [denyReq, setDenyReq] = useState(null);          // request being denied
  const [denyReason, setDenyReason] = useState('');
  const [pdfOffer, setPdfOffer] = useState(null);        // { req, status, reason }
  const [newOpen, setNewOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);

  if (data.missing) {
    return (
      <div className="adm-placeholder">
        <div className="adm-placeholder-icon"><Icon d={P.clock} size={28} /></div>
        <h2>Time Off</h2>
        <p>Run supabase/admin-schema.sql to enable PTO tracking — staff balances, request approvals with decision PDFs, and a full activity log.</p>
      </div>
    );
  }

  const pending = data.rows.filter(r => r.status === 'Pending');
  const history = data.rows.filter(r => r.status !== 'Pending');
  const shownHistory = showAll ? history : history.slice(0, 5);

  /* ── Inline PTO editing ── */
  function startEdit(s, field) {
    setEditingPto({ id: s.id, field });
    setPtoDraft(String(field === 'pto_total' ? (s.pto_total ?? 15) : (s.pto_used ?? 0)));
  }
  async function commitEdit() {
    const val = Number(ptoDraft);
    if (!editingPto || Number.isNaN(val) || val < 0) { setEditingPto(null); return; }
    if (testMode) { toast('Test Mode: PTO not saved.'); setEditingPto(null); return; }
    await updateStaff(editingPto.id, { [editingPto.field]: val });
    setEditingPto(null);
    reloadStaff();
  }

  /* ── Approve / Deny ── */
  async function approve(r) {
    if (testMode) return toast('Test Mode: request not approved.');
    await decideTimeOff(r.id, 'Approved', { decided_by: 'Admin' });
    // fold the days into the staff member's used balance
    const person = staff.find(s => s.id === r.staff_id);
    if (person) await updateStaff(person.id, { pto_used: (person.pto_used ?? 0) + ptoDays(r) });
    reload(); reloadStaff();
    setPdfOffer({ req: r, status: 'Approved', reason: '' });
  }
  async function confirmDeny() {
    const r = denyReq;
    setDenyReq(null);
    if (testMode) { setDenyReason(''); return toast('Test Mode: request not denied.'); }
    await decideTimeOff(r.id, 'Denied', { decided_by: 'Admin', deny_reason: denyReason });
    reload();
    setPdfOffer({ req: r, status: 'Denied', reason: denyReason });
    setDenyReason('');
  }

  return (
    <div>
      {/* ── PTO Overview ── */}
      <div className="adm-panel">
        <div className="adm-panel-head">
          <h2>Staff PTO Overview</h2>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn-ghost sm" onClick={() => exportPtoLogPDF(staff, data.rows)}><Icon d={P.pdf} size={14} />Export PDF</button>
            <button className="btn-primary sm" onClick={() => setNewOpen(true)}><Icon d={P.plus} size={14} />New Request</button>
          </div>
        </div>
        <div className="adm-table-wrap">
          <table className="adm-table">
            <thead><tr><th>Staff</th><th>Used</th><th>Remaining</th><th>Total</th><th style={{ width: '30%' }}>Balance</th></tr></thead>
            <tbody>
              {staff.map(s => {
                const total = s.pto_total ?? 15, used = s.pto_used ?? 0, pct = Math.min(100, (used / total) * 100);
                const color = pct > 80 ? 'var(--red)' : pct > 50 ? 'var(--yellow)' : 'var(--accent)';
                const editing = f => editingPto?.id === s.id && editingPto?.field === f;
                return (
                  <tr key={s.id}>
                    <td className="adm-user-name">{s.name}</td>
                    <td>
                      {editing('pto_used')
                        ? <input className="pto-edit" autoFocus value={ptoDraft} onChange={e => setPtoDraft(e.target.value)} onBlur={commitEdit} onKeyDown={e => e.key === 'Enter' && commitEdit()} />
                        : <button className="pto-cell" title="Click to edit" onClick={() => startEdit(s, 'pto_used')}>{used}</button>}
                    </td>
                    <td>{total - used}</td>
                    <td>
                      {editing('pto_total')
                        ? <input className="pto-edit" autoFocus value={ptoDraft} onChange={e => setPtoDraft(e.target.value)} onBlur={commitEdit} onKeyDown={e => e.key === 'Enter' && commitEdit()} />
                        : <button className="pto-cell" title="Click to edit" onClick={() => startEdit(s, 'pto_total')}>{total}</button>}
                    </td>
                    <td><div className="adm-bar"><div style={{ width: `${pct}%`, background: color }} /></div></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Pending requests ── */}
      <div className="adm-panel">
        <div className="adm-panel-head"><h2>Pending Requests ({pending.length})</h2></div>
        {pending.length === 0 ? <div className="adm-empty">No pending requests.</div> : (
          <div className="adm-req-list">
            {pending.map(r => (
              <div key={r.id} className="adm-req">
                <div>
                  <span className="adm-user-name">{r.staff_name}</span>
                  <span className="adm-req-dates">{r.start_date} → {r.end_date}{r.half_day ? ' · Half day' : ''} · {ptoDays(r)} day{ptoDays(r) === 1 ? '' : 's'}</span>
                  {r.reason && <span className="adm-req-reason">{r.reason}</span>}
                  <span className="adm-req-time">{timeAgo(r.created_at)}</span>
                </div>
                <div className="adm-req-actions">
                  <button className="btn-ghost sm" onClick={() => setDenyReq(r)}>Deny</button>
                  <button className="btn-primary sm" onClick={() => approve(r)}>Approve</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Activity log ── */}
      <div className="adm-panel">
        <div className="adm-panel-head"><h2>Activity Log</h2></div>
        {history.length === 0 ? <div className="adm-empty">No past requests yet.</div> : (
          <>
            <div className="adm-req-list">
              {shownHistory.map(r => (
                <div key={r.id} className="adm-req">
                  <div>
                    <span className="adm-user-name">{r.staff_name}</span>
                    <span className="adm-req-dates">{r.start_date} → {r.end_date}{r.half_day ? ' · Half day' : ''}</span>
                    {r.deny_reason && <span className="adm-req-reason">Reason: {r.deny_reason}</span>}
                    <span className="adm-req-time">{timeAgo(r.created_at)}</span>
                  </div>
                  <span className="adm-role" style={{ '--c': STATUS_COLORS[r.status] }}>{r.status}</span>
                </div>
              ))}
            </div>
            {history.length > 5 && (
              <button className="pto-showall" onClick={() => setShowAll(a => !a)}>
                {showAll ? 'Show less' : `Show all (${history.length})`}
              </button>
            )}
          </>
        )}
      </div>

      {/* ── Deny dialog ── */}
      {denyReq && (
        <div className="modal-overlay" onClick={() => setDenyReq(null)}>
          <div className="modal sheet" style={{ width: 420 }} onClick={e => e.stopPropagation()}>
            <div className="modal-head">
              <h2>Deny request</h2>
              <button className="modal-x" onClick={() => setDenyReq(null)}><Icon d={P.close} size={20} /></button>
            </div>
            <div className="modal-body">
              <p style={{ fontSize: 14, color: 'var(--text-2)' }}>
                Denying {denyReq.staff_name}'s request for {denyReq.start_date} → {denyReq.end_date}.
              </p>
              <label className="field-group"><span>Reason (optional)</span>
                <textarea rows={3} value={denyReason} onChange={e => setDenyReason(e.target.value)} placeholder="e.g. Overlaps with the retreat weekend" />
              </label>
            </div>
            <div className="modal-foot">
              <button className="btn-ghost" onClick={() => setDenyReq(null)}>Cancel</button>
              <button className="btn-primary" style={{ background: 'var(--red)', borderColor: 'var(--red)' }} onClick={confirmDeny}>Deny Request</button>
            </div>
          </div>
        </div>
      )}

      {/* ── PDF offer after decision ── */}
      {pdfOffer && (
        <div className="modal-overlay" onClick={() => setPdfOffer(null)}>
          <div className="modal sheet" style={{ width: 400 }} onClick={e => e.stopPropagation()}>
            <div className="modal-head"><h2>Request {pdfOffer.status.toLowerCase()}</h2>
              <button className="modal-x" onClick={() => setPdfOffer(null)}><Icon d={P.close} size={20} /></button>
            </div>
            <div className="modal-body">
              <p style={{ fontSize: 14, color: 'var(--text-2)' }}>Generate a PDF record of this decision?</p>
            </div>
            <div className="modal-foot">
              <button className="btn-ghost" onClick={() => setPdfOffer(null)}>No thanks</button>
              <button className="btn-primary" onClick={() => { exportDecisionPDF(pdfOffer); setPdfOffer(null); }}>
                <Icon d={P.pdf} size={15} />Generate PDF
              </button>
            </div>
          </div>
        </div>
      )}

      {newOpen && (
        <NewRequestModal staff={staff} testMode={testMode}
          onClose={() => setNewOpen(false)}
          onSaved={() => { setNewOpen(false); reload(); }} />
      )}
    </div>
  );
}

/* ── New Request (admin on behalf of staff) ── */
function NewRequestModal({ staff, testMode, onClose, onSaved }) {
  const today = new Date().toISOString().slice(0, 10);
  const [staffId, setStaffId] = useState(staff[0]?.id || '');
  const [start, setStart] = useState(today);
  const [end, setEnd] = useState(today);
  const [halfDay, setHalfDay] = useState(false);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  async function submit() {
    if (testMode) { toast('Test Mode: request not created.'); onClose(); return; }
    setSaving(true);
    const person = staff.find(s => s.id === staffId);
    await createTimeOff({
      staff_id: staffId, staff_name: person?.name || '',
      start_date: start, end_date: halfDay ? start : end,
      half_day: halfDay, reason,
    });
    setSaving(false);
    onSaved();
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal sheet" style={{ width: 460 }} onClick={e => e.stopPropagation()}>
        <div className="modal-head">
          <h2>New Time Off Request</h2>
          <button className="modal-x" onClick={onClose}><Icon d={P.close} size={20} /></button>
        </div>
        <div className="modal-body">
          <label className="field-group"><span>Staff member</span>
            <select value={staffId} onChange={e => setStaffId(e.target.value)}>
              {staff.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
          <label className="adm-check">
            <input type="checkbox" checked={halfDay} onChange={e => setHalfDay(e.target.checked)} />
            Half day
          </label>
          <div className="field-row">
            <label className="field-group"><span>{halfDay ? 'Date' : 'Start date'}</span>
              <input type="date" value={start} onChange={e => setStart(e.target.value)} />
            </label>
            {!halfDay && (
              <label className="field-group"><span>End date</span>
                <input type="date" value={end} onChange={e => setEnd(e.target.value)} />
              </label>
            )}
          </div>
          <label className="field-group"><span>Reason</span>
            <textarea rows={2} value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. Family vacation" />
          </label>
        </div>
        <div className="modal-foot">
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={submit} disabled={saving || !staffId}>{saving ? 'Saving…' : 'Submit Request'}</button>
        </div>
      </div>
    </div>
  );
}

/* ── PDF exports (print windows, Georgia serif like other exports) ── */
function openPrint(title, bodyHtml) {
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title>
    <style>
      body { font-family: Georgia, 'Times New Roman', serif; margin: 40px; color: #1a1a1a; }
      h1 { font-size: 22px; margin-bottom: 4px; }
      .meta { color: #666; font-size: 13px; margin-bottom: 20px; }
      table { width: 100%; border-collapse: collapse; font-size: 13px; }
      th { text-align: left; border-bottom: 2px solid #333; padding: 8px 6px; }
      td { border-bottom: 1px solid #ddd; padding: 8px 6px; }
      .row { margin: 8px 0; font-size: 14px; }
      .label { color: #666; }
    </style></head><body>${bodyHtml}</body></html>`;
  return printHtml(html, { filename: title.toLowerCase().replace(/\s+/g, '-') });
}

function exportDecisionPDF({ req, status, reason }) {
  openPrint('Time Off Decision', `
    <h1>Time Off Request — ${status}</h1>
    <div class="meta">Bethesda Baptist Church · Generated ${new Date().toLocaleString()}</div>
    <div class="row"><span class="label">Staff member:</span> <strong>${esc(req.staff_name)}</strong></div>
    <div class="row"><span class="label">Dates:</span> ${req.start_date} → ${req.end_date}${req.half_day ? ' (half day)' : ''}</div>
    <div class="row"><span class="label">Days:</span> ${ptoDays(req)}</div>
    ${req.reason ? `<div class="row"><span class="label">Request reason:</span> ${esc(req.reason)}</div>` : ''}
    <div class="row"><span class="label">Decision:</span> <strong>${status}</strong></div>
    ${reason ? `<div class="row"><span class="label">Decision reason:</span> ${esc(reason)}</div>` : ''}
  `);
}

function exportPtoLogPDF(staff, rows) {
  openPrint('PTO Log', `
    <h1>Bethesda Baptist Church — PTO Log</h1>
    <div class="meta">${rows.length} requests · Generated ${new Date().toLocaleString()}</div>
    <h3>Balances</h3>
    <table><thead><tr><th>Staff</th><th>Used</th><th>Remaining</th><th>Total</th></tr></thead><tbody>
      ${staff.map(s => `<tr><td>${esc(s.name)}</td><td>${s.pto_used ?? 0}</td><td>${(s.pto_total ?? 15) - (s.pto_used ?? 0)}</td><td>${s.pto_total ?? 15}</td></tr>`).join('')}
    </tbody></table>
    <h3 style="margin-top:24px">Requests</h3>
    <table><thead><tr><th>Staff</th><th>Dates</th><th>Days</th><th>Status</th><th>Reason</th></tr></thead><tbody>
      ${rows.map(r => `<tr><td>${esc(r.staff_name)}</td><td>${r.start_date} → ${r.end_date}${r.half_day ? ' (half)' : ''}</td><td>${ptoDays(r)}</td><td>${r.status}</td><td>${esc(r.reason || '')}${r.deny_reason ? ` — ${esc(r.deny_reason)}` : ''}</td></tr>`).join('')}
    </tbody></table>
  `);
}

function esc(s = '') {
  return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function toast(msg) {
  const el = document.createElement('div');
  el.className = 'adm-toast';
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 300); }, 2200);
}
