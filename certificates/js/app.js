/**
 * app.js — certificate generator UI: template editor, competitor data and batch generation.
 */
import {
  EVENT_NAMES, EVENT_ORDER, PLACEHOLDERS, SAMPLE_COMPETITION, SAMPLE_COMPETITOR,
  parseCompetition, parseCompetitors, placeholderValues, fillPlaceholders, conditionHolds, countryName,
} from './data.js';
import {
  PT, STANDARD_FONTS, UNICODE_FONT, pageDims, layoutText, textBlockTop, layoutIcons,
  iconEvents, fitBox, prepareContext, renderCertificate, newDoc, effectiveFont,
} from './render.js';
import {
  loadIconFont, loadUnicodeFont, registerCustomFontFace, cssCustomFamily, eventGlyph, flagUrl,
  imageFileToAsset, readFile, arrayBufferToBase64,
} from './assets.js';
import {
  ELEMENT_DEFAULTS, defaultTemplate, exportTemplate, importTemplate, newId, elementLabel,
} from './template.js';

const $ = (id) => document.getElementById(id);
const STORAGE_KEY = 'wca-certificate-template';
const THEME_KEY = 'wca-certificate-theme';
const MM_PER_PX_100 = 25.4 / 96;

// ─── State ────────────────────────────────────────────────────────────────────

const state = {
  tpl: null,
  selectedId: null,
  scale: 3,
  wcif: null,
  comp: SAMPLE_COMPETITION,
  competitors: [],
  selected: new Set(),
  previewKey: null,
  history: [],
  future: [],
  snapshot: null,
};

// Fonts available to the editor's measuring document
const editorCtx = { unicodeFont: null, customFonts: {} };
// Rasterised flags/icons are cached here between generations
const genCtx = { flags: {}, icons: {} };
let measureDoc = null;

// ─── Small DOM helper ─────────────────────────────────────────────────────────

function h(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'style') Object.assign(node.style, v);
    else if (k.startsWith('on')) node[k] = v;
    else if (['value', 'checked', 'disabled', 'selected'].includes(k)) node[k] = v;
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    node.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return node;
}

let toastTimer = null;
function toast(msg, kind = '') {
  let el = $('toast');
  if (!el) {
    el = h('div', { id: 'toast', style: {
      position: 'fixed', bottom: '20px', left: '50%', transform: 'translateX(-50%)', padding: '8px 16px',
      borderRadius: '8px', background: '#111', color: '#fff', fontSize: '13px', zIndex: 9999,
      boxShadow: '0 4px 16px rgba(0,0,0,.4)', transition: 'opacity .3s',
    } });
    document.body.append(el);
  }
  el.textContent = msg;
  el.style.background = kind === 'error' ? '#b91c1c' : '#111';
  el.style.opacity = '1';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.style.opacity = '0'; }, kind === 'error' ? 6000 : 2500);
}

const round = (v, d = 1) => Math.round(v * 10 ** d) / 10 ** d;
const tpl = () => state.tpl;
const selectedEl = () => tpl().elements.find(e => e.id === state.selectedId) || null;

function previewPerson() {
  if (!state.competitors.length) return SAMPLE_COMPETITOR;
  return state.competitors.find(p => p.key === state.previewKey) || state.competitors[0];
}

// ─── History & persistence ────────────────────────────────────────────────────

const snapshotOf = (t) => JSON.stringify({ page: t.page, elements: t.elements });

function resetHistory() {
  state.history = [];
  state.future = [];
  state.snapshot = snapshotOf(tpl());
  updateUndoButtons();
}

/** Records the current template as an undo step (if it changed) and saves it. */
function commit() {
  const snap = snapshotOf(tpl());
  if (snap === state.snapshot) return;
  state.history.push(state.snapshot);
  if (state.history.length > 100) state.history.shift();
  state.snapshot = snap;
  state.future = [];
  updateUndoButtons();
  scheduleSave();
}

function restore(snap) {
  const { page, elements } = JSON.parse(snap);
  tpl().page = page;
  tpl().elements = elements;
  if (!selectedEl()) state.selectedId = null;
  renderAll();
  scheduleSave();
}

function undo() {
  if (!state.history.length) return;
  state.future.push(state.snapshot);
  state.snapshot = state.history.pop();
  restore(state.snapshot);
  updateUndoButtons();
}

function redo() {
  if (!state.future.length) return;
  state.history.push(state.snapshot);
  state.snapshot = state.future.pop();
  restore(state.snapshot);
  updateUndoButtons();
}

function updateUndoButtons() {
  $('undo-btn').disabled = !state.history.length;
  $('redo-btn').disabled = !state.future.length;
}

let saveTimer = null;
let warnedStorage = false;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(exportTemplate(tpl())));
      warnedStorage = false;
    } catch (e) {
      if (!warnedStorage) toast('Template is too large for browser storage — use "Save" to keep a copy.', 'error');
      warnedStorage = true;
    }
  }, 400);
}

function loadStoredTemplate() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return importTemplate(JSON.parse(raw));
  } catch (e) { console.warn('Ignoring stored template', e); }
  return defaultTemplate();
}

async function setTemplate(t) {
  state.tpl = t;
  state.selectedId = null;
  editorCtx.customFonts = {};
  for (const f of t.fonts) {
    editorCtx.customFonts[f.name] = f.data;
    registerCustomFontFace(f.name, f.data).then(renderCanvas).catch(e => console.warn(e));
  }
  measureDoc = null; // forget fonts registered for the previous template
  resetHistory();
  renderAll();
}

// ─── Canvas rendering ─────────────────────────────────────────────────────────

function getMeasureDoc() {
  if (!measureDoc) measureDoc = new window.jspdf.jsPDF({ unit: 'mm', format: 'a4' });
  return measureDoc;
}

function cssFont(font) {
  if (STANDARD_FONTS[font]) return STANDARD_FONTS[font].css;
  if (font === UNICODE_FONT) return 'CertNotoSans, sans-serif';
  return `"${cssCustomFamily(font)}", sans-serif`;
}

function computeScale() {
  const [pw, ph] = pageDims(tpl().page);
  const zoom = $('zoom').value;
  if (zoom !== 'fit') return parseFloat(zoom) / MM_PER_PX_100;
  const wrap = $('canvas-wrap');
  const aw = Math.max(200, wrap.clientWidth - 64), ah = Math.max(200, wrap.clientHeight - 64);
  return Math.min(aw / pw, ah / ph);
}

function renderAll() {
  renderCanvas();
  renderProps();
}

