import { P, Icon } from '../../lib/icons';
import { GUEST_TYPES } from '../../lib/guests';
import '../care/Modal.css';
import './Guests.css';

const TYPE_ICONS = {
  'Returning Guest/Member': P.users,
  'Prospect':               P.location,
  'Salvation':              P.cross,
  'Baptism':                P.water,
  'New Member':             P.star,
  'New Connection':         P.handshake,
  'Comment':                P.chat,
};

export default function GuestTypePicker({ onPick, onClose }) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal sheet" onClick={e => e.stopPropagation()}>
        <div className="modal-grab" />
        <div className="modal-head">
          <div>
            <h2>New Entry</h2>
            <p className="tp-sub">What are you adding?</p>
          </div>
          <button className="modal-x" onClick={onClose}><Icon d={P.close} size={20} /></button>
        </div>

        <div className="modal-body">
          <div className="tp-grid">
            {GUEST_TYPES.map(t => (
              <button key={t.key} className="tp-card" onClick={() => onPick(t.key)}
                style={{ '--tc': t.color }}>
                <div className="tp-icon">
                  <Icon d={TYPE_ICONS[t.key] || P.person} size={22} />
                </div>
                <div className="tp-text">
                  <span className="tp-name">{t.label}</span>
                  <span className="tp-desc">{t.desc}</span>
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
