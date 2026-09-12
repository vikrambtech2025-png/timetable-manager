const XLSX = require('xlsx');
const { parseCollegeSchedule, parseStaffRequests } = require('../lib/parse');
const { scheduleAll } = require('../lib/schedule');

function wbFromRows(aoa) {
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  return wb;
}

function collegeRows() {
  return [
    ['Day', 'P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'Holiday?'],
    ['Monday', '', '', '', '', '', '', '', ''],
    ['Tuesday', '', '', '', '', '', '', '', ''],
    ['Wednesday', '', '', 'PD: C Programming', '', '', '', '', ''],
    ['Thursday', '', '', 'PD: English Language', '', '', '', '', ''],
    ['Friday', '', '', 'PD: Aptitude', '', '', '', '', ''],
    ['Saturday', '', '', '', '', '', '', '', 'YES'],
  ];
}

function staffRows() {
  return [
    ['Staff Name', 'Department', 'Subject', 'Classes per Week', 'Class Type', 'Duration per Class (periods)', 'Pattern', 'Preferred Day'],
    ['Alice', 'CSE', 'Data Structures', '2', 'Normal', '1', 'Separate', 'Any'],
    ['Bob', 'ECE', 'Networks Lab', '2', 'Lab', '2', 'Continuous', 'Any'],
    ['Carol', 'ME', 'Thermodynamics', '3', 'Normal', '1', 'Separate', 'Friday'],
    ['Alice', 'CSE', 'DBMS', '1', 'Normal', '2', 'Separate', 'Wednesday'],
    ['Bad', 'EE', 'Signals', '0', 'Normal', '1', 'Separate', 'Any'],
    ['Bad2', 'EE', 'Control Lab', '1', 'Lab', '1', 'Separate', 'Any'],
  ];
}

function countFree(slots) {
  return slots.filter((s) => s.status === 'FREE').length;
}

let failed = false;
function check(name, cond, detail) {
  console.log((cond ? 'PASS' : 'FAIL') + ' - ' + name + (detail ? (': ' + detail) : ''));
  if (!cond) failed = true;
}

const slots = parseCollegeSchedule(wbFromRows(collegeRows()));
check('college parse produces 42 slots (6 days x 7 periods)', slots.length === 42, JSON.stringify(slots.length));
check('holiday Saturday is all blocked', slots.every((s) => s.day !== 'Saturday' || s.status === 'BLOCKED'));
check('PD blocks landed on Wed/Thu/Fri P3', ['Wednesday', 'Thursday', 'Friday'].every((d) => slots.some((s) => s.day === d && s.period === 3 && s.status === 'BLOCKED')));
check('a few slots are free', countFree(slots) > 10, 'free=' + countFree(slots));

const { requests, errors } = parseStaffRequests(wbFromRows(staffRows()));
check('valid staff rows parsed', requests.length === 4, 'requests=' + requests.length);
check('invalid rows flagged', errors.length === 2, 'errors=' + JSON.stringify(errors));
check('lab duration normalized', requests[1].class_type === 'Lab' && requests[1].duration_per_class === 2);
check('continuous normalized', requests[1].pattern === 'Continuous');
check('preferred day normalized', requests[2].preferred_day === 'Fri' && requests[3].preferred_day === 'Wed');

const results = scheduleAll(requests, slots);
for (const r of results) {
  console.log((r.placed ? 'PLACED  ' : 'UNRESOLVED ') + r.request.staff_name + ' / ' + r.request.subject_name + (r.issue ? ' -> ' + r.issue : '') + (r.segments.length ? ' -> ' + JSON.stringify(r.segments) : ''));
}
check('all valid requests placed', results.every((r) => r.placed));
check('no overlapping segments', (() => {
  const seen = new Set();
  for (const r of results) for (const seg of r.segments) {
    for (let p = seg.period_start; p <= seg.period_end; p++) {
      const k = seg.day + '|' + p;
      if (seen.has(k)) return false;
      seen.add(k);
    }
  }
  return true;
})());

const contRes = results.find((r) => r.request.pattern === 'Continuous' && r.request.staff_name === 'Bob');
check('continuous = one contiguous 4-period block', contRes.segments.length === 1 && (contRes.segments[0].period_end - contRes.segments[0].period_start + 1) === 4);
const sepRes = results.filter((r) => r.request.staff_name === 'Alice');
const aliceDays = new Set();
for (const r of sepRes) for (const seg of r.segments) aliceDays.add(seg.day);
check('separate classes land on distinct days', aliceDays.size >= 2);

process.exit(failed ? 1 : 0);