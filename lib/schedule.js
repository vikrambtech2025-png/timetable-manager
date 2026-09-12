const DAY_ORDER = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5 };

function sortDays(days) {
  return days.slice().sort((a, b) => (DAY_ORDER[a] ?? 99) - (DAY_ORDER[b] ?? 99));
}

function buildFree(slots) {
  const days = sortDays([...new Set(slots.map((s) => s.day))]);
  const periodCount = slots.reduce((m, s) => Math.max(m, s.period), 0);
  const free = {};
  for (const d of days) {
    free[d] = {};
    for (let p = 1; p <= periodCount; p++) free[d][p] = false;
  }
  for (const s of slots) if (s.status === 'FREE') free[s.day][s.period] = true;
  return { days, periodCount, free };
}

function findRun(free, periodCount, day, length) {
  if (!free[day]) return null;
  for (let start = 1; start + length - 1 <= periodCount; start++) {
    let ok = true;
    for (let k = 0; k < length; k++) if (!free[day][start + k]) { ok = false; break; }
    if (ok) return start;
  }
  return null;
}

function claim(free, day, start, length) {
  for (let k = 0; k < length; k++) free[day][start + k] = false;
}

function dayPreference(preferredDay, days) {
  if (preferredDay && days.includes(preferredDay)) {
    return [preferredDay, ...days.filter((d) => d !== preferredDay)];
  }
  return days;
}

function placeRequest(req, free, periodCount, days) {
  const n = req.classes_per_week;
  const d = req.duration_per_class;
  const span = n * d;
  if (req.pattern === 'Continuous') {
    for (const day of dayPreference(req.preferred_day, days)) {
      const start = findRun(free, periodCount, day, span);
      if (start != null) {
        claim(free, day, start, span);
        return { placed: true, segments: [{ day, period_start: start, period_end: start + span - 1 }], issue: null };
      }
    }
    return { placed: false, segments: [], issue: `Cannot fit ${n} class(es) of ${d} period(s) as one continuous block on any day` };
  }
  const candDays = dayPreference(req.preferred_day, days);
  const segments = [];
  const usedDays = new Set();
  for (let i = 0; i < n; i++) {
    let placed = false;
    for (const day of candDays) {
      if (usedDays.has(day)) continue;
      const start = findRun(free, periodCount, day, d);
      if (start != null) {
        claim(free, day, start, d);
        segments.push({ day, period_start: start, period_end: start + d - 1 });
        usedDays.add(day);
        placed = true;
        break;
      }
    }
    if (!placed) {
      return {
        placed: false,
        segments: [],
        issue: `Could only place ${segments.length} of ${n} separate class(es) of ${d} period(s), each on a different day`
      };
    }
  }
  return { placed: true, segments, issue: null };
}

function scheduleAll(requests, slots) {
  const { days, periodCount, free } = buildFree(slots);
  const results = [];
  for (const req of requests) {
    const r = placeRequest(req, free, periodCount, days);
    results.push({ request: req, ...r });
  }
  return results;
}

module.exports = { DAY_ORDER, sortDays, buildFree, scheduleAll };