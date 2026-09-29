// YouTube's own picture for a video, from its link (user, 2026-09-21: "if I use a link for a sermon
// video in pillar, can you pull the thumbnail?"). They are public images at a fixed address — no key,
// nothing downloaded. YouTube doesn't make the 1280-wide one (maxresdefault) for every upload; when it
// hasn't, it answers with a 120×90 grey stand-in, so the size is checked and hqdefault (always made)
// is used instead.
//
// The app reads links the same way (BethesdaApp utils/youtube.js).

/** The video id in a YouTube link (watch?v=, youtu.be/, /embed/, /live/, /shorts/), or null. */
export function youtubeId(url) {
  const m = /^https?:\/\/(?:[\w-]+\.)?(youtube\.com|youtube-nocookie\.com|youtu\.be)\/([^?#]*)(?:\?([^#]*))?/i.exec(String(url || '').trim());
  if (!m) return null;
  const [, host, path, query = ''] = m;
  const parts = path.split('/').filter(Boolean);
  let id = null;
  if (/youtu\.be/i.test(host)) id = parts[0];
  else if (['embed', 'live', 'shorts', 'v'].includes(parts[0])) id = parts[1];
  else {
    for (const pair of query.split('&')) {
      const at = pair.indexOf('=');
      if (at > 0 && pair.slice(0, at) === 'v') { id = pair.slice(at + 1); break; }
    }
  }
  return id && /^[\w-]{6,}$/.test(id) ? id : null;
}

/** Both sizes of a video's picture, or null for a link that isn't YouTube. */
export function youtubeThumbs(url) {
  const id = youtubeId(url);
  return id ? { max: `https://i.ytimg.com/vi/${id}/maxresdefault.jpg`, hq: `https://i.ytimg.com/vi/${id}/hqdefault.jpg` } : null;
}

// how wide a picture turns out to be once it loads (0 if it doesn't say)
function widthOf(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img.naturalWidth || 0);
    img.onerror = () => reject(new Error('no picture'));
    img.src = src;
  });
}

/** The best picture YouTube has for the video: the 1280-wide one if it was made, else hq. */
export async function youtubePicture(url, measure = widthOf) {
  const t = youtubeThumbs(url);
  if (!t) return null;
  try {
    return (await measure(t.max)) > 120 ? t.max : t.hq;
  } catch {
    return t.hq;
  }
}
