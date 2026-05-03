/**
 * group_overview.js — Group overview PDF generator (browser / jsPDF).
 * Integrated into Competition Tools. Loaded as <script type="module">.
 *
 * Station modes, detected per group:
 *   'both'            → Competitor | Stn | Judge  (station-aligned rows)
 *   'competitor-only' → Stn | Competitor  (judges listed separately below)
 *   'none'            → Competitor | Judge  (no station column)
 */

// ─── CJK font (self-contained, mirrors main.js approach) ─────────────────────
let cjkFontBase64 = null;

async function loadCJKFont() {
  if (cjkFontBase64) return;
  try {
    const buf = await (await fetch('./fonts/NotoSansKR-Regular.ttf')).arrayBuffer();
    const bytes = new Uint8Array(buf);
    let bin = '';
    for (let i = 0; i < bytes.byteLength; i++) bin += String.fromCharCode(bytes[i]);
    cjkFontBase64 = btoa(bin);
  } catch (e) {
    console.warn('Could not load CJK font:', e);
  }
}

function registerCJKFont(doc) {
  if (!cjkFontBase64) return;
  doc.addFileToVFS('NotoSans-Regular.ttf', cjkFontBase64);
  doc.addFont('NotoSans-Regular.ttf', 'NotoSans', 'normal');
  doc.addFont('NotoSans-Regular.ttf', 'NotoSans', 'bold');
  doc.setFont('NotoSans', 'normal');
}

loadCJKFont(); // pre-load in background

// ─── Layout constants (mm, A4) ────────────────────────────────────────────────
const PW = 210, PH = 297, M = 8;          // page width/height/margin
const UW = PW - M * 2;                    // usable width
const GUTTER = 1.5;
const COL_MAIN = Math.round(UW * 2 / 3);
const COL_STAFF_W = UW - COL_MAIN - GUTTER;
const COL_STAFF_X = M + COL_MAIN + GUTTER;
const STN_W = 6;

const TITLE_H = 5.5, SUB_H = 3.5, ROW_H = 3.8, SECT_H = 3.2;
const FS_TITLE = 8, FS_SUB = 5.5, FS_ROW = 6, FS_SECT = 5;
const FOOTER_H = 5;
const USABLE_H = PH - M * 2 - FOOTER_H;

const C = {
  titleBg: [27, 63, 110],
  titleTxt: [255, 255, 255],
  subBg: [220, 230, 242],
  subFg: [27, 63, 110],
  alt: [239, 245, 252],
  staffAlt: [244, 248, 255],
  stnBg: [27, 63, 110],
  stnTxt: [255, 255, 255],
  border: [184, 200, 220],
  text: [17, 17, 17],
  sectBg: [226, 236, 248],
  sectFg: [27, 63, 110],
};

// ─── WCIF helpers ─────────────────────────────────────────────────────────────
function buildAssignmentLookup(wcif) {
  const lookup = {};
  for (const { name, assignments = [] } of wcif.persons)
    for (const { activityId, stationNumber, assignmentCode } of assignments)
      (lookup[activityId] ??= {})[name] = { stn: stationNumber ?? null, code: assignmentCode };
  return lookup;
}

function formatTime(iso, timezone) {
  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric', minute: '2-digit', hour12: true, timeZone: timezone,
  }).format(new Date(iso));
}

