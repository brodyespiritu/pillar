import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import AppShell from './AppShell';
import { P, Icon } from '../../lib/icons';
import { getAnnouncements, saveAnnouncement, deleteAnnouncement, genId } from '../../lib/appApi';
import {
  useRows, useSaveQueue, useAutosave, useLeaveGuard, useUndo,
  SaveState, Field, GrowText, Toggle, Seg, Alert, Loading, RowList,
} from './kit';
import SlidesView from './SlidesView';

// App → Bulletin: the announcements at the top of the app's Digital Bulletin. The Bulletin's other
// parts fill themselves — "This week's calendar" is Pillar's Calendar, and "Group Events" are the
// cards under Groups — so this page only holds what the office writes here.

const formOf = (r) => ({
  title: r.title || '',
  body: r.body || '',
  tag: r.tag || '',
  date: r.date || '',
  published: r.published !== false,
});
// what the app server keeps that this page doesn't touch (an old "tap destination", say) rides along
const stripMeta = ({ _key, _saved, _error, ...rest }) => rest;

const VIEWS = [{ key: 'notices', label: 'Announcements' }, { key: 'slides', label: 'Slides' }];

export default function BulletinPage() {
  const [view, setView] = useState('notices');
  const rows = useRows(formOf);
  const queue = useSaveQueue();
  const [picked, setPicked] = useState(null);
  const [error, setError] = useState('');
  const [toast, undo] = useUndo();

  const load = useCallback(async () => {
    setError('');
    try {
      const list = (await getAnnouncements()) || [];
      rows.load(Array.isArray(list) ? list : []);
      setPicked((p) => p ?? (list[0] ? String(list[0].id) : null));
    } catch (e) {
      rows.fail();
      setError(e.message);
    }
  }, [rows.load, rows.fail]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [load]);

  const list = rows.rows || [];
  useLeaveGuard(list.some((r) => rows.dirty(r) && formOf(r).title.trim()));

  const persist = useCallback((key) => queue(key, async () => {
    const r = rows.get(key);
    if (!r || !rows.dirty(r)) return;
    const form = formOf(r);
    try {
      await saveAnnouncement({ ...stripMeta(r), ...form });
      rows.saved(key, form, { id: r.id });
    } catch (e) {
      rows.failed(key, e.message);
      throw e;
    }
  }), [queue, rows]);

  function add() {
    const key = rows.add({ id: genId(), title: '', body: '', tag: '', date: '', published: false }, { first: true });
    setPicked(key);
  }

  async function setLive(key, on) {
    const r = rows.get(key);
    if (!r) return;
    if (on && !formOf(r).title.trim()) { setError('Give the announcement a title before it goes in the Bulletin.'); return; }
    setError('');
    rows.patch(key, { published: on });
    try { await persist(key); } catch (e) { rows.patch(key, { published: !on }); setError(e.message); }
  }

  async function remove(key) {
    const r = rows.get(key);
    if (!r) return;
    const at = list.findIndex((x) => x._key === key);
    const next = list[at + 1] || list[at - 1];
    rows.remove(key);
    setPicked(next ? next._key : null);
    if (r._saved === null) return;   // never reached the server
    try {
      await queue(key, () => deleteAnnouncement(r.id));
    } catch (e) {
      rows.restore(stripMeta(r), at);
      setError(e.message);
      return;
    }
    undo(`“${r.title || 'Announcement'}” deleted.`, async () => {
      try {
        const back = { ...stripMeta(r), ...formOf(r) };
        await saveAnnouncement(back);
        setPicked(rows.restore(back, at));
      } catch (e) { setError(`Couldn’t bring it back: ${e.message}`); }
    });
  }

  const shown = list.filter((r) => r._saved !== null && r.published !== false);
  const current = list.find((r) => r._key === picked) || null;
  const tags = [...new Set(list.map((r) => String(r.tag || '').trim().toUpperCase()).filter(Boolean))].slice(0, 8);

  return (
    <AppShell
      title="Bulletin"
      subtitle="The announcements at the top of the app’s Digital Bulletin. Changes save as you type."
      actions={view === 'notices'
        ? <button type="button" className="ax-btn primary" onClick={add}><Icon d={P.plus} size={17} />New announcement</button>
        : null}
    >
      <div style={{ marginBottom: 28 }}>
        <Seg big label="Show" value={view} onChange={setView} options={VIEWS} />
      </div>
      <Alert onClose={error ? () => setError('') : null}>{error}</Alert>

      {view === 'slides' ? <SlidesView />
        : rows.rows === null ? <Loading>Reaching the app server… (the first load can take up to a minute)</Loading> : (
        <div className="ax-split">
          <section>
            <div className="ax-panel tight">
              <div className="ax-list-head" style={{ padding: '6px 8px 0' }}>
                <span className="ax-list-count">{list.length} announcement{list.length === 1 ? '' : 's'} · {shown.length} in the Bulletin</span>
              </div>
              <RowList
                rows={list}
                picked={picked}
                onPick={setPicked}
                empty={<div className="ax-empty"><strong>No announcements</strong>The Bulletin says “Nothing yet” until you add one.</div>}
                renderRow={(r) => {
                  const f = formOf(r);
                  return (
                    <>
                      <span className="ax-row-main">
                        <span className={`ax-row-title${f.title.trim() ? '' : ' muted'}`}>{f.title.trim() || 'New announcement'}</span>
                        <span className="ax-row-sub">
                          {r._error ? <span className="ax-row-flag">Not saved</span>
                            : [f.tag.toUpperCase(), f.date, r._saved === null ? 'Not saved yet' : ''].filter(Boolean).join(' · ') || (f.body.trim() || 'No message')}
                        </span>
                      </span>
                      <Toggle small checked={f.published} onChange={(on) => setLive(r._key, on)}
                        title={f.published ? 'In the Bulletin — switch off to take it out' : 'Not in the Bulletin — switch on to show it'} />
                    </>
                  );
                }}
              />
            </div>
            <p className="ax-hint" style={{ margin: '14px 8px 0' }}>The switch puts an announcement in the Bulletin or takes it out.</p>
          </section>

          <section>
            {current ? (
              <NoticeEditor key={current._key} row={current} rows={rows} persist={persist} tags={tags}
                isNew={current._saved === null} onLive={(on) => setLive(current._key, on)} onDelete={() => remove(current._key)} />
            ) : (
              <div className="ax-panel"><div className="ax-empty"><strong>Pick an announcement to change it</strong>or write a new one.</div></div>
            )}
          </section>

          <aside className="ax-aside">
            <div className="ax-sticky">
              <BulletinPhone rows={list} picked={picked} onPick={setPicked} />
            </div>
          </aside>
        </div>
      )}
      {toast}
    </AppShell>
  );
}