let pendingUnicodeLoad = false;
function requestUnicodeFont() {
  if (editorCtx.unicodeFont || pendingUnicodeLoad) return;
  pendingUnicodeLoad = true;
  loadUnicodeFont()
    .then(b64 => { editorCtx.unicodeFont = b64; measureDoc = null; renderCanvas(); })
    .catch(() => toast('Could not load the Unicode font.', 'error'))
    .finally(() => { pendingUnicodeLoad = false; });
}

function renderCanvas() {
  if (!state.tpl) return;
  const t = tpl();
  const [pw, ph] = pageDims(t.page);
  const s = state.scale = computeScale();
  const page = $('page');
  page.style.width = `${pw * s}px`;
  page.style.height = `${ph * s}px`;
  page.style.backgroundColor = t.page.background || '#ffffff';
  const bg = t.assets[t.page.backgroundAsset];
  page.style.backgroundImage = bg ? `url("${bg.data}")` : 'none';

  const person = previewPerson();
  const values = placeholderValues(person, state.comp);
  page.replaceChildren(...t.elements.map(el => renderElement(el, s, person, values)));
  $('preview-name').textContent = person === SAMPLE_COMPETITOR
    ? `${person.name} (sample — load a WCIF to use real data)`
    : `${person.name} · ${countryName(person.countryIso2)} · ${person.events.length} events`;
}

function renderElement(el, s, person, values) {
  const div = h('div', { class: 'el', 'data-id': el.id, style: {
    left: `${el.x * s}px`, top: `${el.y * s}px`, width: `${el.w * s}px`, height: `${el.h * s}px`,
    opacity: el.opacity ?? 1,
  } });
  if (!conditionHolds(el.condition, person)) {
    div.style.opacity = (el.opacity ?? 1) * 0.25;
    div.title = 'Not shown for this competitor (visibility condition)';
  }
  const rel = (b) => ({ left: `${(b.x - el.x) * s}px`, top: `${(b.y - el.y) * s}px`, width: `${b.w * s}px`, height: `${b.h * s}px` });

  if (el.type === 'text') {
    const text = fillPlaceholders(el.text, values);
    if (effectiveFont(el, text) === UNICODE_FONT) requestUnicodeFont();
    const doc = getMeasureDoc();
    const layout = layoutText(doc, el, text, editorCtx);
    const top = textBlockTop(el, layout);
    const style = STANDARD_FONTS[layout.font] ? (el.style || 'normal') : 'normal';
    layout.lines.forEach((line, i) => {
      div.append(h('div', { class: 'line-txt', style: {
        top: `${(top - el.y + i * layout.lineH) * s}px`,
        height: `${layout.lineH * s}px`, lineHeight: `${layout.lineH * s}px`,
        fontSize: `${layout.size * PT * s}px`, fontFamily: cssFont(layout.font),
        fontWeight: style.includes('bold') ? 'bold' : 'normal',
        fontStyle: style.includes('italic') ? 'italic' : 'normal',
        color: el.color, textAlign: el.align || 'left',
      } }, line));
    });
    if (!el.autoFit) {
      const tooTall = layout.lines.length * layout.lineH > el.h + 0.01;
      const tooWide = layout.lines.some(l => doc.getTextWidth(l) > el.w + 0.01);
      if (tooTall || tooWide) {
        div.classList.add('overflow');
        div.title = 'Text does not fit in its box for this competitor';
      }
    }
  } else if (el.type === 'shape') {
    const sw = (el.strokeWidth || 0) * s;
    if (el.shape === 'line') {
      const vertical = el.direction === 'vertical';
      div.append(h('div', { style: {
        position: 'absolute', background: el.stroke,
        ...(vertical
          ? { top: 0, bottom: 0, left: `${el.w * s / 2 - sw / 2}px`, width: `${sw}px` }
          : { left: 0, right: 0, top: `${el.h * s / 2 - sw / 2}px`, height: `${sw}px` }),
        borderRadius: el.lineCap === 'round' ? `${sw}px` : 0,
      } }));
    } else {
      div.append(h('div', { style: {
        position: 'absolute', inset: 0,
        background: el.fillEnabled !== false ? el.fill : 'transparent',
        border: sw > 0 ? `${sw}px solid ${el.stroke}` : 'none',
        borderRadius: el.shape === 'ellipse' ? '50%' : `${(el.radius || 0) * s + (sw > 0 ? sw / 2 : 0)}px`,
      } }));
    }
  } else if (el.type === 'image') {
    const asset = tpl().assets[el.asset];
    if (asset) div.append(h('img', { src: asset.data, alt: '', style: rel(fitBox(el, asset.w, asset.h, el.fit)) }));
    else div.append(h('div', { class: 'placeholder-box' }, 'No image — choose one in the properties panel'));
  } else if (el.type === 'flag') {
    const b = fitBox(el, 4, 3, el.fit);
    const sw = (el.strokeWidth || 0) * s;
    const img = h('img', { src: flagUrl(person.countryIso2), alt: person.countryIso2, style: {
      ...rel(b), objectFit: 'fill', boxSizing: 'border-box',
      outline: sw > 0 ? `${sw}px solid ${el.stroke}` : 'none', outlineOffset: `${-sw / 2}px`,
    } });
    img.onerror = () => { img.replaceWith(h('div', { class: 'placeholder-box' }, `No flag for "${person.countryIso2}"`)); };
    div.append(img);
  } else if (el.type === 'events') {
    const evs = iconEvents(el, person, state.comp);
    layoutIcons(el, evs.length).forEach((pos, i) => {
      div.append(h('span', { class: 'icon', title: EVENT_NAMES[evs[i].id] || evs[i].id, style: {
        left: `${(pos.x - el.x) * s}px`, top: `${(pos.y - el.y) * s}px`,
        width: `${pos.s * s}px`, height: `${pos.s * s}px`, fontSize: `${pos.s * s}px`,
        color: evs[i].active ? el.color : (el.dimColor || '#cccccc'),
      } }, eventGlyph(evs[i].id)));
    });
    if (!evs.length) div.append(h('div', { class: 'placeholder-box' }, 'No events for this competitor'));
  }

  if (el.id === state.selectedId) {
    div.classList.add('selected');
    for (const [dir, left, top] of [['nw', 0, 0], ['n', 50, 0], ['ne', 100, 0], ['e', 100, 50],
      ['se', 100, 100], ['s', 50, 100], ['sw', 0, 100], ['w', 0, 50]]) {
      div.append(h('div', { class: 'handle', 'data-dir': dir, style: { left: `${left}%`, top: `${top}%` } }));
    }
  }
  return div;
}

// ─── Dragging, resizing and snapping ──────────────────────────────────────────

let drag = null;

