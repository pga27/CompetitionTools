/**
 * render.js — draws a certificate template onto a jsPDF document.
 * The editor uses the same layout helpers so what you see matches the PDF.
 * All coordinates are millimetres from the top-left corner of the page.
 */
import { fillPlaceholders, placeholderValues, conditionHolds } from './data.js';
import { flagPng, eventIconPng, loadUnicodeFont } from './assets.js';

export const PT = 25.4 / 72; // 1pt in mm

export const STANDARD_FONTS = {
  helvetica: { label: 'Helvetica', css: 'Helvetica, Arial, sans-serif', ascent: 0.905, descent: 0.212 },
  times: { label: 'Times', css: '"Times New Roman", Times, serif', ascent: 0.891, descent: 0.216 },
  courier: { label: 'Courier', css: '"Courier New", Courier, monospace', ascent: 0.833, descent: 0.300 },
};
export const UNICODE_FONT = 'NotoSans';
const UNICODE_METRICS = { ascent: 1.069, descent: 0.293 };
const CUSTOM_METRICS = { ascent: 0.9, descent: 0.25 };

export const PAGE_SIZES = {
  a4: [210, 297], a5: [148, 210], a3: [297, 420], letter: [215.9, 279.4], legal: [215.9, 355.6],
};

export function pageDims(page) {
  if (page.size === 'custom') return [page.width, page.height];
  const [w, h] = PAGE_SIZES[page.size] || PAGE_SIZES.a4;
  return page.orientation === 'landscape' ? [h, w] : [w, h];
}

const needsUnicode = (text) => /[^\x00-\xFF]/.test(text);

// jsPDF's standard fonts only cover Latin-1, so typographic punctuation is swapped for plain equivalents
const TYPOGRAPHIC = { '–': '-', '—': '-', '‘': "'", '’': "'", '‚': ',', '“': '"', '”': '"', '„': '"', '…': '...', '•': '·', '€': 'EUR' };

/**
 * The text and font actually drawn for an element. Standard fonts can't draw non-Latin
 * scripts, so such text falls back to Noto Sans.
 */
export function resolveText(el, text) {
  if (el.uppercase) text = text.toUpperCase();
  const font = el.font || 'helvetica';
  if (!STANDARD_FONTS[font]) return { text, font };
  const plain = text.replace(/[–—‘’‚“”„…•€]/g, c => TYPOGRAPHIC[c]);
  return needsUnicode(plain) ? { text, font: UNICODE_FONT } : { text: plain, font };
}

export const effectiveFont = (el, text) => resolveText(el, text).font;

export function fontMetrics(font) {
  return STANDARD_FONTS[font] || (font === UNICODE_FONT ? UNICODE_METRICS : CUSTOM_METRICS);
}

/** Make sure a font is available in a jsPDF document. Returns the jsPDF font name. */
export function ensureFont(doc, font, ctx) {
  if (STANDARD_FONTS[font]) return font;
  doc.__certFonts = doc.__certFonts || new Set();
  if (doc.__certFonts.has(font)) return font;
  const b64 = font === UNICODE_FONT ? ctx.unicodeFont : ctx.customFonts?.[font];
  if (!b64) return 'helvetica';
  const file = `${font.replace(/[^\w-]/g, '_')}.ttf`;
  doc.addFileToVFS(file, b64);
  // Only a regular face is available; alias the other styles to it so they don't crash
  for (const style of ['normal', 'bold', 'italic', 'bolditalic']) doc.addFont(file, font, style);
  doc.__certFonts.add(font);
  return font;
}

function setFont(doc, el, font, ctx) {
  font = ensureFont(doc, font, ctx);
  const style = STANDARD_FONTS[font] ? (el.style || 'normal') : 'normal';
  doc.setFont(font, style);
  return font;
}

/**
 * Lays out a text element: picks the font size (shrinking to fit when autoFit is on)
 * and splits the text into lines. Returns { font, size, lines, lineH } (lineH in mm).
 */
export function layoutText(doc, el, rawText, ctx) {
  const resolved = resolveText(el, rawText);
  const text = resolved.text;
  const font = setFont(doc, el, resolved.font, ctx);
  const lh = el.lineHeight || 1.2;
  const split = (size) => {
    doc.setFontSize(size);
    const paragraphs = text.split('\n');
    return el.wrap === false ? paragraphs : doc.splitTextToSize(text, el.w);
  };
  const fits = (size, lines) => {
    if (lines.length * size * PT * lh > el.h + 0.01) return false;
    doc.setFontSize(size);
    return lines.every(l => doc.getTextWidth(l) <= el.w + 0.01);
  };
  let size = el.size || 12;
  let lines = split(size);
  if (el.autoFit && !fits(size, lines)) {
    let lo = 2, hi = size;
    while (hi - lo > 0.25) {
      const mid = (lo + hi) / 2;
      if (fits(mid, split(mid))) lo = mid; else hi = mid;
    }
    size = Math.floor(lo * 4) / 4;
    lines = split(size);
  }
  doc.setFontSize(size);
  return { font, size, lines, lineH: size * PT * lh };
}

