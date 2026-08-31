import { P, Icon } from '../../lib/icons';
import LocationsPanel from './LocationsPanel';
import '../care/Modal.css';
import './locations.css';

/* Modal wrapper around LocationsPanel, for the calendar's tools menu.
   Admin > Email renders the same panel inline. */
export default function LocationsManager({ onClose, onChanged }) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal sheet lm-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Locations</h2>
          <button className="modal-x" onClick={onClose}><Icon d={P.close} size={20} /></button>
        </div>
        <div className="modal-body">
          <LocationsPanel onChanged={onChanged} />
        </div>
        <div className="modal-foot">
          <button className="btn-ghost" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}