function snapTargets(exceptId) {
  const [pw, ph] = pageDims(tpl().page);
  const xs = [0, pw / 2, pw], ys = [0, ph / 2, ph];
  for (const o of tpl().elements) {
    if (o.id === exceptId) continue;
    xs.push(o.x, o.x + o.w / 2, o.x + o.w);
    ys.push(o.y, o.y + o.h / 2, o.y + o.h);
  }
  return { xs, ys };
}

/** Best snap offset for any of `points` onto `targets`, within the threshold. */
function bestSnap(points, targets, threshold) {
  let best = null;
  for (const p of points) for (const t of targets) {
    const d = t - p;
    if (Math.abs(d) <= threshold && (!best || Math.abs(d) < Math.abs(best.d))) best = { d, at: t };
  }
  return best;
}

function showGuides(gx, gy) {
  const page = $('page');
  page.querySelectorAll('.guide').forEach(g => g.remove());
  if (gx != null) page.append(h('div', { class: 'guide v', style: { left: `${gx * state.scale}px` } }));
  if (gy != null) page.append(h('div', { class: 'guide h', style: { top: `${gy * state.scale}px` } }));
}

function onPagePointerDown(e) {
  if (e.button !== 0) return;
  const handle = e.target.closest('.handle');
  const elDiv = e.target.closest('.el');
  if (!elDiv) {
    if (state.selectedId) { state.selectedId = null; renderAll(); }
    return;
  }
  e.preventDefault();
  const id = elDiv.dataset.id;
  if (id !== state.selectedId) { state.selectedId = id; renderAll(); }
  const el = selectedEl();
  drag = {
    mode: handle ? 'resize' : 'move', dir: handle?.dataset.dir,
    startX: e.clientX, startY: e.clientY, orig: { x: el.x, y: el.y, w: el.w, h: el.h }, moved: false,
  };
}

function onPointerMove(e) {
  if (!drag) return;
  const el = selectedEl();
  if (!el) { drag = null; return; }
  const dx = (e.clientX - drag.startX) / state.scale, dy = (e.clientY - drag.startY) / state.scale;
  if (!drag.moved && Math.hypot(dx, dy) * state.scale < 3) return;
  drag.moved = true;
  const snap = $('snap').checked && !e.altKey;
  const thr = 6 / state.scale;
  const { xs, ys } = snap ? snapTargets(el.id) : { xs: [], ys: [] };
  const o = drag.orig;
  let gx = null, gy = null;

  if (drag.mode === 'move') {
    let x = o.x + dx, y = o.y + dy;
    if (snap) {
      const sx = bestSnap([x, x + o.w / 2, x + o.w], xs, thr);
      const sy = bestSnap([y, y + o.h / 2, y + o.h], ys, thr);
      if (sx) { x += sx.d; gx = sx.at; } else x = Math.round(x * 2) / 2;
      if (sy) { y += sy.d; gy = sy.at; } else y = Math.round(y * 2) / 2;
    }
    el.x = round(x, 2); el.y = round(y, 2);
  } else {
    const d = drag.dir;
    let left = o.x, top = o.y, right = o.x + o.w, bottom = o.y + o.h;
    if (d.includes('w')) left += dx;
    if (d.includes('e')) right += dx;
    if (d.includes('n')) top += dy;
    if (d.includes('s')) bottom += dy;
    if (snap) {
      const snapEdge = (v, targets, isX) => {
        const sn = bestSnap([v], targets, thr);
        if (sn) { if (isX) gx = sn.at; else gy = sn.at; return v + sn.d; }
        return Math.round(v * 2) / 2;
      };
      if (d.includes('w')) left = snapEdge(left, xs, true);
      if (d.includes('e')) right = snapEdge(right, xs, true);
      if (d.includes('n')) top = snapEdge(top, ys, false);
      if (d.includes('s')) bottom = snapEdge(bottom, ys, false);
    }
    const MIN = 1;
    if (right - left < MIN) { if (d.includes('w')) left = right - MIN; else right = left + MIN; }
    if (bottom - top < MIN) { if (d.includes('n')) top = bottom - MIN; else bottom = top + MIN; }
    // Shift on a corner keeps the aspect ratio
    if (e.shiftKey && d.length === 2) {
      const ratio = o.w / o.h;
      const w = right - left;
      const hh = w / ratio;
      if (d.includes('n')) top = bottom - hh; else bottom = top + hh;
    }
    el.x = round(left, 2); el.y = round(top, 2);
    el.w = round(right - left, 2); el.h = round(bottom - top, 2);
  }
  renderCanvas();
  showGuides(gx, gy);
  updateGeometryInputs();
}

function onPointerUp() {
  if (!drag) return;
  const moved = drag.moved;
  drag = null;
  showGuides(null, null);
  if (moved) commit();
}

// ─── Element operations ───────────────────────────────────────────────────────

function centerOnPage(el) {
  const [pw, ph] = pageDims(tpl().page);
  el.x = round((pw - el.w) / 2, 2);
  el.y = round((ph - el.h) / 2, 2);
}

function addElement(el) {
  tpl().elements.push(el);
  state.selectedId = el.id;
  commit();
  renderAll();
}

let imagePickCallback = null;
function pickImage(cb) {
  imagePickCallback = cb;
  $('image-input').value = '';
  $('image-input').click();
}

async function imageToAsset(file) {
  const asset = await imageFileToAsset(file);
  const id = newId('img');
  tpl().assets[id] = asset;
  return id;
}

function addImageFromFile(file, at) {
  return imageToAsset(file).then(assetId => {
    const asset = tpl().assets[assetId];
    const el = ELEMENT_DEFAULTS.image();
    el.asset = assetId;
    const [pw, ph] = pageDims(tpl().page);
    el.w = Math.min(60, pw * 0.5);
    el.h = round(el.w * asset.h / asset.w, 2);
    if (el.h > ph * 0.5) { el.h = ph * 0.5; el.w = round(el.h * asset.w / asset.h, 2); }
    centerOnPage(el);
    if (at) { el.x = round(at.x - el.w / 2, 2); el.y = round(at.y - el.h / 2, 2); }
    addElement(el);
  }).catch(err => toast(err.message, 'error'));
}

function onAdd(kind) {
  if (kind === 'image') {
    pickImage(file => addImageFromFile(file));
    return;
  }
  const el = ELEMENT_DEFAULTS[kind]();
  centerOnPage(el);
  addElement(el);
}

function moveLayer(where) {
  const els = tpl().elements;
  const i = els.findIndex(e => e.id === state.selectedId);
  if (i < 0) return;
  const [el] = els.splice(i, 1);
  const j = { up: Math.min(els.length, i + 1), down: Math.max(0, i - 1), top: els.length, bottom: 0 }[where];
  els.splice(j, 0, el);
  commit();
  renderAll();
}

