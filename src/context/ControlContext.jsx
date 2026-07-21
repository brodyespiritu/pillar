import { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from './AuthContext';

/*
 * Consent-based live co-session ("Control"). An admin requests control of a
 * user; the user gets a "Give control to [admin]?" prompt. Once accepted, the
 * admin's cursor, clicks, and page navigation are mirrored to the user's screen
 * over a Supabase Realtime broadcast channel — the user watches what the admin
 * does in real time. This is co-viewing, not OS-level remote control.
 */
const ControlCtx = createContext({ requestControl: () => {} });
const chName = id => `ctrl:${id}`;

export function ControlProvider({ children }) {
  const { user, profile } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [incoming, setIncoming]         = useState(null); // target: pending request {fromId, fromName}
  const [controlledBy, setControlledBy] = useState(null); // target: active {id, name}
  const [controlling, setControlling]   = useState(null); // admin: active {id, name}
  const [requesting, setRequesting]     = useState(null); // admin: awaiting accept {id, name}
  const [ghost, setGhost]   = useState(null);             // target: controller cursor {x,y}
  const [ripples, setRipples] = useState([]);             // target: click ripples

  const ownRef  = useRef(null);   // this user's channel (as a target)
  const ctrlRef = useRef(null);   // channel to the target we're controlling (as admin)
  const lastMove = useRef(0);
  const reqTimer = useRef(null);

  const name = profile?.name || 'Someone';

  /* ── Subscribe to our own control channel (we might be a target) ── */
  useEffect(() => {
    if (!user?.id) return;
    const ch = supabase.channel(chName(user.id), { config: { broadcast: { self: false } } });
    ch.on('broadcast', { event: 'request' }, ({ payload }) => setIncoming(payload))
      .on('broadcast', { event: 'end' }, () => { setControlledBy(null); setGhost(null); })
      .on('broadcast', { event: 'sig' }, ({ payload }) => {
        if (payload.t === 'cursor') setGhost({ x: payload.x, y: payload.y });
        else if (payload.t === 'nav') navigate(payload.path);
        else if (payload.t === 'scroll') window.scrollTo({ top: payload.y });
        else if (payload.t === 'click') {
          const id = Math.random().toString(36).slice(2);
          setRipples(r => [...r, { id, x: payload.x, y: payload.y }]);
          setTimeout(() => setRipples(r => r.filter(x => x.id !== id)), 650);
          execRemoteClick(payload);   // actually perform the click here
        }
      })
      .subscribe();
    ownRef.current = ch;
    return () => { supabase.removeChannel(ch); ownRef.current = null; };
  }, [user?.id, navigate]);

  /* ── Admin: broadcast cursor, clicks (with element path), and scroll ── */
  useEffect(() => {
    if (!controlling) return;
    const send = payload => ctrlRef.current?.send({ type: 'broadcast', event: 'sig', payload });
    const onMove = e => {
      const now = Date.now();
      if (now - lastMove.current < 40) return;
      lastMove.current = now;
      send({ t: 'cursor', x: e.clientX / window.innerWidth, y: e.clientY / window.innerHeight });
    };
    const onClick = e => {
      // Never mirror clicks on the control UI itself (End button, banners, etc.)
      if (e.target.closest?.('.ctl-banner, .ctl-consent, .ctl-overlay, .ctl-ghost')) return;
      send({ t: 'click', path: cssPath(e.target), x: e.clientX / window.innerWidth, y: e.clientY / window.innerHeight });
    };
    let lastScroll = 0;
    const onScroll = () => {
      const now = Date.now();
      if (now - lastScroll < 60) return;
      lastScroll = now;
      send({ t: 'scroll', y: window.scrollY });
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('click', onClick, true);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('click', onClick, true);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [controlling]);

  /* ── Admin: mirror our navigation to the controlled user ── */
  useEffect(() => {
    if (controlling) ctrlRef.current?.send({ type: 'broadcast', event: 'sig', payload: { t: 'nav', path: location.pathname } });
  }, [location.pathname, controlling]);

  /* ── Admin action: request control of a user ── */
  const requestControl = useCallback((targetId, targetName) => {
    if (!user?.id || targetId === user.id) return;
    if (ctrlRef.current) { supabase.removeChannel(ctrlRef.current); ctrlRef.current = null; }
    clearTimeout(reqTimer.current);
    setRequesting({ id: targetId, name: targetName });

    const ch = supabase.channel(chName(targetId), { config: { broadcast: { self: false } } });
    ch.on('broadcast', { event: 'accept' }, () => {
        clearTimeout(reqTimer.current);
        setRequesting(null);
        setControlling({ id: targetId, name: targetName });
      })
      .on('broadcast', { event: 'decline' }, () => {
        clearTimeout(reqTimer.current); setRequesting(null); setControlling(null);
        supabase.removeChannel(ch); ctrlRef.current = null;
        toast(`${targetName} declined.`);
      })
      .on('broadcast', { event: 'end' }, () => setControlling(null))
      .subscribe(status => {
        if (status === 'SUBSCRIBED') {
          ch.send({ type: 'broadcast', event: 'request', payload: { fromId: user.id, fromName: name } });
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          setRequesting(null); toast('Could not reach realtime — check the connection.');
        }
      });
    ctrlRef.current = ch;
    reqTimer.current = setTimeout(() => {
      setRequesting(r => {
        if (r) { toast(`${targetName} didn't respond. Are they signed in on another device?`); }
        if (ctrlRef.current) { supabase.removeChannel(ctrlRef.current); ctrlRef.current = null; }
        return null;
      });
    }, 30000);
  }, [user?.id, name]);

  const cancelRequest = () => {
    clearTimeout(reqTimer.current);
    setRequesting(null);
    if (ctrlRef.current) { supabase.removeChannel(ctrlRef.current); ctrlRef.current = null; }
  };

  /* ── Target: accept / decline ── */
  const accept = () => {
    ownRef.current?.send({ type: 'broadcast', event: 'accept' });
    setControlledBy({ id: incoming.fromId, name: incoming.fromName });
    setIncoming(null);
  };
  const decline = () => { ownRef.current?.send({ type: 'broadcast', event: 'decline' }); setIncoming(null); };

  /* ── End (either side) ── */
  const endAsAdmin = () => {
    clearTimeout(reqTimer.current);
    ctrlRef.current?.send({ type: 'broadcast', event: 'end' });
    if (ctrlRef.current) supabase.removeChannel(ctrlRef.current);
    ctrlRef.current = null; setControlling(null); setRequesting(null);
  };
  const endAsTarget = () => {
    ownRef.current?.send({ type: 'broadcast', event: 'end' });
    setControlledBy(null); setGhost(null);
  };

  return (
    <ControlCtx.Provider value={{ requestControl }}>
      {children}

      {/* Target: consent prompt */}
      {incoming && (
        <div className="ctl-overlay">
          <div className="ctl-consent">
            <div className="ctl-consent-ic"><CursorIcon /></div>
            <h3>Give control to {incoming.fromName}?</h3>
            <p>{incoming.fromName} wants to view and guide your screen to help. You'll see their cursor and where they go. You can end it at any time.</p>
            <div className="ctl-consent-actions">
              <button className="btn-ghost" onClick={decline}>Not now</button>
              <button className="btn-primary" onClick={accept}>Give control</button>
            </div>
          </div>
        </div>
      )}

      {/* Target: ghost cursor + ripples + banner */}
      {controlledBy && (
        <>
          {ghost && (
            <div className="ctl-ghost" style={{ left: `${ghost.x * 100}vw`, top: `${ghost.y * 100}vh` }}>
              <CursorIcon />
              <span>{controlledBy.name}</span>
            </div>
          )}
          {ripples.map(r => <span key={r.id} className="ctl-ripple" style={{ left: `${r.x * 100}vw`, top: `${r.y * 100}vh` }} />)}
          <div className="ctl-banner target">
            <span className="ctl-dot" />{controlledBy.name} is guiding your screen
            <button onClick={endAsTarget}>End</button>
          </div>
        </>
      )}

      {/* Admin: awaiting acceptance */}
      {requesting && !controlling && (
        <div className="ctl-banner request">
          <span className="ctl-dot" />Waiting for {requesting.name} to accept on their device…
          <button onClick={cancelRequest}>Cancel</button>
        </div>
      )}

      {/* Admin: controlling banner */}
      {controlling && (
        <div className="ctl-banner admin">
          <span className="ctl-dot" />Controlling {controlling.name}'s screen
          <button onClick={endAsAdmin}>End</button>
        </div>
      )}
    </ControlCtx.Provider>
  );
}

/* Build a stable CSS path to an element (tag + nth-of-type chain from body). */
function cssPath(el) {
  if (!(el instanceof Element)) return null;
  const parts = [];
  let node = el;
  while (node && node.nodeType === 1 && node !== document.body && parts.length < 14) {
    let sel = node.tagName.toLowerCase();
    const parent = node.parentElement;
    if (parent) {
      const sibs = [...parent.children].filter(c => c.tagName === node.tagName);
      if (sibs.length > 1) sel += `:nth-of-type(${sibs.indexOf(node) + 1})`;
    }
    parts.unshift(sel);
    node = node.parentElement;
  }
  return parts.length ? 'body > ' + parts.join(' > ') : null;
}

/* Target: resolve the admin's click to a local element and perform it. */
function execRemoteClick(p) {
  let el = null;
  if (p.path) { try { el = document.querySelector(p.path); } catch { /* invalid path */ } }
  if (!el && typeof p.x === 'number') el = document.elementFromPoint(p.x * window.innerWidth, p.y * window.innerHeight);
  if (!el) return;
  if (el.closest('.ctl-ghost, .ctl-banner, .ctl-consent, .ctl-overlay')) return; // never touch control UI
  try {
    if (typeof el.focus === 'function') el.focus();
    el.click();
  } catch { /* ignore */ }
}

function CursorIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M5 3l14 7-6 2-2 6-6-15z" />
    </svg>
  );
}
function toast(msg) {
  const el = document.createElement('div');
  el.className = 'adm-toast';
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 300); }, 2200);
}

export const useControl = () => useContext(ControlCtx);