/** Y of the first line's top edge, honouring vertical alignment. */
export function textBlockTop(el, layout) {
  const total = layout.lines.length * layout.lineH;
  if (el.valign === 'middle') return el.y + (el.h - total) / 2;
  if (el.valign === 'bottom') return el.y + el.h - total;
  return el.y;
}

/** Positions for the event icons inside a box: [{ x, y, s }] (top-left + side, in mm). */
export function layoutIcons(el, count) {
  if (!count) return [];
  const gap = el.gap ?? 2;
  let best = { s: 0, rows: 1, cols: count };
  const maxRows = el.wrap === false ? 1 : count;
  for (let rows = 1; rows <= maxRows; rows++) {
    const cols = Math.ceil(count / rows);
    const s = Math.min((el.h - gap * (rows - 1)) / rows, (el.w - gap * (cols - 1)) / cols);
    if (s > best.s) best = { s, rows, cols };
  }
  const s = Math.min(best.s, el.maxIconSize || Infinity);
  const out = [];
  const totalH = best.rows * s + (best.rows - 1) * gap;
  const y0 = el.y + (el.h - totalH) / 2;
  for (let r = 0; r < best.rows; r++) {
    const n = Math.min(best.cols, count - r * best.cols);
    const rowW = n * s + (n - 1) * gap;
    let x0 = el.x;
    if (el.align === 'center') x0 = el.x + (el.w - rowW) / 2;
    else if (el.align === 'right') x0 = el.x + el.w - rowW;
    for (let c = 0; c < n; c++) out.push({ x: x0 + c * (s + gap), y: y0 + r * (s + gap), s });
  }
  return out;
}

/** Which events an icon element shows, and whether each one is "active" for this competitor. */
export function iconEvents(el, person, comp) {
  if (el.mode === 'all') return comp.eventIds.map(id => ({ id, active: person.events.includes(id) }));
  return person.events.map(id => ({ id, active: true }));
}

/** Fits an image of natural size (iw, ih) inside a box. */
export function fitBox(box, iw, ih, fit) {
  if (fit === 'stretch' || !iw || !ih) return { x: box.x, y: box.y, w: box.w, h: box.h };
  const s = Math.min(box.w / iw, box.h / ih);
  const w = iw * s, h = ih * s;
  return { x: box.x + (box.w - w) / 2, y: box.y + (box.h - h) / 2, w, h };
}

const hex = (c) => c || '#000000';

function withOpacity(doc, opacity, fn) {
  if (opacity == null || opacity >= 1) return fn();
  doc.saveGraphicsState();
  doc.setGState(new doc.GState({ opacity, 'stroke-opacity': opacity }));
  try { fn(); } finally { doc.restoreGraphicsState(); }
}

function drawText(doc, el, values, ctx) {
  const text = fillPlaceholders(el.text, values);
  if (!text.trim()) return;
  const layout = layoutText(doc, el, text, ctx);
  const m = fontMetrics(layout.font);
  const sizeMm = layout.size * PT;
  doc.setTextColor(hex(el.color));
  const top = textBlockTop(el, layout);
  const x = el.align === 'center' ? el.x + el.w / 2 : el.align === 'right' ? el.x + el.w : el.x;
  layout.lines.forEach((line, i) => {
    // Baseline as CSS would place it: half-leading above the font's content area
    const baseline = top + i * layout.lineH + (layout.lineH - (m.ascent + m.descent) * sizeMm) / 2 + m.ascent * sizeMm;
    doc.text(line, x, baseline, { align: el.align || 'left', baseline: 'alphabetic' });
  });
}

function drawShape(doc, el) {
  const sw = el.strokeWidth || 0;
  const fill = el.fill && el.fillEnabled !== false;
  const stroke = sw > 0;
  if (stroke) { doc.setDrawColor(hex(el.stroke)); doc.setLineWidth(sw); }
  if (fill) doc.setFillColor(hex(el.fill));
  if (el.shape === 'line') {
    if (!stroke) return;
    doc.setLineCap(el.lineCap === 'round' ? 'round' : 'butt');
    if (el.direction === 'vertical') doc.line(el.x + el.w / 2, el.y, el.x + el.w / 2, el.y + el.h);
    else doc.line(el.x, el.y + el.h / 2, el.x + el.w, el.y + el.h / 2);
    return;
  }
  const style = fill && stroke ? 'FD' : fill ? 'F' : stroke ? 'S' : null;
  if (!style) return;
  // Inset the stroke so it stays inside the box, matching the editor
  const i = stroke ? sw / 2 : 0;
  const x = el.x + i, y = el.y + i, w = el.w - 2 * i, h = el.h - 2 * i;
  if (el.shape === 'ellipse') doc.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, style);
  else if (el.radius > 0) {
    const r = Math.min(el.radius, w / 2, h / 2);
    doc.roundedRect(x, y, w, h, r, r, style);
  } else doc.rect(x, y, w, h, style);
}