function duplicateSelected() {
  const el = selectedEl();
  if (!el) return;
  const copy = { ...JSON.parse(JSON.stringify(el)), id: newId(), x: el.x + 5, y: el.y + 5 };
  const els = tpl().elements;
  els.splice(els.indexOf(el) + 1, 0, copy);
  state.selectedId = copy.id;
  commit();
  renderAll();
}

function deleteSelected() {
  const els = tpl().elements;
  const i = els.findIndex(e => e.id === state.selectedId);
  if (i < 0) return;
  els.splice(i, 1);
  state.selectedId = null;
  commit();
  renderAll();
}

// ─── Fonts ────────────────────────────────────────────────────────────────────

let fontPickCallback = null;
function pickFont(cb) {
  fontPickCallback = cb;
  $('font-input').value = '';
  $('font-input').click();
}

async function addFontFromFile(file) {
  const buf = await readFile(file, 'arrayBuffer');
  const magic = new DataView(buf).getUint32(0);
  if (magic === 0x4f54544f) throw new Error('OpenType (CFF) fonts are not supported by the PDF engine. Please use a .ttf font.');
  if (magic !== 0x00010000 && magic !== 0x74727565) throw new Error('This file does not look like a TrueType (.ttf) font.');
  let name = file.name.replace(/\.[^.]+$/, '').replace(/[^\w -]/g, '').trim() || 'Custom font';
  const existing = new Set([...tpl().fonts.map(f => f.name), ...Object.keys(STANDARD_FONTS), UNICODE_FONT]);
  for (let n = 2; existing.has(name); n++) name = `${name.replace(/ \d+$/, '')} ${n}`;
  const data = arrayBufferToBase64(buf);
  await registerCustomFontFace(name, data);
  tpl().fonts.push({ name, data });
  editorCtx.customFonts[name] = data;
  scheduleSave();
  return name;
}

function removeFont(name) {
  tpl().fonts = tpl().fonts.filter(f => f.name !== name);
  delete editorCtx.customFonts[name];
  for (const el of tpl().elements) if (el.type === 'text' && el.font === name) el.font = 'helvetica';
  commit();
  scheduleSave();
  renderAll();
}

// ─── Properties panel ─────────────────────────────────────────────────────────

/** Called on every live edit from the panel. */
function changed() {
  renderCanvas();
}

function numField(obj, key, label, opts = {}) {
  const factor = opts.factor || 1;
  const input = h('input', {
    type: 'number', step: opts.step ?? 0.5, min: opts.min, max: opts.max,
    value: round((obj[key] ?? 0) * factor, 2),
  });
  if (opts.geom) input.dataset.geom = key;
  input.oninput = () => {
    let v = parseFloat(input.value);
    if (Number.isNaN(v)) return;
    if (opts.min != null) v = Math.max(opts.min, v);
    if (opts.max != null) v = Math.min(opts.max, v);
    obj[key] = v / factor;
    (opts.onInput || changed)();
  };
  input.onchange = commit;
  return h('label', { class: 'field' }, label, input);
}

