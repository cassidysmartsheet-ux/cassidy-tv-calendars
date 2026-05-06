// Shared calendar utilities for TV displays
// Data source abstraction layer - swappable between CSV and API

// Phase color palette - muted, enterprise dashboard tones
// Milling moved from burnt orange to deep teal/cyan to separate it from
// Paving (brick red) and Crackfill (warm amber) which sit too close on a TV.
const PHASE_COLORS = {
  'Milling': '#0E7490',        // deep teal/cyan
  'Paving': '#991B1B',         // brick red
  'Crackfill': '#A16207',      // warm amber
  'Hand': '#166534',           // forest green
  'Reclaim/Grading': '#1E3A8A', // navy
  'Pulverizing': '#6D28D9',    // muted purple
  'SubC': '#115E59'            // deep teal (legacy — no dedicated TV)
};

// Phase -> CSS class slug used by calendar-styles.css
const PHASE_SLUGS = {
  'Milling': 'milling',
  'Paving': 'paving',
  'Crackfill': 'crackfill',
  'Hand': 'hand',
  'Reclaim/Grading': 'reclaimgrading',
  'Pulverizing': 'pulverizing',
  'SubC': 'subc'
};

// Phase -> short crew code shown on the operations calendar badge
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

// CSV Parser - handles quoted fields with embedded commas
function parseCSVLine(line) {
  const result = [];
  let current = '';
  let insideQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      if (insideQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        insideQuotes = !insideQuotes;
      }
    } else if (char === ',' && !insideQuotes) {
      result.push(current.trim());
      current = '';
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

  const headerLine = lines[0];
  const headers = parseCSVLine(headerLine);

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    const row = {};
    headers.forEach((header, idx) => {
      row[header] = values[idx] || '';
    });
    rows.push(row);
  }

  return { headers, rows };
}

// Load events from local CSV file
async function loadEvents() {
  try {
    const response = await fetch('operations-schedule.csv');
    if (!response.ok) throw new Error(`CSV load error: ${response.status}`);
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

      const event = {
        jobNumber: row['Job #'],
        client: row['Client'],
        city: row['Job City'],
        phase: row['Phase'],
        startDate: startDate,
        endDate: endDate || startDate,
        status: row['Status']
      };

      events.push(event);
    });

    return events;
  } catch (error) {
    console.error('Error loading events:', error);
    return [];
  }
}

// Parse date string in MM/DD/YY format
function parseDate(dateStr) {
  if (!dateStr || dateStr.trim() === '') return null;
  const parts = dateStr.trim().split('/');
  if (parts.length !== 3) return null;

  const month = parseInt(parts[0], 10) - 1;
  const day = parseInt(parts[1], 10);
  const year = parseInt(parts[2], 10);

  const fullYear = year > 50 ? 1900 + year : 2000 + year;

  const date = new Date(fullYear, month, day);
  if (date.getMonth() !== month || date.getDate() !== day) {
    return null;
  }

  return date;
}

// Filter events by phase (null = all phases)
function filterEventsByPhase(events, phase) {
  if (!phase) return events;
  return events.filter(e => e.phase === phase);
}

// Get calendar grid dates (rolling 6-week window)
// Grid start: Sunday of the week containing (today - 7 days)
// Grid length: 42 days (6 weeks)
function getCalendarDates(today) {
  const sevenDaysAgo = new Date(today);
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  const startDate = new Date(sevenDaysAgo);
  startDate.setDate(startDate.getDate() - startDate.getDay());
  startDate.setHours(0, 0, 0, 0);

  const dates = [];
  let current = new Date(startDate);
  for (let i = 0; i < 42; i++) {
    dates.push(new Date(current));
    current.setDate(current.getDate() + 1);
  }
  return dates;
}

// Get events for a specific date
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

// Format date as Month Day for display
function formatDateShort(date) {
  return new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// Format date for calendar header
function formatMonthYear(date) {
  return new Date(date).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

// Adaptive cell scaling — guarantees no event truncation.
//
// Strategy: after the grid renders, every day cell is measured. If the events
// container would overflow its allotted height, a density class
// (.density-2 / .density-3 / .density-4 / .density-max) is applied to the
// CELL — calendar-styles.css uses these to ratchet down font-size, padding,
// and gap so every event remains visible. Re-run on window resize so a
// rotating TV mount or browser zoom won't break the layout.
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

// Debounced resize handler — re-evaluates density when viewport changes.
function bindAdaptiveDensityResize() {
  let t = null;
  window.addEventListener('resize', () => {
    clearTimeout(t);
    t = setTimeout(applyAdaptiveDensity, 150);
  });
}

// Format date range for calendar header (handles month/year spanning)
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
