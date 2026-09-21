import { useCallback, useEffect, useMemo, useState } from 'react';
import AppShell from './AppShell';
import { P, Icon } from '../../lib/icons';
import {
  listGroups, saveGroup, setGroupSort, deleteGroup, groupProblems, kindPills, KINDS, FILTER_KEYS,
  listPosts, savePost, setPostSort, deletePost, postProblems, isLiveNow, liveLabel,
} from '../../lib/groupPosts';
import {
  useRows, useSaveQueue, useAutosave, useLeaveGuard, useUndo, ask,
  SaveState, Field, GrowText, Toggle, Seg, Alert, Loading, RowList,
} from './kit';

// App → Groups: the Groups and Ministries page (Home → Connect), and the cards members swipe
// through there and in the Bulletin's Group Events. Both lists work the same way: pick one, change
// it (it saves as you type), flip its switch, drag to reorder.

const groupForm = (r) => ({
  name: r.name || '',
  kind: r.kind || '',
  about: r.about || '',
  meets: r.meets || '',
  location: r.location || '',
  audience: r.audience || '',
  filter_key: r.filter_key || '',
  leaders: (r.leaders || []).map((p) => ({ name: p.name || '', role: p.role || '' })),
  published: r.published !== false,
});
const postForm = (r) => ({
  group_id: r.group_id || '',
  title: r.title || '',
  body: r.body || '',
  button_label: r.button_label || '',
  button_url: r.button_url || '',
  starts_on: r.starts_on || '',
  ends_on: r.ends_on || '',
  published: r.published !== false,
});
const setupHint = (m) => (/schema cache|does not exist/i.test(m || '') ? ' — run supabase/groups-schema.sql and group-posts.sql first.' : '');

