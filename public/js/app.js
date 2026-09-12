(function () {
  'use strict';

  const DAY_ORDER = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5 };
  const PALETTE = ['#4f81bd', '#c0504d', '#9bbb59', '#8064a2', '#4bacc6', '#f79646', '#953735', '#77933c', '#b276b2', '#558ed5'];

  let weeks = [];
  let current = null;
  let timetable = null;
  let hours = [];

  const $ = (id) => document.getElementById(id);

  function banner(msg, cls) {
    const el = $('banner');
    el.textContent = msg || '';
    el.className = 'banner' + (cls ? ' ' + cls : '');
  }

  async function api(path, opts) {
    opts = opts || {};
    if (opts.body && !(opts.body instanceof FormData) && !(opts.body instanceof Blob)) {
      opts = Object.assign({}, opts, { headers: Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {}) });
    }
    const res = await fetch(path, opts);
    let data = null;
    try { data = await res.json(); } catch (e) { /* empty */ }
    if (!res.ok) throw new Error((data && data.error) || ('HTTP ' + res.status));
    return data;
  }

  function deptColor(dept) {
    let h = 0;
    for (let i = 0; i < dept.length; i++) h = (h * 31 + dept.charCodeAt(i)) >>> 0;
    return PALETTE[h % PALETTE.length];
  }

  function cellText(cell) {
    if (!cell) return '';
    if (cell.type === 'blocked') return (cell.label || 'Blocked') + '\n';
    if (cell.type === 'booking') return cell.subject + '\n' + cell.staff;
    return '';
  }

  async function loadWeeks() {
    try {
      weeks = await api('/api/weeks');
      const sel = $('weekSelect');
      sel.innerHTML = '';
      if (!weeks.length) {
        sel.innerHTML = '<option value="">No weeks yet</option>';
        current = null;
        renderAll(false);
        return;
      }
      for (const w of weeks) {
        const opt = document.createElement('option');
        opt.value = w.id;
        opt.textContent = w.week_start + '  [' + w.status + ']';
        sel.appendChild(opt);
      }
      if (current && weeks.some((w) => w.id === current.id)) {
        sel.value = current.id;
      } else {
        sel.value = weeks[0].id;
        await selectWeek(weeks[0].id);
      }
    } catch (e) {
      banner(e.message, 'error');
      if (e.message && /supabase/i.test(e.message)) renderAll(false);
      else renderAll(false);
    }
  }

  async function selectWeek(id) {
    current = weeks.find((w) => w.id === id) || null;
    if (!current) return renderAll(false);
    banner(null);
    try {
      const [tt, hs] = await Promise.all([
        api('/api/weeks/' + id + '/timetable'),
        api('/api/weeks/' + id + '/staff-hours')
      ]);
      timetable = tt;
      hours = hs.hours || [];
      current = tt.week;
      renderAll(true);
    } catch (e) {
      banner(e.message, 'error');
    }
  }

  function renderAll(hasData) {
    const locked = current && current.status === 'LOCKED';
    $('uploadPanel').hidden = !hasData;
    $('actionPanel').hidden = !hasData;
    $('gridPanel').hidden = !hasData;
    $('hoursPanel').hidden = !hasData;

    if (!current) {
      $('weekStatus').textContent = 'Create a week first.';
      return;
    }
    $('weekStatus').textContent = 'Selected week: ' + current.week_start + ' — ' + current.status;
    $('weekStatus').className = 'muted';

    const editingEnabled = !locked;
    $('uploadBtn').disabled = locked;
    $('generateBtn').disabled = locked;
    $('lockBtn').disabled = locked;
    $('collegeFile').disabled = locked;
    $('staffFile').disabled = locked;

    if (locked) banner('This week is LOCKED. The timetable is frozen — viewing and exporting only.', 'warn');
    else banner(null);

    renderGrid();
    renderUnresolved();
    renderHours(editingEnabled);
  }

  function todayIndex() {
    const map = { Sunday: 0, Monday: 1, Tuesday: 2, Wednesday: 3, Thursday: 4, Friday: 5, Saturday: 6 };
    return map[new Date().toLocaleDateString('en-US', { weekday: 'long' })];
  }

  function renderGrid() {
    const wrap = $('gridWrap');
    if (!timetable || !timetable.days || !timetable.days.length) {
      wrap.innerHTML = '<p class="muted">No timetable yet — upload inputs and generate.</p>';
      return;
    }
    const days = timetable.days.slice().sort((a, b) => (DAY_ORDER[a] ?? 99) - (DAY_ORDER[b] ?? 99));
    const pc = timetable.periodCount;
    const grid = timetable.grid;
    const nowIdx = todayIndex();
    const table = document.createElement('table');
    table.className = 'timetable';

    const thead = document.createElement('thead');
    const hr = document.createElement('tr');
    hr.appendChild(document.createElement('th')).textContent = 'Period';
    for (const d of days) {
      const th = document.createElement('th');
      th.textContent = d;
      const iso = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
      if (iso[d] === nowIdx) th.classList.add('today');
      hr.appendChild(th);
    }
    thead.appendChild(hr);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    for (let p = 1; p <= pc; p++) {
      const tr = document.createElement('tr');
      const ptd = document.createElement('td');
      ptd.className = 'period';
      ptd.textContent = 'P' + p;
      tr.appendChild(ptd);
      for (const d of days) {
        const cell = (grid[d] && grid[d][p]) || { type: 'free' };
        const td = document.createElement('td');
        td.setAttribute('data-day', d);
        td.setAttribute('data-period', p);
        if (cell.type === 'blocked') {
          td.className = 'blocked';
          if (String(cell.label || '').toLowerCase().indexOf('holiday') === 0) td.classList.add('holiday');
          td.textContent = cell.label || 'Blocked';
        } else if (cell.type === 'booking') {
          td.className = 'booking';
          td.style.background = shade(deptColor(cell.dept || '?'), 0.86);
          const b = document.createElement('b');
          b.textContent = cell.subject;
          const s = document.createElement('span');
          s.textContent = cell.staff + (cell.dept ? ' · ' + cell.dept : '');
          td.appendChild(b);
          td.appendChild(document.createElement('br'));
          td.appendChild(s);
        } else {
          td.className = 'free';
          td.textContent = '\u00a0';
        }
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    wrap.replaceChildren(table);
  }

  function shade(hex, factor) {
    const n = parseInt(hex.slice(1), 16);
    let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    r = Math.round((r * factor) + (255 * (1 - factor)));
    g = Math.round((g * factor) + (255 * (1 - factor)));
    b = Math.round((b * factor) + (255 * (1 - factor)));
    return 'rgb(' + r + ',' + g + ',' + b + ')';
  }

  function renderUnresolved() {
    const panel = $('unresolvedPanel');
    const list = (timetable && timetable.unresolved) || [];
    if (!list.length) {
      panel.hidden = true;
      return;
    }
    panel.hidden = false;
    const ul = $('unresolvedList');
    ul.innerHTML = '';
    list.forEach((u) => {
      const li = document.createElement('li');
      li.textContent = u.staff_name + ' — ' + u.subject_name + ': ' + (u.issue || 'could not be scheduled');
      ul.appendChild(li);
    });
  }

  function renderHours(editing) {
    const tbody = $('hoursBody');
    tbody.innerHTML = '';
    $('hoursNote').textContent = editing
      ? 'Edit required values in the inputs and click Save. All constraints are re-checked and the timetable is updated. Changes are locked out once the week is locked.'
      : 'This week is locked. Hours are read-only.';
    if (!hours.length) {
      tbody.innerHTML = '<tr><td colspan="12" class="muted">No staff requests yet.</td></tr>';
      return;
    }
    let totalRequired = 0, totalBooked = 0;
    for (const h of hours) {
      totalRequired += h.required_hours || 0;
      totalBooked += h.booked_hours || 0;
      const tr = document.createElement('tr');
      tr.dataset.requestId = h.request_id;

      addCell(tr, h.staff);
      addCell(tr, h.department);
      addCell(tr, h.subject);
      addCell(tr, h.class_type);
      addCell(tr, String(h.classes_per_week));
      addCell(tr, String(h.duration_per_class));
      addCell(tr, h.pattern);
      addCell(tr, h.preferred_day || 'Any');

      if (editing) {
        const c1 = addCell(tr, '', true);
        c1.innerHTML = '';
        const nInput = document.createElement('input');
        nInput.type = 'number'; nInput.min = '1'; nInput.className = 'editable';
        nInput.value = h.classes_per_week;
        c1.appendChild(nInput);

        const c2 = addCell(tr, '', true);
        c2.innerHTML = '';
        const dSel = document.createElement('select');
        dSel.className = 'editable';
        [1, 2, 3].forEach((v) => {
          const o = document.createElement('option');
          o.value = v; o.textContent = v + (v === 1 ? ' period' : ' periods');
          if (v === h.duration_per_class) o.selected = true;
          dSel.appendChild(o);
        });
        c2.appendChild(dSel);

        const c3 = addCell(tr, '', true);
        c3.innerHTML = '';
        const pSel = document.createElement('select');
        pSel.className = 'editable';
        ['Separate', 'Continuous'].forEach((v) => {
          const o = document.createElement('option');
          o.value = v; o.textContent = v;
          if (v === h.pattern) o.selected = true;
          pSel.appendChild(o);
        });
        c3.appendChild(pSel);

        const c4 = addCell(tr, '', true);
        c4.innerHTML = '';
        const daySel = document.createElement('select');
        daySel.className = 'editable';
        ['Any', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].forEach((v) => {
          const o = document.createElement('option');
          o.value = v; o.textContent = v;
          if ((h.preferred_day || 'Any') === v) o.selected = true;
          daySel.appendChild(o);
        });
        c4.appendChild(daySel);

        addCell(tr, h.required_hours, false, 'center');
        addCell(tr, h.booked_hours, false, 'center');
        addCell(tr, h.status, false, 'status-' + (h.status || '').toLowerCase());

        const cA = addCell(tr, '', true);
        cA.innerHTML = '';
        const saveBtn = document.createElement('button');
        saveBtn.textContent = 'Save';
        saveBtn.className = 'primary save-row';
        cA.appendChild(saveBtn);
      } else {
        addCell(tr, h.required_hours, false, 'center');
        addCell(tr, h.booked_hours, false, 'center');
        addCell(tr, h.status, false, 'status-' + (h.status || '').toLowerCase());
        const cA = addCell(tr, '', true);
        cA.innerHTML = '';
      }

      tbody.appendChild(tr);
    }

    const trTotal = document.createElement('tr');
    const tc = document.createElement('td');
    tc.colSpan = 8;
    tc.textContent = 'Totals';
    tc.style.fontWeight = '600';
    trTotal.appendChild(tc);
    const reqTd = document.createElement('td');
    reqTd.textContent = totalRequired;
    reqTd.style.textAlign = 'center';
    const bokTd = document.createElement('td');
    bokTd.textContent = totalBooked;
    bokTd.style.textAlign = 'center';
    trTotal.appendChild(reqTd);
    trTotal.appendChild(bokTd);
    const statusTd = document.createElement('td');
    trTotal.appendChild(statusTd);
    const actTd = document.createElement('td');
    trTotal.appendChild(actTd);
    tbody.appendChild(trTotal);

    tbody.querySelectorAll('.save-row').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const tr = btn.closest('tr');
        const rid = tr.dataset.requestId;
        const inputs = tr.querySelectorAll('input.editable, select.editable');
        btn.disabled = true;
        try {
          const payload = {
            classes_per_week: parseInt(tr.querySelector('input.editable').value, 10),
            duration_per_class: parseInt(tr.querySelectorAll('select.editable')[0].value, 10),
            pattern: tr.querySelectorAll('select.editable')[1].value,
            preferred_day: tr.querySelectorAll('select.editable')[2].value
          };
          const data = await api('/api/weeks/' + current.id + '/requests/' + rid, {
            method: 'PUT',
            body: JSON.stringify(payload)
          });
          timetable = data.timetable;
          hours = data.hours;
          current = data.timetable.week;
          banner('Request updated and timetable regenerated.', 'ok');
          renderAll(true);
        } catch (e) {
          banner('Could not apply changes: ' + e.message, 'error');
          btn.disabled = false;
        }
      });
    });
  }

  function addCell(tr, text, allowHtml, cls) {
    const td = document.createElement('td');
    if (cls) td.className = cls;
    if (allowHtml) td.innerHTML = text;
    else td.textContent = text;
    tr.appendChild(td);
    return td;
  }

  function currentId() {
    const id = $('weekSelect').value;
    if (!id) throw new Error('Select a week first');
    return id;
  }

  $('createWeekBtn').addEventListener('click', async () => {
    const date = $('weekDate').value;
    if (!date) return banner('Pick a week start date first.', 'error');
    try {
      await api('/api/weeks', { method: 'POST', body: JSON.stringify({ week_start: date }) });
      banner('Week created.', 'ok');
      $('weekDate').value = '';
      await loadWeeks();
    } catch (e) {
      banner('Could not create week: ' + e.message, 'error');
    }
  });

  $('refreshBtn').addEventListener('click', () => loadWeeks());

  $('weekSelect').addEventListener('change', async (e) => {
    if (e.target.value) await selectWeek(e.target.value);
  });

  $('clearFileBtn').addEventListener('click', () => {
    $('collegeFile').value = '';
    $('staffFile').value = '';
    $('uploadStatus').textContent = '';
  });

  $('uploadBtn').addEventListener('click', async () => {
    const college = $('collegeFile').files[0];
    const staff = $('staffFile').files[0];
    if (!college || !staff) return banner('Select both Excel files (College Schedule + Staff Requests).', 'error');
    const id = $('weekSelect').value;
    if (!id) return banner('Select a week first.', 'error');
    $('uploadBtn').disabled = true;
    try {
      const fd = new FormData();
      fd.append('collegeSchedule', college);
      fd.append('staffRequests', staff);
      const data = await api('/api/weeks/' + id + '/upload', { method: 'POST', body: fd });
      let msg = 'Uploaded: ' + data.slots + ' schedule slots, ' + data.requests + ' requests.';
      if ((data.staffErrors || []).length) msg += ' Skipped ' + data.staffErrors.length + ' invalid row(s): ' + data.staffErrors.map((e) => 'row ' + e.row + ' (' + e.message + ')').join('; ');
      $('uploadStatus').textContent = msg;
      banner('Week inputs loaded. Generate the timetable now.', 'ok');
      await selectWeek(id);
    } catch (e) {
      banner('Upload failed: ' + e.message, 'error');
    } finally {
      $('uploadBtn').disabled = false;
    }
  });

  $('generateBtn').addEventListener('click', async () => {
    const id = $('weekSelect').value;
    if (!id) return banner('Select a week first.', 'error');
    $('generateBtn').disabled = true;
    try {
      const data = await api('/api/weeks/' + id + '/generate', { method: 'POST' });
      banner('Timetable generated: ' + data.resolved + ' placed, ' + data.unresolved.length + ' unresolved.', data.unresolved.length ? 'warn' : 'ok');
      await selectWeek(id);
    } catch (e) {
      banner('Generate failed: ' + e.message, 'error');
    } finally {
      $('generateBtn').disabled = false;
    }
  });

  $('lockBtn').addEventListener('click', async () => {
    const id = $('weekSelect').value;
    if (!id) return banner('Select a week first.', 'error');
    if (!window.confirm('Lock this week? After locking, the timetable cannot be changed for the entire week.')) return;
    try {
      await api('/api/weeks/' + id + '/lock', { method: 'POST' });
      banner('Week locked.', 'ok');
      await loadWeeks();
    } catch (e) {
      banner('Lock failed: ' + e.message, 'error');
    }
  });

  $('excelBtn').addEventListener('click', exportExcel);
  $('pdfBtn').addEventListener('click', exportPdf);
  $('printBtn').addEventListener('click', () => window.print());

  function exportExcel() {
    if (!current || !timetable) return banner('Generate a timetable first.', 'error');
    if (typeof XLSX === 'undefined') return banner('XLSX library not loaded.', 'error');
    const days = timetable.days.slice().sort((a, b) => (DAY_ORDER[a] ?? 99) - (DAY_ORDER[b] ?? 99));
    const rows = [['Period', ...days]];
    for (let p = 1; p <= timetable.periodCount; p++) {
      const line = ['P' + p];
      for (const d of days) line.push(cellText((timetable.grid[d] && timetable.grid[d][p]) || null).trim());
      rows.push(line);
    }
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Timetable');

    const hRows = [[
      'Staff', 'Department', 'Subject', 'Class Type', 'Classes/Week', 'Duration (periods)',
      'Pattern', 'Preferred Day', 'Required Hours', 'Booked Hours', 'Status'
    ]];
    for (const h of hours) {
      hRows.push([
        h.staff, h.department, h.subject, h.class_type, h.classes_per_week, h.duration_per_class,
        h.pattern, h.preferred_day || 'Any', h.required_hours, h.booked_hours, h.status
      ]);
    }
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(hRows), 'Staff Hours');
    XLSX.writeFile(wb, 'timetable_' + current.week_start + '.xlsx');
  }

  function exportPdf() {
    if (!current || !timetable) return banner('Generate a timetable first.', 'error');
    if (!window.jspdf) return banner('jsPDF library not loaded.', 'error');
    const days = timetable.days.slice().sort((a, b) => (DAY_ORDER[a] ?? 99) - (DAY_ORDER[b] ?? 99));
    const head = [['Period', ...days]];
    const body = [];
    for (let p = 1; p <= timetable.periodCount; p++) {
      const line = ['P' + p];
      for (const d of days) line.push(cellText((timetable.grid[d] && timetable.grid[d][p]) || null).trim());
      body.push(line);
    }
    const doc = new window.jspdf.jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    doc.setFontSize(14);
    doc.text('Timetable — week of ' + current.week_start + ' (' + current.status + ')', 10, 12);
    doc.autoTable({ startY: 18, head, body, styles: { fontSize: 8, cellPadding: 1.5 }, theme: 'grid' });

    doc.addPage();
    doc.setFontSize(14);
    doc.text('Staff weekly hours — ' + current.week_start, 10, 12);
    doc.autoTable({
      startY: 18,
      head: [['Staff', 'Department', 'Subject', 'Type', 'Classes/wk', 'Duration', 'Pattern', 'Preferred Day', 'Required', 'Booked', 'Status']],
      body: hours.map((h) => [
        h.staff, h.department, h.subject, h.class_type, h.classes_per_week, h.duration_per_class,
        h.pattern, h.preferred_day || 'Any', h.required_hours, h.booked_hours, h.status
      ]),
      styles: { fontSize: 8, cellPadding: 1.5 },
      theme: 'grid'
    });
    doc.save('timetable_' + current.week_start + '.pdf');
  }

  loadWeeks();
})();