function drawImage(doc, el, ctx) {
  const asset = ctx.assets[el.asset];
  if (!asset) return;
  const b = fitBox(el, asset.w, asset.h, el.fit);
  doc.addImage(asset.data, asset.format, b.x, b.y, b.w, b.h, `asset-${el.asset}`, 'FAST');
}

function drawFlag(doc, el, person, ctx) {
  const png = ctx.flags[person.countryIso2];
  if (!png) return;
  const b = fitBox(el, 4, 3, el.fit);
  doc.addImage(png, 'PNG', b.x, b.y, b.w, b.h, `flag-${person.countryIso2}`, 'FAST');
  if (el.strokeWidth > 0) {
    doc.setDrawColor(hex(el.stroke));
    doc.setLineWidth(el.strokeWidth);
    doc.rect(b.x, b.y, b.w, b.h, 'S');
  }
}

function drawIcons(doc, el, person, comp, ctx) {
  const evs = iconEvents(el, person, comp);
  layoutIcons(el, evs.length).forEach((pos, i) => {
    const { id, active } = evs[i];
    const color = active ? hex(el.color) : hex(el.dimColor || '#cccccc');
    const png = ctx.icons[`${id}|${color}`];
    if (png) doc.addImage(png, 'PNG', pos.x, pos.y, pos.s, pos.s, `icon-${id}-${color}`, 'FAST');
  });
}

/** Loads flags, icons and fonts a set of competitors will need. Fills ctx caches. */
export async function prepareContext(template, people, comp, ctx) {
  ctx.assets = template.assets;
  ctx.customFonts = Object.fromEntries((template.fonts || []).map(f => [f.name, f.data]));
  ctx.flags = ctx.flags || {};
  ctx.icons = ctx.icons || {};
  const els = template.elements;
  const jobs = [];
  if (els.some(e => e.type === 'flag')) {
    for (const iso of new Set(people.map(p => p.countryIso2))) {
      if (!(iso in ctx.flags)) jobs.push(flagPng(iso).then(png => { ctx.flags[iso] = png; }));
    }
  }
  for (const el of els.filter(e => e.type === 'events')) {
    const ids = el.mode === 'all' ? comp.eventIds : [...new Set(people.flatMap(p => p.events))];
    const colors = [hex(el.color), ...(el.mode === 'all' ? [hex(el.dimColor || '#cccccc')] : [])];
    for (const id of ids) for (const color of colors) {
      const key = `${id}|${color}`;
      if (!(key in ctx.icons)) jobs.push(eventIconPng(id, color).then(png => { ctx.icons[key] = png; }));
    }
  }
  const texts = els.filter(e => e.type === 'text');
  const needsNoto = texts.some(e => e.font === UNICODE_FONT) || people.some(p => {
    const values = placeholderValues(p, comp);
    return texts.some(e => effectiveFont(e, fillPlaceholders(e.text, values)) === UNICODE_FONT);
  });
  if (needsNoto && !ctx.unicodeFont) jobs.push(loadUnicodeFont().then(b64 => { ctx.unicodeFont = b64; }));
  await Promise.all(jobs);
}

/** Draws one certificate on the current page of doc. prepareContext() must have run first. */
export function renderCertificate(doc, template, person, comp, ctx) {
  const [pw, ph] = pageDims(template.page);
  const page = template.page;
  if (page.background && page.background.toLowerCase() !== '#ffffff') {
    doc.setFillColor(page.background);
    doc.rect(0, 0, pw, ph, 'F');
  }
  const bg = ctx.assets[page.backgroundAsset];
  if (bg) doc.addImage(bg.data, bg.format, 0, 0, pw, ph, `asset-${page.backgroundAsset}`, 'FAST');

  const values = placeholderValues(person, comp);
  for (const el of template.elements) {
    if (el.hidden || !conditionHolds(el.condition, person)) continue;
    withOpacity(doc, el.opacity, () => {
      if (el.type === 'text') drawText(doc, el, values, ctx);
      else if (el.type === 'shape') drawShape(doc, el);
      else if (el.type === 'image') drawImage(doc, el, ctx);
      else if (el.type === 'flag') drawFlag(doc, el, person, ctx);
      else if (el.type === 'events') drawIcons(doc, el, person, comp, ctx);
    });
  }
}

export function newDoc(template) {
  const [pw, ph] = pageDims(template.page);
  return new window.jspdf.jsPDF({
    unit: 'mm', format: [pw, ph], orientation: pw > ph ? 'landscape' : 'portrait',
    compress: true, putOnlyUsedFonts: true,
  });
}
