// Shared calendar utilities for TV displays
// Pulls live data from the Smartsheet "Operations Calendar Report" via the
// public Smartsheet API. The Report is the single source of truth — same
// rows the Smartsheet Calendar App shows on phones/tablets.

// ============ CREW COLOR PALETTE ============
// Colors mirror the Smartsheet Calendar App's per-crew swatches so a crew's
// jobs look the same on the boardroom TVs and on the user's phone app.
const CREW_COLORS = {
  'Milling':         '#3B5BA5', // navy/royal blue
  'Crackfill':       '#E2B33D', // goldenrod
  'Paving':          '#C13548', // brick red
  'Reclaim/Grading': '#C56F87', // rose pink
  'Hand':            '#8E83BD', // soft lavender
  'Pulverizing':     '#E89E7E', // salmon/peach
  'Subcontractor':   '#A8B143'  // olive/chartreuse
};

const CREW_SLUGS = {
  'Milling':         'milling',
  'Paving':          'paving',
  'Crackfill':       'crackfill',
  'Hand':            'hand',
  'Reclaim/Grading': 'reclaimgrading',
  'Pulverizing':     'pulverizing',
  'Subcontractor':   'subcontractor'
};

const CREW_CODES = {
  'Milling':         'MILL',
  'Paving':          'PAVE',
  'Crackfill':       'CRCK',
  'Hand':            'HAND',
  'Reclaim/Grading': 'RECL',
  'Pulverizing':     'PULV',
  'Subcontractor':   'SUBC'
};

function getCrewSlug(crew) { return CREW_SLUGS[crew] || 'milling'; }
function getCrewCode(crew) { return CREW_CODES[crew] || ''; }

// ============ SMARTSHEET API CONFIG ============
const SMARTSHEET_TOKEN = 'p24Cgh1izpdYeclFRk4gE6m9nCuEoBW5Nkywe';
// Operations Calendar Report — drives the Smartsheet Calendar App on phones
// AND these TV calendars. Single source of truth.
const REPORT_ID = '3854855551537028';

// Column IDs (from source sheet — report cells include columnId).
// Verified against report on 2026-05-06.
const COL = {
  JOB_NUM:       7358000912879492,
  COMPANY_NAME:  171009385385860,
  CITY:          3980301192351620,
  PHASE:         4824726122483588,
  START:         8765375796432772,
  END:           180389006757764,
  STATUS:        4683988634128260,
  ASSIGNED_CREW: 8202425843011460
};

// ============ DATE HELPERS ============
function parseSmartsheetDate(s) {
  if (!s) return null;
  const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const d = new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10));
  return isNaN(d.getTime()) ? null : d;
}

function parseDate(dateStr) { // CSV fallback (MM/DD/YY)
  if (!dateStr || dateStr.trim() === '') return null;
  const parts = dateStr.trim().split('/');
  if (parts.length !== 3) return null;
  const month = parseInt(parts[0], 10) - 1;
  const day = parseInt(parts[1], 10);
  const year = parseInt(parts[2], 10);
  const fullYear = year > 50 ? 1900 + year : 2000 + year;
  const date = new Date(fullYear, month, day);
  if (date.getMonth() !== month || date.getDate() !== day) return null;
  return date;
}

// ============ EVENT LOADING ============
async function loadEvents() {
  try {
    const events = await loadEventsFromReport();
    console.log(`[calendar] Loaded ${events.length} events from Operations Calendar Report`);
    return events;
  } catch (err) {
    console.warn('[calendar] Report API failed, falling back to CSV:', err);
    return loadEventsFromCSV();
  }
}

async function loadEventsFromReport() {
  const url = `https://api.smartsheet.com/2.0/reports/${REPORT_ID}?pageSize=10000`;
  const resp = await fetch(url, {
    headers: { 'Authorization': 'Bearer ' + SMARTSHEET_TOKEN }
  });
  if (!resp.ok) throw new Error('Report API HTTP ' + resp.status);
  const data = await resp.json();
  const rows = data.rows || [];

  function cellValue(row, columnId) {
    if (!row.cells) return null;
    for (const c of row.cells) {
      if (Number(c.columnId) === Number(columnId)) {
        return c.value !== undefined ? c.value : (c.displayValue !== undefined ? c.displayValue : null);
      }
    }
    return null;
  }

  const events = [];
  for (const row of rows) {
    const status   = cellValue(row, COL.STATUS);
    const jobNum   = cellValue(row, COL.JOB_NUM);
    const startVal = cellValue(row, COL.START);
    if (!jobNum || !startVal) continue;

    const startDate = parseSmartsheetDate(startVal);
    if (!startDate) continue;
    const endDate = parseSmartsheetDate(cellValue(row, COL.END)) || startDate;

    // The Report is what drives the App; trust its filtering.
    // We only do client-side cancellation skip as a belt-and-suspenders.
    if (status === 'Cancelled') continue;

    const crewRaw  = cellValue(row, COL.ASSIGNED_CREW);
    const phaseRaw = cellValue(row, COL.PHASE);
    events.push({
      jobNumber:    String(jobNum),
      client:       cellValue(row, COL.COMPANY_NAME) || '',
      city:         cellValue(row, COL.CITY) || '',
      // Fall back to Phase when Assigned Crew is blank so the event still
      // gets a color on the operations view.
      crew:         crewRaw || phaseRaw || '',
      phase:        phaseRaw || '',
      startDate:    startDate,
      endDate:      endDate,
      status:       status || ''
    });
  }
  return events;
}