function colorField(obj, key, label) {
  const picker = h('input', { type: 'color', value: obj[key] || '#000000' });
  const text = h('input', { type: 'text', value: obj[key] || '#000000', maxlength: 7 });
  picker.oninput = () => { obj[key] = text.value = picker.value; changed(); };
  picker.onchange = commit;
  text.onchange = () => {
    const v = text.value.trim();
    if (/^#[0-9a-f]{6}$/i.test(v)) { obj[key] = picker.value = v.toLowerCase(); changed(); commit(); }
    else text.value = obj[key];
  };
  return h('label', { class: 'field' }, label, h('div', { class: 'color-row' }, picker, text));
}

function selectField(obj, key, label, options, after) {
  const sel = h('select', {}, options.map(([v, l]) => h('option', { value: v, selected: obj[key] === v }, l)));
  sel.onchange = () => { obj[key] = sel.value; changed(); commit(); if (after) after(sel.value); };
  return h('label', { class: 'field' }, label, sel);
}

function checkField(obj, key, label, after) {
  const cb = h('input', { type: 'checkbox', checked: !!obj[key] });
  cb.onchange = () => { obj[key] = cb.checked; changed(); commit(); if (after) after(); };
  return h('label', { class: 'check' }, cb, label);
}

function toggleField(obj, key, label, options, after) {
  const group = h('div', { class: 'toggle-group' });
  const buttons = options.map(([v, l, title]) => {
    const b = h('button', { type: 'button', class: obj[key] === v ? 'on' : '', title: title || l }, l);
    b.onclick = () => {
      if (after) after(v);
      obj[key] = v;
      buttons.forEach(x => x.classList.toggle('on', x === b));
      changed(); commit();
    };
    return b;
  });
  group.append(...buttons);
  return h('div', { class: 'field' }, label, group);
}

function updateGeometryInputs() {
  const el = selectedEl();
  if (!el) return;
  $('props').querySelectorAll('input[data-geom]').forEach(input => {
    if (document.activeElement !== input) input.value = round(el[input.dataset.geom], 2);
  });
}

function eventOptions() {
  const ids = state.wcif ? state.comp.eventIds : EVENT_ORDER.filter(id => !['333ft', 'magic', 'mmagic', '333mbo'].includes(id));
  return ids.map(id => [id, EVENT_NAMES[id] || id]);
}

function renderProps() {
  const panel = $('props');
  const el = selectedEl();
  panel.replaceChildren(...(el ? elementProps(el) : pageProps()));
}

function elementProps(el) {
  const [pw, ph] = pageDims(tpl().page);
  const out = [];
  out.push(h('div', { class: 'props-title' },
    h('h2', {}, elementLabel(el).split(':')[0]),
    h('button', { class: 'btn small', onclick: () => { state.selectedId = null; renderAll(); } }, 'Done')));

  // Type-specific settings first: that's what people edit most
  if (el.type === 'text') out.push(...textProps(el));
  if (el.type === 'image') {
    out.push(h('h3', {}, 'Image'),
      h('button', { class: 'btn wide', onclick: () => pickImage(async file => {
        try { el.asset = await imageToAsset(file); commit(); renderAll(); } catch (err) { toast(err.message, 'error'); }
      }) }, el.asset ? 'Replace image…' : 'Choose image…'),
      selectField(el, 'fit', 'Fit', [['contain', 'Keep proportions'], ['stretch', 'Stretch to box']]));
    const asset = tpl().assets[el.asset];
    if (asset) out.push(h('button', { class: 'btn small', onclick: () => {
      el.h = round(el.w * asset.h / asset.w, 2); changed(); commit(); updateGeometryInputs();
    } }, 'Resize box to image proportions'));
  }
  if (el.type === 'shape') {
    out.push(h('h3', {}, 'Shape'));
    if (el.shape !== 'line') {
      out.push(checkField(el, 'fillEnabled', 'Fill', renderProps));
      if (el.fillEnabled !== false) out.push(colorField(el, 'fill', 'Fill colour'));
    }
    out.push(colorField(el, 'stroke', el.shape === 'line' ? 'Colour' : 'Border colour'),
      numField(el, 'strokeWidth', el.shape === 'line' ? 'Thickness (mm)' : 'Border width (mm, 0 = none)', { step: 0.1, min: 0 }));
    if (el.shape === 'rect') out.push(numField(el, 'radius', 'Corner radius (mm)', { step: 0.5, min: 0 }));
    if (el.shape === 'line') {
      out.push(toggleField(el, 'direction', 'Direction', [['horizontal', 'Horizontal'], ['vertical', 'Vertical']]),
        selectField(el, 'lineCap', 'Ends', [['butt', 'Square'], ['round', 'Round']]));
    }
  }
  if (el.type === 'flag') {
    out.push(h('h3', {}, 'Flag'),
      h('p', { class: 'hint' }, 'Shows the flag of each competitor\'s country.'),
      selectField(el, 'fit', 'Fit', [['contain', 'Keep proportions (4:3)'], ['stretch', 'Stretch to box']]),
      numField(el, 'strokeWidth', 'Border width (mm, 0 = none)', { step: 0.1, min: 0 }),
      colorField(el, 'stroke', 'Border colour'));
  }
  if (el.type === 'events') {
    out.push(h('h3', {}, 'Event icons'),
      selectField(el, 'mode', 'Show', [['registered', 'Only the competitor\'s events'], ['all', 'All competition events (others dimmed)']], renderProps),
      colorField(el, 'color', 'Icon colour'));
    if (el.mode === 'all') out.push(colorField(el, 'dimColor', 'Colour for events not entered'));
    out.push(numField(el, 'gap', 'Spacing (mm)', { step: 0.5, min: 0 }),
      toggleField(el, 'align', 'Alignment', [['left', 'Left'], ['center', 'Centre'], ['right', 'Right']]),
      checkField(el, 'wrap', 'Allow several rows'));
  }

  // Position & size
  out.push(h('h3', {}, 'Position & size (mm)'),
    h('div', { class: 'grid2' },
      numField(el, 'x', 'X', { geom: true, step: 0.5 }), numField(el, 'y', 'Y', { geom: true, step: 0.5 }),
      numField(el, 'w', 'Width', { geom: true, step: 0.5, min: 1 }), numField(el, 'h', 'Height', { geom: true, step: 0.5, min: 1 })),
    h('div', { class: 'btn-row' },
      h('button', { class: 'btn', onclick: () => { el.x = round((pw - el.w) / 2, 2); changed(); commit(); updateGeometryInputs(); } }, '↔ Centre'),
      h('button', { class: 'btn', onclick: () => { el.y = round((ph - el.h) / 2, 2); changed(); commit(); updateGeometryInputs(); } }, '↕ Centre'),
      h('button', { class: 'btn', title: 'Full page width with 20 mm margins', onclick: () => {
        el.x = 20; el.w = round(pw - 40, 2); changed(); commit(); updateGeometryInputs();
      } }, '⟷ Full width')),
    numField(el, 'opacity', 'Opacity (%)', { factor: 100, step: 5, min: 0, max: 100 }));

  // Visibility
  const cond = el.condition = el.condition || { type: 'always', event: '333' };
  out.push(h('h3', {}, 'Show on'),
    selectField(cond, 'type', 'Visible for', [
      ['always', 'Every competitor'], ['newcomer', 'Newcomers only'], ['returning', 'Returning competitors only'],
      ['event', 'Competitors in an event'], ['noEvent', 'Competitors not in an event'],
    ], renderProps));
  if (cond.type === 'event' || cond.type === 'noEvent') {
    if (!eventOptions().some(([v]) => v === cond.event)) cond.event = eventOptions()[0]?.[0];
    out.push(selectField(cond, 'event', 'Event', eventOptions()));
  }

  // Arrange
  out.push(h('h3', {}, 'Arrange'),
    h('div', { class: 'btn-row' },
      h('button', { class: 'btn', onclick: () => moveLayer('top'), title: 'Bring to front' }, '⤒ Front'),
      h('button', { class: 'btn', onclick: () => moveLayer('up'), title: 'Bring forward' }, '↑'),
      h('button', { class: 'btn', onclick: () => moveLayer('down'), title: 'Send backward' }, '↓'),
      h('button', { class: 'btn', onclick: () => moveLayer('bottom'), title: 'Send to back' }, '⤓ Back')),
    h('div', { class: 'btn-row' },
      h('button', { class: 'btn', onclick: duplicateSelected }, 'Duplicate'),
      h('button', { class: 'btn danger', onclick: deleteSelected }, 'Delete')));
  return out;
}

function textProps(el) {
  const out = [h('h3', {}, 'Text')];
  const ta = h('textarea', { id: 'text-input', rows: 3, value: el.text });
  ta.oninput = () => { el.text = ta.value; changed(); };
  ta.onchange = commit;
  const ins = h('select', {}, h('option', { value: '' }, 'Insert placeholder…'),
    PLACEHOLDERS.map(([k, d]) => h('option', { value: k }, `{${k}} — ${d}`)));
  ins.onchange = () => {
    if (!ins.value) return;
    const token = `{${ins.value}}`;
    const start = ta.selectionStart ?? ta.value.length, end = ta.selectionEnd ?? ta.value.length;
    ta.value = ta.value.slice(0, start) + token + ta.value.slice(end);
    el.text = ta.value;
    ins.value = '';
    changed(); commit();
    ta.focus();
    ta.setSelectionRange(start + token.length, start + token.length);
  };
  out.push(h('label', { class: 'field' }, 'Content', ta), ins);

  const fontOptions = [
    ...Object.entries(STANDARD_FONTS).map(([k, f]) => [k, f.label]),
    [UNICODE_FONT, 'Noto Sans (all scripts, incl. CJK)'],
    ...tpl().fonts.map(f => [f.name, f.name]),
    ['__upload', '＋ Upload TTF font…'],
  ];
  const prevFont = el.font;
  const fontSel = selectField(el, 'font', 'Font', fontOptions, (v) => {
    if (v === '__upload') {
      el.font = prevFont; // until a font is actually uploaded
      pickFont(async file => {
        try { el.font = await addFontFromFile(file); commit(); } catch (err) { toast(err.message, 'error'); }
        renderAll();
      });
    }
    renderProps();
  });
  out.push(fontSel);
  if (STANDARD_FONTS[el.font]) {
    out.push(selectField(el, 'style', 'Style', [['normal', 'Regular'], ['bold', 'Bold'], ['italic', 'Italic'], ['bolditalic', 'Bold italic']]),
      h('p', { class: 'hint' }, 'Names in non-Latin scripts automatically switch to Noto Sans.'));
  }
  out.push(
    h('div', { class: 'grid2' },
      numField(el, 'size', el.autoFit ? 'Max size (pt)' : 'Size (pt)', { step: 1, min: 2 }),
      numField(el, 'lineHeight', 'Line height', { step: 0.05, min: 0.5 })),
    colorField(el, 'color', 'Colour'),
    toggleField(el, 'align', 'Horizontal', [['left', '⇤ Left'], ['center', 'Centre'], ['right', 'Right ⇥']]),
    toggleField(el, 'valign', 'Vertical', [['top', 'Top'], ['middle', 'Middle'], ['bottom', 'Bottom']]),
    checkField(el, 'autoFit', 'Shrink text to fit the box', renderProps),
    checkField(el, 'wrap', 'Wrap long lines'),
    checkField(el, 'uppercase', 'UPPERCASE'),
  );
  return out;
}

/** Keeps the layout when the page size changes by scaling element boxes (font sizes are kept). */
function rescaleElements([ow, oh], [nw, nh]) {
  if (!ow || !oh || (ow === nw && oh === nh)) return;
  const sx = nw / ow, sy = nh / oh;
  for (const el of tpl().elements) {
    el.x = round(el.x * sx, 2); el.w = round(el.w * sx, 2);
    el.y = round(el.y * sy, 2); el.h = round(el.h * sy, 2);
  }
}

function pageProps() {
  const t = tpl();
  const page = t.page;
  const out = [h('div', { class: 'props-title' }, h('h2', {}, 'Page'))];
  const sizeOpts = [['a4', 'A4'], ['a5', 'A5'], ['a3', 'A3'], ['letter', 'US Letter'], ['legal', 'US Legal'], ['custom', 'Custom']];
  out.push(
    h('p', { class: 'hint' }, 'Select an element on the page to edit it, or add one from the toolbar.'),
    selectField(page, 'size', 'Paper size', sizeOpts, () => {
      if (page.size === 'custom') return renderAll();
      const old = [page.width, page.height];
      [page.width, page.height] = pageDims(page);
      rescaleElements(old, [page.width, page.height]);
      renderAll();
    }));
  if (page.size === 'custom') {
    const resize = () => { rescaleElements(lastDims, [page.width, page.height]); lastDims = [page.width, page.height]; changed(); };
    let lastDims = [page.width, page.height];
    out.push(h('div', { class: 'grid2' },
      numField(page, 'width', 'Width (mm)', { min: 20, step: 1, onInput: resize }),
      numField(page, 'height', 'Height (mm)', { min: 20, step: 1, onInput: resize })));
  } else {
    out.push(toggleField(page, 'orientation', 'Orientation', [['landscape', 'Landscape'], ['portrait', 'Portrait']], (v) => {
      if (v === page.orientation) return;
      const old = pageDims(page);
      rescaleElements(old, [old[1], old[0]]);
      [page.width, page.height] = [old[1], old[0]];
    }));
  }
  out.push(colorField(page, 'background', 'Background colour'),
    h('label', { class: 'field' }, 'Background image (stretched to the page)'),
    h('div', { class: 'btn-row' },
      h('button', { class: 'btn', onclick: () => pickImage(async file => {
        try { page.backgroundAsset = await imageToAsset(file); commit(); renderAll(); } catch (err) { toast(err.message, 'error'); }
      }) }, page.backgroundAsset ? 'Replace…' : 'Choose…'),
      page.backgroundAsset && h('button', { class: 'btn danger', onclick: () => { page.backgroundAsset = null; commit(); renderAll(); } }, 'Remove')),
    h('p', { class: 'hint' }, 'Tip: design the artwork in another tool and use it as the background, then place text fields on top.'));

  out.push(h('h3', {}, 'Elements'));
  const layers = h('ul', { class: 'layers' });
  [...t.elements].reverse().forEach(el => {
    layers.append(h('li', { onclick: () => { state.selectedId = el.id; renderAll(); } }, elementLabel(el)));
  });
  if (!t.elements.length) layers.append(h('li', {}, 'No elements yet'));
  out.push(layers, h('p', { class: 'hint' }, 'Top of the list is drawn on top.'));

  out.push(h('h3', {}, 'Custom fonts'));
  const fonts = h('ul', { class: 'font-list' });
  t.fonts.forEach(f => fonts.append(h('li', {}, h('span', { style: { fontFamily: cssFont(f.name) } }, f.name),
    h('button', { class: 'link', onclick: () => removeFont(f.name) }, 'remove'))));
  out.push(fonts, h('button', { class: 'btn', onclick: () => pickFont(async file => {
    try { await addFontFromFile(file); } catch (err) { toast(err.message, 'error'); }
    renderAll();
  }) }, '＋ Upload TTF font'));

  out.push(h('h3', {}, 'Placeholders'),
    h('p', { class: 'hint' }, 'Use these in any text field; they are replaced with each competitor\'s data. Click to copy.'));
  const list = h('ul', { class: 'placeholder-list' });
  PLACEHOLDERS.forEach(([k, d]) => {
    const code = h('code', { title: 'Copy' }, `{${k}}`);
    code.onclick = () => navigator.clipboard?.writeText(`{${k}}`).then(() => toast(`Copied {${k}}`));
    list.append(h('li', {}, code, ' ', h('span', { class: 'muted' }, d)));
  });
  out.push(list);
  return out;
}

// ─── Competition data ─────────────────────────────────────────────────────────

function setStatus(id, msg, kind = '') {
  const el = $(id);
  el.textContent = msg;
  el.className = `status ${kind}`;
}

function loadWcif(json) {
  if (!json || !Array.isArray(json.persons) || !Array.isArray(json.events)) {
    throw new Error('This does not look like a WCIF file (missing persons or events).');
  }
  state.wcif = json;
  recomputeCompetitors();
  const n = state.competitors.length;
  setStatus('data-status', `Loaded ${state.comp.name}: ${n} competitor${n === 1 ? '' : 's'}.`, n ? 'ok' : 'error');
  $('data-options').hidden = false;
  $('competitors-section').hidden = false;
}

function recomputeCompetitors() {
  const wcif = state.wcif;
  if (!wcif) return;
  state.comp = parseCompetition(wcif);
  const source = $('event-source').value;
  if (source === 'results' && !state.comp.hasResults) {
    toast('This WCIF has no results yet, so every competitor would have no events.', 'error');
  }
  let list = parseCompetitors(wcif, state.comp, source);
  if ($('skip-empty').checked) list = list.filter(p => p.events.length);
  state.competitors = list;
  state.selected = new Set(list.map(p => p.key));
  if (!list.some(p => p.key === state.previewKey)) state.previewKey = list[0]?.key ?? null;
  renderCompetitorList();
  renderAll();
}

function renderCompetitorList() {
  const q = $('comp-search').value.trim().toLowerCase();
  const ul = $('competitor-list');
  const shown = state.competitors.filter(p => !q ||
    p.name.toLowerCase().includes(q) || p.wcaId.toLowerCase().includes(q) ||
    countryName(p.countryIso2).toLowerCase().includes(q));
  ul.replaceChildren(...shown.map(p => {
    const cb = h('input', { type: 'checkbox', checked: state.selected.has(p.key) });
    cb.onchange = () => { if (cb.checked) state.selected.add(p.key); else state.selected.delete(p.key); updateSelectedCount(); };
    const name = h('span', { class: 'name', title: p.name }, p.name);
    name.onclick = () => { state.previewKey = p.key; renderCompetitorList(); renderCanvas(); };
    return h('li', { class: p.key === state.previewKey ? 'active' : '' }, cb, name,
      h('span', { class: 'meta' }, `${p.countryIso2} · ${p.events.length} ev${p.wcaId ? '' : ' · new'}`));
  }));
  if (!shown.length) ul.append(h('li', { class: 'muted' }, state.competitors.length ? 'No matches' : 'No competitors'));
  updateSelectedCount();
}

function updateSelectedCount() {
  $('selected-count').textContent = `${state.selected.size} of ${state.competitors.length} selected`;
}

function stepPreview(delta) {
  const list = state.competitors;
  if (!list.length) return;
  const i = Math.max(0, list.findIndex(p => p.key === state.previewKey));
  state.previewKey = list[(i + delta + list.length) % list.length].key;
  renderCompetitorList();
  renderCanvas();
  const active = $('competitor-list').querySelector('li.active');
  if (active) active.scrollIntoView({ block: 'nearest' });
}

async function handleWcifFile(file) {
  try {
    const json = JSON.parse(await readFile(file, 'text'));
    loadWcif(json);
    $('wcif-drop').classList.add('success');
    $('wcif-drop').textContent = `✓ ${file.name}`;
  } catch (err) {
    setStatus('data-status', err instanceof SyntaxError ? 'The file is not valid JSON.' : err.message, 'error');
  }
}

async function fetchWcif() {
  const id = $('comp-id').value.trim();
  if (!id) { setStatus('data-status', 'Please enter a competition ID.', 'error'); return; }
  setStatus('data-status', 'Fetching…');
  $('fetch-btn').disabled = true;
  try {
    const res = await fetch(`https://www.worldcubeassociation.org/api/v0/competitions/${encodeURIComponent(id)}/wcif/public`);
    if (!res.ok) throw new Error(res.status === 404 ? 'Competition not found. Check the ID.' : `WCA API error (${res.status}).`);
    loadWcif(await res.json());
  } catch (err) {
    setStatus('data-status', err.message === 'Failed to fetch' ? 'Could not reach the WCA website.' : err.message, 'error');
  } finally {
    $('fetch-btn').disabled = false;
  }
}

// ─── Generation ───────────────────────────────────────────────────────────────

function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

function safeFilename(name) {
  return name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '').replace(/\s+/g, ' ').trim().slice(0, 150);
}

