import { useState } from 'react';
import { P, Icon } from '../../lib/icons';

/*
 * The shareable RSVP link, once it exists. Used in two places — under the
 * Broadcast composer and in the dialog the Responses tab opens — so the link,
 * the copy button and what "copied" looks like stay the same in both.
 */
export default function RsvpLink({ url }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      /* Clipboard blocked (an insecure origin, or a browser that refuses).
         The field is selectable, so there is still a way to take the link. */
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2200);
  }

  return (
    <div className="rsvp-link">
      <input
        className="rsvp-link-url"
        readOnly
        value={url}
        onFocus={e => e.target.select()}
        aria-label="Reservation link"
      />
      <button type="button" className={`rsvp-link-copy ${copied ? 'done' : ''}`} onClick={copy}>
        <Icon d={copied ? P.check : P.link} size={15} />
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  );
}

/*
 * What is being served. One field to start, a green plus for another — the
 * same editor under the composer and in the Responses dialog, so a menu typed
 * in either place looks and behaves identically.
 */
export function MenuEditor({ items, onChange }) {
  const set = (i, v) => onChange(items.map((x, j) => (j === i ? v : x)));
  const add = () => onChange([...items, '']);
  const drop = i => onChange(items.length === 1 ? [''] : items.filter((_, j) => j !== i));

  return (
    <div className="sms-menu">
      <span className="sms-menu-lbl">Menu</span>
      {items.map((item, i) => (
        <div className="sms-menu-row" key={i}>
          <input
            value={item}
            onChange={e => set(i, e.target.value)}
            placeholder={i === 0 ? 'Baked spaghetti' : 'Another item'}
          />
          {i === items.length - 1
            ? <button type="button" className="sms-menu-add" onClick={add} title="Add another item">
                <Icon d={P.plus} size={17} />
              </button>
            : <button type="button" className="sms-menu-del" onClick={() => drop(i)} title="Remove">
                <Icon d={P.close} size={15} />
              </button>}
        </div>
      ))}
    </div>
  );
}
