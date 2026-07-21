import { P, Icon } from '../../lib/icons';
import { WIDGETS, ADDABLE, SIZES, SIZE_LABEL } from './widgets';

const WIDGET_DESC = {
  cares:      'People to check on · log a hello',
  calendar:   'Upcoming events · tap to expand',
  guests:     'Visitors & prospects',
  members:    'Search the directory',
  email:      'Inbox & compose',
  sms:        'Text the congregation',
  attendance: 'Worship-center map',
  analytics:  'Usage & trends',
};

/*
 * iOS-style widget gallery. Pick a widget, choose a size → it's added to the grid.
 */
export default function AddWidgetSheet({ onAdd, onClose }) {
  return (
    <div className="aw-overlay" onClick={onClose}>
      <div className="aw-sheet" onClick={e => e.stopPropagation()}>
        <div className="aw-grab" />
        <div className="aw-head">
          <div>
            <h2>Add a widget</h2>
            <p>Pick a widget and a size to drop it on your home screen.</p>
          </div>
          <button className="aw-x" onClick={onClose}><Icon d={P.close} size={20} /></button>
        </div>

        <div className="aw-grid">
          {ADDABLE.map(type => {
            const w = WIDGETS[type];
            return (
              <div key={type} className="aw-card">
                <div className="aw-card-top">
                  <span className="aw-card-icon"><Icon d={w.icon} size={20} /></span>
                  <div className="aw-card-text">
                    <span className="aw-card-name">{w.title}{w.soon && <em className="aw-soon">Soon</em>}</span>
                    <span className="aw-card-desc">{WIDGET_DESC[type]}</span>
                  </div>
                </div>
                <div className="aw-card-sizes">
                  {SIZES.filter(s => w.sizes.includes(s)).map(s => (
                    <button key={s} onClick={() => onAdd(type, s)}>
                      <Icon d={P.plus} size={12} />{SIZE_LABEL[s]}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