// ─── Data extraction ──────────────────────────────────────────────────────────
function extractGroupData(wcif) {
  const timezone = wcif.schedule.venues[0]?.timezone ?? 'UTC';
  const lookup = buildAssignmentLookup(wcif);
  const acts = [];
  for (const { rooms } of wcif.schedule.venues)
    for (const { name: roomName, activities } of rooms)
      for (const act of activities)
        for (const child of act.childActivities ?? [])
          acts.push({ ...child, roomName });
  acts.sort((a, b) => new Date(a.startTime) - new Date(b.startTime));

  return acts.map(act => {
    const comps = [], judges = [], scramblers = [], runners = [];
    for (const [name, { stn, code }] of Object.entries(lookup[act.id] ?? {})) {
      const e = { name, stn };
      if (code === 'competitor') comps.push(e);
      else if (code === 'staff-judge') judges.push(e);
      else if (code === 'staff-scrambler') scramblers.push(e);
      else if (code === 'staff-runner') runners.push(e);
    }

    const byStn = (a, b) => a.stn == null && b.stn == null ? a.name.localeCompare(b.name)
      : a.stn == null ? 1 : b.stn == null ? -1 : a.stn - b.stn;
    const byName = (a, b) => a.name.localeCompare(b.name);
    comps.sort(byStn); judges.sort(byStn);
    scramblers.sort(byName); runners.sort(byName);

    const hasStn = arr => arr.some(x => x.stn != null);
    const stationMode = hasStn(comps) && hasStn(judges) ? 'both'
      : hasStn(comps) ? 'competitor-only' : 'none';

    let rows, judgesUnassigned = [];

    if (stationMode === 'both') {
      const stns = [...new Set([...comps, ...judges].filter(x => x.stn != null).map(x => x.stn))].sort((a, b) => a - b);
      const cMap = Object.fromEntries(comps.filter(x => x.stn != null).map(x => [x.stn, x.name]));
      const jMap = Object.fromEntries(judges.filter(x => x.stn != null).map(x => [x.stn, x.name]));
      rows = stns.map(s => ({ station: s, competitor: cMap[s] ?? '', judge: jMap[s] ?? '' }));
      const cn = comps.filter(x => x.stn == null).map(x => x.name);
      const jn = judges.filter(x => x.stn == null).map(x => x.name);
      for (let i = 0; i < Math.max(cn.length, jn.length); i++)
        rows.push({ station: null, competitor: cn[i] ?? '', judge: jn[i] ?? '' });

    } else if (stationMode === 'competitor-only') {
      rows = comps.map(c => ({ station: c.stn, competitor: c.name, judge: '' }));
      judgesUnassigned = judges.map(j => j.name);

    } else {
      rows = Array.from({ length: Math.max(comps.length, judges.length) }, (_, i) => ({
        station: null, competitor: comps[i]?.name ?? '', judge: judges[i]?.name ?? '',
      }));
    }

    return {
      title: act.name, activityCode: act.activityCode, roomName: act.roomName,
      timeRange: `${formatTime(act.startTime, timezone)} - ${formatTime(act.endTime, timezone)}`,
      stationMode, rows, judgesUnassigned, scramblers, runners,
    };
  });
}

// ─── Height estimation ────────────────────────────────────────────────────────
function groupBlockHeight({ rows, judgesUnassigned: ju, scramblers: sc, runners: ru }) {
  const secH = arr => arr.length ? SECT_H + arr.length * ROW_H : 0;
  const mainH = TITLE_H + SUB_H + rows.length * ROW_H
    + (ju?.length ? SECT_H + Math.ceil(ju.length / 2) * ROW_H : 0);
  const staffH = TITLE_H + secH(sc) + secH(ru);
  return Math.max(mainH, staffH);
}

// ─── jsPDF drawing helpers ────────────────────────────────────────────────────
function filledRect(doc, x, y, w, h, rgb) {
  doc.setFillColor(...rgb);
  doc.rect(x, y, w, h, 'F');
}

function borderedRect(doc, x, y, w, h, rgb, lw = 0.15) {
  doc.setDrawColor(...rgb);
  doc.setLineWidth(lw);
  doc.rect(x, y, w, h, 'S');
}

function hline(doc, x1, x2, y, lw = 0.1) {
  doc.setDrawColor(...C.border);
  doc.setLineWidth(lw);
  doc.line(x1, y, x2, y);
}

function vline(doc, x, y1, y2, lw = 0.1) {
  doc.setDrawColor(...C.border);
  doc.setLineWidth(lw);
  doc.line(x, y1, x, y2);
}

// Clip text to fit within maxW using jsPDF's getStringUnitWidth
function clipText(doc, str, maxW, fontSize) {
  const scale = fontSize / doc.internal.scaleFactor;
  let out = str;
  while (out.length > 1 && doc.getStringUnitWidth(out) * scale > maxW)
    out = out.slice(0, -1);
  return out === str ? str : out.slice(0, -1) + '…';
}

function drawText(doc, str, x, y, { fontSize, color, bold = false, align = 'left', maxW } = {}) {
  doc.setFontSize(fontSize);
  doc.setTextColor(...color);
  doc.setFont('NotoSans', bold ? 'bold' : 'normal');
  const s = maxW ? clipText(doc, str, maxW, fontSize) : str;
  doc.text(s, x, y, { align, baseline: 'middle' });
}

