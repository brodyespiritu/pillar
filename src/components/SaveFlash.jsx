import { useState, useEffect, useRef } from 'react';
import { _registerFlash } from '../lib/flash';
import './SaveFlash.css';

/*
 * Mounted once, near the root, and driven by flashSaved() from anywhere.
 *
 * It sits behind the top bar on purpose: the point is a change at the edge of
 * vision, not a banner to read and dismiss. Anything that demands attention
 * belongs in a dialog instead.
 */

const HOLD = 1100;   // ms the wash stays before it starts leaving

export default function SaveFlash() {
  const [flash, setFlash] = useState(null);   // { id, label } | null
  const timer = useRef(null);

  useEffect(() => {
    _registerFlash(label => {
      /* A fresh id restarts the animation even when one is already running, so
         two saves in quick succession read as two, not one that got stuck. */
      setFlash({ id: Date.now(), label });
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setFlash(null), HOLD);
    });
    return () => { _registerFlash(null); clearTimeout(timer.current); };
  }, []);

  if (!flash) return null;

  return (
    <div
      key={flash.id}
      className="sf-wash"
      /* Announced to a screen reader, which cannot see a gradient. The label is
         off-screen rather than absent — the visual is deliberately wordless. */
      role="status"
      aria-live="polite"
    >
      <span className="sf-label">{flash.label}</span>
    </div>
  );
}
