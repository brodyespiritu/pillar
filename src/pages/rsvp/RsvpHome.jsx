import { useEffect, useState } from 'react';
import { P, Icon } from '../../lib/icons';
import RsvpPage from './RsvpPage';
import PublicForm from './PublicForm';
import './rsvp.css';

/*
 * bethesda.rsvp — the front door.
 *
 * Whatever is open to sign up for: the Wednesday dinner while it is taking
 * reservations, and every open form built on the RSVP page in Pillar. One thing
 * open fills the screen, the way the dinner form always has. Two or more show as
 * boxes, and choosing one opens it full screen with a way back.
 *
 * If the list cannot be read at all, the page falls back to the dinner form —
 * the one thing this address has always been — rather than an error.
 */

const ENDPOINT = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/rsvp-forms`;

export default function RsvpHome() {
  const [state, setState] = useState({ loading: true, failed: false, forms: [], dinner: null });
  const [picked, setPicked] = useState(null);     // 'dinner' or a form slug

  useEffect(() => {
    let live = true;
    fetch(ENDPOINT)
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then(d => {
        if (!live) return;
        setState({ loading: false, failed: false, forms: Array.isArray(d?.forms) ? d.forms : [], dinner: d?.dinner?.open ? d.dinner : null });
      })
      .catch(() => { if (live) setState({ loading: false, failed: true, forms: [], dinner: null }); });
    return () => { live = false; };
  }, []);

  if (state.loading) {
    return <div className="rsvp-wrap"><div className="rsvp-card rsvp-loading" aria-busy="true" aria-label="Loading" /></div>;
  }
  if (state.failed) return <RsvpPage />;

  const entries = [
    ...(state.dinner ? [{ id: 'dinner', title: 'Wednesday night dinner', desc: 'Reserve your plate', go: 'Reserve' }] : []),
    ...state.forms.map(f => ({ id: f.slug, title: f.title, desc: f.description, go: 'Register', form: f })),
  ];

  const back = entries.length > 1 ? () => setPicked(null) : undefined;
  const open = picked ? entries.find(e => e.id === picked) : entries.length === 1 ? entries[0] : null;
  if (open) {
    return open.id === 'dinner' ? <RsvpPage onBack={back} /> : <PublicForm form={open.form} onBack={back} />;
  }

  if (!entries.length) {
    return (
      <div className="rsvp-wrap">
        <main className="rsvp-card">
          <h1 className="rsvp-title">Nothing to sign up for right now</h1>
          <p className="rsvp-sub">Bethesda Baptist Church. Check back soon.</p>
        </main>
      </div>
    );
  }

  return (
    <div className="rsvp-wrap">
      <main className={`rsvp-choose ${entries.length === 3 ? 'wide' : ''}`}>
        <h1 className="rsvp-title">Sign up at Bethesda</h1>
        <p className="rsvp-sub">Choose what you'd like to register for.</p>
        <div className={`rsvp-choices count-${Math.min(entries.length, 5)}`}>
          {entries.map(e => (
            <button key={e.id} type="button" className="rsvp-choice" onClick={() => { setPicked(e.id); window.scrollTo(0, 0); }}>
              <span className="rsvp-choice-title">{e.title}</span>
              {e.desc && <span className="rsvp-choice-desc">{e.desc}</span>}
              <span className="rsvp-choice-go">{e.go}<Icon d={P.arrowRight} size={20} /></span>
            </button>
          ))}
        </div>
      </main>
    </div>
  );
}