// ─── Group rendering ──────────────────────────────────────────────────────────
function drawGroup(doc, group, startY) {
  const { stationMode: mode, rows, judgesUnassigned: ju, scramblers, runners } = group;
  const x0 = M;
  let y = startY;

  const showStn = mode !== 'none';
  const showJudge = mode !== 'competitor-only';
  const stnW = showStn ? STN_W : 0;

  let nameW, compX, stnX, judgeX;
  if (mode === 'both') {
    nameW = (COL_MAIN - stnW) / 2;
    compX = x0; stnX = x0 + nameW; judgeX = stnX + stnW;
  } else if (mode === 'competitor-only') {
    nameW = COL_MAIN - stnW;
    stnX = x0; compX = x0 + stnW; judgeX = null;
  } else {
    nameW = COL_MAIN / 2;
    compX = x0; stnX = null; judgeX = x0 + nameW;
  }

  const pad = 1;    // horizontal text padding
  const midH = h => y + h / 2;  // vertical center of a band at current y

  // Title bar
  filledRect(doc, x0, y, UW, TITLE_H, C.titleBg);
  drawText(doc, group.title, x0 + pad, midH(TITLE_H),
    { fontSize: FS_TITLE, color: C.titleTxt, bold: true, maxW: COL_MAIN - pad * 2 });
  drawText(doc, `${group.timeRange}  ·  ${group.roomName}`, COL_STAFF_X + pad, midH(TITLE_H),
    { fontSize: FS_TITLE - 1, color: C.titleTxt, maxW: COL_STAFF_W - pad });
  y += TITLE_H;

  // Sub-header
  filledRect(doc, x0, y, COL_MAIN, SUB_H, C.subBg);
  const compCount = rows.filter(r => r.competitor).length;
  const judgeCount = mode === 'competitor-only' ? ju.length : rows.filter(r => r.judge).length;

  drawText(doc, `Competitor (${compCount})`, compX + pad, midH(SUB_H),
    { fontSize: FS_SUB, color: C.subFg, bold: true, maxW: nameW - pad * 2 });
  if (showStn)
    drawText(doc, 'Stn', stnX + stnW / 2, midH(SUB_H),
      { fontSize: FS_SUB, color: C.subFg, bold: true, align: 'center' });
  if (showJudge) {
    vline(doc, judgeX, y, y + SUB_H);
    drawText(doc, `Judge (${judgeCount})`, judgeX + pad, midH(SUB_H),
      { fontSize: FS_SUB, color: C.subFg, bold: true, maxW: nameW - pad * 2 });
  }
  hline(doc, x0, x0 + COL_MAIN, y + SUB_H, 0.15);
  y += SUB_H;

  const rowsStartY = y;

  // Data rows
  rows.forEach((row, i) => {
    filledRect(doc, x0, y, COL_MAIN, ROW_H, i % 2 ? C.alt : [255, 255, 255]);

    if (row.competitor)
      drawText(doc, row.competitor, compX + pad, midH(ROW_H),
        { fontSize: FS_ROW, color: C.text, maxW: nameW - pad * 2 });

    if (showStn && row.station != null) {
      filledRect(doc, stnX + 0.4, y + 0.5, stnW - 0.8, ROW_H - 1, C.stnBg);
      drawText(doc, String(row.station), stnX + stnW / 2, midH(ROW_H),
        { fontSize: FS_ROW - 0.5, color: C.stnTxt, bold: true, align: 'center' });
    }

    if (showJudge) {
      vline(doc, judgeX, y + 0.3, y + ROW_H - 0.3);
      if (row.judge)
        drawText(doc, row.judge, judgeX + pad, midH(ROW_H),
          { fontSize: FS_ROW, color: C.text, maxW: nameW - pad * 2 });
    }

    hline(doc, x0, x0 + COL_MAIN, y + ROW_H);
    y += ROW_H;
  });

  // Unassigned judges section (competitor-only mode) — two columns
  if (mode === 'competitor-only' && ju.length) {
    filledRect(doc, x0, y, COL_MAIN, SECT_H, C.sectBg);
    drawText(doc, `Judges (${ju.length}) — no station assigned`, x0 + pad, midH(SECT_H),
      { fontSize: FS_SECT, color: C.sectFg, bold: true, maxW: COL_MAIN - pad * 2 });
    y += SECT_H;
    const half = Math.ceil(ju.length / 2), jColW = COL_MAIN / 2;
    for (let i = 0; i < half; i++) {
      filledRect(doc, x0, y, COL_MAIN, ROW_H, i % 2 ? C.alt : [255, 255, 255]);
      drawText(doc, `${i + 1}. ${ju[i]}`, x0 + pad, midH(ROW_H),
        { fontSize: FS_ROW, color: C.text, maxW: jColW - pad * 2 });
      if (ju[i + half]) {
        vline(doc, x0 + jColW, y + 0.3, y + ROW_H - 0.3);
        drawText(doc, `${i + half + 1}. ${ju[i + half]}`, x0 + jColW + pad, midH(ROW_H),
          { fontSize: FS_ROW, color: C.text, maxW: jColW - pad * 2 });
      }
      hline(doc, x0, x0 + COL_MAIN, y + ROW_H);
      y += ROW_H;
    }
  }

  const mainBottom = y;

  // Staff column (scramblers + runners)
  let sy = rowsStartY;
  const drawStaff = (label, people) => {
    if (!people.length) return;
    filledRect(doc, COL_STAFF_X, sy, COL_STAFF_W, SECT_H, C.sectBg);
    drawText(doc, `${label} (${people.length})`, COL_STAFF_X + pad, sy + SECT_H / 2,
      { fontSize: FS_SECT, color: C.sectFg, bold: true, maxW: COL_STAFF_W - pad * 2 });
    sy += SECT_H;
    people.forEach(({ name }, i) => {
      filledRect(doc, COL_STAFF_X, sy, COL_STAFF_W, ROW_H, i % 2 ? C.staffAlt : [255, 255, 255]);
      drawText(doc, `${i + 1}. ${name}`, COL_STAFF_X + pad, sy + ROW_H / 2,
        { fontSize: FS_ROW, color: C.text, maxW: COL_STAFF_W - pad * 2 });
      hline(doc, COL_STAFF_X, COL_STAFF_X + COL_STAFF_W, sy + ROW_H);
      sy += ROW_H;
    });
  };
  drawStaff('Scramblers', scramblers);
  drawStaff('Runners', runners);

  // Outer border + column separator
  const bottom = Math.max(mainBottom, sy);
  borderedRect(doc, x0, startY, UW, bottom - startY, C.border, 0.2);
  vline(doc, COL_STAFF_X - GUTTER / 2, startY, bottom, 0.2);

  return bottom + 2;
}

