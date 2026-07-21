import AppShell from './AppShell';
import { P, Icon } from '../../lib/icons';

/* Placeholder for App modules being built next in this series. */
export default function StubPage({ title, subtitle, note }) {
  return (
    <AppShell title={title} subtitle={subtitle}>
      <div className="ap-panel" style={{ padding: '48px 28px', textAlign: 'center' }}>
        <span className="ap-stat-ic" style={{ margin: '0 auto 14px' }}><Icon d={P.clock} size={22} /></span>
        <h3 style={{ fontSize: 17, fontWeight: 800, color: 'var(--text)' }}>Being built next</h3>
        <p style={{ fontSize: 14, color: 'var(--text-2)', marginTop: 6, maxWidth: 440, marginInline: 'auto', lineHeight: 1.5 }}>
          {note || 'This section of the App module is on the way. The backend endpoints are wired and ready.'}
        </p>
      </div>
    </AppShell>
  );
}
