# Cassidy Paving TV Calendars

Full-screen month-view calendars for 60" 4K TV displays at Cassidy headquarters. Designed for AbleSign TV signage app.

## Files

- **index.html** - Navigation hub with clean card grid linking to all calendars
- **milling.html** - Milling crew schedule (deep orange #D97706)
- **paving.html** - Paving crew schedule (crimson #DC2626)
- **crackfill.html** - Crackfill crew schedule (amber #B45309)
- **hand.html** - Hand crew schedule (forest green #15803D)
- **reclaim.html** - Reclaim/Grading crew schedule (cobalt blue #1D4ED8)
- **pulverizing.html** - Pulverizing crew schedule (purple #6D28D9)
- **subc.html** - Subcontractor schedule (slate #475569)
- **operations.html** - All phases combined with phase-specific color coding
- **calendar-utils.js** - Data abstraction layer + shared utility functions
- **operations-schedule.csv** - Local CSV data file (shipped with site)

## Data Source & Updates

The calendars now load from **operations-schedule.csv** rather than the Smartsheet API. This file is included in the deployment and automatically refreshed by the site every 1 minute.

**To update the schedule:**

1. Export the latest Operations Schedule from Smartsheet as CSV
2. Replace **operations-schedule.csv** in this folder with the new export
3. Commit and push to the GitHub Pages repository
4. The TV displays will fetch the new CSV on their next 1-minute refresh

**CSV columns used:**
- Job # → jobNumber
- Client → client
- Job City → city
- Phase → phase (Milling, Paving, Crackfill, Hand, Reclaim/Grading, Pulverizing, SubC)
- Start Date → startDate (MM/DD/YY format)
- End Date → endDate (MM/DD/YY format)
- Status → status (Scheduled, In Progress, Complete, Cancelled, etc.)

Rows with Status = "Cancelled" are automatically hidden.

## Code Architecture

**Data Abstraction Layer** (`calendar-utils.js`):

The `loadEvents()` function is the single point of data ingestion. It:
1. Fetches the CSV file
2. Parses quoted CSV fields (handles commas in job descriptions)
3. Normalizes into a standard event shape:
   ```js
   {
     jobNumber: string,
     client: string,
     city: string,
     phase: string,
     startDate: Date,
     endDate: Date,
     status: string
   }
   ```

This design allows **easy future migration to Smartsheet API** — just swap out the CSV fetch logic in `loadEvents()`, and all downstream rendering continues to work unchanged.

## Display & Behavior

- **Theme**: Light, clean, modern. White background (#ffffff), dark text (#1a1a1a), Cassidy red (#CC0000) for branding
- **Typography**: System font stack (Apple/Segoe UI/Roboto) for native, premium feel
- **Event cards**: Light tinted background per phase color, subtle left border (3px phase color), dark text
- **Today indicator**: Red left border + light red background on current day cell
- **Complete jobs**: 50% opacity, muted gray styling
- **Month range**: Current calendar month extended 7 days prior to show preceding week
- **Filtering**: Crew pages show only that phase; Operations shows all phases
- **Auto-refresh**: Every 1 minute (re-fetches CSV)
- **No scrolling**: Full calendar fits 1920×1080 viewport with `overflow: hidden`
- **Text size**: Event text >=16-18px; day numbers, labels proportionally larger; readable from 10-15 feet
- **No external dependencies**: Pure HTML/CSS/JavaScript, no CDN imports

## Deployment

1. Copy all 11 files to a GitHub Pages repository (including operations-schedule.csv)
2. Configure AbleSign to point to URLs like:
   - `https://yourusername.github.io/tv-calendars/milling.html`
   - `https://yourusername.github.io/tv-calendars/operations.html`
   - etc.

## Customization

**Colors**: Phase colors are defined in `calendar-utils.js` (PHASE_COLORS object) and in each HTML file's `.event` background/border classes.

**Event format**: Each crew page displays events as: `Job# Client City`. Edit the text template in the crew HTML files' JavaScript sections.

**Refresh interval**: Change `10 * 60 * 1000` (milliseconds) in the `setInterval()` call at the end of each HTML file.

**Phase color mapping** (for future adjustments):
- Milling: #D97706 (deep orange) → light bg #ffe8e8, border accent
- Paving: #DC2626 (crimson) → light bg #fee2e2
- Crackfill: #B45309 (amber) → light bg #fef3c7
- Hand: #15803D (forest green) → light bg #dcfce7
- Reclaim/Grading: #1D4ED8 (cobalt blue) → light bg #dbeafe
- Pulverizing: #6D28D9 (purple) → light bg #ede9fe
- SubC: #475569 (slate) → light bg #f1f5f9

## Notes

- The CSV parser in `calendar-utils.js` handles quoted fields with embedded commas
- Date parsing supports MM/DD/YY format (e.g., 04/27/26 → April 27, 2026)
- 2-digit year logic: 00-50 → 2000-2050; 51-99 → 1951-1999