const tick = () => new Promise(r => setTimeout(r, 0));

async function generate() {
  if (!state.wcif) { setStatus('gen-status', 'Load the competition WCIF first (step 1).', 'error'); return; }
  const people = state.competitors.filter(p => state.selected.has(p.key));
  if (!people.length) { setStatus('gen-status', 'No competitors selected.', 'error'); return; }

  const btn = $('generate-btn'), progress = $('gen-progress');
  btn.disabled = true;
  progress.hidden = false;
  progress.value = 0;
  progress.max = people.length;
  const t = tpl(), comp = state.comp;
  const started = performance.now();
  try {
    setStatus('gen-status', 'Preparing flags, icons and fonts…');
    await prepareContext(t, people, comp, genCtx);
    const pattern = $('filename-pattern').value || '{name}';
    const base = safeFilename(comp.id || 'certificates') || 'certificates';

    if ($('output-mode').value === 'merged') {
      const [pw, ph] = pageDims(t.page);
      const doc = newDoc(t);
      for (let i = 0; i < people.length; i++) {
        if (i > 0) doc.addPage([pw, ph], pw > ph ? 'landscape' : 'portrait');
        renderCertificate(doc, t, people[i], comp, genCtx);
        progress.value = i + 1;
        setStatus('gen-status', `Rendering ${i + 1} / ${people.length}…`);
        await tick();
      }
      download(doc.output('blob'), `${base}-certificates.pdf`);
    } else {
      const zip = new window.JSZip();
      const used = new Set();
      for (let i = 0; i < people.length; i++) {
        const p = people[i];
        const doc = newDoc(t);
        renderCertificate(doc, t, p, comp, genCtx);
        let name = safeFilename(fillPlaceholders(pattern, placeholderValues(p, comp))) || `certificate-${p.registrantId}`;
        for (let n = 2, orig = name; used.has(name.toLowerCase()); n++) name = `${orig} (${n})`;
        used.add(name.toLowerCase());
        zip.file(`${name}.pdf`, doc.output('arraybuffer'));
        progress.value = i + 1;
        setStatus('gen-status', `Rendering ${i + 1} / ${people.length}…`);
        await tick();
      }
      setStatus('gen-status', 'Compressing ZIP…');
      const blob = await zip.generateAsync({ type: 'blob' });
      download(blob, `${base}-certificates.zip`);
    }
    const secs = ((performance.now() - started) / 1000).toFixed(1);
    setStatus('gen-status', `Done: ${people.length} certificate${people.length === 1 ? '' : 's'} in ${secs}s.`, 'ok');
  } catch (err) {
    console.error(err);
    setStatus('gen-status', `Generation failed: ${err.message}`, 'error');
  } finally {
    btn.disabled = false;
    progress.hidden = true;
  }
}