function NoticeEditor({ row, rows, persist, tags, isNew, onLive, onDelete }) {
  const key = row._key;
  const f = formOf(row);
  const set = (k, v) => rows.patch(key, { [k]: v });
  const ready = !!f.title.trim();
  const auto = useAutosave({ value: f, savedJson: row._saved, ready, save: () => persist(key) });

  return (
    <div className="ax-panel">
      <div className="ax-editor-head">
        <SaveState auto={auto} waiting="Not saved — give it a title" />
        <Toggle checked={f.published} onChange={onLive} label="In the Bulletin"
          sub={f.published ? 'Members see it now' : 'A draft — only you see it'} />
      </div>
      <div className="ax-form">
        <Field label="Title">
          <input className="ax-input title" value={f.title} autoFocus={isNew} placeholder="What’s happening"
            onChange={(e) => set('title', e.target.value)} />
        </Field>
        <Field label="Message">
          <GrowText value={f.body} placeholder="The details, the way you’d say them from the pulpit."
            onChange={(e) => set('body', e.target.value)} />
        </Field>
        <div className="ax-row2">
          <Field label="Tag" hint="A word or two in orange above the title.">
            <input className="ax-input" value={f.tag} placeholder="NEW" onChange={(e) => set('tag', e.target.value)} />
            {tags.length > 0 && (
              <div className="ax-chips">
                {tags.map((t) => (
                  <button key={t} type="button" className={`ax-chip${f.tag.trim().toUpperCase() === t ? ' on' : ''}`}
                    onClick={() => set('tag', f.tag.trim().toUpperCase() === t ? '' : t)}>{t}</button>
                ))}
              </div>
            )}
          </Field>
          <Field label="When" hint="As members should read it — “Every Wed.”, “Sunday, 6 PM”.">
            <input className="ax-input" value={f.date} placeholder="Every Wed." onChange={(e) => set('date', e.target.value)} />
          </Field>
        </div>
      </div>
      <div className="ax-editor-foot">
        <span className="ax-hint">{f.published ? 'Changes reach phones as you make them.' : 'Switch it on to put it in the Bulletin.'}</span>
        <button type="button" className="ax-btn danger" onClick={onDelete}><Icon d={P.trash} size={16} />Delete</button>
      </div>
    </div>
  );
}

function BulletinPhone({ rows, picked, onPick }) {
  const items = rows.filter((r) => (r._saved !== null && r.published !== false) || r._key === picked);
  const count = rows.filter((r) => r._saved !== null && r.published !== false).length;
  return (
    <div className="ax-phone-wrap">
      <div className="ax-phone">
        <div className="ax-phone-title">Digital Bulletin</div>
        <div className="ax-fold">
          <div className="ax-fold-head">Announcements <span>{count ? `${count} this week` : 'Nothing yet'}</span></div>
          {items.length === 0 ? <div className="ax-hint">Nothing yet.</div> : items.map((r) => {
            const f = formOf(r);
            const hidden = !(r._saved !== null && r.published !== false);
            return (
              <div key={r._key} role="button" tabIndex={0} className={`ax-notice${r._key === picked ? ' picked' : ''}`}
                onClick={() => onPick(r._key)} onKeyDown={(e) => { if (e.key === 'Enter') onPick(r._key); }}>
                {(f.tag || f.date || hidden) && (
                  <div className="ax-notice-head">
                    {hidden && <span className="ax-cp-draft" style={{ position: 'static', background: '#fff' }}>NOT IN THE BULLETIN</span>}
                    {f.tag && <span className="ax-notice-tag">{f.tag.toUpperCase()}</span>}
                    {f.date && <span className="ax-notice-when">{f.date}</span>}
                  </div>
                )}
                <div className="ax-notice-title">{f.title || 'Title'}</div>
                {f.body && <div className="ax-notice-body">{f.body}</div>}
              </div>
            );
          })}
        </div>
      </div>
      <p className="ax-phone-cap">
        The Bulletin’s calendar comes from <Link className="ax-link" to="/calendar">Calendar</Link>, and its Group Events
        from <Link className="ax-link" to="/app/groups">Groups</Link>.
      </p>
    </div>
  );
}
