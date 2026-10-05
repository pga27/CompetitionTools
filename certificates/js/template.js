/**
 * template.js — template data model: defaults, new elements, (de)serialisation.
 */

export const TEMPLATE_FORMAT = 'wca-certificate-template';
export const TEMPLATE_VERSION = 1;

let idCounter = 0;
export const newId = (prefix = 'el') => `${prefix}${Date.now().toString(36)}${(idCounter++).toString(36)}`;

const common = () => ({ id: newId(), condition: { type: 'always', event: '333' }, opacity: 1 });

export const ELEMENT_DEFAULTS = {
  text: () => ({
    ...common(), type: 'text', w: 120, h: 12, text: 'New text {name}', font: 'helvetica', style: 'normal',
    size: 18, color: '#222222', align: 'center', valign: 'middle', lineHeight: 1.2, autoFit: true, wrap: true, uppercase: false,
  }),
  image: () => ({ ...common(), type: 'image', w: 40, h: 40, asset: null, fit: 'contain' }),
  rect: () => ({ ...common(), type: 'shape', shape: 'rect', w: 60, h: 30, fill: '#dbe7f5', fillEnabled: true, stroke: '#1b3f6e', strokeWidth: 0.5, radius: 0 }),
  ellipse: () => ({ ...common(), type: 'shape', shape: 'ellipse', w: 30, h: 30, fill: '#dbe7f5', fillEnabled: true, stroke: '#1b3f6e', strokeWidth: 0.5 }),
  line: () => ({ ...common(), type: 'shape', shape: 'line', w: 80, h: 2, stroke: '#1b3f6e', strokeWidth: 0.6, direction: 'horizontal', fillEnabled: false }),
  flag: () => ({ ...common(), type: 'flag', w: 20, h: 15, fit: 'contain', stroke: '#999999', strokeWidth: 0.2 }),
  events: () => ({ ...common(), type: 'events', w: 150, h: 14, mode: 'registered', color: '#1b3f6e', dimColor: '#d0d5dc', gap: 3, align: 'center', wrap: true }),
};

export const ELEMENT_LABELS = {
  text: 'Text', image: 'Image', shape: 'Shape', flag: 'Country flag', events: 'Event icons',
};

export function elementLabel(el) {
  if (el.type === 'text') return `Text: ${(el.text || '').split('\n')[0].slice(0, 24) || '(empty)'}`;
  if (el.type === 'shape') return { rect: 'Rectangle', ellipse: 'Ellipse', line: 'Line' }[el.shape] || 'Shape';
  return ELEMENT_LABELS[el.type] || el.type;
}

const T = (props) => ({ ...ELEMENT_DEFAULTS.text(), ...props });

export function defaultTemplate() {
  const navy = '#1b3f6e', gold = '#b8901f';
  return {
    page: { size: 'a4', orientation: 'landscape', width: 297, height: 210, background: '#ffffff', backgroundAsset: null },
    assets: {},
    fonts: [],
    elements: [
      { ...ELEMENT_DEFAULTS.rect(), x: 8, y: 8, w: 281, h: 194, fillEnabled: false, stroke: navy, strokeWidth: 1.6, radius: 3 },
      { ...ELEMENT_DEFAULTS.rect(), x: 12.5, y: 12.5, w: 272, h: 185, fillEnabled: false, stroke: gold, strokeWidth: 0.5, radius: 1.5 },
      T({ x: 20, y: 24, w: 257, h: 20, text: 'CERTIFICATE', font: 'times', style: 'bold', size: 44, color: navy }),
      T({ x: 20, y: 44, w: 257, h: 9, text: 'OF PARTICIPATION', style: 'bold', size: 14, color: gold }),
      T({ x: 20, y: 64, w: 257, h: 8, text: 'This certificate is proudly presented to', style: 'italic', size: 13, color: '#444444' }),
      T({ x: 30, y: 74, w: 237, h: 20, text: '{name}', font: 'times', style: 'bold', size: 36, color: '#111111', wrap: false }),
      { ...ELEMENT_DEFAULTS.line(), x: 78, y: 94, w: 141, h: 2, stroke: gold, strokeWidth: 0.6 },
      { ...ELEMENT_DEFAULTS.flag(), x: 141.5, y: 99, w: 14, h: 10.5 },
      T({ x: 20, y: 111, w: 257, h: 7, text: '{country} · {wcaId}', size: 12, color: '#444444' }),
      T({ x: 35, y: 123, w: 227, h: 14, text: 'for taking part in {competition}, held on {dateRange}, competing in the following events:', size: 13, color: '#333333' }),
      { ...ELEMENT_DEFAULTS.events(), x: 40, y: 142, w: 217, h: 13, color: navy },
      T({ x: 20, y: 160, w: 257, h: 7, text: 'Welcome to the WCA community!', style: 'bolditalic', size: 11, color: gold,
        condition: { type: 'newcomer', event: '333' } }),
      { ...ELEMENT_DEFAULTS.line(), x: 40, y: 178, w: 75, h: 2, stroke: '#555555', strokeWidth: 0.3 },
      { ...ELEMENT_DEFAULTS.line(), x: 182, y: 178, w: 75, h: 2, stroke: '#555555', strokeWidth: 0.3 },
      T({ x: 40, y: 181, w: 75, h: 6, text: 'Organizer', size: 10, color: '#555555' }),
      T({ x: 182, y: 181, w: 75, h: 6, text: 'WCA Delegate', size: 10, color: '#555555' }),
    ],
  };
}

/** Serialisable template with only the assets that are actually referenced. */
export function exportTemplate(tpl) {
  const used = new Set([tpl.page.backgroundAsset, ...tpl.elements.map(e => e.asset)].filter(Boolean));
  const assets = Object.fromEntries(Object.entries(tpl.assets).filter(([id]) => used.has(id)));
  return { format: TEMPLATE_FORMAT, version: TEMPLATE_VERSION, page: tpl.page, elements: tpl.elements, assets, fonts: tpl.fonts || [] };
}

export function importTemplate(obj) {
  if (!obj || obj.format !== TEMPLATE_FORMAT || !obj.page || !Array.isArray(obj.elements)) {
    throw new Error('This file is not a certificate template.');
  }
  const base = defaultTemplate();
  return {
    page: { ...base.page, ...obj.page },
    assets: obj.assets || {},
    fonts: obj.fonts || [],
    elements: obj.elements.map(el => {
      const key = el.type === 'shape' ? el.shape : el.type;
      const defaults = ELEMENT_DEFAULTS[key] ? ELEMENT_DEFAULTS[key]() : {};
      return { ...defaults, ...el, id: el.id || newId() };
    }),
  };
}
