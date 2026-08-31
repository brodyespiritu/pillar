import { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { initials as initialsOf } from '../../lib/members';
import { tapSelect, tapSaved, tapFailed } from '../../lib/haptics';
import './PINPage.css';

/*
 * The PIN screen.
 *
 * A sheet from the bottom, like everything else on the phone, with the lock as
 * the whole of the identity — no card heading, no instruction line. A keypad
 * under a padlock does not need to be told what it is for.
 *
 * The lock is the two Material icons, with the closed one's shackle redrawn as
 * a stroked arc so it can move on its own: it presses down, and only then does
 * the icon swap to the open one.
 */

/*
 * The lock, in pieces so the shackle can move on its own.
 *
 * The icon cannot simply be split to get there: its first sub-path is the body
 * AND the outer arch as one outline, and the third is the arch's inner hole,
 * relying on fill-rule to punch it through. Filling that third path alone draws
 * a solid dome, not a shackle.
 *
 * So the shackle is redrawn as a stroked arc, using the icon's own geometry —
 * outer radius 208.5 and inner 102.5 about x=480, which is a 106-wide band on a
 * 155.5 centreline, springing from y=-724.5 with legs down to the body at
 * -660.9. Stroking it also makes it far easier to animate than a fill.
 */
const BODY = 'M246.78-62.48q-43.72 0-74.86-31.14-31.14-31.13-31.14-74.86v-386.43q0-43.73 31.14-74.87 31.14-31.13 74.86-31.13h466.44q43.72 0 74.86 31.13 31.14 31.14 31.14 74.87v386.43q0 43.73-31.14 74.86-31.14 31.14-74.86 31.14H246.78Z';
const KEYHOLE = 'M536.5-305.2q23.5-23.5 23.5-56.5t-23.5-56.5Q513-441.7 480-441.7t-56.5 23.5Q400-394.7 400-361.7t23.5 56.5q23.5 23.5 56.5 23.5t56.5-23.5Z';
const SHACKLE = 'M324.52-660.91V-724.52A155.48 155.48 0 0 1 635.48-724.52V-660.91';

/* Open padlock — the shackle has swung left and merged into the body. */
const OPEN_BODY = 'M246.78-62.48q-43.72 0-74.86-31.14-31.14-31.13-31.14-74.86v-386.43q0-43.73 31.14-74.87 31.14-31.13 74.86-31.13h335.7v-63.61q0-43.41-29.63-73.79Q523.22-828.7 480-828.7q-33.18 0-58.07 18.44-24.89 18.43-35.89 46.26-7.95 17.96-24.97 28.72-17.03 10.76-36.8 10.76-22.4 0-36.73-16.65-14.32-16.66-8.5-37.87 12.13-62.92 68.48-109.29Q403.86-934.7 480-934.7q86.96 0 147.72 61.33 60.76 61.33 60.76 148.85v63.61h24.74q43.72 0 74.86 31.13 31.14 31.14 31.14 74.87v386.43q0 43.73-31.14 74.86-31.14 31.14-74.86 31.14H246.78Z';

const KEYS = [['1', '2', '3'], ['4', '5', '6'], ['7', '8', '9'], ['', '0', '⌫']];

/* Press, then pop. Kept here so the hold on the unmount and the CSS cannot
 * drift apart. */
const PRESS_MS = 190;
const POP_MS = 430;

export default function PINPage({ overlay = false }) {
  const { profile, verifyPin, signOut } = useAuth();
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [shake, setShake] = useState(false);
  const [phase, setPhase] = useState('locked');   // locked | pressing | open

  const initials = initialsOf(profile?.name || '');
  const busy = phase !== 'locked';

  function pressKey(k) {
    if (busy) return;
    if (k === '⌫') { tapSelect(); setPin(p => p.slice(0, -1)); setError(''); return; }
    if (!k || pin.length >= 4) return;
    tapSelect();
    const next = pin + k;
    setPin(next);
    if (next.length === 4) checkPin(next);
  }

  async function checkPin(entered) {
    /* Hold the screen open long enough for the lock to finish. */
    const ok = await verifyPin(entered, PRESS_MS + POP_MS);
    if (!ok) {
      tapFailed();
      setError('Incorrect PIN');
      setShake(true);
      setTimeout(() => { setShake(false); setPin(''); setError(''); }, 700);
      return;
    }
    tapSaved();
    setPhase('pressing');
    setTimeout(() => setPhase('open'), PRESS_MS);
  }

  return (
    <div className={`pin-wrap ${overlay ? 'overlay' : ''}`}>
      <div className={`pin-sheet ${phase}`}>

        <div className="pin-lock" aria-hidden="true">
          <svg viewBox="0 -960 960 960" className="pin-lock-svg">
            {phase === 'open' ? (
              <>
                <path d={OPEN_BODY} />
                <path d={KEYHOLE} />
              </>
            ) : (
              <>
                <path className="pin-shackle" d={SHACKLE} />
                <path d={BODY} />
                <path d={KEYHOLE} />
              </>
            )}
          </svg>
          {/* Whose lock it is, badged onto the corner the way the care tiles
              badge their category. */}
          <span className="pin-initials">{initials}</span>
        </div>

        <p className="pin-name">{profile?.name ?? 'Staff'}</p>

        <div className={`pin-dots ${shake ? 'shake' : ''}`}>
          {[0, 1, 2, 3].map(i => (
            <span key={i} className={`pin-dot ${pin.length > i ? 'filled' : ''} ${error ? 'error' : ''}`} />
          ))}
        </div>

        <p className={`pin-error ${error ? 'on' : ''}`}>{error || ' '}</p>

        <div className="pin-keypad">
          {KEYS.map((row, r) => (
            <div key={r} className="pin-row">
              {row.map((k, i) => (
                <button
                  key={i}
                  className={`pin-key ${!k ? 'invisible' : ''} ${k === '⌫' ? 'back' : ''}`}
                  onClick={() => pressKey(k)}
                  disabled={!k || busy}
                >
                  {k}
                </button>
              ))}
            </div>
          ))}
        </div>

        <button className="pin-signout" onClick={signOut}>Sign out</button>
      </div>
    </div>
  );
}
