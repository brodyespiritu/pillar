/*
 * Snap-style glowing density heatmap on a <canvas>.
 * Renders soft intensity blobs, then colorizes by intensity through a gradient
 * lookup: sparse → cool blue/teal haze, dense → glowing orange/red core.
 */

// Colour ramp keyed by intensity (0..1). Low end is transparent so empty areas stay clear.
const GRAD_STOPS = [
  [0.00, 'rgba(47,111,208,0)'],
  [0.12, 'rgba(47,111,208,0.55)'], // blue
  [0.32, '#22c0b6'],               // teal
  [0.50, '#63e05a'],               // green
  [0.68, '#ffe23d'],               // yellow
  [0.84, '#ff9b2f'],               // orange
  [1.00, '#ff2b2b'],               // red
];

let LUT = null; // Uint8ClampedArray of 256*4 (rgba per intensity level)
function gradientLUT() {
  if (LUT) return LUT;
  const c = document.createElement('canvas');
  c.width = 1; c.height = 256;
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, 256);
  for (const [stop, color] of GRAD_STOPS) g.addColorStop(stop, color);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 1, 256);
  LUT = ctx.getImageData(0, 0, 1, 256).data;
  return LUT;
}

/**
 * @param canvas  target canvas (its width/height attrs define the logical space)
 * @param points  [{ x, y, value, r? }]  in canvas logical coordinates
 * @param opts    { radius, blur, max }
 */
export function drawHeatmap(canvas, points, opts = {}) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  if (!points || !points.length) return;

  const radius = opts.radius ?? 46;
  const blur = opts.blur ?? 16;
  const max = opts.max ?? Math.max(...points.map(p => p.value), 1);

  // 1) Intensity pass — soft black blobs, alpha ∝ value. Overlaps accumulate.
  ctx.save();
  if (blur) ctx.filter = `blur(${blur}px)`;
  for (const p of points) {
    const r = p.r ?? radius;
    const a = Math.min(1, Math.max(0.04, p.value / max));
    const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
    g.addColorStop(0, `rgba(0,0,0,${a})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  // 2) Colorize — map accumulated alpha through the gradient LUT.
  const lut = gradientLUT();
  const img = ctx.getImageData(0, 0, W, H);
  const data = img.data;
  for (let i = 0; i < data.length; i += 4) {
    const alpha = data[i + 3];
    if (alpha === 0) continue;
    const off = alpha * 4;
    data[i]     = lut[off];
    data[i + 1] = lut[off + 1];
    data[i + 2] = lut[off + 2];
    // Boost the glow a touch so hot cores read as luminous.
    data[i + 3] = Math.min(255, alpha + (alpha > 170 ? 40 : 0));
  }
  ctx.putImageData(img, 0, 0);
}
