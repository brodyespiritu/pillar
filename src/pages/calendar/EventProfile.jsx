import { alertDialog } from "../../lib/dialog";
import { useState } from 'react';
import { P, Icon } from '../../lib/icons';
import { catColor, fmtTime, parseISO, deleteEvent, downloadICS } from '../../lib/calendar';
import '../care/Modal.css';
import './Calendar.css';

export default function EventProfile({ event, onClose, onEdit, onChanged }) {
  const [tab, setTab] = useState('details');
  const [confirmDel, setConfirmDel] = useState(false);
  const color = catColor(event.category);

  const start = parseISO(event.start_date);
  const end = event.end_date ? parseISO(event.end_date) : null;
  const dateLabel = end && event.end_date !== event.start_date
    ? `${start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${end.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
    : start.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  const timeLabel = event.start_time
    ? `${fmtTime(event.start_time)}${event.end_time ? ` – ${fmtTime(event.end_time)}` : ''}`
    : 'All day';

  async function del(mode) {
    await deleteEvent(event, mode);
    onChanged();
    onClose();
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal slideover" onClick={e => e.stopPropagation()}>
        <div className="ep-head" style={{ '--cc': color }}>
          <div className="ep-head-top">
            <span className="ep-cat" style={{ '--cc': color }}>{event.category}</span>
            <button className="modal-x" onClick={onClose}><Icon d={P.close} size={20} /></button>
          </div>
          <h2 className="ep-title">{event.title}</h2>
          <div className="ep-flags">
            {event.is_private && <span className="ep-flag"><Icon d={P.lock} size={12} />Private</span>}
            {event.series_id && <span className="ep-flag"><Icon d={P.repeat} size={12} />{event.recurrence || 'Recurring'}</span>}
          </div>
        </div>

        <div className="ep-tabs">
          <button className={tab === 'details' ? 'on' : ''} onClick={() => setTab('details')}>Details</button>
          <button className={tab === 'files' ? 'on' : ''} onClick={() => setTab('files')}>Files</button>
        </div>

        <div className="modal-body">
          {tab === 'details' ? (
            <>
              <div className="ep-row"><Icon d={P.calendar} size={17} /><div><span className="ep-k">Date</span><span className="ep-v">{dateLabel}</span></div></div>
              <div className="ep-row"><Icon d={P.clock} size={17} /><div><span className="ep-k">Time</span><span className="ep-v">{timeLabel}</span></div></div>
              {event.location && <div className="ep-row"><Icon d={P.location} size={17} /><div><span className="ep-k">Location</span><span className="ep-v">{event.location}</span></div></div>}
              {event.organizer && <div className="ep-row"><Icon d={P.person} size={17} /><div><span className="ep-k">Organizer</span><span className="ep-v">{event.organizer}</span></div></div>}
              {event.description && (
                <div className="ep-notes">
                  <p className="mp-section">Notes</p>
                  <p>{event.description}</p>
                </div>
              )}
              <button className="ep-ics" onClick={() => downloadICS(event)}><Icon d={P.calendar} size={15} />Export .ics</button>
            </>
          ) : (
            <div className="ep-files">
              <div className="ep-files-drop">
                <Icon d={P.folder} size={26} />
                <p>File management</p>
                <span>Upload files, create folders, and organize documents per event.</span>
                <button className="btn-ghost sm" onClick={() => alertDialog('File uploads — coming soon (needs storage bucket).')}>Upload file</button>
              </div>
            </div>
          )}
        </div>

        <div className="modal-foot">
          {!confirmDel ? (
            <>
              <button className="btn-danger" onClick={() => setConfirmDel(true)}><Icon d={P.trash} size={15} />Delete</button>
              <button className="btn-primary" onClick={() => onEdit(event)}><Icon d={P.edit} size={15} />Edit Event</button>
            </>
          ) : (
            <div className="ep-del">
              <span>Delete…</span>
              <button className="btn-ghost sm" onClick={() => del('single')}>This event</button>
              {event.series_id && <button className="btn-ghost sm" onClick={() => del('future')}>This & future</button>}
              {event.series_id && <button className="btn-danger sm" onClick={() => del('series')}>Entire series</button>}
              <button className="btn-ghost sm" onClick={() => setConfirmDel(false)}>Cancel</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
