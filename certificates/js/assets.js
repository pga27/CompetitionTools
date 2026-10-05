/**
 * assets.js — fonts, flags and event icons, loaded lazily and cached.
 * Everything is served from this repository so the app works offline on GitHub Pages.
 */

const ASSET_BASE = new URL('../assets/', import.meta.url);
const UNICODE_FONT_URL = new URL('../../fonts/NotoSansKR-Regular.ttf', import.meta.url);

// Codepoints of the @cubing/icons font (assets/icons/cubing-icons.woff2)
export const EVENT_GLYPHS = {
  '444': 0xf101, 'sq1': 0xf102, 'minx': 0xf103, '444bf': 0xf104, 'skewb': 0xf105, '333': 0xf106,
  '333bf': 0xf107, 'clock': 0xf108, '333mbo': 0xf109, '222': 0xf10a, 'magic': 0xf10b, '555': 0xf10c,
  '333fm': 0xf10d, '333mbf': 0xf10e, '333ft': 0xf10f, 'mmagic': 0xf110, '777': 0xf111, 'pyram': 0xf112,
  '666': 0xf113, '555bf': 0xf114, '333oh': 0xf115,
};

export function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

export function base64ToArrayBuffer(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

// ─── Fonts ────────────────────────────────────────────────────────────────────

let unicodeFontPromise = null;
/** Noto Sans (with CJK) as base64, also registered as a CSS font for the editor. */
export function loadUnicodeFont() {
  if (!unicodeFontPromise) {
    unicodeFontPromise = (async () => {
      const buf = await (await fetch(UNICODE_FONT_URL)).arrayBuffer();
      try {
        const face = new FontFace('CertNotoSans', buf);
        await face.load();
        document.fonts.add(face);
      } catch (e) { console.warn('Could not register Noto Sans for the editor', e); }
      return arrayBufferToBase64(buf);
    })().catch(e => { unicodeFontPromise = null; throw e; });
  }
  return unicodeFontPromise;
}

const customFaces = new Map();
/** Registers an uploaded TTF as a CSS font so the editor can display it. */
export async function registerCustomFontFace(name, base64) {
  if (customFaces.has(name)) return;
  const face = new FontFace(cssCustomFamily(name), base64ToArrayBuffer(base64));
  customFaces.set(name, face);
  await face.load();
  document.fonts.add(face);
}

export const cssCustomFamily = (name) => `CertCustom-${name.replace(/[^\w-]/g, '_')}`;

// ─── Event icons ──────────────────────────────────────────────────────────────

let iconFontPromise = null;
export function loadIconFont() {
  if (!iconFontPromise) {
    iconFontPromise = (async () => {
      const face = new FontFace('cubing-icons', `url(${new URL('icons/cubing-icons.woff2', ASSET_BASE)})`);
      await face.load();
      document.fonts.add(face);
    })().catch(e => { iconFontPromise = null; throw e; });
  }
  return iconFontPromise;
}

export const eventGlyph = (eventId) => EVENT_GLYPHS[eventId] ? String.fromCodePoint(EVENT_GLYPHS[eventId]) : '?';

const iconCache = new Map();
/** PNG data URL of an event icon in the given colour (square, transparent). */
export async function eventIconPng(eventId, color, px = 256) {
  const key = `${eventId}|${color}|${px}`;
  if (iconCache.has(key)) return iconCache.get(key);
  await loadIconFont();
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = px;
  const g = canvas.getContext('2d');
  g.fillStyle = color;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  if (EVENT_GLYPHS[eventId]) {
    g.font = `${px}px cubing-icons`;
    g.fillText(eventGlyph(eventId), px / 2, px / 2);
  } else {
    g.font = `bold ${px * 0.3}px sans-serif`;
    g.fillText(eventId, px / 2, px / 2);
  }
  const url = canvas.toDataURL('image/png');
  iconCache.set(key, url);
  return url;
}

// ─── Flags ────────────────────────────────────────────────────────────────────

export const flagUrl = (iso2) => new URL(`flags/${(iso2 || '').toLowerCase()}.svg`, ASSET_BASE).href;

const flagCache = new Map();
/** PNG data URL of a country flag (4:3), or null if there is no flag for that code. */
export function flagPng(iso2, widthPx = 640) {
  const key = `${iso2}|${widthPx}`;
  if (!flagCache.has(key)) {
    flagCache.set(key, (async () => {
      if (!/^[A-Za-z]{2}$/.test(iso2 || '')) return null;
      const res = await fetch(flagUrl(iso2));
      if (!res.ok) return null;
      const w = widthPx, h = Math.round(widthPx * 3 / 4);
      // Explicit width/height so every browser rasterises the SVG at the right size
      const svg = (await res.text()).replace('<svg', `<svg width="${w}" height="${h}" preserveAspectRatio="none"`);
      const img = await loadImage(URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' })));
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(img.src);
      return canvas.toDataURL('image/png');
    })().catch(() => null));
  }
  return flagCache.get(key);
}

// ─── Images ───────────────────────────────────────────────────────────────────

export function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not load image'));
    img.src = src;
  });
}

export function readFile(file, as = 'dataURL') {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    if (as === 'dataURL') r.readAsDataURL(file);
    else if (as === 'text') r.readAsText(file);
    else r.readAsArrayBuffer(file);
  });
}

/**
 * Turns an uploaded image file into an asset jsPDF can embed: PNG and JPEG are kept as-is,
 * anything else (SVG, WebP, GIF…) is rasterised to PNG. Large images are scaled down.
 */
export async function imageFileToAsset(file, maxPx = 2400) {
  const dataUrl = await readFile(file);
  const img = await loadImage(dataUrl);
  let w = img.naturalWidth || 1000, h = img.naturalHeight || 1000;
  const isPng = /^data:image\/png/.test(dataUrl), isJpeg = /^data:image\/jpe?g/.test(dataUrl);
  const scale = Math.min(1, maxPx / Math.max(w, h));
  if ((isPng || isJpeg) && scale === 1) {
    return { data: dataUrl, w, h, format: isPng ? 'PNG' : 'JPEG', name: file.name };
  }
  // SVGs without intrinsic size: rasterise at a reasonable resolution
  if (/^data:image\/svg/.test(dataUrl) && Math.max(w, h) < 1200) {
    const s = 1200 / Math.max(w, h); w *= s; h *= s;
  }
  w = Math.round(w * scale); h = Math.round(h * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const g = canvas.getContext('2d');
  g.drawImage(img, 0, 0, w, h);
  const keepJpeg = isJpeg;
  return {
    data: canvas.toDataURL(keepJpeg ? 'image/jpeg' : 'image/png', 0.92),
    w, h, format: keepJpeg ? 'JPEG' : 'PNG', name: file.name,
  };
}
