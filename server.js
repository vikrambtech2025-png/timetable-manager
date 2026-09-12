require('dotenv').config();
const path = require('path');
const express = require('express');
const multer = require('multer');
const XLSX = require('xlsx');

const { scheduleAll, sortDays } = require('./lib/schedule');
const { parseCollegeSchedule, parseStaffRequests, normalizeDay } = require('./lib/parse');
const { createStore } = require('./lib/store');

const app = express();
const PORT = process.env.PORT || 3000;
const store = createStore(process.env);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

function sendError(res, err) {
  let status = err.status || 500;
  if (err.code === '23505' || err.code === '23514') status = 409;
  if (res.headersSent) return;
  res.status(status).json({ error: err.message || 'Server error' });
}

function isoDate(v) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? String(v) : null;
}

async function loadWeek(req, res, next) {
  try {
    const week = await store.getWeek(req.params.id);
    if (!week) return res.status(404).json({ error: 'Week not found' });
    req.week = week;
    next();
  } catch (e) {
    sendError(res, e);
  }
}

function requireOpen(req, res, next) {
  if (req.week && req.week.status === 'LOCKED') {
    return res.status(409).json({ error: 'Week is locked for the entire week; the timetable cannot be modified.' });
  }
  next();
}

async function fetchSlots(weekId) {
  return store.getSlots(weekId);
}

async function fetchRequests(weekId) {
  return store.getRequests(weekId);
}

async function persistSchedule(weekId, requestsOverride) {
  const slots = await fetchSlots(weekId);
  const requests = requestsOverride || (await fetchRequests(weekId));
  const results = scheduleAll(requests, slots);

  await store.deleteBookings(weekId);
  const bookings = [];
  for (const r of results) {
    if (!r.placed) continue;
    for (const seg of r.segments) {
      bookings.push({ week_id: weekId, request_id: r.request.id, day: seg.day, period_start: seg.period_start, period_end: seg.period_end });
    }
  }
  await store.insertBookings(bookings);
  for (const r of results) {
    await store.setRequestOutcome(r.request.id, r.placed ? 'PLACED' : 'UNRESOLVED', r.issue);
  }

  const unresolved = results
    .filter((r) => !r.placed)
    .map((r) => ({
      request_id: r.request.id,
      staff_name: r.request.staff_name,
      subject_name: r.request.subject_name,
      issue: r.issue
    }));

  return { ok: true, resolved: results.filter((r) => r.placed).length, booked: bookings.length, unresolved };
}

async function buildTimetableView(weekId) {
  const slots = await fetchSlots(weekId);
  const days = sortDays([...new Set(slots.map((s) => s.day))]);
  const periodCount = slots.reduce((m, s) => Math.max(m, s.period), 0);

  const grid = {};
  for (const d of days) {
    grid[d] = {};
    for (let p = 1; p <= periodCount; p++) grid[d][p] = { type: 'free', label: null };
  }
  for (const s of slots) {
    grid[s.day][s.period] = { type: s.status === 'FREE' ? 'free' : 'blocked', label: s.label };
  }

  const requests = await store.getRequests(weekId);
  const reqMap = {};
  for (const r of requests) {
    reqMap[r.id] = { subject: r.subject_name, staff: r.staff_name, dept: r.staff_department };
  }

  const bookings = await store.getBookings(weekId);
  for (const b of bookings) {
    const meta = reqMap[b.request_id] || { subject: '', staff: '', dept: '' };
    for (let p = b.period_start; p <= b.period_end; p++) {
      if (grid[b.day] && grid[b.day][p]) {
        grid[b.day][p] = {
          type: 'booking',
          subject: meta.subject,
          staff: meta.staff,
          dept: meta.dept,
          request_id: b.request_id
        };
      }
    }
  }

  const unresolved = requests
    .filter((r) => r.status === 'UNRESOLVED')
    .map((r) => ({ request_id: r.id, staff_name: r.staff_name, subject_name: r.subject_name, issue: r.issue }));

  return { days, periodCount, grid, unresolved };
}

async function buildHours(weekId) {
  const requests = await store.getRequests(weekId);
  const bookings = await store.getBookings(weekId);

  const bookedByReq = {};
  for (const b of bookings) {
    bookedByReq[b.request_id] = (bookedByReq[b.request_id] || 0) + (b.period_end - b.period_start + 1);
  }

  return requests.map((r) => ({
    request_id: r.id,
    staff: r.staff_name,
    department: r.staff_department,
    subject: r.subject_name,
    class_type: r.class_type,
    classes_per_week: r.classes_per_week,
    duration_per_class: r.duration_per_class,
    pattern: r.pattern,
    preferred_day: r.preferred_day,
    required_hours: r.classes_per_week * r.duration_per_class,
    booked_hours: bookedByReq[r.id] || 0,
    status: r.status
  }));
}

app.get('/api/health', (req, res) => {
  res.json({ ok: true, mode: store.kind });
});

app.get('/api/weeks', async (req, res) => {
  try {
    const weeks = await store.listWeeks();
    res.json(weeks);
  } catch (e) {
    sendError(res, e);
  }
});

app.post('/api/weeks', async (req, res) => {
  try {
    const week_start = isoDate(req.body.week_start);
    if (!week_start) return res.status(400).json({ error: 'Invalid week_start; expected YYYY-MM-DD' });
    const week = await store.createWeek(week_start);
    res.status(201).json(week);
  } catch (e) {
    sendError(res, e);
  }
});