// CSV fallback — used only if the Report API call fails.
async function loadEventsFromCSV() {
  try {
    const response = await fetch('operations-schedule.csv');
    if (!response.ok) throw new Error('CSV load error: ' + response.status);
    const csvText = await response.text();
    const { rows } = parseCSV(csvText);

    const events = [];
    rows.forEach(row => {
      if (!row['Job #'] || !row['Start Date']) return;
      if (row['Status'] === 'Cancelled') return;
      if (row['Split Parent'] && row['Split Parent'].trim().toUpperCase() === 'TRUE') return;
      const startDate = parseDate(row['Start Date']);
      const endDate = parseDate(row['End Date']);
      if (!startDate) return;
      events.push({
        jobNumber: row['Job #'],
        client:    row['Company Name'] || row['Client'] || '',
        city:      row['Job City'] || '',
        crew:      row['Assigned Crew'] || row['Phase'] || '',
        phase:     row['Phase'] || '',
        startDate: startDate,
        endDate:   endDate || startDate,
        status:    row['Status']
      });
    });
    return events;
  } catch (error) {
    console.error('Error loading events:', error);
    return [];
  }
}

// CSV parser
function parseCSVLine(line) {
  const result = [];
  let current = '';
  let insideQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (insideQuotes && line[i + 1] === '"') { current += '"'; i++; }
      else { insideQuotes = !insideQuotes; }
    } else if (char === ',' && !insideQuotes) {
      result.push(current.trim()); current = '';
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}
function parseCSV(csvText) {
  const lines = csvText.split('\n').filter(line => line.trim());
  if (lines.length < 2) return { headers: [], rows: [] };
  const headers = parseCSVLine(lines[0]);
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    const row = {};
    headers.forEach((header, idx) => { row[header] = values[idx] || ''; });
    rows.push(row);
  }
  return { headers, rows };
}

// ============ FILTER / DATE GRID ============
// Filter by Assigned Crew (was Phase). Each crew calendar passes its
// crew name (e.g. 'Milling'); operations passes null to show everything.
function filterEventsByCrew(events, crew) {
  if (!crew) return events;
  return events.filter(e => e.crew === crew);
}

// Backwards-compatible alias for any HTML still using the old name.
function filterEventsByPhase(events, crew) { return filterEventsByCrew(events, crew); }

function getCalendarDates(today) {
  const sevenDaysAgo = new Date(today);
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const startDate = new Date(sevenDaysAgo);
  startDate.setDate(startDate.getDate() - startDate.getDay());
  startDate.setHours(0, 0, 0, 0);
  const dates = [];
  const current = new Date(startDate);
  for (let i = 0; i < 42; i++) {
    dates.push(new Date(current));
    current.setDate(current.getDate() + 1);
  }
  return dates;
}

function getEventsForDate(events, date) {
  return events.filter(event => {
    const eventStart = new Date(event.startDate);
    const eventEnd = new Date(event.endDate);
    eventStart.setHours(0, 0, 0, 0);
    eventEnd.setHours(23, 59, 59, 999);
    const checkDate = new Date(date);
    checkDate.setHours(0, 0, 0, 0);
    return checkDate >= eventStart && checkDate <= eventEnd;
  });
}

function formatDateShort(date) {
  return new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
function formatMonthYear(date) {
  return new Date(date).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

// ============ ADAPTIVE DENSITY ============
function applyAdaptiveDensity() {
  const cells = document.querySelectorAll('.day-cell');
  cells.forEach(cell => {
    cell.classList.remove('density-2', 'density-3', 'density-4', 'density-max');
    const events = cell.querySelector('.events');
    if (!events) return;
    const levels = ['', 'density-2', 'density-3', 'density-4', 'density-max'];
    for (let i = 0; i < levels.length; i++) {
      if (levels[i]) cell.classList.add(levels[i]);
      const fits = events.scrollHeight <= events.clientHeight + 1;
      if (fits) return;
    }
  });
}

function bindAdaptiveDensityResize() {
  let t = null;
  window.addEventListener('resize', () => {
    clearTimeout(t);
    t = setTimeout(applyAdaptiveDensity, 150);
  });
}

function formatDateRange(startDate, endDate) {
  const start = new Date(startDate);
  const end = new Date(endDate);
  const startMonth = start.getMonth();
  const startYear = start.getFullYear();
  const endMonth = end.getMonth();
  const endYear = end.getFullYear();
  if (startMonth === endMonth && startYear === endYear) {
    return new Date(start).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  }
  const startMonthStr = new Date(start).toLocaleDateString('en-US', { month: 'long' });
  const endMonthYearStr = new Date(end).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  if (startYear === endYear) return `${startMonthStr} – ${endMonthYearStr}`;
  const startMonthYearStr = new Date(start).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  return `${startMonthYearStr} – ${endMonthYearStr}`;
}

// Backwards-compat aliases for templates still using the old phase names.
function getPhaseSlug(crew) { return getCrewSlug(crew); }
function getPhaseCode(crew) { return getCrewCode(crew); }
