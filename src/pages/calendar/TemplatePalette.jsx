import { useRef, useState, useEffect, useCallback } from 'react';
import { P, Icon } from '../../lib/icons';
import { catColor, fmtTime } from '../../lib/calendar';
import { alertDialog, confirmDialog } from '../../lib/dialog';
import {
  fetchTemplates, createTemplate, updateTemplate, deleteTemplate,
  isDefaultTemplate, templateSpan,
} from '../../lib/eventTemplates';
import ContextMenu from './ContextMenu';
import TemplateForm from './TemplateForm';

/*
 * Drag a template onto any day to create that event.
 *
 * Uses pointer events rather than HTML5 drag-and-drop so the same code works
 * with a mouse and with touch — HTML5 dragstart never fires on an iPad.
 * Drop targets are anything carrying data-drop-date (see CalendarPage).
 */

const THRESHOLD = 4;   // px before a press becomes a drag, so taps still register

const SETUP_NOTE = 'Custom templates need a one-time database setup. '
  + 'Run supabase/event-templates-schema.sql in the Supabase SQL editor, then reload.';

function hitTest(x, y) {
  const el = document.elementFromPoint(x, y)?.closest('[data-drop-date]');
  if (!el) return null;
  return { el, date: el.dataset.dropDate, hour: el.dataset.dropHour ? Number(el.dataset.dropHour) : null };
}

export default function TemplatePalette({ onDrop }) {
  const [templates, setTemplates] = useState([]);
  const [readOnly, setReadOnly]   = useState(false);
  const [drag, setDrag] = useState(null);        // { tpl, x, y, over } while dragging
  const [menu, setMenu] = useState(null);        // { x, y, tpl }
  const [form, setForm] = useState(null);        // { template } | {}
  const press = useRef(null);
  const lastTarget = useRef(null);

  const load = useCallback(async () => {
    const { templates, readOnly } = await fetchTemplates();
    setTemplates(templates);
    setReadOnly(readOnly);
  }, []);
  useEffect(() => { load(); }, [load]);

  /* Tint the target in the template's own category colour, so you can see what
     is about to land there as well as where. */
  function highlight(el, color) {
    if (lastTarget.current === el) return;
    lastTarget.current?.classList.remove('cal-drop-on');
    if (el) { el.style.setProperty('--drop-cc', color); el.classList.add('cal-drop-on'); }
    lastTarget.current = el;
  }

  function endDrag() {
    highlight(null);
    document.body.classList.remove('cal-dragging');
    press.current = null;
    setDrag(null);
  }
  // A drag can outlive this component (view switch, navigation) — never leave
  // the body stuck in the dragging state.
  useEffect(() => () => {
    lastTarget.current?.classList.remove('cal-drop-on');
    document.body.classList.remove('cal-dragging');
  }, []);

  function onPointerDown(e, tpl) {
    if (e.button > 0) return;                    // left button / touch only
    press.current = { tpl, x0: e.clientX, y0: e.clientY, moved: false };
    // Keeps the gesture on this chip once the pointer leaves it. Throws if the
    // pointer is already gone, which is harmless — the drag still tracks.
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* ignore */ }
  }

  function onPointerMove(e) {
    const p = press.current;
    if (!p) return;
    if (!p.moved) {
      if (Math.hypot(e.clientX - p.x0, e.clientY - p.y0) < THRESHOLD) return;
      p.moved = true;
      document.body.classList.add('cal-dragging');
    }
    e.preventDefault();
    const hit = hitTest(e.clientX, e.clientY);
    highlight(hit?.el || null, catColor(p.tpl.category));
    setDrag({ tpl: p.tpl, x: e.clientX, y: e.clientY, over: !!hit });
  }

  function onPointerUp(e) {
    const p = press.current;
    if (!p?.moved) return endDrag();             // a tap, not a drag
    const hit = hitTest(e.clientX, e.clientY);
    endDrag();
    if (hit) onDrop(p.tpl, hit.date, hit.hour);
  }

  function openMenu(e, tpl) {
    e.preventDefault();
    e.stopPropagation();
    endDrag();                                   // a right-click cancels any press
    setMenu({ x: e.clientX, y: e.clientY, tpl });
  }

  async function saveTemplate(patch) {
    const editing = form?.template;
    const res = editing ? await updateTemplate(editing.id, patch) : await createTemplate(patch);
    if (!res.error) load();
    return res;
  }

  async function removeTemplate(tpl) {
    if (!(await confirmDialog({ message: `Remove the "${tpl.title}" template? Events already on the calendar stay.` }))) return;
    const { error } = await deleteTemplate(tpl.id);
    if (error) return alertDialog(`Could not remove the template: ${error.message}`);
    load();
  }

  function newTemplate() {
    if (readOnly) return alertDialog(SETUP_NOTE);
    setForm({});
  }

  return (
    <>
      <div className="cal-tpl-head">
        <p className="cal-up-label">Templates</p>
        <button className="cal-tpl-new" onClick={newTemplate} title="New template">
          <Icon d={P.plus} size={14} />New
        </button>
      </div>
      <p className="cal-tpl-hint">Drag one onto a day to schedule it. Right-click to edit.</p>

      <div className="cal-tpl-list">
        {templates.map(tpl => (
          <div
            key={tpl.id || tpl.title}
            className={`cal-tpl ${drag?.tpl === tpl ? 'dragging' : ''}`}
            style={{ '--cc': catColor(tpl.category) }}
            role="button"
            tabIndex={0}
            onPointerDown={e => onPointerDown(e, tpl)}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={endDrag}
            onContextMenu={e => openMenu(e, tpl)}
          >
            <Icon d={P.grip} size={14} className="cal-tpl-grip" />
            <span className="cal-tpl-dot" />
            <div className="cal-tpl-info">
              <span className="cal-tpl-title">{tpl.title}</span>
              <span className="cal-tpl-meta">{templateSpan(tpl, fmtTime)}</span>
            </div>
          </div>
        ))}
      </div>

      {drag && (
        <div
          className={`cal-drag-ghost ${drag.over ? 'over' : ''}`}
          style={{ '--cc': catColor(drag.tpl.category), left: drag.x, top: drag.y }}
        >
          <span className="cal-tpl-dot" />
          {drag.tpl.title}
        </div>
      )}

      {menu && (
        <ContextMenu x={menu.x} y={menu.y} onClose={() => setMenu(null)} items={[
          { icon: P.edit,  label: 'Edit template',
            act: () => (readOnly || isDefaultTemplate(menu.tpl))
              ? alertDialog(SETUP_NOTE) : setForm({ template: menu.tpl }) },
          { icon: P.plus,  label: 'New template', act: newTemplate },
          { icon: P.trash, label: 'Remove template', danger: true,
            act: () => (readOnly || isDefaultTemplate(menu.tpl))
              ? alertDialog(SETUP_NOTE) : removeTemplate(menu.tpl) },
        ]} />
      )}

      {form && (
        <TemplateForm template={form.template} onClose={() => setForm(null)} onSave={saveTemplate} />
      )}
    </>
  );
}