app.post('/api/weeks/:id/upload', loadWeek, requireOpen, upload.fields([{ name: 'collegeSchedule', maxCount: 1 }, { name: 'staffRequests', maxCount: 1 }]), async (req, res) => {
  try {
    const collegeFile = req.files && req.files.collegeSchedule && req.files.collegeSchedule[0];
    const staffFile = req.files && req.files.staffRequests && req.files.staffRequests[0];
    if (!collegeFile) return res.status(400).json({ error: 'College Schedule file is required' });
    if (!staffFile) return res.status(400).json({ error: 'Staff Requests file is required' });

    let slots;
    let parsedRequests;
    try {
      slots = parseCollegeSchedule(XLSX.read(collegeFile.buffer, { type: 'buffer' }));
    } catch (e) {
      return res.status(400).json({ error: 'College Schedule file: ' + e.message });
    }
    try {
      parsedRequests = parseStaffRequests(XLSX.read(staffFile.buffer, { type: 'buffer' }));
    } catch (e) {
      return res.status(400).json({ error: 'Staff Requests file: ' + e.message });
    }
    if (!parsedRequests.requests.length) {
      return res.status(400).json({ error: 'Staff Requests file has no valid rows' });
    }

    const weekId = req.params.id;
    await store.clearWeek(weekId);
    await store.insertSlots(weekId, slots);

    const names = [...new Set(parsedRequests.requests.map((r) => r.staff_name))];
    const deptsByName = {};
    for (const r of parsedRequests.requests) {
      if (!deptsByName[r.staff_name]) deptsByName[r.staff_name] = r.department;
    }
    const staffMap = await store.upsertStaff(names, deptsByName);

    const reqRows = parsedRequests.requests.map((r) => ({
      staff_id: staffMap[r.staff_name],
      subject_name: r.subject_name,
      classes_per_week: r.classes_per_week,
      class_type: r.class_type,
      duration_per_class: r.duration_per_class,
      pattern: r.pattern,
      preferred_day: r.preferred_day,
      sort_idx: r.sort_idx
    }));
    await store.insertRequests(weekId, reqRows);

    res.json({ ok: true, slots: slots.length, requests: reqRows.length, staffErrors: parsedRequests.errors });
  } catch (e) {
    sendError(res, e);
  }
});

app.post('/api/weeks/:id/generate', loadWeek, requireOpen, async (req, res) => {
  try {
    const result = await persistSchedule(req.params.id);
    res.json(result);
  } catch (e) {
    sendError(res, e);
  }
});

app.put('/api/weeks/:id/requests/:rt', loadWeek, requireOpen, async (req, res) => {
  try {
    const requests = await fetchRequests(req.params.id);
    const target = requests.find((r) => String(r.id) === String(req.params.rt));
    if (!target) return res.status(404).json({ error: 'Request not found' });

    const classes_per_week = parseInt(req.body.classes_per_week, 10);
    const duration_per_class = parseInt(req.body.duration_per_class, 10);
    if (!Number.isInteger(classes_per_week) || classes_per_week < 1) {
      return res.status(400).json({ error: 'classes_per_week must be a whole number >= 1' });
    }
    if (![1, 2, 3].includes(duration_per_class)) {
      return res.status(400).json({ error: 'duration_per_class must be 1, 2 or 3' });
    }
    if (target.class_type === 'Lab' && ![2, 3].includes(duration_per_class)) {
      return res.status(400).json({ error: 'Lab classes require a duration of 2 or 3 periods' });
    }
    const pattern = /continu|consecut|back.?to.?back|block/i.test(String(req.body.pattern || '')) ? 'Continuous' : 'Separate';
    const preferred_day = normalizeDay(req.body.preferred_day);

    const modified = { ...target, classes_per_week, duration_per_class, pattern, preferred_day };
    const simRequests = requests.map((r) => (r.id === target.id ? modified : r));
    const simResults = scheduleAll(simRequests, await fetchSlots(req.params.id));
    const simTarget = simResults.find((r) => String(r.request.id) === String(target.id));
    if (!simTarget.placed) {
      return res.status(409).json({ error: 'Cannot apply these changes: ' + simTarget.issue });
    }

    await store.updateRequest(target.id, { classes_per_week, duration_per_class, pattern, preferred_day });
    const result = await persistSchedule(req.params.id, simRequests);
    const timetable = await buildTimetableView(req.params.id);
    const hours = await buildHours(req.params.id);
    res.json({ ok: true, result, timetable, hours });
  } catch (e) {
    sendError(res, e);
  }
});

app.post('/api/weeks/:id/lock', loadWeek, async (req, res) => {
  try {
    if (req.week.status === 'LOCKED') return res.json(req.week);
    const week = await store.lockWeek(req.params.id);
    res.json(week);
  } catch (e) {
    sendError(res, e);
  }
});

app.get('/api/weeks/:id/timetable', loadWeek, async (req, res) => {
  try {
    const view = await buildTimetableView(req.params.id);
    res.json({ week: req.week, ...view });
  } catch (e) {
    sendError(res, e);
  }
});

app.get('/api/weeks/:id/staff-hours', loadWeek, async (req, res) => {
  try {
    const hours = await buildHours(req.params.id);
    res.json({ week: req.week, hours });
  } catch (e) {
    sendError(res, e);
  }
});

app.listen(PORT, () => {
  console.log(`Timetable Manager running at http://localhost:${PORT}`);
  console.log(`Data mode: ${store.kind}`);
});