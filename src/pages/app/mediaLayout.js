import { useEffect, useRef, useState } from 'react';
import { getMediaLayout, putMediaLayout } from '../../lib/appApi';
import { useSaveQueue } from './kit';

/* ── the app server's media layout: "Suggested for You" (the row under Featured) and which sermon is
   the big card at the top of Media (user, 2026-09-21: "make sure I can choose what sermon is the main
   big card via a toggle"). With none chosen the app shows the newest sermon there. ── */

export function useMediaLayout() {
  const [layout, setLayout] = useState(null);
  const [error, setError] = useState('');
  const queue = useSaveQueue();
  const latest = useRef(null);
  latest.current = layout;

  useEffect(() => {
    getMediaLayout().then((l) => setLayout(l || {})).catch((e) => { setLayout({}); setError(e.message); });
  }, []);

  // One change at a time, each on top of the newest layout: the server keeps whatever is sent, so a
  // save built on an older copy would quietly undo the switch before it.
  const change = (edit) => queue('layout', async () => {
    const before = latest.current || {};
    const next = { ...before, ...edit(before) };
    latest.current = next;
    setLayout(next);
    try { await putMediaLayout(next); }
    catch (e) { setError(e.message); latest.current = before; setLayout(before); }
  });

  const ids = Array.isArray(layout?.suggestedIds) ? layout.suggestedIds : [];
  const has = (id) => ids.includes(String(id));
  const toggle = (id, on) => change((l) => {
    const key = String(id);
    const cur = (Array.isArray(l.suggestedIds) ? l.suggestedIds : []).filter((x) => x !== key);
    return { suggestedIds: on ? [...cur, key] : cur };
  });

  const bigCard = layout?.featuredSermonId != null && layout.featuredSermonId !== '' ? String(layout.featuredSermonId) : null;
  const isBig = (id) => bigCard !== null && bigCard === String(id);
  // on: this one, in place of any other; off: back to the newest
  const setBig = (id, on) => change((l) => ({
    featuredSermonId: on ? String(id) : (String(l.featuredSermonId ?? '') === String(id) ? null : (l.featuredSermonId ?? null)),
  }));

  // The app's resource order (redesign, 2026-09-23). The member app shows ONLY the resources listed
  // here, in this order, whenever the list isn't empty (BethesdaApp screens/SermonsScreen.js
  // resourcesOrdered) — and Pillar has had no editor for it since the old Media page went, so a
  // resource added since then can be invisible on phones. The Resources editor says so and offers
  // this: put that one resource at the end of the order. It never starts an order that isn't there
  // (an empty order already shows everything).
  const resourcesOrder = Array.isArray(layout?.resourcesOrder) ? layout.resourcesOrder.map(String) : [];
  const includeResource = (id) => change((l) => {
    const cur = Array.isArray(l.resourcesOrder) ? l.resourcesOrder.map(String) : [];
    const key = String(id);
    return cur.length && !cur.includes(key) ? { resourcesOrder: [...cur, key] } : {};
  });

  // `ids` (the Suggested order) and `resourcesOrder` are read by the Watch phone preview, so it draws
  // those rows exactly as the app does
  return {
    ready: layout !== null, has, toggle, isBig, setBig, bigCard, error, setError, count: ids.length,
    ids, resourcesOrder, includeResource,
  };
}
