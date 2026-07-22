import { useState, useMemo } from 'react';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';
import { PROVIDERS, connectAccount } from '../../lib/email';
import { enableDesktopNotifications, blockedHelpText, unsupportedHelpText } from '../../lib/notify';
import { alertDialog } from '../../lib/dialog';
import { P, Icon } from '../../lib/icons';
import './onboarding.css';

const CHANNELS = [
  { key: 'email',  label: 'Email',              sub: 'Recaps & important notices' },
  { key: 'sms',    label: 'Text messages (SMS)', sub: 'Urgent, time-sensitive alerts' },
  { key: 'push',   label: 'Push notifications',  sub: 'In-app & mobile alerts' },
  { key: 'digest', label: 'Weekly digest',       sub: 'A Monday summary of the week' },
];

const HOME_MODULES = [
  { key: 'cares', label: 'Care List' }, { key: 'guests', label: 'Guest List' },
  { key: 'calendar', label: 'Calendar' }, { key: 'services', label: 'Services' },
  { key: 'email', label: 'Email' }, { key: 'sms', label: 'SMS' },
  { key: 'members', label: 'Members' }, { key: 'attendance', label: 'Attendance' },
  { key: 'admin', label: 'Admin' },
];
const labelFor = k => HOME_MODULES.find(m => m.key === k)?.label || k;

