'use strict';

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { createClient } = require('@supabase/supabase-js');

const SQLITE_SCHEMA = `
create table if not exists staff (
  id integer primary key autoincrement,
  name text not null unique,
  department text not null default ''
);
create table if not exists week (
  id integer primary key autoincrement,
  week_start text not null unique,
  status text not null default 'OPEN',
  locked_at text
);
create table if not exists college_slot (
  id integer primary key autoincrement,
  week_id integer not null references week(id) on delete cascade,
  day text not null,
  period integer not null,
  status text not null default 'FREE',
  label text,
  unique (week_id, day, period)
);
create table if not exists staff_request (
  id integer primary key autoincrement,
  week_id integer not null references week(id) on delete cascade,
  staff_id integer not null references staff(id) on delete cascade,
  subject_name text not null,
  classes_per_week integer not null,
  class_type text not null default 'Normal',
  duration_per_class integer not null default 1,
  pattern text not null default 'Separate',
  preferred_day text,
  sort_idx integer not null default 0,
  status text not null default 'UNRESOLVED',
  issue text
);
create table if not exists booking (
  id integer primary key autoincrement,
  week_id integer not null references week(id) on delete cascade,
  request_id integer not null references staff_request(id) on delete cascade,
  day text not null,
  period_start integer not null,
  period_end integer not null,
  unique (week_id, day, period_start)
)`;

const PK_FETCH = 'id, week_start, status, locked_at';
const REQ_FIELDS = [
  'r.id', 'r.staff_id', 'r.subject_name', 'r.classes_per_week', 'r.class_type',
  'r.duration_per_class', 'r.pattern', 'r.preferred_day', 'r.sort_idx', 'r.status', 'r.issue'
].join(', ');

function sqliteError(err, table) {
  if (err && err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
    const e = new Error(`Constraint violation in ${table || 'table'}: ${err.message}`);
    e.code = '23505';
    return e;
  }
  return err;
}

