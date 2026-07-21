import { useState, useEffect, useRef } from 'react';
import { _registerDialog } from '../lib/dialog';
import './Dialogs.css';

/* Global renderer for confirmDialog / promptDialog / alertDialog. Mount once at the app root. */
export default function Dialogs() {
  const [dlg, setDlg] = useState(null);
  const [value, setValue] = useState('');
  const inputRef = useRef(null);

  useEffect(() => {
    _registerDialog(cfg => { setValue(cfg.defaultValue || ''); setDlg(cfg); });
  }, []);

  useEffect(() => {
    if (dlg?.type === 'prompt') { const t = setTimeout(() => inputRef.current?.focus(), 40); return () => clearTimeout(t); }
  }, [dlg]);

  if (!dlg) return null;

  const finish = result => { dlg.resolve(result); setDlg(null); };
  const onConfirm = () => finish(dlg.type === 'prompt' ? value : true);
  const onCancel  = () => finish(dlg.type === 'prompt' ? null : (dlg.type === 'alert' ? undefined : false));

  return (
    <div className="dlg-overlay" onMouseDown={dlg.type === 'alert' ? onConfirm : onCancel}>
      <div className="dlg-card" onMouseDown={e => e.stopPropagation()}>
        {dlg.title && <h3 className="dlg-title">{dlg.title}</h3>}
        {dlg.message && <p className="dlg-message">{dlg.message}</p>}
        {dlg.type === 'prompt' && (
          <input ref={inputRef} className="dlg-input" value={value} placeholder={dlg.placeholder || ''}
            inputMode={dlg.numeric ? 'numeric' : undefined}
            onChange={e => setValue(dlg.numeric ? e.target.value.replace(/\D/g, '').slice(0, dlg.maxLength || 99) : e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') onConfirm(); if (e.key === 'Escape') onCancel(); }} />
        )}
        <div className="dlg-actions">
          {dlg.type !== 'alert' && <button className="dlg-btn ghost" onClick={onCancel}>{dlg.cancelLabel || 'Cancel'}</button>}
          <button className={`dlg-btn ${dlg.danger ? 'danger' : 'primary'}`} onClick={onConfirm}>
            {dlg.confirmLabel || (dlg.type === 'alert' ? 'OK' : dlg.danger ? 'Delete' : 'Confirm')}
          </button>
        </div>
      </div>
    </div>
  );
}
