const XLSX = require('xlsx');

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function sheetRows(wb) {
  const name = wb.SheetNames[0];
  const ws = wb.Sheets[name];
  if (!ws) return [];
  return XLSX.utils.sheet_to_json(ws, { defval: '', raw: true });
}

function findHeader(headers, patterns, skip = []) {
  for (const h of headers) {
    const k = String(h).trim().toLowerCase();
    if (skip.some((s) => k.includes(s))) continue;
    if (patterns.some((p) => k.includes(p))) return h;
  }
  return null;
}

function parseCollegeSchedule(wb) {
  const rows = sheetRows(wb);
  if (!rows.length) throw new Error('sheet is empty');
  const headers = Object.keys(rows[0]);
  for (const h of headers) {
    if (!String(h).trim()) throw new Error('header row has empty cells; keep Day, P1..Pn, Holiday? as column headers');
  }
  const dayHeader = findHeader(headers, ['day']);
  const holidayHeader = findHeader(headers, ['holiday']);
  if (!dayHeader) throw new Error('missing a "Day" column');
  const periodCols = [];
  let assigned = null;
  for (const h of headers) {
    if (h === dayHeader || h === holidayHeader) continue;
    const m = /(\d+)/.exec(String(h));
    periodCols.push({ header: h, period: m ? parseInt(m[1], 10) : 0 });
  }
  if (!periodCols.length) throw new Error('no period columns found (use P1, P2, ... P7)');
  assigned = 1;
  for (const pc of periodCols) if (!pc.period) pc.period = assigned++;
  periodCols.sort((a, b) => a.period - b.period);

  const byKey = {};
  for (const r of rows) {
    const day = String(r[dayHeader] ?? '').trim();
    if (!day) continue;
    const holiday = holidayHeader && /^(yes|true|x|holiday)$/i.test(String(r[holidayHeader] ?? '').trim());
    for (const pc of periodCols) {
      const value = holiday ? 'Holiday' : String(r[pc.header] ?? '').trim();
      const key = day + '|' + pc.period;
      if (value) byKey[key] = { day, period: pc.period, status: 'BLOCKED', label: value };
      else if (!byKey[key]) byKey[key] = { day, period: pc.period, status: 'FREE', label: null };
    }
  }
  const slots = Object.values(byKey);
  if (!slots.length) throw new Error('no schedulable days found');
  return slots;
}

function normalizeDay(value) {
  const v = String(value ?? '').trim();
  if (!v || /any/i.test(v) || /^all$/i.test(v)) return null;
  const low = v.toLowerCase().slice(0, 3);
  const hit = WEEKDAYS.find((d) => d.toLowerCase() === low);
  return hit || null;
}

function normalizeType(value) {
  return /lab|laboratory/i.test(String(value ?? '')) ? 'Lab' : 'Normal';
}

function normalizePattern(value) {
  return /continu|consecut|back.?to.?back|block/i.test(String(value ?? '')) ? 'Continuous' : 'Separate';
}

function parseStaffRequests(wb) {
  const rows = sheetRows(wb);
  const headers = rows.length ? Object.keys(rows[0]) : [];
  if (!headers.length) throw new Error('sheet is empty');
  const colStaff = findHeader(headers, ['staff', 'teacher', 'faculty', 'name'], ['subject']);
  const colDept = findHeader(headers, ['department', 'dept']);
  const colSubject = findHeader(headers, ['subject']);
  const colClasses = findHeader(headers, ['class'], ['type', 'duration', 'pattern', 'day']);
  const colType = findHeader(headers, ['type']);
  const colDuration = findHeader(headers, ['duration', 'periods']);
  const colPattern = findHeader(headers, ['pattern', 'continu', 'separ', 'continuous', 'separate']);
  const colPreferred = findHeader(headers, ['preferred']);
  if (!colStaff) throw new Error('missing "Staff Name" column');
  if (!colSubject) throw new Error('missing "Subject" column');
  if (!colClasses) throw new Error('missing "Classes per Week" column');

  const requests = [];
  const errors = [];
  rows.forEach((r, i) => {
    const rowNum = i + 2;
    const staff_name = String(r[colStaff] ?? '').trim();
    const subject_name = String(r[colSubject] ?? '').trim();
    if (!staff_name || !subject_name) {
      errors.push({ row: rowNum, message: 'Staff Name and Subject are required' });
      return;
    }
    const classes = parseInt(r[colClasses], 10);
    if (!Number.isInteger(classes) || classes < 1) {
      errors.push({ row: rowNum, message: `Classes per Week must be a whole number >= 1, got "${r[colClasses]}"` });
      return;
    }
    const class_type = normalizeType(colType ? r[colType] : 'Normal');
    let duration = colDuration && String(r[colDuration]).trim() !== '' ? parseInt(r[colDuration], 10) : 1;
    if (!Number.isInteger(duration) || duration < 1 || duration > 3) {
      errors.push({ row: rowNum, message: `Duration must be 1, 2 or 3 periods, got "${r[colDuration]}"` });
      return;
    }
    if (class_type === 'Lab' && (duration < 2 || duration > 3)) {
      errors.push({ row: rowNum, message: 'Lab classes must have a duration of 2 or 3 periods' });
      return;
    }
    const pattern = normalizePattern(colPattern ? r[colPattern] : 'Separate');
    const preferred_day = normalizeDay(colPreferred ? r[colPreferred] : '');
    requests.push({
      sort_idx: i + 1,
      staff_name,
      department: String(r[colDept] ?? '').trim(),
      subject_name,
      classes_per_week: classes,
      class_type,
      duration_per_class: duration,
      pattern,
      preferred_day
    });
  });
  return { requests, errors };
}

module.exports = { parseCollegeSchedule, parseStaffRequests, normalizeDay };