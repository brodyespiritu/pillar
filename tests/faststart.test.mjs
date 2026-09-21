// Pillar/src/lib/videoUpload.js faststart(): a video whose index sits at the end is sent with the
// index first, so it plays as it arrives — the same bytes, in a different order, with every frame
// position shifted. Anything it doesn't fully understand goes up untouched.
//
// The test videos are a plain animated test card (fixtures/make-clips.swift) finished by macOS's own
// avconvert: --disableFastStart writes the index last, exactly as a camera or screen recorder does.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const PILLAR = path.resolve(import.meta.dirname, '..');
const HERE = import.meta.dirname;
const CLIPS = path.join(HERE, 'fixtures');   // real encoder output: slow.* index last, clip.mp4 index first
const OUT = path.join(HERE, 'build');
fs.mkdirSync(OUT, { recursive: true });

let src = fs.readFileSync(path.join(PILLAR, 'src/lib/videoUpload.js'), 'utf8');
for (const [a, b] of [
  ["import { supabase } from './supabase';", 'const supabase = null;'],
  ["import { getGcsSignedUrl } from './appApi';", 'const getGcsSignedUrl = null;'],
]) { assert.ok(src.includes(a), a); src = src.replace(a, b); }
fs.writeFileSync(path.join(OUT, 'faststart.mjs'), src);
const { faststart, videoFacts, tooHeavy, describeVideo } = await import(pathToFileURL(path.join(OUT, 'faststart.mjs')).href);

let ok = 0;
const t = async (n, f) => { await f(); ok++; console.log('  ✓', n); };
const fileOf = (name, type) => new File([fs.readFileSync(path.join(CLIPS, name))], name, { type });

/** Top-level boxes of a Blob's bytes: [[type, size, at], …] */
async function boxesOf(blob) {
  const buf = Buffer.from(await blob.arrayBuffer());
  const out = [];
  let at = 0;
  while (at + 8 <= buf.length) {
    let size = buf.readUInt32BE(at);
    const type = buf.toString('latin1', at + 4, at + 8);
    if (size === 1) size = Number(buf.readBigUInt64BE(at + 8));
    else if (size === 0) size = buf.length - at;
    out.push([type, size, at]);
    at += size;
  }
  return out;
}
/** Every frame position the index holds, in order. */
async function chunkOffsets(blob) {
  const buf = Buffer.from(await blob.arrayBuffer());
  const offsets = [];
  const walk = (start, end) => {
    let at = start;
    while (at + 8 <= end) {
      let size = buf.readUInt32BE(at);
      let head = 8;
      const type = buf.toString('latin1', at + 4, at + 8);
      if (size === 1) { size = Number(buf.readBigUInt64BE(at + 8)); head = 16; }
      else if (size === 0) size = end - at;
      if (size < head) return;
      if (type === 'stco' || type === 'co64') {
        const count = buf.readUInt32BE(at + head + 4);
        let p = at + head + 8;
        for (let i = 0; i < count; i += 1) {
          offsets.push(type === 'stco' ? buf.readUInt32BE(p) : Number(buf.readBigUInt64BE(p)));
          p += type === 'stco' ? 4 : 8;
        }
      } else if (['moov', 'trak', 'mdia', 'minf', 'stbl', 'edts', 'udta'].includes(type)) walk(at + head, at + size);
      at += size;
    }
  };
  walk(0, buf.length);
  return offsets;
}

for (const [name, type] of [['slow.mp4', 'video/mp4'], ['slow.mov', 'video/quicktime']]) {
  await t(`${name}: the index moves to the front, the bytes stay the same`, async () => {
    const before = fileOf(name, type);
    const was = await boxesOf(before);
    const wasOffsets = await chunkOffsets(before);
    assert.ok(was.findIndex((b) => b[0] === 'moov') > was.findIndex((b) => b[0] === 'mdat'), 'the test file has its index last');

    const after = await faststart(before);
    const now = await boxesOf(after);
    const moovSize = was.find((b) => b[0] === 'moov')[1];

    assert.strictEqual(after.size, before.size, 'nothing added, nothing dropped');
    assert.strictEqual(after.name, before.name);
    assert.strictEqual(after.type, before.type);
    assert.strictEqual(now[0][0], 'ftyp', 'it still opens with ftyp');
    assert.ok(now.findIndex((b) => b[0] === 'moov') < now.findIndex((b) => b[0] === 'mdat'), 'the index now leads');
    assert.deepStrictEqual(now.map((b) => b[0]).sort(), was.map((b) => b[0]).sort(), 'the same boxes');

    // every frame position moved by exactly the size of the index
    const nowOffsets = await chunkOffsets(after);
    assert.strictEqual(nowOffsets.length, wasOffsets.length);
    assert.ok(nowOffsets.every((o, i) => o === wasOffsets[i] + moovSize), 'frame positions shifted with it');

    // and they still point inside the media, at the same bytes as before
    const mdat = now.find((b) => b[0] === 'mdat');
    const first = nowOffsets[0];
    assert.ok(first > mdat[2] && first < mdat[2] + mdat[1], 'the first frame is inside the media');
    const oldBytes = Buffer.from(await before.slice(wasOffsets[0], wasOffsets[0] + 64).arrayBuffer());
    const newBytes = Buffer.from(await after.slice(first, first + 64).arrayBuffer());
    assert.ok(oldBytes.equals(newBytes), 'and it is the same frame');
    fs.writeFileSync(path.join(OUT, `fixed-${name}`), Buffer.from(await after.arrayBuffer()));
  });
}