let previewUrl = null;
async function previewPdf() {
  const btn = $('preview-pdf');
  btn.disabled = true;
  try {
    const person = previewPerson();
    await prepareContext(tpl(), [person], state.comp, genCtx);
    const doc = newDoc(tpl());
    renderCertificate(doc, tpl(), person, state.comp, genCtx);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = URL.createObjectURL(doc.output('blob'));
    $('pdf-frame').src = previewUrl;
    $('pdf-dialog-title').textContent = `Preview — ${person.name}`;
    $('pdf-dialog').showModal();
  } catch (err) {
    console.error(err);
    toast(`Preview failed: ${err.message}`, 'error');
  } finally {
    btn.disabled = false;
  }
}

// ─── Template files ───────────────────────────────────────────────────────────

function saveTemplateFile() {
  const json = JSON.stringify(exportTemplate(tpl()), null, 1);
  const name = safeFilename(state.wcif ? `${state.comp.id}-certificate-template` : 'certificate-template');
  download(new Blob([json], { type: 'application/json' }), `${name}.json`);
}

async function loadTemplateFile(file) {
  try {
    await setTemplate(importTemplate(JSON.parse(await readFile(file, 'text'))));
    scheduleSave();
    toast('Template loaded.');
  } catch (err) {
    toast(err instanceof SyntaxError ? 'The file is not valid JSON.' : err.message, 'error');
  }
}

