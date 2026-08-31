import { useMemo } from 'react';
import { P, Icon } from '../../lib/icons';
import { groupCampaigns } from '../../lib/campaigns';
import { normPhone, formatPhone } from '../../lib/conversations';

/*
 * What sits under the composer: the last few replies, the library as folders,
 * and the groups. Each is a summary — the full view is a tab away, and every
 * heading is the way there.
 */

const when = iso => (iso ? new Date(iso).toLocaleString('en-US',
  { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '');

const fmtDay = iso => (iso ? new Date(iso).toLocaleDateString('en-US',
  { month: 'short', day: 'numeric' }) : 'never sent');

function Section({ title, count, action, onAction, children }) {
  return (
    <section className="ov-section">
      <div className="ov-head">
        <h2>{title}{count != null && <span className="ov-count">{count}</span>}</h2>
        {action && <button className="ov-more" onClick={onAction}>{action}<Icon d={P.arrowRight} size={15} /></button>}
      </div>
      {children}
    </section>
  );
}

export default function SmsOverview({ threads, library, scheduled, groups, members, contacts, onOpen }) {
  const nameFor = useMemo(() => {
    const byPhone = new Map((contacts || []).map(c => [normPhone(c.phone), c.name]));
    return t => byPhone.get(t.key) || t.name || formatPhone(t.number);
  }, [contacts]);

  const recent = useMemo(
    () => groupCampaigns(threads?.rows || [], library?.rows || [], nameFor).slice(0, 3),
    [threads, library, nameFor]);

  /*
   * The library as folders, one per kind of message. Grouping on the type the
   * library already records means these are real piles of messages rather than
   * labels somebody has to keep tidy.
   */
  const folders = useMemo(() => {
    const map = new Map();
    for (const row of library?.rows || []) {
      const key = row.message_type || 'General';
      if (!map.has(key)) map.set(key, { key, rows: [] });
      map.get(key).rows.push(row);
    }
    return [...map.values()].map(f => ({
      ...f,
      last: f.rows.reduce((a, r) => (a > (r.last_sent_at || '') ? a : (r.last_sent_at || '')), ''),
    })).sort((a, b) => (b.last || '').localeCompare(a.last || ''));
  }, [library]);

  const upcoming = (scheduled?.rows || []).filter(r => r.status === 'pending');

  return (
    <div className="sms-overview">
      <Section title="Responses" count={recent.length ? undefined : 0}
        action="View all" onAction={() => onOpen('responses')}>
        {recent.length === 0 ? (
          <p className="ov-empty">Replies to your texts appear here.</p>
        ) : (
          <div className="ov-list">
            {recent.map(c => (
              <button key={c.key} className="ov-row" onClick={() => onOpen('responses')}>
                <span className="ov-row-main">
                  <span className="ov-row-title">
                    {c.unread > 0 && <span className="ov-dot" />}{c.key}
                  </span>
                  <span className="ov-row-sub">
                    {c.replies.length} {c.replies.length === 1 ? 'reply' : 'replies'} · {when(c.lastAt)}
                  </span>
                </span>
                {c.showTally && (
                  <span className="ov-tally">{c.tally.total}<em>coming</em></span>
                )}
              </button>
            ))}
          </div>
        )}
      </Section>

      <Section title="Library" count={library?.rows?.length || 0}
        action="Open" onAction={() => onOpen('library')}>
        {folders.length === 0 ? (
          <p className="ov-empty">Messages you save appear here.</p>
        ) : (
          <div className="ov-folders">
            {folders.map(f => (
              <button key={f.key} className="ov-folder" onClick={() => onOpen('library')}>
                <Icon d={P.folder} size={54} />
                <span className="ov-folder-name">{f.key}</span>
                <span className="ov-folder-n">{f.rows.length} {f.rows.length === 1 ? 'Item' : 'Items'}</span>
              </button>
            ))}
            {upcoming.length > 0 && (
              <button className="ov-folder scheduled" onClick={() => onOpen('library')}>
                <Icon d={P.folder} size={54} />
                <span className="ov-folder-name">Scheduled</span>
                <span className="ov-folder-n">
                  {upcoming.length} {upcoming.length === 1 ? 'Item' : 'Items'}
                </span>
              </button>
            )}
          </div>
        )}
      </Section>

      <Section title="Groups" count={groups?.length || 0}
        action="Manage" onAction={() => onOpen('groups')}>
        {(groups || []).length === 0 ? (
          <p className="ov-empty">Groups let you text part of the congregation.</p>
        ) : (
          <div className="ov-list">
            {groups.map(g => {
              const n = (members || []).filter(m => m.group_id === g.id).length;
              return (
                <button key={g.id} className="ov-row" onClick={() => onOpen('groups')}>
                  <span className="ov-row-main">
                    <span className="ov-row-title">{g.name}</span>
                    <span className="ov-row-sub">{n} {n === 1 ? 'person' : 'people'}</span>
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </Section>
    </div>
  );
}
