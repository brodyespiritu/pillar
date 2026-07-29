import { useState } from 'react';
import { P, Icon } from '../../lib/icons';
import { analyzeScreenshots, saveRead, fileToImagePart, CAPACITY } from '../../lib/attendance';

/*
 * Capture a livestream still (or a few) of fellowship time, run the Claude vision
 * headcount via the analyze-attendance edge function, review, and save as a read.
 *
 * A screenshot is the realistic v1 input — the fixed camera means one frame is
 * exactly what the model needs. Auto-pulling the frame from a YouTube URL is a
 * later step (needs a stream-extraction service); the URL/timestamp fields here
 * are stored with the read for provenance.
 */
export default function AttendanceIntakeModal({ onClose, onSaved }) {
  const today = new Date().toISOString().slice(0, 10);
  const [files, setFiles] = useState([]);
  const [serviceDate, setServiceDate] = useState(today);
  const [sourceUrl, setSourceUrl] = useState('');
  const [frameTs, setFrameTs] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);

  const pct = result?.total ? Math.round((result.total / CAPACITY) * 100) : 0;

  async function runAnalysis() {
    setError(''); setBusy(true); setResult(null);
    try {
      const images = await Promise.all([...files].map(fileToImagePart));
      const res = await analyzeScreenshots(images, { service_date: serviceDate, source_url: sourceUrl, frame_ts: frameTs });
      setResult(res);
    } catch (e) {
      setError(String(e.message || e));
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    setError(''); setBusy(true);
    try {
      await saveRead({ service_date: serviceDate, source_url: sourceUrl, frame_ts: frameTs, result });
      onSaved();
    } catch (e) {
      setError(String(e.message || e));
      setBusy(false);
    }
  }

  return (
    <div className="hm-modal-overlay" onClick={onClose}>
      <div className="hm-modal" onClick={e => e.stopPropagation()}>
        <div className="hm-modal-head">
          <h3>Analyze attendance</h3>
          <button className="hm-modal-x" onClick={onClose} aria-label="Close"><Icon d={P.close} size={18} /></button>
        </div>

        <p className="hm-modal-lede">
          Upload a screenshot of the livestream during fellowship time. Claude counts the
          people in each seating zone and fills in the heat map.
        </p>

        <label className="hm-field">
          <span>Screenshot(s)</span>
          <input type="file" accept="image/*" multiple
                 onChange={e => { setFiles(e.target.files); setResult(null); }} />
        </label>

        <div className="hm-field-row">
          <label className="hm-field">
            <span>Service date</span>
            <input type="date" value={serviceDate} onChange={e => setServiceDate(e.target.value)} />
          </label>
          <label className="hm-field">
            <span>Frame time (optional)</span>
            <input type="text" placeholder="00:12:30" value={frameTs} onChange={e => setFrameTs(e.target.value)} />
          </label>
        </div>

        <label className="hm-field">
          <span>Livestream URL (optional)</span>
          <input type="url" placeholder="https://youtube.com/watch?v=…" value={sourceUrl}
                 onChange={e => setSourceUrl(e.target.value)} />
        </label>

        {error && <div className="hm-modal-err">{error}</div>}

        {result && (
          <div className="hm-result">
            <div>
              <span className="hm-result-num">≈ {result.total}</span>
              <span className="hm-result-label">people · {pct}% full{result.confidence != null ? ` · ${Math.round(result.confidence * 100)}% confidence` : ''}</span>
            </div>
          </div>
        )}

        <div className="hm-modal-actions">
          <button className="hm-btn-ghost" onClick={onClose}>Cancel</button>
          {result ? (
            <button className="hm-btn" onClick={save} disabled={busy}>
              {busy ? 'Saving…' : 'Save read'}
            </button>
          ) : (
            <button className="hm-btn" onClick={runAnalysis} disabled={busy || !files.length}>
              {busy ? 'Analyzing…' : 'Run analysis'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