export default function OnboardingWizard() {
  const { user, profile, completeOnboarding, setPin } = useAuth();
  const pref = profile?.preferences || {};
  const inviteCode = profile?.invite_code || '';

  // Steps — the invite-code confirmation only appears if an invite was issued.
  const KEYS = useMemo(
    () => ['welcome', ...(inviteCode ? ['invite'] : []), 'details', 'email', 'notifications', 'home', 'security', 'done'],
    [inviteCode],
  );

  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const stepKey = KEYS[step];
  const lastIdx = KEYS.length - 1;

  const firstName = profile?.name?.split(' ')[0] || 'there';

  const [code, setCode]   = useState('');
  const [name, setName]   = useState(profile?.name || '');
  const [title, setTitle] = useState(profile?.title || '');
  const [phone, setPhone] = useState(profile?.phone || '');
  const [notif, setNotif] = useState(() => ({ email: true, sms: true, push: true, digest: true, ...(pref.notifications || {}) }));
  const [desktopOn, setDesktopOn] = useState(pref.desktop_notifications || false);
  const [featured, setFeatured] = useState(() => (Array.isArray(pref.home_featured) && pref.home_featured.length === 3 ? pref.home_featured : ['cares', 'guests', 'calendar']));
  const [pin, setPinValue] = useState('');
  const [pin2, setPin2]    = useState('');

  const [emProvider, setEmProvider] = useState('');
  const [emAddr, setEmAddr] = useState('');
  const [emPass, setEmPass] = useState('');
  const [emBusy, setEmBusy] = useState(false);
  const [emDone, setEmDone] = useState(false);
  const [emErr, setEmErr]   = useState('');

  async function connectEmail() {
    if (!emProvider || !emAddr.trim() || !emPass.trim()) return;
    setEmBusy(true); setEmErr('');
    const { error } = await connectAccount({ provider: emProvider, email: emAddr.trim(), app_password: emPass.trim(), owner: user.id });
    setEmBusy(false);
    if (error) { setEmErr(error.message || 'Could not connect that account.'); return; }
    setEmDone(true);
  }

  const codeOk = code === inviteCode;
  const canNext = useMemo(() => {
    if (stepKey === 'invite')   return /^\d{6}$/.test(code) && codeOk;
    if (stepKey === 'details')  return name.trim().length > 0;
    if (stepKey === 'security') return /^\d{4}$/.test(pin) && pin === pin2;
    return true;
  }, [stepKey, code, codeOk, name, pin, pin2]);

  async function enableDesktop() {
    const res = await enableDesktopNotifications();
    setDesktopOn(res === 'granted');
    if (res === 'denied') {
      alertDialog(blockedHelpText());
    } else if (res === 'unsupported') {
      alertDialog(unsupportedHelpText());
    }
  }

  const setSlot = (i, key) => setFeatured(f => f.map((k, idx) => (idx === i ? key : k)));

  async function finish() {
    setSaving(true); setError('');
    try {
      const okPin = await setPin(pin);
      if (!okPin) throw new Error('Could not save your PIN. Please try again.');

      const preferences = { notifications: notif, desktop_notifications: desktopOn, home_featured: featured };
      const { error: upErr } = await supabase.from('staff')
        .update({ name: name.trim(), title: title.trim() || null, phone: phone.trim() || null, preferences, onboarded: true, invite_code: null })
        .eq('id', user.id);
      if (upErr) throw new Error(upErr.message);

      await completeOnboarding();
    } catch (e) {
      setError(e.message || 'Something went wrong.');
      setSaving(false);
    }
  }

  const next = () => { if (step < lastIdx) setStep(s => s + 1); };
  const back = () => setStep(s => Math.max(0, s - 1));

  return (
    <div className="ob-overlay">
      <div className="ob-card">
        <div className="ob-progress">
          {KEYS.map((k, i) => <span key={k} className={`ob-dot ${i === step ? 'on' : i < step ? 'done' : ''}`} />)}
        </div>

        <div className="ob-body">
          {stepKey === 'welcome' && (
            <div className="ob-center">
              <div className="ob-badge"><Icon d={P.shield} size={30} /></div>
              <h1>Welcome to Pillar, {firstName}</h1>
              <p className="ob-lead">{inviteCode
                ? 'Your admin set up an account for you. Let’s confirm it’s you, check your details, and get you set up.'
                : 'Let’s set up your account, notifications, and home screen. Your personal settings stay private to you.'}</p>
            </div>
          )}

          {stepKey === 'invite' && (
            <div className="ob-step">
              <h2>Enter your invite code</h2>
              <p className="ob-sub">Check your email for the 6-digit code and enter it here to confirm your account.</p>
              <div className="ob-field">
                <label>Invite code</label>
                <input className="ob-code" inputMode="numeric" maxLength={6} value={code}
                  onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="••••••" autoFocus />
              </div>
              {code.length === 6 && !codeOk && <p className="ob-err-inline">That code doesn’t match. Check your email and try again.</p>}
            </div>
          )}

          {stepKey === 'details' && (
            <div className="ob-step">
              <h2>Confirm your details</h2>
              <p className="ob-sub">Your admin entered these. Fix anything that’s off before continuing.</p>
              <div className="ob-field"><label>Full name</label><input value={name} onChange={e => setName(e.target.value)} placeholder="Your name" autoFocus /></div>
              <div className="ob-field"><label>Title / role <span className="ob-opt">(optional)</span></label><input value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Care Coordinator" /></div>
              <div className="ob-field"><label>Phone <span className="ob-opt">(optional)</span></label><input value={phone} onChange={e => setPhone(e.target.value)} placeholder="(555) 555-5555" /></div>
            </div>
          )}

          {stepKey === 'email' && (
            <div className="ob-step">
              <h2>Connect your email</h2>
              <p className="ob-sub">Link Gmail or Yahoo so you can send emails from Pillar. Optional — you can skip and set this up later in the Email module.</p>
              {emDone ? (
                <div className="ob-email-done"><Icon d={P.check} size={18} /><span>Connected <strong>{emAddr}</strong></span></div>
              ) : (
                <>
                  <div className="ob-providers">
                    {Object.values(PROVIDERS).map(p => (
                      <button key={p.key} type="button" className={`ob-provider ${emProvider === p.key ? 'on' : ''}`} onClick={() => setEmProvider(p.key)}>
                        <span className="ob-provider-dot" style={{ background: p.color }} />{p.label}
                      </button>
                    ))}
                  </div>
                  {emProvider && (
                    <>
                      <div className="ob-field"><label>Email address</label><input value={emAddr} onChange={e => setEmAddr(e.target.value)} placeholder="you@example.com" /></div>
                      <div className="ob-field"><label>App password</label><input type="password" value={emPass} onChange={e => setEmPass(e.target.value)} placeholder="16-character app password" /></div>
                      <p className="ob-help">Need one? <a href={PROVIDERS[emProvider].help} target="_blank" rel="noreferrer">Get an app password</a> (requires 2-step verification).</p>
                      {emErr && <p className="ob-err-inline">{emErr}</p>}
                      <button type="button" className="ob-connect-btn" onClick={connectEmail} disabled={emBusy || !emAddr.trim() || !emPass.trim()}>
                        {emBusy ? 'Connecting…' : 'Connect account'}
                      </button>
                    </>
                  )}
                </>
              )}
            </div>
          )}

          {stepKey === 'notifications' && (
            <div className="ob-step">
              <h2>Notifications</h2>
              <p className="ob-sub">Pick how Pillar reaches you. You can change these anytime in Settings.</p>
              <div className="ob-prefs">
                {CHANNELS.map(n => (
                  <button key={n.key} type="button" className={`ob-pref ${notif[n.key] ? 'on' : ''}`}
                    onClick={() => setNotif(p => ({ ...p, [n.key]: !p[n.key] }))}>
                    <span className="ob-pref-text"><span className="ob-pref-label">{n.label}</span><span className="ob-pref-sub">{n.sub}</span></span>
                    <span className="ob-switch"><span /></span>
                  </button>
                ))}
              </div>
              <div className="ob-desktop">
                <div className="ob-desktop-text"><span className="ob-pref-label">Desktop notifications</span><span className="ob-pref-sub">Allow Pillar to show alerts on this device</span></div>
                {desktopOn
                  ? <span className="ob-desktop-on"><Icon d={P.check} size={15} />Enabled</span>
                  : <button type="button" className="ob-desktop-btn" onClick={enableDesktop}>Enable</button>}
              </div>
            </div>
          )}

          {stepKey === 'home' && (
            <div className="ob-step">
              <h2>Home screen</h2>
              <p className="ob-sub">Your home has three feature boxes. Choose which page fills each — the layout stays put.</p>
              <div className="ob-slots">
                {[0, 1, 2].map(i => (
                  <div key={i} className="ob-slot">
                    <div className="ob-slot-card"><span className="ob-slot-pill">Featured</span><span className="ob-slot-name">{labelFor(featured[i])}</span></div>
                    <label className="ob-slot-label">Box {i + 1}{i === 0 ? ' · top-left' : ''}</label>
                    <select value={featured[i]} onChange={e => setSlot(i, e.target.value)}>
                      {HOME_MODULES.map(m => <option key={m.key} value={m.key}>{m.label}</option>)}
                    </select>
                  </div>
                ))}
              </div>
            </div>
          )}

          {stepKey === 'security' && (
            <div className="ob-step">
              <h2>Set your PIN</h2>
              <p className="ob-sub">A 4-digit PIN protects your session on this device. It’s stored securely — never in plain text.</p>
              <div className="ob-field"><label>New PIN</label>
                <input className="ob-pin" inputMode="numeric" maxLength={4} value={pin}
                  onChange={e => setPinValue(e.target.value.replace(/\D/g, '').slice(0, 4))} placeholder="••••" autoFocus /></div>
              <div className="ob-field"><label>Confirm PIN</label>
                <input className="ob-pin" inputMode="numeric" maxLength={4} value={pin2}
                  onChange={e => setPin2(e.target.value.replace(/\D/g, '').slice(0, 4))} placeholder="••••" /></div>
              {pin2.length === 4 && pin !== pin2 && <p className="ob-err-inline">PINs don’t match.</p>}
            </div>
          )}

          {stepKey === 'done' && (
            <div className="ob-center">
              <div className="ob-badge done"><Icon d={P.check} size={32} /></div>
              <h1>You’re all set</h1>
              <p className="ob-lead">Your account is ready. Everything you set here lives under your profile and stays private to you.</p>
            </div>
          )}
        </div>

        {error && <p className="ob-error">{error}</p>}

        <div className="ob-foot">
          {step > 0 && step < lastIdx ? <button className="ob-ghost" onClick={back}>Back</button> : <span />}
          {step < lastIdx
            ? <button className="ob-primary" onClick={next} disabled={!canNext}>Continue</button>
            : <button className="ob-primary" onClick={finish} disabled={saving}>{saving ? 'Setting up…' : 'Enter Pillar'}</button>}
        </div>
      </div>
    </div>
  );
}