function createSQLiteStore(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const db = new Database(filePath);
  db.pragma('foreign_keys = ON');
  db.exec(SQLITE_SCHEMA);

  const store = {
    kind: 'sqlite',

    async listWeeks() {
      return db.prepare(`select ${PK_FETCH} from week order by week_start desc`).all();
    },
    async createWeek(week_start) {
      try {
        const r = db.prepare('insert into week (week_start, status) values (?, ?)').run(week_start, 'OPEN');
        return db.prepare(`select ${PK_FETCH} from week where id = ?`).get(r.lastInsertRowid);
      } catch (e) {
        throw sqliteError(e, 'week(week_start)');
      }
    },
    async getWeek(id) {
      return db.prepare(`select ${PK_FETCH} from week where id = ?`).get(id) || null;
    },
    async lockWeek(id) {
      db.prepare("update week set status = 'LOCKED', locked_at = ? where id = ?").run(new Date().toISOString(), id);
      return db.prepare(`select ${PK_FETCH} from week where id = ?`).get(id);
    },
    async clearWeek(weekId) {
      db.prepare('delete from booking where week_id = ?').run(weekId);
      db.prepare('delete from staff_request where week_id = ?').run(weekId);
      db.prepare('delete from college_slot where week_id = ?').run(weekId);
    },
    async insertSlots(weekId, rows) {
      const ins = db.prepare('insert into college_slot (week_id, day, period, status, label) values (?, ?, ?, ?, ?)');
      const tx = db.transaction((list) => {
        for (const r of list) ins.run(weekId, r.day, r.period, r.status, r.label);
      });
      try {
        tx(rows);
      } catch (e) {
        throw sqliteError(e, 'college_slot');
      }
    },
    async upsertStaff(names, deptsByName) {
      const ins = db.prepare('insert into staff (name, department) values (?, ?)');
      const upd = db.prepare('update staff set department = ? where name = ?');
      const map = {};
      const tx = db.transaction(() => {
        const placeholders = names.map(() => '?').join(', ');
        const existing = db.prepare(`select id, name from staff where name in (${placeholders})`).all(...names);
        for (const s of existing) map[s.name] = s.id;
        for (const name of names) {
          if (!map[name]) {
            const r = ins.run(name, '');
            map[name] = Number(r.lastInsertRowid);
          }
          upd.run(deptsByName[name] || '', name);
        }
      });
      try {
        tx();
      } catch (e) {
        throw sqliteError(e, 'staff');
      }
      return map;
    },
    async insertRequests(weekId, rows) {
      const ins = db.prepare(
        'insert into staff_request (week_id, staff_id, subject_name, classes_per_week, class_type, duration_per_class, pattern, preferred_day, sort_idx) values (?, ?, ?, ?, ?, ?, ?, ?, ?)'
      );
      const tx = db.transaction((list) => {
        for (const r of list) {
          ins.run(weekId, r.staff_id, r.subject_name, r.classes_per_week, r.class_type, r.duration_per_class, r.pattern, r.preferred_day, r.sort_idx);
        }
      });
      try {
        tx(rows);
      } catch (e) {
        throw sqliteError(e, 'staff_request');
      }
    },
    async getSlots(weekId) {
      return db.prepare('select day, period, status, label from college_slot where week_id = ?').all(weekId);
    },
    async getRequests(weekId) {
      const rows = db.prepare(
        `select ${REQ_FIELDS}, s.name as staff_name, s.department as staff_department
           from staff_request r join staff s on s.id = r.staff_id
          where r.week_id = ? order by r.sort_idx asc`
      ).all(weekId);
      return rows;
    },
    async getRequest(id) {
      return db.prepare(
        `select ${REQ_FIELDS}, s.name as staff_name
           from staff_request r join staff s on s.id = r.staff_id
          where r.id = ?`
      ).get(id) || null;
    },
    async updateRequest(id, fields) {
      db.prepare(
        'update staff_request set classes_per_week = ?, duration_per_class = ?, pattern = ?, preferred_day = ? where id = ?'
      ).run(
        fields.classes_per_week, fields.duration_per_class, fields.pattern, fields.preferred_day ?? null, id
      );
    },
    async setRequestOutcome(id, status, issue) {
      db.prepare('update staff_request set status = ?, issue = ? where id = ?').run(status, issue, id);
    },
    async deleteBookings(weekId) {
      db.prepare('delete from booking where week_id = ?').run(weekId);
    },
    async insertBookings(rows) {
      const check = db.prepare(
        'select id from booking where week_id = ? and day = ? and (period_start <= ? and period_end >= ?)'
      );
      const ins = db.prepare('insert into booking (week_id, request_id, day, period_start, period_end) values (?, ?, ?, ?, ?)');
      const tx = db.transaction((list) => {
        for (const b of list) {
          const clash = check.get(b.week_id, b.day, b.period_end, b.period_start);
          if (clash) {
            const e = new Error(`Booking conflict on ${b.day} periods ${b.period_start}-${b.period_end}`);
            e.code = '23505';
            throw e;
          }
          ins.run(b.week_id, b.request_id, b.day, b.period_start, b.period_end);
        }
      });
      try {
        tx(rows);
      } catch (e) {
        throw sqliteError(e, 'booking');
      }
    },
    async getBookings(weekId) {
      return db.prepare('select id, day, period_start, period_end, request_id from booking where week_id = ?').all(weekId);
    }
  };
  return store;
}