export default function GroupsPage() {
  const groups = useRows(groupForm);
  const posts = useRows(postForm);
  const queue = useSaveQueue();
  const [tab, setTab] = useState('groups');
  const [pickedGroup, setPickedGroup] = useState(null);
  const [pickedPost, setPickedPost] = useState(null);
  const [error, setError] = useState('');
  const [toast, undo] = useUndo();

  const load = useCallback(async () => {
    setError('');
    const [g, p] = await Promise.allSettled([listGroups(), listPosts()]);
    if (g.status === 'fulfilled') {
      groups.load(g.value);
      setPickedGroup((k) => k ?? (g.value[0] ? String(g.value[0].id) : null));
    } else { groups.fail(); setError(`${g.reason?.message}${setupHint(g.reason?.message)}`); }
    if (p.status === 'fulfilled') {
      posts.load(p.value);
      setPickedPost((k) => k ?? (p.value[0] ? String(p.value[0].id) : null));
    } else { posts.fail(); setError((e) => e || `${p.reason?.message}${setupHint(p.reason?.message)}`); }
  }, [groups.load, groups.fail, posts.load, posts.fail]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [load]);

  const gl = groups.rows || [];
  const pl = posts.rows || [];
  useLeaveGuard(gl.some((r) => groups.dirty(r) && r.name?.trim()) || pl.some((r) => posts.dirty(r) && r.title?.trim()));

  // ── saving ──
  const persistGroup = useCallback((key) => queue(`g:${key}`, async () => {
    const r = groups.get(key);
    if (!r || !groups.dirty(r)) return;
    const form = groupForm(r);
    try {
      const saved = await saveGroup({ ...form, id: groups.idOf(key), sort: r.sort });
      groups.saved(key, form, saved);
    } catch (e) { groups.failed(key, e.message); throw e; }
  }), [queue, groups]);

  const persistPost = useCallback((key) => queue(`p:${key}`, async () => {
    const r = posts.get(key);
    if (!r || !posts.dirty(r)) return;
    const form = postForm(r);
    try {
      const saved = await savePost({ ...form, id: posts.idOf(key), sort: r.sort });
      posts.saved(key, form, saved);
    } catch (e) { posts.failed(key, e.message); throw e; }
  }), [queue, posts]);

  // ── shared list actions ──
  const nextSort = (list) => list.reduce((m, r) => Math.max(m, Number(r.sort) || 0), 0) + 10;

  function addGroup() {
    setTab('groups');
    setPickedGroup(groups.add({ name: '', leaders: [], published: false, sort: nextSort(gl) }));
  }
  function addPost() {
    setTab('cards');
    setPickedPost(posts.add({ group_id: '', title: '', published: false, sort: nextSort(pl) }));
  }

  async function setLive(which, key, on) {
    const api = which === 'group' ? groups : posts;
    const form = which === 'group' ? groupForm : postForm;
    const persist = which === 'group' ? persistGroup : persistPost;
    const r = api.get(key);
    if (!r) return;
    if (on) {
      const problems = which === 'group' ? groupProblems(form(r)) : postProblems(form(r));
      if (problems.length) { setError(`Not yet — ${problems[0]}`); return; }
    }
    setError('');
    api.patch(key, { published: on });
    try { await persist(key); } catch (e) { api.patch(key, { published: !on }); setError(e.message); }
  }

  async function reorder(which, keys) {
    const api = which === 'group' ? groups : posts;
    const list = which === 'group' ? gl : pl;
    const save = which === 'group' ? setGroupSort : setPostSort;
    const before = new Map(list.map((r) => [r._key, r.sort]));
    api.order(keys);
    const moved = keys.map((k, i) => [k, (i + 1) * 10]).filter(([k, sort]) => before.get(k) !== sort);
    moved.forEach(([k, sort]) => api.patch(k, { sort }));
    try {
      await Promise.all(moved.map(([k, sort]) => queue(`${which === 'group' ? 'g' : 'p'}:${k}`, async () => {
        const id = api.idOf(k);
        if (id) await save(id, sort);
      })));
    } catch (e) { setError(`The new order didn’t save: ${e.message}`); load(); }
  }

  async function removeGroup(key) {
    const r = groups.get(key);
    if (!r) return;
    const id = groups.idOf(key);
    const cards = id ? pl.filter((p) => p.group_id === id) : [];
    if (cards.length && !(await ask(`Delete “${r.name}”? Its ${cards.length} card${cards.length === 1 ? '' : 's'} go with it.`))) return;
    const at = gl.findIndex((x) => x._key === key);
    const next = gl[at + 1] || gl[at - 1];
    groups.remove(key);
    cards.forEach((p) => posts.remove(p._key));
    setPickedGroup(next ? next._key : null);
    if (!id) return;
    try {
      await queue(`g:${key}`, () => deleteGroup(id));
    } catch (e) { setError(e.message); load(); return; }
    undo(`“${r.name || 'Group'}” deleted${cards.length ? ` with its ${cards.length} card${cards.length === 1 ? '' : 's'}` : ''}.`, async () => {
      try {
        const back = await saveGroup({ ...groupForm(r), sort: r.sort });
        setPickedGroup(groups.restore(back, at));
        for (const p of cards) {
          const card = await savePost({ ...postForm(p), group_id: back.id, sort: p.sort });
          posts.restore(card, pl.findIndex((x) => x._key === p._key));
        }
      } catch (e) { setError(`Couldn’t bring it all back: ${e.message}`); load(); }
    });
  }

  async function removePost(key) {
    const r = posts.get(key);
    if (!r) return;
    const at = pl.findIndex((x) => x._key === key);
    const next = pl[at + 1] || pl[at - 1];
    const id = posts.idOf(key);
    posts.remove(key);
    setPickedPost(next ? next._key : null);
    if (!id) return;
    try {
      await queue(`p:${key}`, () => deletePost(id));
    } catch (e) { posts.restore({ ...r, id }, at); setError(e.message); return; }
    undo(`“${r.title || 'Card'}” deleted.`, async () => {
      try {
        const back = await savePost({ ...postForm(r), sort: r.sort });
        setPickedPost(posts.restore(back, at));
      } catch (e) { setError(`Couldn’t bring it back: ${e.message}`); }
    });
  }

  const groupName = useMemo(() => {
    const by = new Map(gl.filter((g) => g.id).map((g) => [g.id, g.name]));
    return (id) => (id ? by.get(id) || 'A deleted group' : '');
  }, [gl]);
  const pills = kindPills(gl.filter((g) => g._saved !== null).map(groupForm));
  const liveGroups = gl.filter((g) => g._saved !== null && g.published !== false).length;
  const livePosts = pl.filter((p) => p._saved !== null && isLiveNow(p)).length;
  const loading = groups.rows === null || posts.rows === null;
  const curGroup = gl.find((r) => r._key === pickedGroup) || null;
  const curPost = pl.find((r) => r._key === pickedPost) || null;

  return (
    <AppShell
      title="Groups"
      subtitle="Groups and Ministries in the app, and the cards members swipe through there and in the Bulletin. Changes save as you type."
      actions={(
        <>
          <button type="button" className="ax-btn" onClick={addPost}><Icon d={P.plus} size={17} />New card</button>
          <button type="button" className="ax-btn primary" onClick={addGroup}><Icon d={P.plus} size={17} />New group</button>
        </>
      )}
    >
      <Alert onClose={error ? () => setError('') : null}>{error}</Alert>

      <div style={{ marginBottom: 28 }}>
        <Seg big label="Show" value={tab} onChange={setTab} options={[
          { key: 'groups', label: `Groups · ${gl.length}` },
          { key: 'cards', label: `Cards · ${pl.length}` },
        ]} />
      </div>

      {loading ? <Loading /> : tab === 'groups' ? (
        <div className="ax-split">
          <section>
            <div className="ax-panel tight">
              <div className="ax-list-head" style={{ padding: '6px 8px 0' }}>
                <span className="ax-list-count">{gl.length} group{gl.length === 1 ? '' : 's'} · {liveGroups} in the app</span>
              </div>
              <RowList rows={gl} picked={pickedGroup} onPick={setPickedGroup} onMove={(k) => reorder('group', k)}
                empty={<div className="ax-empty"><strong>No groups</strong>Add the church’s groups and ministries.</div>}
                renderRow={(r) => {
                  const f = groupForm(r);
                  return (
                    <>
                      <span className="ax-thumb"><Icon d={P.users} size={19} /></span>
                      <span className="ax-row-main">
                        <span className={`ax-row-title${f.name.trim() ? '' : ' muted'}`}>{f.name.trim() || 'New group'}</span>
                        <span className="ax-row-sub">
                          {r._error ? <span className="ax-row-flag">Not saved</span>
                            : [f.kind || 'No kind', r._saved === null ? 'Not saved yet' : ''].filter(Boolean).join(' · ')}
                        </span>
                      </span>
                      <Toggle small checked={f.published} onChange={(on) => setLive('group', r._key, on)}
                        title={f.published ? 'In the app — switch off to hide it' : 'Hidden — switch on to show it'} />
                    </>
                  );
                }} />
            </div>
            <p className="ax-hint" style={{ margin: '14px 8px 0' }}>Drag to change the order members see.</p>
          </section>

          <section>
            {curGroup ? (
              <GroupEditor key={curGroup._key} row={curGroup} rows={groups} persist={persistGroup}
                kinds={[...new Set([...KINDS, ...gl.map((g) => String(g.kind || '').trim()).filter(Boolean)])]}
                cards={curGroup.id ? pl.filter((p) => p.group_id === curGroup.id).length : 0}
                isNew={curGroup._saved === null}
                onLive={(on) => setLive('group', curGroup._key, on)}
                onDelete={() => removeGroup(curGroup._key)}
                onAddCard={() => { setTab('cards'); setPickedPost(posts.add({ group_id: curGroup.id || '', title: '', published: false, sort: nextSort(pl) })); }} />
            ) : (
              <div className="ax-panel"><div className="ax-empty"><strong>Pick a group to change it</strong>or add a new one.</div></div>
            )}
          </section>

          <aside className="ax-aside">
            <div className="ax-sticky ax-panel white">
              <div className="ax-panel-title">Filter pills</div>
              <p className="ax-panel-sub" style={{ marginBottom: 18 }}>What members see under the search on Groups and Ministries.</p>
              <div className="ax-chips">
                <span className="ax-chip on">All</span>
                {pills.map((p) => <span key={p} className="ax-chip">{p}</span>)}
              </div>
              <p className="ax-hint" style={{ marginTop: 18 }}>
                {pills.length
                  ? 'Each kind in use becomes a pill. The calendar ties add Men, Women, Kids and Youth when those have events.'
                  : 'A kind pill appears once two different kinds are in use — one kind on every group is the same as “All”.'}
              </p>
            </div>
          </aside>
        </div>
      ) : (
        <div className="ax-split">
          <section>
            <div className="ax-panel tight">
              <div className="ax-list-head" style={{ padding: '6px 8px 0' }}>
                <span className="ax-list-count">{pl.length} card{pl.length === 1 ? '' : 's'} · {livePosts} showing</span>
              </div>
              <RowList rows={pl} picked={pickedPost} onPick={setPickedPost} onMove={(k) => reorder('post', k)}
                empty={<div className="ax-empty"><strong>No cards</strong>Add one and it appears under the filters on Groups and Ministries.</div>}
                renderRow={(r) => {
                  const f = postForm(r);
                  const state = r._saved === null ? 'Not saved yet' : (f.published && liveLabel(r) !== 'Live' ? liveLabel(r) : '');
                  return (
                    <>
                      <span className="ax-row-main">
                        <span className={`ax-row-title${f.title.trim() ? '' : ' muted'}`}>{f.title.trim() || 'New card'}</span>
                        <span className="ax-row-sub">
                          {r._error ? <span className="ax-row-flag">Not saved</span>
                            : [groupName(f.group_id) || 'Everyone', state].filter(Boolean).join(' · ')}
                        </span>
                      </span>
                      <Toggle small checked={f.published} onChange={(on) => setLive('post', r._key, on)}
                        title={f.published ? 'Showing — switch off to hide it' : 'Hidden — switch on to show it'} />
                    </>
                  );
                }} />
            </div>
            <p className="ax-hint" style={{ margin: '14px 8px 0' }}>Drag to change the order members swipe through.</p>
          </section>

          <section>
            {curPost ? (
              <PostEditor key={curPost._key} row={curPost} rows={posts} persist={persistPost}
                groups={gl.filter((g) => g.id)} isNew={curPost._saved === null}
                onLive={(on) => setLive('post', curPost._key, on)} onDelete={() => removePost(curPost._key)} />
            ) : (
              <div className="ax-panel"><div className="ax-empty"><strong>Pick a card to change it</strong>or write a new one.</div></div>
            )}
          </section>

          <aside className="ax-aside">
            <div className="ax-sticky ax-phone-wrap">
              <div className="ax-phone">
                <div className="ax-phone-title">Groups and Ministries</div>
                {curPost ? <GroupCard post={postForm(curPost)} group={groupName(postForm(curPost).group_id)} />
                  : <div className="ax-phone-none">Pick a card to see it here</div>}
              </div>
              <p className="ax-phone-cap">The card as members see it — on this page and in the Bulletin’s Group Events.</p>
            </div>
          </aside>
        </div>
      )}
      {toast}
    </AppShell>
  );
}

