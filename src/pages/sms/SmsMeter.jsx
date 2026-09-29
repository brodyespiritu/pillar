import { useLayoutEffect, useRef } from 'react';
import { money } from '../../lib/smsMeter';
import './SmsMeter.css';

/*
 * The message box, marked the way a carrier will split the text (smsMeter.js):
 * a green bracket where each full segment ends, orange past the two-segment
 * line, yellow on a character that forces the costlier alphabet.
 *
 * The marks sit on a backdrop that lays the text out exactly as the textarea on
 * top of it does; the textarea's own letters are transparent and its caret
 * visible, so typing, selecting and pasting all behave as in a plain box. Both
 * layers take the caller's class (`sms-body`, `sm-input`), which is what keeps
 * their font, padding and wrapping identical.
 */
export function SmsMeterBox({ meter, value, onChange, className, rows, disabled, placeholder, ariaLabel }) {
  const ta = useRef(null);
  const bg = useRef(null);
  const sync = () => { if (bg.current && ta.current) bg.current.scrollTop = ta.current.scrollTop; };
  useLayoutEffect(sync, [value]);

  return (
    <>
      <div className={`${className} smh-bg`} ref={bg} aria-hidden="true">
        {meter.runs.map((r, i) => (
          <span key={i} className={r.cls === 'plain' ? undefined : `smh-${r.cls}`}>
            {r.text}
            {r.segEnd && <span className="smh-seg-end" />}
          </span>
        ))}
        {/* A trailing newline in the box needs a line of its own here too. */}
        {'\n'}
      </div>
      <textarea
        ref={ta}
        className={`${className} smh-ta`}
        rows={rows}
        value={value}
        onChange={e => onChange(e.target.value)}
        onScroll={sync}
        disabled={disabled}
        placeholder={placeholder}
        aria-label={ariaLabel}
      />
    </>
  );
}

/* What sending this will cost, and the cheapest way to make it cost less. */
export function SmsCostLine({ meter, people, compact = false }) {
  if (!meter.segments || !people) return null;
  const s = n => (n === 1 ? '' : 's');
  const over = meter.overBy > 0;
  const trimSaves = over ? (meter.segments - 2) * meter.nextCost : 0;
  const next = meter.segments === 1 ? 'before this becomes 2 segments' : `left in segment ${meter.segments}`;

  return (
    <div className={`smc ${compact ? 'compact' : ''}`} aria-live="polite">
      <p className="smc-main">
        <b>{money(meter.cost)}</b> to send
        <span className="smc-sep"> · </span>
        {meter.segments} segment{s(meter.segments)} × {people.toLocaleString('en-US')} {people === 1 ? 'person' : 'people'}
        {!compact && (
          <>
            <span className="smc-sep"> · </span>
            {meter.left} character{s(meter.left)} {next}
            {meter.segments === 1 || !over ? ` (next adds ${money(meter.nextCost)})` : ''}
          </>
        )}
      </p>
      {over && (
        <p className="smc-warn over">
          <span className="smc-swatch over" />
          {meter.overBy} character{s(meter.overBy)} past two segments. Trimming them saves {money(trimSaves)}.
        </p>
      )}
      {meter.costly.length > 0 && (
        <p className="smc-warn costly">
          <span className="smc-swatch costly" />
          {meter.costly.join(' ')} makes every segment hold 70 characters instead of 160. Without it: {money(meter.costIfPlain)}.
        </p>
      )}
      {meter.fixedCount > 0 && (
        <p className="smc-warn fixed">
          <span className="smc-swatch fixed" />
          {meter.fixed.join(' ')} {meter.fixedCount === 1 ? 'goes' : 'go'} out as plain punctuation
          {meter.typedSegments > meter.segments
            ? `, keeping this at ${money(meter.cost)} instead of ${money(meter.costAsTyped)}.`
            : ', at no extra cost.'}
        </p>
      )}
    </div>
  );
}
