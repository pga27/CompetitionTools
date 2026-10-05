/**
 * data.js — WCIF parsing and placeholder resolution for the certificate generator.
 */

export const EVENT_NAMES = {
  '333': '3x3x3 Cube', '222': '2x2x2 Cube', '444': '4x4x4 Cube', '555': '5x5x5 Cube',
  '666': '6x6x6 Cube', '777': '7x7x7 Cube', '333bf': '3x3x3 Blindfolded',
  '333fm': '3x3x3 Fewest Moves', '333oh': '3x3x3 One-Handed', 'clock': 'Clock',
  'minx': 'Megaminx', 'pyram': 'Pyraminx', 'skewb': 'Skewb', 'sq1': 'Square-1',
  '444bf': '4x4x4 Blindfolded', '555bf': '5x5x5 Blindfolded', '333mbf': '3x3x3 Multi-Blind',
  '333ft': '3x3x3 With Feet', 'magic': 'Magic', 'mmagic': 'Master Magic', '333mbo': '3x3x3 Multi-Blind Old Style',
};

export const EVENT_ORDER = Object.keys(EVENT_NAMES);

export const PLACEHOLDERS = [
  ['name', 'Full name, as registered'],
  ['nameLatin', 'Name without the local-script part in parentheses'],
  ['nameLocal', 'Local-script name (text in parentheses), if any'],
  ['firstName', 'First word of the name'],
  ['lastName', 'Last word of the Latin name'],
  ['wcaId', 'WCA ID, or "Newcomer"'],
  ['country', 'Country name'],
  ['countryCode', 'ISO 3166 two-letter code'],
  ['registrantId', 'Registration number in this competition'],
  ['events', 'Event names, comma separated'],
  ['eventsShort', 'Event IDs (333, 222, …)'],
  ['eventCount', 'Number of events'],
  ['competition', 'Competition name'],
  ['competitionShort', 'Short competition name'],
  ['competitionId', 'Competition ID'],
  ['date', 'First day of the competition'],
  ['endDate', 'Last day of the competition'],
  ['dateRange', 'Date range, e.g. "12 – 13 October 2026"'],
  ['year', 'Competition year'],
];

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];

function parseDate(iso) {
  const [y, m, d] = (iso || '').split('-').map(Number);
  return y ? { y, m, d } : null;
}

function addDays({ y, m, d }, n) {
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
}

const fmtDate = (p) => p ? `${p.d} ${MONTHS[p.m - 1]} ${p.y}` : '';

function fmtRange(a, b) {
  if (!a) return '';
  if (!b || (a.y === b.y && a.m === b.m && a.d === b.d)) return fmtDate(a);
  if (a.y === b.y && a.m === b.m) return `${a.d} – ${b.d} ${MONTHS[a.m - 1]} ${a.y}`;
  if (a.y === b.y) return `${a.d} ${MONTHS[a.m - 1]} – ${b.d} ${MONTHS[b.m - 1]} ${a.y}`;
  return `${fmtDate(a)} – ${fmtDate(b)}`;
}

export function countryName(iso2) {
  // countryCodes is a global from countryList.js
  const map = typeof countryCodes !== 'undefined' ? countryCodes : {};
  return map[iso2] || iso2 || '';
}

/** Competition-level info extracted from a WCIF document. */
export function parseCompetition(wcif) {
  const start = parseDate(wcif.schedule?.startDate);
  const end = start ? addDays(start, Math.max(0, (wcif.schedule?.numberOfDays || 1) - 1)) : null;
  const eventIds = (wcif.events || []).map(e => e.id);

  // registrantIds with at least one result, per event (only populated after the competition)
  const resultsByEvent = {};
  for (const ev of wcif.events || []) {
    const ids = new Set();
    for (const round of ev.rounds || []) {
      for (const r of round.results || []) {
        if ((r.attempts || []).some(a => a.result !== 0)) ids.add(r.personId);
      }
    }
    resultsByEvent[ev.id] = ids;
  }
  const hasResults = Object.values(resultsByEvent).some(s => s.size > 0);

  return {
    id: wcif.id || '',
    name: wcif.name || '',
    shortName: wcif.shortName || wcif.name || '',
    startDate: start, endDate: end, eventIds, resultsByEvent, hasResults,
  };
}

/**
 * Competitors (accepted, competing registrations) with their events.
 * eventSource: 'registered' | 'results'
 */
export function parseCompetitors(wcif, comp, eventSource = 'registered') {
  const order = (id) => {
    const i = comp.eventIds.indexOf(id);
    return i >= 0 ? i : 100 + EVENT_ORDER.indexOf(id);
  };
  return (wcif.persons || [])
    .filter(p => p.registration && p.registration.status === 'accepted' && p.registration.isCompeting !== false)
    .map(p => {
      let events = [...(p.registration.eventIds || [])];
      if (eventSource === 'results') events = events.filter(e => comp.resultsByEvent[e]?.has(p.registrantId));
      events.sort((a, b) => order(a) - order(b));
      return {
        key: String(p.registrantId),
        name: p.name || '',
        wcaId: p.wcaId || '',
        countryIso2: p.countryIso2 || '',
        registrantId: p.registrantId,
        events,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export const SAMPLE_COMPETITION = {
  id: 'SampleOpen2026', name: 'Sample Open 2026', shortName: 'Sample Open 2026',
  startDate: { y: 2026, m: 10, d: 10 }, endDate: { y: 2026, m: 10, d: 11 },
  eventIds: ['333', '222', '444', '333oh', 'pyram', 'skewb', 'clock'], resultsByEvent: {}, hasResults: false,
};

export const SAMPLE_COMPETITOR = {
  key: 'sample', name: 'Maria Silva', wcaId: '2019SILV01', countryIso2: 'PT', registrantId: 1,
  events: ['333', '222', '333oh', 'pyram'],
};

/** Values for every placeholder, for one competitor. */
export function placeholderValues(person, comp) {
  const m = person.name.match(/^(.*?)\s*\(([^)]*)\)\s*$/);
  const latin = (m ? m[1] : person.name).trim();
  const words = latin.split(/\s+/).filter(Boolean);
  return {
    name: person.name,
    nameLatin: latin,
    nameLocal: m ? m[2].trim() : '',
    firstName: words[0] || '',
    lastName: words.length > 1 ? words[words.length - 1] : '',
    wcaId: person.wcaId || 'Newcomer',
    country: countryName(person.countryIso2),
    countryCode: person.countryIso2,
    registrantId: String(person.registrantId ?? ''),
    events: person.events.map(e => EVENT_NAMES[e] || e).join(', '),
    eventsShort: person.events.join(', '),
    eventCount: String(person.events.length),
    competition: comp.name,
    competitionShort: comp.shortName,
    competitionId: comp.id,
    date: fmtDate(comp.startDate),
    endDate: fmtDate(comp.endDate),
    dateRange: fmtRange(comp.startDate, comp.endDate),
    year: comp.startDate ? String(comp.startDate.y) : '',
  };
}

export function fillPlaceholders(text, values) {
  return (text || '').replace(/\{(\w+)\}/g, (all, k) => (k in values ? values[k] : all));
}

/** Whether an element's visibility condition holds for a competitor. */
export function conditionHolds(cond, person) {
  if (!cond || cond.type === 'always') return true;
  if (cond.type === 'newcomer') return !person.wcaId;
  if (cond.type === 'returning') return !!person.wcaId;
  if (cond.type === 'event') return person.events.includes(cond.event);
  if (cond.type === 'noEvent') return !person.events.includes(cond.event);
  return true;
}
