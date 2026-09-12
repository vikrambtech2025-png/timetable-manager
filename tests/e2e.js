const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const XLSX = require('xlsx');

let failed = false;
function check(name, cond, detail) {
  console.log((cond ? 'PASS' : 'FAIL') + ' - ' + name + (detail ? (': ' + detail) : ''));
  if (!cond) failed = true;
}

function wbFromRows(aoa) {
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  return XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' });
}

function collegeXlsx() {
  return wbFromRows([
    ['Day', 'P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'Holiday?'],
    ['Monday', '', '', '', '', '', '', '', ''],
    ['Tuesday', '', '', '', '', '', '', '', ''],
    ['Wednesday', '', '', 'PD: C Programming', '', '', '', '', ''],
    ['Thursday', '', '', 'PD: English Language', '', '', '', '', ''],
    ['Friday', '', '', 'PD: Aptitude', '', '', '', '', ''],
    ['Saturday', '', '', '', '', '', '', '', 'YES'],
  ]);
}

function staffXlsx() {
  return wbFromRows([
    ['Staff Name', 'Department', 'Subject', 'Classes per Week', 'Class Type', 'Duration per Class (periods)', 'Pattern', 'Preferred Day'],
    ['Alice', 'CSE', 'Data Structures', '2', 'Normal', '1', 'Separate', 'Any'],
    ['Bob', 'ECE', 'Networks Lab', '2', 'Lab', '2', 'Continuous', 'Any'],
    ['Carol', 'ME', 'Thermodynamics', '5', 'Normal', '1', 'Separate', 'Any'],
  ]);
}

const port = 3210;
const base = `http://localhost:${port}`;

function getJson(p) { return fetch(base + p).then((r) => r.json()); }

function postJson(p, body) {
  return fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) }).then((r) => r.json());
}

function putJson(p, body) {
  return fetch(base + p, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());
}

async function upload(weekId, collegeBuf, staffBuf) {
  const fd = new FormData();
  fd.append('collegeSchedule', new Blob([collegeBuf], { type: 'application/octet-stream' }), 'college.xlsx');
  fd.append('staffRequests', new Blob([staffBuf], { type: 'application/octet-stream' }), 'staff.xlsx');
  const res = await fetch(base + `/api/weeks/${weekId}/upload`, { method: 'POST', body: fd });
  return { status: res.status, body: await res.json() };
}

async function main() {
  const tmpDb = path.join(os.tmpdir(), 'tt_e2e_' + Date.now() + '.db');
  const server = spawn(process.execPath, ['server.js'], {
    env: { ...process.env, PORT: String(port), SUPABASE_URL: '', SUPABASE_SERVICE_ROLE_KEY: '', SQLITE_PATH: tmpDb },
    stdio: 'ignore'
  });
  const start = Date.now();
  let up = false;
  while (Date.now() - start < 10000) {
    try {
      const h = await getJson('/api/health');
      if (h.ok) { up = true; check('server started in sqlite mode', h.mode === 'sqlite'); break; }
    } catch (e) { /* retry */ }
    await new Promise((r) => setTimeout(r, 300));
  }
  if (!up) { check('server reachable', false); server.kill(); process.exit(1); }

  try {
    const w = await postJson('/api/weeks', { week_start: '2026-09-14' });
    check('week created', !!w.id && w.status === 'OPEN');
    const wid = w.id;

    const dup = await postJson('/api/weeks', { week_start: '2026-09-14' });
    check('duplicate week rejected', dup.error && /constraint|duplicate|unique/i.test(dup.error));

    const up1 = await upload(wid, collegeXlsx(), staffXlsx());
    check('upload ok', up1.status === 200 && up1.body.requests === 3, up1.status + ' / ' + JSON.stringify(up1.body));

    const gen = await postJson(`/api/weeks/${wid}/generate`);
    check('generate resolves all 3', gen.resolved === 3 && gen.unresolved.length === 0, JSON.stringify(gen));

    const tt = await getJson(`/api/weeks/${wid}/timetable`);
    const bookedCells = Object.values(tt.grid).reduce((acc, day) => acc + Object.values(day).filter((c) => c.type === 'booking').length, 0);
    check('timetable has bookings (Alice 2 + Bob 4 + Carol 5)', bookedCells === 11, 'cells=' + bookedCells);

    const hours = await getJson(`/api/weeks/${wid}/staff-hours`);
    const carol = hours.hours.find((h) => h.staff === 'Carol');
    check('Carol required 5 booked 5', carol.required_hours === 5 && carol.booked_hours === 5);

    const aliceReq = hours.hours.find((h) => h.staff === 'Alice');
    const conflict = await putJson(`/api/weeks/${wid}/requests/${aliceReq.request_id}`, {
      classes_per_week: 8, duration_per_class: 1, pattern: 'Separate', preferred_day: 'Any'
    });
    check('unplaceable edit rejected with 409', conflict.error && /Cannot apply/.test(conflict.error), JSON.stringify(conflict));

    const okEdit = await putJson(`/api/weeks/${wid}/requests/${aliceReq.request_id}`, {
      classes_per_week: 3, duration_per_class: 1, pattern: 'Separate', preferred_day: 'Any'
    });
    check('valid edit applied and regenerated', okEdit.ok === true && okEdit.timetable && okEdit.hours.length === 3, JSON.stringify(okEdit && okEdit.result));

    const lk = await postJson(`/api/weeks/${wid}/lock`);
    check('week locked', lk.status === 'LOCKED', JSON.stringify(lk));

    const genLocked = await postJson(`/api/weeks/${wid}/generate`);
    check('generate rejected after lock', genLocked.error && /locked/i.test(genLocked.error));

    const hoursLocked = await getJson(`/api/weeks/${wid}/staff-hours`);
    check('reads still work after lock', Array.isArray(hoursLocked.hours) && hoursLocked.hours.length === 3);

    const setA = new Set();
    const tt2 = await getJson(`/api/weeks/${wid}/timetable`);
    Object.entries(tt2.grid).forEach(([day, cols]) => Object.entries(cols).forEach(([p, c]) => { if (c.type === 'booking') setA.add(`${day}|${p}|${c.staff}`); }));
    check('no staff double-booked at same period', setA.size === 12);
  } finally {
    server.kill();
    try { fs.unlinkSync(tmpDb); } catch (e) { /* ignore */ }
  }
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error('e2e error:', e);
  process.exit(1);
});