// ─── Wiring ───────────────────────────────────────────────────────────────────

function isTyping() {
  const a = document.activeElement;
  return a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT' || a.isContentEditable);
}

function onKeyDown(e) {
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key.toLowerCase() === 'z' && !isTyping()) { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
  if (mod && e.key.toLowerCase() === 'y' && !isTyping()) { e.preventDefault(); redo(); return; }
  if (isTyping() || $('pdf-dialog').open) return;
  const el = selectedEl();
  if (!el) return;
  if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteSelected(); }
  else if (e.key === 'Escape') { state.selectedId = null; renderAll(); }
  else if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); duplicateSelected(); }
  else if (e.key.startsWith('Arrow')) {
    e.preventDefault();
    const step = e.shiftKey ? 5 : 0.5;
    if (e.key === 'ArrowLeft') el.x = round(el.x - step, 2);
    if (e.key === 'ArrowRight') el.x = round(el.x + step, 2);
    if (e.key === 'ArrowUp') el.y = round(el.y - step, 2);
    if (e.key === 'ArrowDown') el.y = round(el.y + step, 2);
    renderCanvas();
    updateGeometryInputs();
    clearTimeout(onKeyDown.t);
    onKeyDown.t = setTimeout(commit, 400);
  }
}

function setupDropzone(zone, onFile, accept) {
  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('over'));
  zone.addEventListener('drop', e => {
    e.preventDefault();
    zone.classList.remove('over');
    const file = [...e.dataTransfer.files].find(accept);
    if (file) onFile(file, e);
  });
}

function init() {
  if (!window.jspdf || !window.JSZip) {
    document.body.prepend(h('p', { style: { background: '#b91c1c', color: '#fff', padding: '8px', margin: 0 } },
      'Could not load the PDF libraries. Check your internet connection and reload the page.'));
    return;
  }

  // Theme
  const light = (() => { try { return localStorage.getItem(THEME_KEY) === 'light'; } catch { return false; } })();
  $('themeToggle').checked = light;
  document.body.classList.toggle('light-mode', light);
  $('themeToggle').onchange = () => {
    document.body.classList.toggle('light-mode', $('themeToggle').checked);
    try { localStorage.setItem(THEME_KEY, $('themeToggle').checked ? 'light' : 'dark'); } catch { /* ignore */ }
  };

  // Data source
  document.querySelectorAll('input[name="src"]').forEach(r => r.onchange = () => {
    const upload = document.querySelector('input[name="src"]:checked').value === 'upload';
    $('src-upload').hidden = !upload;
    $('src-fetch').hidden = upload;
  });
  $('wcif-drop').onclick = () => $('wcif-input').click();
  $('wcif-drop').onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') $('wcif-input').click(); };
  $('wcif-input').onchange = () => { const f = $('wcif-input').files[0]; if (f) handleWcifFile(f); };
  setupDropzone($('wcif-drop'), handleWcifFile, f => /json/i.test(f.type) || /\.json$/i.test(f.name));
  $('fetch-btn').onclick = fetchWcif;
  $('comp-id').onkeydown = (e) => { if (e.key === 'Enter') fetchWcif(); };
  $('event-source').onchange = recomputeCompetitors;
  $('skip-empty').onchange = recomputeCompetitors;
  $('comp-search').oninput = renderCompetitorList;
  $('select-all').onclick = () => { state.selected = new Set(state.competitors.map(p => p.key)); renderCompetitorList(); };
  $('select-none').onclick = () => { state.selected.clear(); renderCompetitorList(); };

  // Generation
  $('generate-btn').onclick = generate;
  $('preview-pdf').onclick = previewPdf;
  $('pdf-dialog-close').onclick = () => $('pdf-dialog').close();
  $('prev-person').onclick = () => stepPreview(-1);
  $('next-person').onclick = () => stepPreview(1);

  // Toolbar
  document.querySelectorAll('[data-add]').forEach(b => b.onclick = () => onAdd(b.dataset.add));
  $('undo-btn').onclick = undo;
  $('redo-btn').onclick = redo;
  $('zoom').onchange = renderCanvas;
  $('new-tpl').onclick = async () => {
    if (!confirm('Replace the current template with the default one? Save it first if you want to keep it.')) return;
    await setTemplate(defaultTemplate());
    scheduleSave();
  };
  $('save-tpl').onclick = saveTemplateFile;
  $('load-tpl').onclick = () => { $('tpl-input').value = ''; $('tpl-input').click(); };
  $('tpl-input').onchange = () => { const f = $('tpl-input').files[0]; if (f) loadTemplateFile(f); };
  $('image-input').onchange = () => {
    const f = $('image-input').files[0];
    if (f && imagePickCallback) imagePickCallback(f);
    imagePickCallback = null;
  };
  $('font-input').onchange = () => {
    const f = $('font-input').files[0];
    if (f && fontPickCallback) fontPickCallback(f);
    fontPickCallback = null;
  };

  // Canvas
  const page = $('page');
  page.addEventListener('pointerdown', onPagePointerDown);
  page.addEventListener('dblclick', (e) => {
    if (e.target.closest('.el') && selectedEl()?.type === 'text') { $('text-input')?.focus(); $('text-input')?.select(); }
  });
  $('canvas-wrap').addEventListener('pointerdown', (e) => {
    if (e.target === $('canvas-wrap') && state.selectedId) { state.selectedId = null; renderAll(); }
  });
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('keydown', onKeyDown);
  setupDropzone($('canvas-wrap'), (file, e) => {
    const r = page.getBoundingClientRect();
    addImageFromFile(file, { x: (e.clientX - r.left) / state.scale, y: (e.clientY - r.top) / state.scale });
  }, f => /^image\//.test(f.type));
  new ResizeObserver(() => { if ($('zoom').value === 'fit') renderCanvas(); }).observe($('canvas-wrap'));

  setTemplate(loadStoredTemplate());
  loadIconFont().then(renderCanvas).catch(() => toast('Could not load event icons.', 'error'));
}

init();