function drawFooter(doc, pageNum, total) {
  doc.setFontSize(7);
  doc.setTextColor(150, 150, 150);
  doc.setFont('NotoSans', 'normal');
  doc.text(`Page ${pageNum} of ${total}`, PW - M, PH - M / 2, { align: 'right', baseline: 'bottom' });
}

// ─── Page packing ─────────────────────────────────────────────────────────────
function packPages(groups) {
  const pages = [[]];
  let rem = USABLE_H;
  for (const g of groups) {
    const h = groupBlockHeight(g) + 2;
    if (h > rem && pages.at(-1).length) { pages.push([]); rem = USABLE_H; }
    pages.at(-1).push(g);
    rem -= h;
  }
  return pages;
}

// ─── Public entry point ───────────────────────────────────────────────────────

/**
 * Fetches WCIF, generates the group overview PDF and triggers download.
 * Called from the HTML button.
 */
window.generateGroupOverview = async function () {
  const compId = document.getElementById('go-comp-id').value.trim();
  const statusEl = document.getElementById('go-status');
  const btnEl = document.getElementById('go-btn');

  if (!compId) { statusEl.textContent = 'Please enter a competition ID.'; return; }

  statusEl.textContent = 'Fetching competition data…';
  btnEl.disabled = true;

  try {
    const res = await fetch(`https://www.worldcubeassociation.org/api/v0/competitions/${compId}/wcif/public`);
    if (!res.ok) throw new Error(`Could not fetch "${compId}". Check the ID.`);
    const wcif = await res.json();

    statusEl.textContent = 'Generating PDF…';

    // Ensure CJK font is loaded (reuses the loader already in main.js)
    await loadCJKFont();

    const groups = extractGroupData(wcif);
    if (!groups.length) throw new Error('No groups found in this competition.');

    const pages = packPages(groups);
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({
      orientation: 'p', unit: 'mm', format: 'a4',
      putOnlyUsedFonts: true, compress: true
    });
    registerCJKFont(doc);

    pages.forEach((pageGroups, i) => {
      if (i > 0) doc.addPage();
      let y = M;
      for (const g of pageGroups) y = drawGroup(doc, g, y);
      drawFooter(doc, i + 1, pages.length);
    });

    doc.save(`${compId}_group_overview.pdf`);
    statusEl.textContent = `Done — ${pages.length} page(s).`;
  } catch (err) {
    statusEl.textContent = `Error: ${err.message}`;
  } finally {
    btnEl.disabled = false;
  }
};