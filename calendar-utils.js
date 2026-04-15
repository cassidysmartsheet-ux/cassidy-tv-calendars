// Shared calendar utilities for TV displays
// Data source abstraction layer - swappable between CSV and API

// Phase color palette - light theme friendly
const PHASE_COLORS = {
  'Milling': '#D97706',        // deep orange
  'Paving': '#DC2626',         // crimson
  'Crackfill': '#B45309',      // amber/brown
  'Hand': '#15803D',           // forest green
  'Reclaim/Grading': '#1D4ED8', // cobalt blue
  'Pulverizing': '#6D28D9',    // purple
  'SubC': '#475569'            // slate
};

// CSV Parser - handles quoted fields with embedded commas
function parseCSVLine(line) {
  const result = [];
  let current = '';
  let insideQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      if (insideQuotes && line[i + 1] === '"') {
        // Escaped quote
        current += '"';
        i++;
      } else {
        // Toggle quote mode
        insideQuotes = !insideQuotes;
      }
    } else if (char === ',' && !insideQuotes) {
      // Field delimiter
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
      // Skip empty rows and rows without required fields
      if (!row['Job #'] || !row['Start Date']) return;

      // Skip Cancelled status
      if (row['Status'] === 'Cancelled') return;

      // Parse dates (MM/DD/YY format)
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

  const month = parseInt(parts[0], 10) - 1; // JS months are 0-indexed
  const day = parseInt(parts[1], 10);
  const year = parseInt(parts[2], 10);

  // Handle 2-digit year (26 -> 2026)
  const fullYear = year > 50 ? 1900 + year : 2000 + year;

  const date = new Date(fullYear, month, day);
  // Validate date
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

// Get calendar grid dates (7 days before month start through end of month)
function getCalendarDates(today) {
  const year = today.getFullYear();
  const month = today.getMonth();

  // First day of month
  const firstDay = new Date(year, month, 1);
  // Find the Sunday of the week containing the first day
  const startDate = new Date(firstDay);
  startDate.setDate(firstDay.getDate() - firstDay.getDay());
  // Move back 7 more days
  startDate.setDate(startDate.getDate() - 7);

  // Last day of month
  const lastDay = new Date(year, month + 1, 0);

  // Build array of dates
  const dates = [];
  let current = new Date(startDate);
  while (current <= lastDay) {
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