await t('a video that already leads with its index is left alone', async () => {
  const before = fileOf('clip.mp4', 'video/mp4');
  const after = await faststart(before);
  assert.strictEqual(after, before, 'the very same file object — no work done');
});

await t('anything that isn’t a plain MP4 or MOV is left alone', async () => {
  const noise = new File([Buffer.alloc(4096, 7)], 'noise.mp4', { type: 'video/mp4' });
  assert.strictEqual(await faststart(noise), noise);
  const empty = new File([], 'empty.mp4', { type: 'video/mp4' });
  assert.strictEqual(await faststart(empty), empty);
  // a real video cut short: the boxes no longer add up
  const whole = fs.readFileSync(path.join(CLIPS, 'slow.mp4'));
  const cut = new File([whole.subarray(0, Math.floor(whole.length / 2))], 'cut.mp4', { type: 'video/mp4' });
  assert.strictEqual(await faststart(cut), cut);
  // and one with a nonsense box size
  const bent = Buffer.from(whole);
  bent.writeUInt32BE(0xfffffff0, 0);
  const bentFile = new File([bent], 'bent.mp4', { type: 'video/mp4' });
  assert.strictEqual(await faststart(bentFile), bentFile);
});

await t('the fixed file is what the player wants: index, then media, ready from the first bytes', async () => {
  const fixed = fs.readFileSync(path.join(OUT, 'fixed-slow.mov'));
  const head = fixed.subarray(0, 64 * 1024);
  assert.ok(head.includes(Buffer.from('moov')), 'the index is in the first 64 KB');
  assert.ok(head.includes(Buffer.from('avc1')) || head.includes(Buffer.from('hvc1')), 'so the player knows the format at once');
  const original = fs.readFileSync(path.join(CLIPS, 'slow.mov'));
  assert.ok(!original.subarray(0, 64 * 1024).includes(Buffer.from('moov')), '(it wasn’t, before)');
});

await t('it reads what a video is: length, size on screen, format, and how fat the stream is', async () => {
  const facts = await videoFacts(fileOf('slow.mov', 'video/quicktime'));
  assert.strictEqual(Math.round(facts.seconds), 16);
  assert.deepStrictEqual([facts.width, facts.height], [400, 258]);
  assert.strictEqual(facts.codec, 'avc1');
  assert.strictEqual(facts.bitrate, Math.round((fs.statSync(path.join(CLIPS, 'slow.mov')).size * 8) / facts.seconds));
  assert.ok(/258p H\.264, 0:16, about 0\.2 Mbps/.test(describeVideo(facts)), describeVideo(facts));
  assert.strictEqual(await videoFacts(new File([Buffer.alloc(2048)], 'x.mp4', { type: 'video/mp4' })), null);
});

await t('a video phones can’t keep up with is spotted before it is sent', () => {
  // what the church actually uploaded: 75 seconds, 276 MB, 1440p HEVC
  const theirs = { seconds: 74.9, width: 2560, height: 1440, codec: 'hvc1', bitrate: 29_500_000 };
  assert.ok(tooHeavy(theirs));
  assert.strictEqual(describeVideo(theirs), '1440p HEVC, 1:15, about 30 Mbps');
  // 1080p at a sane rate is fine, and so is a small clip
  assert.ok(!tooHeavy({ seconds: 75, width: 1920, height: 1080, codec: 'avc1', bitrate: 6_000_000 }));
  assert.ok(!tooHeavy({ seconds: 16, width: 400, height: 258, codec: 'avc1', bitrate: 836_000 }));
  // …but 1080p at 20 Mbps is not, and neither is 4K at any rate
  assert.ok(tooHeavy({ seconds: 75, width: 1920, height: 1080, codec: 'avc1', bitrate: 20_000_000 }));
  assert.ok(tooHeavy({ seconds: 75, width: 3840, height: 2160, codec: 'hvc1', bitrate: 7_000_000 }));
  assert.strictEqual(tooHeavy(null), false);
});

await t('the upload box says so, and lets the office decide', () => {
  const kit = fs.readFileSync(path.join(PILLAR, 'src/pages/app/kit.jsx'), 'utf8');
  assert.ok(/const facts = await videoFacts\(file\);\s*\n\s*if \(tooHeavy\(facts\)\) \{ setHeavy\(\{ file, facts \}\); return; \}/.test(kit), 'measured before it is sent');
  assert.ok(/Export it smaller first/.test(kit) && /Choose a smaller export/.test(kit) && /Upload it anyway/.test(kit));
  assert.ok(kit.indexOf('setHeavy({ file, facts })') < kit.indexOf('async function send'), 'nothing is uploaded first');
});

console.log(`\n${ok} fast-start checks passed`);