function createSupabaseStore(url, key) {
  const sb = createClient(url, key);
  const CHUNK = 500;
  const en = (fields, data) => (data || []).map((r) => {
    const row = {};
    for (const f of Object.keys(r)) row[f] = r[f];
    row.staff_name = Array.isArray(r.staff) ? (r.staff[0] && r.staff[0].name) || '' : (r.staff && r.staff.name) || '';
    row.staff_department = Array.isArray(r.staff) ? (r.staff[0] && r.staff[0].department) || '' : (r.staff && r.staff.department) || '';
    delete row.staff;
    return row;
  })(fields, data);

  const store = {
    kind: 'supabase',

    async listWeeks() {
      const { data, error } = await sb.from('week').select('id, week_start, status, locked_at').order('week_start', { ascending: false });
      if (error) throw error;
      return data || [];
    },
    async createWeek(week_start) {
      const { data, error } = await sb.from('week').insert({ week_start, status: 'OPEN' }).select('id, week_start, status, locked_at').single();
      if (error) throw error;
      return data;
    },
    async getWeek(id) {
      const { data, error } = await sb.from('week').select('id, week_start, status, locked_at').eq('id', id).single();
      if (error) return null;
      return data;
    },
    async lockWeek(id) {
      const { data, error } = await sb.from('week').update({ status: 'LOCKED', locked_at: new Date().toISOString() }).eq('id', id).select('id, week_start, status, locked_at').single();
      if (error) throw error;
      return data;
    },
    async clearWeek(weekId) {
      const { error } = await sb.from('booking').delete().eq('week_id', weekId);
      if (error) throw error;
      const { error: er2 } = await sb.from('staff_request').delete().eq('week_id', weekId);
      if (error || er2) throw er2 || error;
      const { error: er3 } = await sb.from('college_slot').delete().eq('week_id', weekId);
      if (error || er3) throw er3 || error;
    },
    async insertSlots(weekId, rows) {
      const list = rows.map((r) => ({ week_id: weekId, day: r.day, period: r.period, status: r.status, label: r.label }));
      for (let i = 0; i < list.length; i += CHUNK) {
        const { error } = await sb.from('college_slot').insert(list.slice(i, i + CHUNK));
        if (error) throw error;
      }
    },
    async upsertStaff(names, deptsByName) {
      const { data: existing, error } = await sb.from('staff').select('id, name').in('name', names);
      if (error) throw error;
      const map = {};
      for (const s of existing || []) map[s.name] = s.id;
      const toInsert = names.filter((n) => !map[n]);
      for (let i = 0; i < toInsert.length; i += CHUNK) {
        const { data: inserted, error: e } = await sb.from('staff').insert(toInsert.slice(i, i + CHUNK).map((name) => ({ name, department: '' }))).select('id, name');
        if (e) throw e;
        for (const s of inserted || []) map[s.name] = s.id;
      }
      for (const name of names) {
        const { error: e } = await sb.from('staff').update({ department: deptsByName[name] || '' }).eq('name', name);
        if (e) throw e;
      }
      return map;
    },
    async insertRequests(weekId, rows) {
      const list = rows.map((r) => ({
        week_id: weekId, staff_id: r.staff_id, subject_name: r.subject_name,
        classes_per_week: r.classes_per_week, class_type: r.class_type,
        duration_per_class: r.duration_per_class, pattern: r.pattern,
        preferred_day: r.preferred_day, sort_idx: r.sort_idx
      }));
      for (let i = 0; i < list.length; i += CHUNK) {
        const { error } = await sb.from('staff_request').insert(list.slice(i, i + CHUNK));
        if (error) throw error;
      }
    },
    async getSlots(weekId) {
      const { data, error } = await sb.from('college_slot').select('day, period, status, label').eq('week_id', weekId).order('period', { ascending: true });
      if (error) throw error;
      return data || [];
    },
    async getRequests(weekId) {
      const { data, error } = await sb.from('staff_request')
        .select(`id, staff_id, subject_name, classes_per_week, class_type, duration_per_class, pattern, preferred_day, sort_idx, status, issue, staff:staff_id(name, department)`)
        .eq('week_id', weekId)
        .order('sort_idx', { ascending: true });
      if (error) throw error;
      return en([], data);
    },
    async getRequest(id) {
      const { data, error } = await sb.from('staff_request')
        .select(`id, staff_id, subject_name, classes_per_week, class_type, duration_per_class, pattern, preferred_day, sort_idx, status, issue, staff:staff_id(name, department)`)
        .eq('id', id)
        .single();
      if (error) return null;
      return en([], [data])[0] || null;
    },
    async updateRequest(id, fields) {
      const { error } = await sb.from('staff_request').update({
        classes_per_week: fields.classes_per_week,
        duration_per_class: fields.duration_per_class,
        pattern: fields.pattern,
        preferred_day: fields.preferred_day
      }).eq('id', id);
      if (error) throw error;
    },
    async setRequestOutcome(id, status, issue) {
      const { error } = await sb.from('staff_request').update({ status, issue }).eq('id', id);
      if (error) throw error;
    },
    async deleteBookings(weekId) {
      const { error } = await sb.from('booking').delete().eq('week_id', weekId);
      if (error) throw error;
    },
    async insertBookings(rows) {
      const list = rows.map((b) => ({ week_id: b.week_id, request_id: b.request_id, day: b.day, period_start: b.period_start, period_end: b.period_end }));
      for (let i = 0; i < list.length; i += CHUNK) {
        const { error } = await sb.from('booking').insert(list.slice(i, i + CHUNK));
        if (error) throw error;
      }
    },
    async getBookings(weekId) {
      const { data, error } = await sb.from('booking').select('id, day, period_start, period_end, request_id').eq('week_id', weekId);
      if (error) throw error;
      return data || [];
    }
  };
  return store;
}

function createStore(env) {
  const url = env.SUPABASE_URL || '';
  const key = env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (url && key) return createSupabaseStore(url, key);
  const file = env.SQLITE_PATH || path.join(__dirname, '..', 'data', 'timetable.db');
  return createSQLiteStore(file);
}

module.exports = { createStore, createSQLiteStore };