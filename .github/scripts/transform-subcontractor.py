"""Transform raw Smartsheet Subcontractor Schedule sheet JSON into the events
array consumed by subc.html via data-subcontractor.json.

Reads sheet JSON from stdin, writes data-subcontractor.json shape to stdout.

This is a SILOED pipeline — completely independent of the main transform.py
which feeds the internal-crew calendars. If one breaks, the other still runs.
"""
import json, re, sys
from datetime import datetime, timezone

# Column titles on the Subcontractor Schedule sheet (id 1314998310621060).
# We resolve column IDs by title so the script survives column reordering.
COL_TITLES = {
    "JOB_NUM":   "Job #",
    "COMPANY":   "Company",
    "CLIENT":    "Client First",
    "CITY":      "Job City",
    "SUB_CREW":  "Subcontractor Crew",
    "SCOPE":     "Scope",
    "START":     "Start Date",
    "END":       "End Date",
    "STATUS":    "Status",
}

def resolve_column_ids(columns):
    by_title = {c.get("title"): c.get("id") for c in columns}
    missing = [k for k, title in COL_TITLES.items() if title not in by_title]
    if missing:
        sys.stderr.write(
            f"transform-subcontractor: missing columns on sheet: {missing}\n"
        )
        sys.exit(1)
    return {key: by_title[title] for key, title in COL_TITLES.items()}

def cell_value(row, column_id):
    for c in (row.get("cells") or []):
        if int(c.get("columnId", 0)) == int(column_id):
            v = c.get("value")
            if v is not None:
                return v
            return c.get("displayValue")
    return None

def parse_date(s):
    if not s: return None
    m = re.match(r"^(\d{4})-(\d{2})-(\d{2})", str(s))
    if not m: return None
    return f"{m.group(1)}-{m.group(2)}-{m.group(3)}"

raw = json.load(sys.stdin)
col_ids = resolve_column_ids(raw.get("columns") or [])

events = []
for row in (raw.get("rows") or []):
    status   = cell_value(row, col_ids["STATUS"])
    job_num  = cell_value(row, col_ids["JOB_NUM"])
    start    = cell_value(row, col_ids["START"])

    if not job_num or not start:
        continue
    if status == "Cancelled":
        continue

    sd = parse_date(start)
    if not sd:
        continue
    ed = parse_date(cell_value(row, col_ids["END"])) or sd

    events.append({
        "jobNumber":    str(job_num),
        "client":       cell_value(row, col_ids["COMPANY"]) or "",
        "clientFirst":  cell_value(row, col_ids["CLIENT"]) or "",
        "city":         cell_value(row, col_ids["CITY"]) or "",
        "crew":         cell_value(row, col_ids["SUB_CREW"]) or "",
        "scope":        cell_value(row, col_ids["SCOPE"]) or "",
        "phase":        "Subcontractor",
        "startDate":    sd,
        "endDate":      ed,
        "status":       status or "",
    })

out = {
    "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    "source": "Smartsheet Subcontractor Schedule sheet (id 1314998310621060)",
    "totalRows": raw.get("totalRowCount"),
    "events": events,
}
json.dump(out, sys.stdout, indent=2, ensure_ascii=False)
