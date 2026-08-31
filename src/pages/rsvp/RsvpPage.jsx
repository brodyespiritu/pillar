import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { P, Icon } from '../../lib/icons';
import './rsvp.css';

/*
 * The page behind the link the church posts to Facebook.
 *
 * Public — no sign-in. It is a form, not a text: hitting Send Reservation posts
 * the name and plate count to the dinner-rsvp function, which writes it onto
 * the same dinner list a texted reservation lands on. Nothing is read from the
 * database here, and the only write goes through that function under validation
 * — anonymous clients never touch the message table directly.
 *
 * Built for a congregation that skews older: two fields, one button, type large
 * enough to read without glasses, and the plate count opens the number pad
 * rather than a full keyboard.
 */

const ENDPOINT = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/dinner-rsvp`;

export default function RsvpPage() {
  /* /rsvp/<token> names the dinner; bare /rsvp takes whichever is collecting. */
  const { token } = useParams();
  const [name, setName] = useState('');
  const [plates, setPlates] = useState('');
  const [menu, setMenu] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(null);

  /* What is being served, if whoever made the link said. */
  useEffect(() => {
    let live = true;
    fetch(`${ENDPOINT}?token=${encodeURIComponent(token || '')}`)
      .then(r => r.json())
      .then(d => { if (live && Array.isArray(d?.menu)) setMenu(d.menu); })
      .catch(() => { /* no menu is not an error — the form still works */ });
    return () => { live = false; };
  }, [token]);

  const tidyName = name.replace(/\s+/g, ' ').trim();
  const ready = tidyName.length >= 2 && Number(plates) >= 1;

  async function submit(e) {
    e.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    setError('');
    try {
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: tidyName, plates: Number(plates), token }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Something went wrong. Please try again.');
      setDone(data);
    } catch (err) {
      setError(err.message || 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="rsvp-wrap">
        <main className="rsvp-card rsvp-done">
          <div className="rsvp-tick"><Icon d={P.check} size={34} /></div>
          <h1 className="rsvp-title">Reservation received</h1>
          <p className="rsvp-sub">
            Thank you, {done.name}. We have you down for{' '}
            <strong>{done.plates} {done.plates === 1 ? 'plate' : 'plates'}</strong> on
            Wednesday night.
          </p>
          <button className="rsvp-again" onClick={() => { setDone(null); setPlates(''); }}>
            Change my reservation
          </button>
        </main>
      </div>
    );
  }

  return (
    <div className="rsvp-wrap">
      <form className="rsvp-card" onSubmit={submit}>
        <h1 className="rsvp-title">Reserve your plate</h1>
        <p className="rsvp-sub">Wednesday night dinner at Bethesda Baptist Church</p>

        {menu.length > 0 && (
          <div className="rsvp-menu">
            <p className="rsvp-menu-head">Menu</p>
            <ul className="rsvp-menu-list">
              {menu.map((item, i) => <li key={i}>{item}</li>)}
            </ul>
          </div>
        )}

        <label className="rsvp-field">
          <span className="rsvp-label">Your name</span>
          <input
            className="rsvp-input"
            value={name}
            onChange={e => setName(e.target.value)}
            autoComplete="name"
            autoCapitalize="words"
            enterKeyHint="next"
            placeholder="Jane Smith"
          />
        </label>

        <label className="rsvp-field">
          <span className="rsvp-label">How many plates</span>
          {/* type=tel with a numeric inputMode is what reliably opens the number
              pad on both iPhone and Android; type=number adds spinners and
              scroll-to-change, which are a nuisance on a phone. */}
          <input
            className="rsvp-input"
            value={plates}
            onChange={e => setPlates(e.target.value.replace(/\D/g, '').slice(0, 2))}
            type="tel"
            inputMode="numeric"
            pattern="[0-9]*"
            enterKeyHint="done"
            placeholder="2"
          />
        </label>

        {error && <p className="rsvp-error">{error}</p>}

        <button className="rsvp-go" type="submit" disabled={!ready || busy}>
          {busy ? 'Sending…' : 'Send Reservation'}
        </button>
      </form>
    </div>
  );
}
