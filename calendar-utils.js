// Shared calendar utilities for TV displays
// Pulls live data from the Smartsheet Operations Schedule via the
// public Smartsheet API. Falls back to the local CSV snapshot if the
// API call fails so the TVs never blank out.

// ============ PHASE COLOR PALETTE ============
// Milling moved from burnt orange to deep teal/cyan to separate it from
// Paving (brick red) and Crackfill (warm amber) which sit too close on a TV.
const PHASE_COLORS = {
  'Milling': '#0E7490',
  'Paving': '#991B1B',
  'Crackfill': '#A16207',
  'Hand': '#166534',
  'Reclaim/Grading': '#1E3A8A',
  'Pulverizing': '#6D28D9',
  'SubC': '#115E59'
};

const PHASE_SLUGS = {
  'Milling': 'milling',
  'Paving': 'paving',
  'Crackfill': 'crackfill',
  'Hand': 'hand',
  'Reclaim/Grading': 'reclaimgrading',
  'Pulverizing': 'pulverizing',
  'SubC': 'subc'
};

const PHASE_CODES = {
  'Milling': 'MILL',
  'Paving': 'PAVE',
  'Crackfill': 'CRCK',
  'Hand': 'HAND',
  'Reclaim/Grading': 'RECL',
  'Pulverizing': 'PULV',
  'SubC': 'SUBC'
};

function getPhaseSlug(phase) { return PHASE_SLUGS[phase] || 'milling'; }
function getPhaseCode(phase) { return PHASE_CODES[phase] || ''; }

// ============ SMARTSHEET API CONFIG ============
// Read-only token "CalendarGit" — internal TV use only.
// If the token is rotated, replace below and re-deploy.
const SMARTSHEET_TOKEN = 'p24Cgh1izpdYeclFRk4gE6m9nCuEoBW5Nkywe';
const SHEET_ID = '1728592246427524'; // Operations Schedule

// Column IDs — confirmed against the live sheet on 2026-05-06.
const COL = {
  JOB_NUM:      7358000912879492,
  CLIENT:       1728501378666372,
  CITY:         3980301192351620,
  PHASE:        4824726122483588,
  START:        8765375796432772, // ABSTRACT_DATETIME (e.g. '2026-04-27T08:00:00')
  END:          180389006757764,  // ABSTRACT_DATETIME
  STATUS:       4683988634128260,
  SPLIT_PARENT: 1575401988771716  // CHECKBOX — TRUE rows are rollups, skip
};

// ============ DATE HELPERS ============
// Parse ISO-ish date string from Smartsheet ABSTRACT_DATETIME column.
// Treat as a calendar date (ignore the time/timezone) so cell positioning
// is consistent regardless of the player's TZ setting.
function parseSmartsheetDate(s) {
  if (!s) return null;
  const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const d = new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10));
  return isNaN(d.getTime()) ? null : d;
}

// Legacy CSV date format MM/DD/YY (used by fallback path).
function parseDate(dateStr) {
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

// ============ EVENT LOADING — API + CSV FALLBACK ============
async function loadEvents() {
  try {
    const events = await loadEventsFromAPI();
    console.log(`[calendar] Loaded ${events.length} events from Smartsheet API`);
    return events;
  } catch (err) {
    console.warn('[calendar] Smartsheet API failed, falling back to CSV:', err);
    return loadEventsFromCSV();
  }
}

async function loadEventsFromAPI() {
  const url = `https://api.smartsheet.com/2.0/sheets/${SHEET_ID}?pageSize=10000`;
  const resp = await fetch(url, {
    headers: { 'Authorization': 'Bearer ' + SMARTSHEET_TOKEN }
  });
  if (!resp.ok) throw new Error('Smartsheet API HTTP ' + resp.status);
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
    const status = cellValue(row, COL.STATUS);
    if (status === 'Cancelled') continue;

    const splitParent = cellValue(row, COL.SPLIT_PARENT);
    if (splitParent === true) continue;

    const jobNum = cellValue(row, COL.JOB_NUM);
    const startVal = cellValue(row, COL.START);
    if (!jobNum || !startVal) continue;

    const startDate = parseSmartsheetDate(startVal);
    if (!startDate) continue;
    const endDate = parseSmartsheetDate(cellValue(row, COL.END)) || startDate;

    events.push({
      jobNumber: String(jobNum),
      client:    cellValue(row, COL.CLIENT)  || '',
      city:      cellValue(row, COL.CITY)    || '',
      phase:     cellValue(row, COL.PHASE)   || '',
      startDate: startDate,
      endDate:   endDate,
      status:    status || ''
    });
  }
  return events;
}

// CSV fallback — reads operations-schedule.csv shipped in the repo.
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
        client:    row['Client'],
        city:      row['Job City'],
        phase:     row['Phase'],
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

// CSV parser — handles quoted fields with embedded commas
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

// ============ FILTERING / DATES / CALENDAR ============
function filterEventsByPhase(events, phase) {
  if (!phase) return events;
  return events.filter(e => e.phase === phase);
}

// Rolling 6-week window: Sunday of the week containing (today - 7 days), 42 days.
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

// ============ ADAPTIVE CELL DENSITY ============
// After each render, every day cell is measured. If events overflow,
// progressively heavier density classes are applied so all events fit
// without truncation. Re-runs on resize.
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

// ============ DATE-RANGE HEADER FORMATTER ============
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
  if (startYear === endYear) {
    return `${startMonthStr} – ${endMonthYearStr}`;
  }
  const startMonthYearStr = new Date(start).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  return `${startMonthYearStr} – ${endMonthYearStr}`;
}