/* ── a group ── */

function GroupEditor({ row, rows, persist, kinds, cards, isNew, onLive, onDelete, onAddCard }) {
  const key = row._key;
  const f = groupForm(row);
  const set = (k, v) => rows.patch(key, { [k]: v });
  const setLeaders = (fn) => rows.patch(key, (r) => ({ leaders: fn(groupForm(r).leaders) }));
  const problems = groupProblems(f);
  const ready = problems.length === 0;
  const auto = useAutosave({ value: f, savedJson: row._saved, ready, save: () => persist(key) });

  return (
    <div className="ax-panel">
      <div className="ax-editor-head">
        <SaveState auto={auto} waiting={`Not saved — ${problems[0] || 'give the group a name'}`} />
        <Toggle checked={f.published} onChange={onLive} label="In the app"
          sub={f.published ? 'Members see it now' : 'Hidden — only you see it'} />
      </div>
      <div className="ax-form">
        <Field label="Name">
          <input className="ax-input title" value={f.name} maxLength={80} autoFocus={isNew} placeholder="The group’s name"
            onChange={(e) => set('name', e.target.value)} />
        </Field>
        <Field label="Kind" hint="The kind becomes a filter pill in the app. Pick one or type your own.">
          <div className="ax-chips">
            {kinds.map((k) => (
              <button key={k} type="button" className={`ax-chip${f.kind === k ? ' on' : ''}`}
                onClick={() => set('kind', f.kind === k ? '' : k)}>{k}</button>
            ))}
          </div>
          <input className="ax-input" value={f.kind} maxLength={40} placeholder="Or type a kind"
            onChange={(e) => set('kind', e.target.value)} />
        </Field>
        <Field label="About" count={f.about.length} max={1000}>
          <GrowText value={f.about} maxLength={1000} placeholder="What this group is, in your own words."
            onChange={(e) => set('about', e.target.value)} />
        </Field>
        <div className="ax-row2">
          <Field label="When it meets">
            <input className="ax-input" value={f.meets} maxLength={120} placeholder="Sundays at 9:45 AM"
              onChange={(e) => set('meets', e.target.value)} />
          </Field>
          <Field label="Where">
            <input className="ax-input" value={f.location} maxLength={120} placeholder="The room"
              onChange={(e) => set('location', e.target.value)} />
          </Field>
        </div>
        <Field label="Who it’s for">
          <input className="ax-input" value={f.audience} maxLength={80} placeholder="Anyone welcome"
            onChange={(e) => set('audience', e.target.value)} />
        </Field>
        <Field label="Tied to the calendar"
          hint="How the app counts what this group has coming up. Leave it off for a group with nothing on the calendar.">
          <Seg label="Tied to the calendar" value={f.filter_key} onChange={(k) => set('filter_key', k)}
            options={FILTER_KEYS.map((k) => ({ key: k.key, label: k.key ? k.label : 'Not tied' }))} />
        </Field>
        <Field label="Leaders" hint="Real names only — members see these.">
          <div className="ax-rows">
            {f.leaders.map((p, i) => (
              <div key={i} className="ax-subrow">
                <input className="ax-input" value={p.name} placeholder="Name" aria-label={`Leader ${i + 1} name`}
                  onChange={(e) => setLeaders((ls) => ls.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
                <input className="ax-input" value={p.role} placeholder="Role (optional)" aria-label={`Leader ${i + 1} role`}
                  onChange={(e) => setLeaders((ls) => ls.map((x, j) => (j === i ? { ...x, role: e.target.value } : x)))} />
                <button type="button" className="ax-iconbtn danger" title="Remove this leader"
                  onClick={() => setLeaders((ls) => ls.filter((_, j) => j !== i))}><Icon d={P.close} size={18} /></button>
              </div>
            ))}
            <button type="button" className="ax-btn sm" style={{ alignSelf: 'flex-start' }}
              onClick={() => setLeaders((ls) => [...ls, { name: '', role: '' }])}>
              <Icon d={P.plus} size={15} />Add a leader
            </button>
          </div>
        </Field>
      </div>
      <div className="ax-editor-foot">
        <button type="button" className="ax-btn sm" onClick={onAddCard} disabled={!row.id}>
          <Icon d={P.plus} size={15} />{cards ? `Write a card for it (${cards} so far)` : 'Write a card for it'}
        </button>
        <button type="button" className="ax-btn danger" onClick={onDelete}><Icon d={P.trash} size={16} />Delete group</button>
      </div>
    </div>
  );
}

/* ── a card ── */

function PostEditor({ row, rows, persist, groups, isNew, onLive, onDelete }) {
  const key = row._key;
  const f = postForm(row);
  const set = (k, v) => rows.patch(key, { [k]: v });
  const problems = postProblems(f);
  const ready = problems.length === 0;
  const auto = useAutosave({ value: f, savedJson: row._saved, ready, save: () => persist(key) });
  const state = liveLabel({ ...row, published: f.published });

  return (
    <div className="ax-panel">
      <div className="ax-editor-head">
        <SaveState auto={auto} waiting={`Not saved — ${problems[0] || 'give the card a title'}`} />
        <Toggle checked={f.published} onChange={onLive} label="Showing"
          sub={f.published ? (state === 'Live' ? 'Members see it now' : state) : 'A draft — only you see it'} />
      </div>
      <div className="ax-form">
        <Field label="Title" count={f.title.length} max={80}>
          <input className="ax-input title" value={f.title} maxLength={80} autoFocus={isNew} placeholder="What’s happening"
            onChange={(e) => set('title', e.target.value)} />
        </Field>
        <Field label="Who it’s for" hint="A card for everyone shows whatever a member has filtered to.">
          <select className="ax-select" value={f.group_id} onChange={(e) => set('group_id', e.target.value)}>
            <option value="">Everyone</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>{g.name}{g.published === false ? ' (hidden group)' : ''}</option>
            ))}
          </select>
        </Field>
        <Field label="Message" count={f.body.length} max={600}>
          <GrowText value={f.body} maxLength={600} placeholder="Anything you want to say to this group."
            onChange={(e) => set('body', e.target.value)} />
        </Field>
        <Field label="Button" hint="Optional. Fill in both, or leave both empty. The link has to start with https://.">
          <div className="ax-subrow">
            <input className="ax-input" value={f.button_label} maxLength={30} placeholder="Label, like Sign up"
              aria-label="Button label" onChange={(e) => set('button_label', e.target.value)} />
            <input className="ax-input" value={f.button_url} inputMode="url" placeholder="https://"
              aria-label="Button link" onChange={(e) => set('button_url', e.target.value)} />
          </div>
        </Field>
        <Field label="When it shows" hint="Leave both empty to keep it up until you switch it off.">
          <div className="ax-row2">
            <input className="ax-input" type="date" value={f.starts_on} aria-label="Show from"
              onChange={(e) => set('starts_on', e.target.value)} />
            <input className="ax-input" type="date" value={f.ends_on} aria-label="Show until"
              onChange={(e) => set('ends_on', e.target.value)} />
          </div>
        </Field>
      </div>
      <div className="ax-editor-foot">
        <span className="ax-hint">{f.published ? 'Changes reach phones as you make them.' : 'Switch it on to show it.'}</span>
        <button type="button" className="ax-btn danger" onClick={onDelete}><Icon d={P.trash} size={16} />Delete card</button>
      </div>
    </div>
  );
}

/** The card as the member sees it, in the app's own shape and colours (BethesdaApp screens/GroupsScreen.js). */
function GroupCard({ post, group }) {
  const label = post.button_label.trim();
  const url = post.button_url.trim();
  const body = post.body.trim();
  return (
    <div className="ax-gcard">
      {group ? <span className="ax-gcard-tag">{group}</span> : null}
      <div className="ax-gcard-title">{post.title.trim() || 'Title'}</div>
      {body ? <div className="ax-gcard-body">{body.length > 170 ? `${body.slice(0, 170)}…` : body}</div> : null}
      {label && url ? <span className="ax-gcard-btn">{label} ↗</span> : null}
    </div>
  );
}
