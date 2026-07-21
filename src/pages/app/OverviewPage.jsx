import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import AppShell from './AppShell';
import { P, Icon } from '../../lib/icons';
import { getLivestream, getSermons, getEvents, getAnnouncements, getPushCount, hasAppApiAuth, APP_API_BASE } from '../../lib/appApi';

export default function OverviewPage() {
  const navigate = useNavigate();
  const [state, setState] = useState({ loading: true, error: '', data: null });

  const load = useCallback(async () => {
    setState(s => ({ ...s, loading: true, error: '' }));
    try {
      const [live, sermons, events, announcements, push] = await Promise.all([
        getLivestream(), getSermons(), getEvents(), getAnnouncements(), getPushCount(),
      ]);
      setState({
        loading: false, error: '',
        data: {
          isLive: !!live?.isLive, liveTitle: live?.liveTitle || '',
          sermons: Array.isArray(sermons) ? sermons.length : 0,
          events: Array.isArray(events) ? events.length : 0,
          announcements: Array.isArray(announcements) ? announcements.length : 0,
          devices: push?.count ?? 0,
        },
      });
    } catch (e) {
      setState({ loading: false, error: e.message || 'Could not reach the app server.', data: null });
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const d = state.data;

  return (
    <AppShell
      title="Overview"
      subtitle="Live status and content across the Bethesda mobile app."
      actions={<button className="ap-btn" onClick={load} disabled={state.loading}><Icon d={P.repeat} size={15} />Refresh</button>}
    >
      {!hasAppApiAuth() && (
        <div className="ap-banner warn">
          <Icon d={P.lock} size={16} />
          Reading is enabled, but the server requires a key to save changes. Set it in <strong>App Settings → App API access</strong> before editing, then edits publish to the live app within seconds.
          <button className="ap-btn" style={{ marginLeft: 'auto' }} onClick={() => navigate('/app/settings')}>Set key</button>
        </div>
      )}

      {state.loading ? (
        <div className="ap-loading"><span className="ap-spinner" />Reaching the app server… (first load can take up to a minute)</div>
      ) : state.error ? (
        <div className="ap-banner error"><Icon d={P.close} size={16} />{state.error} <button className="ap-btn" style={{ marginLeft: 'auto' }} onClick={load}>Retry</button></div>
      ) : (
        <>
          <div className="ap-grid">
            <div className="ap-stat">
              <div className="ap-stat-top">
                <span className="ap-stat-ic" style={d.isLive ? { color: '#E5484D', background: '#FDECEC' } : undefined}><Icon d={P.radio} size={20} /></span>
                <span className={`ap-dot ${d.isLive ? 'live' : 'off'}`} />
              </div>
              <div className="ap-stat-n">{d.isLive ? 'LIVE' : 'Off'}</div>
              <div className="ap-stat-l">{d.isLive ? (d.liveTitle || 'Streaming now') : 'Not streaming'}</div>
            </div>
            <Stat icon={P.book} n={d.sermons} label="Sermons" />
            <Stat icon={P.announce} n={d.announcements} label="Announcements" />
            <Stat icon={P.calendar} n={d.events} label="Events" />
          </div>

          <div className="ap-grid" style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}>
            <Stat icon={P.chat} n={d.devices} label="Registered devices" />
            <div className="ap-stat">
              <div className="ap-stat-top">
                <span className="ap-stat-ic" style={{ color: 'var(--green)', background: 'var(--green-soft)' }}><Icon d={P.check} size={20} /></span>
                <span className="ap-dot ok" />
              </div>
              <div className="ap-stat-n" style={{ fontSize: 20 }}>Reachable</div>
              <div className="ap-stat-l">{APP_API_BASE.replace('https://', '')}</div>
            </div>
          </div>

          <h3 className="ap-section-title" style={{ marginTop: 12 }}>Quick actions</h3>
          <div className="ap-quick">
            <button className="ap-btn primary" onClick={() => navigate('/app/live')}><Icon d={P.radio} size={15} />Go Live</button>
            <button className="ap-btn" onClick={() => navigate('/app/notifications')}><Icon d={P.chat} size={15} />Send Notification</button>
            <button className="ap-btn" onClick={() => navigate('/app/sermons')}><Icon d={P.plus} size={15} />Add Sermon</button>
          </div>
        </>
      )}
    </AppShell>
  );
}

function Stat({ icon, n, label }) {
  return (
    <div className="ap-stat">
      <div className="ap-stat-top"><span className="ap-stat-ic"><Icon d={icon} size={20} /></span></div>
      <div className="ap-stat-n">{n}</div>
      <div className="ap-stat-l">{label}</div>
    </div>
  );
}
