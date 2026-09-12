<div align="center">

# 📅 College Timetable Manager

**Excel-driven, conflict-free weekly timetable generator for college staff**

*No paperwork. No double bookings. One Excel sheet in, a full weekly timetable out.*

[![Language](https://img.shields.io/badge/JavaScript-Node.js%20%7C%20Browser-F7DF1E?logo=javascript&logoColor=black)](#)
[![Framework](https://img.shields.io/badge/Express-4.x-gray?logo=express&logoColor=white)](#)
[![Database](https://img.shields.io/badge/SQLite%20%E2%9C%94%20Supabase-003B57?logo=postgresql&logoColor=white)](#)
[![Excel](https://img.shields.io/badge/Excel%20in%20%2F%20out-217346?logo=microsoftexcel&logoColor=white)](#)
[![License](https://img.shields.io/badge/License-MIT-blue)](#)

</div>

---

## ✨ Overview

A college repeatedly faces the same weekly problem: staff request their class hours, but slots are
finite and nobody may double-book. This app turns that scramble into a deterministic, auditable
process:

1. **A staff member fills one Excel row** — name, department, subject, how many classes a week, whether
   it is a *Normal* class or a *Lab*, how many consecutive periods one class takes, and whether their
   multiple weekly classes should run **Continuous** (one block) or on **Separate** days.
2. **An admin uploads the college's master schedule** — the days, the 7 daily periods, locked slots
   (the **professional-development hours**: C-Programming on Wednesday, English on Thursday, Aptitude
   on Friday), lunch breaks, and whole-day holidays.
3. **The scheduler assigns every request to free periods** — first-come-first-served in Excel row
   order, and a booked cell can **never** be booked again.
4. **The week is Locked** → immutable for the entire week. View, edit (while open), print, or export
   to Excel/PDF at any time.

---

## ✨ Features

| Feature | Detail |
| --- | --- |
| 🗓️ **Excel-driven inputs** | Weekly inputs arrive as `.xlsx` files — complete with dropdowns and an instructions sheet |
| 🧱 **No double bookings** | Guaranteed by the scheduler *and* re-enforced by a database constraint |
| 🔒 **Weekly locking** | Admin presses **Lock Week** → the whole week freezes (`409` on any mutation) |
| ⏱️ **7 periods / day** | Data-driven — whatever your college schedule says (3–7+ periods supported) |
| 🏖️ **Holidays** | One `Holiday? = YES` cell makes an entire day unavailable |
| 📐 **Normal vs Lab** | Labs must occupy 2–3 consecutive periods; normal classes 1–3 |
| 🔁 **Continuous vs Separate** | Continuous = single contiguous block; Separate = one class per day |
| 📊 **Staff hours editor** | Required vs booked weekly hours per staff; editable while open, re-checked & rolled back on conflict |
| 📤 **Exports** | Excel (`.xlsx`), PDF, and browser **Print** — including for locked weeks |
| 💾 **No vendor lock-in** | Zero-config **SQLite** local mode; switch to **Supabase** by adding a `.env` |

---

## 🗓️ Scheduling rules (how the engine thinks)

- Requests are processed **in Excel row order** (first-come, first-served) — order matters.
- Only cells marked *free* in the college schedule are eligible. PD hours, lunch, blocked cells and
  holidays are **never** touched.
- **Continuous** → a subject's `N` classes (of `D` periods each) are placed as **one contiguous block**
  of `N × D` periods within a single day.
- **Separate** → each of the `N` classes is placed on a **different day**, each occupying `D`
  consecutive periods.
- **Preferred day** is a best-effort hint — if it cannot be granted, the request lands on another free day.
- Anything that cannot be placed appears in an **Unresolved requests** list instead of silently
  corrupting the grid.

---

## 🧱 Tech stack

| Layer | Choice |
| --- | --- |
| Frontend | Vanilla HTML/CSS/JS (no build step) + SheetJS · jsPDF · autotable (bundled, offline-capable) |
| Server | Node.js · Express 4 · multer (Excel uploads) |
| Orchestration | Same-page scheduler over a small repository layer (`lib/store.js`) |
| Storage | **Local mode:** SQLite (`better-sqlite3`) · **Cloud mode:** Supabase (Postgres) |
| Excel parsing | `xlsx` (server) for validation + upload; SheetJS (client) for export |

Both storage backends implement the **same interface and schema**, so the app is identical to operate.

---

## 🏗️ Architecture

```
┌──────────────────────────┐         HTTP (JSON / multipart)        ┌───────────────────────────┐
│   Browser (vanilla UI)   │ ─────────────────────────────────────▶ │     Express server        │
│  · uploads the two .xlsx │  /api/weeks, /upload, /generate,       │  · Route validation       │
│  · renders timetable     │  /requests/:id, /lock, /timetable...   │  · .xlsx parsing          │
│  · staff-hours editor    │                                        │  · scheduling engine      │
│  · PDF / Excel / print   │ ◀───────────────────────────────────── │  · lock enforcement (409)│
└──────────────────────────┘          rendered grid + hours          └───────────┬───────────────┘
                                                                                 │ repository layer
                                                                                 ▼
                                                              ┌───────────────────────────────┐
                                                              │  SQLite (local, zero-config)  │
                                                              │      OR                       │
                                                              │  Supabase Postgres (cloud)    │
                                                              │  staff · week · college_slot  │
                                                              │  staff_request · booking      │
                                                              └───────────────────────────────┘
```

**Two storage modes, one schema:**

| | Local mode | Cloud mode |
| --- | --- | --- |
| When | `.env` missing / empty | `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` set in `.env` |
| Database file | `data/timetable.db` (auto-created) | Postgres via `supabase/migrations/schema.sql` |
| Best for | Single machine, offline, instant start | Shared deployment, multiple admin machines |
| Enforced integrity | JS overlap checks | JS checks **+** Postgres `EXCLUDE USING gist` no-overlap constraint |

> ⚠️ Data does **not** migrate between modes. Pick one per machine/environment.

---

## 🚀 Getting started

### Prerequisites

- **Node.js ≥ 18** (tested on 24)
- Python 3 + `openpyxl` *(only if you want to regenerate the Excel templates)*

### 1. Install

```sh
npm install
```

### 2. Choose your storage

**Option A — Local SQLite (recommended to start, zero config):**

Nothing to do. Skip to *Run*.

**Option B — Supabase (shared/cloud):**

1. Create a free project at <https://supabase.com>.
2. In **SQL Editor**, run the contents of `supabase/migrations/schema.sql`.
3. Copy **Project URL** and the **Service Role key** (Settings → API → `service_role`):

```sh
cp .env.example .env
# fill in SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY
```

The service-role key never leaves the server — the browser never talks to Supabase directly.

### 3. Run

```sh
npm start
```

Open **<http://localhost:3000>**.

### 4. Say hello with the sample data

The repo ships ready templates in [`/templates`](./templates):

1. Click **Create Week**, pick a Monday start date, and select the week.
2. Upload `college_schedule_template.xlsx` + `staff_requests_template.xlsx`.
3. Click **Generate Timetable**. 🎉
4. Play with the staff-hours editor, then hit **Lock Week** and export to Excel/PDF.

---

## 📋 The two Excel inputs

### `college_schedule_template.xlsx` — the college's week

| Column | Meaning |
| --- | --- |
| `Day` | Monday … Saturday |
| `P1 … P7` | Periods of the day — **empty** = schedulable, **any text** = blocked (e.g. `PD: C Programming`, `Lunch break`) |
| `Holiday?` | `YES` blocks the entire day |

The three professional-development hours are pre-filled as *examples* (Wednesday → C Programming,
Thursday → English Language, Friday → Aptitude) — move/edit them to match your college.

### `staff_requests_template.xlsx` — what staff ask for

| Column | Options |
| --- | --- |
| Staff Name | any text |
| Department | any text |
| Subject | any text (free-form per request) |
| Classes per Week | `1 … N` |
| Class Type | dropdown `Normal · Lab` |
| Duration per Class (periods) | dropdown `1 · 2 · 3` (labs must be `2–3`) |
| Pattern | dropdown `Separate · Continuous` |
| Preferred Day | dropdown `Any · Mon · Tue · Wed · Thu · Fri · Sat` (best-effort) |

### Regenerate the templates

```sh
python scripts/make_templates.py
```

---

## 🔄 Weekly workflow

```
Create Week ─▶ Upload (schedule + staff) ─▶ Generate ─▶ Edit hours (optional) ─▶ Lock Week
      │                                                   │                       │
   select date        .xlsx parsed & validated            grid fills in          frozen:
                               │                        unresolved → list        view/export
                               ▼                                               only until
                     no double bookings ever  ▲  constraints re-checked &      next week
                                               │  rolled back on conflict
```

---

## 📡 API reference

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/health` | Server + storage mode (`sqlite` / `supabase`) |
| `POST` | `/api/weeks` | Create a week `{ "week_start": "YYYY-MM-DD" }` |
| `GET` | `/api/weeks` | List weeks (newest first) |
| `POST` | `/api/weeks/:id/upload` | Multipart upload of `collegeSchedule` + `staffRequests` (`.xlsx`) |
| `POST` | `/api/weeks/:id/generate` | Run the scheduler and rebuild bookings |
| `PUT` | `/api/weeks/:id/requests/:rid` | Edit one request (classes/wk, duration, pattern, preferred day) |
| `POST` | `/api/weeks/:id/lock` | **Lock the week** (admin) |
| `GET` | `/api/weeks/:id/timetable` | Timetable grid + unresolved requests |
| `GET` | `/api/weeks/:id/staff-hours` | Per-request required vs booked hours |

> Every mutating route returns **`409 Conflict`** once the week is locked.

---

## 🗄️ Data model

| Table | Purpose |
| --- | --- |
| `staff` | Staff members (name, department) — created/updated from the Excel upload |
| `week` | One row per teaching week with `OPEN` / `LOCKED` status |
| `college_slot` | `day × period` grid cell with `FREE` / `BLOCKED` + human label |
| `staff_request` | What a staff member asked for (subject, count, duration, type, pattern, preferred day) |
| `booking` | A placed class (`day`, `period_start`, `period_end`) — unique & non-overlapping |

Both storage modes share this shape; the SQLite DDL lives in `lib/store.js` and the Postgres
migration in `supabase/migrations/schema.sql`.

---

## 🧪 Testing

```sh
node tests/smoke.js   # Excel parsing + scheduling engine (logic only)
node tests/e2e.js     # full HTTP workflow: create → upload → generate → edit → lock → 409
```

---

## 📁 Project structure

```
├── server.js                  # Express app + API routes + lock enforcement
├── lib/
│   ├── schedule.js            # conflict-free placement engine (pure)
│   ├── parse.js               # .xlsx parsing + validation (pure)
│   └── store.js               # repository layer: SQLite ⇄ Supabase
├── public/
│   ├── index.html             # single-page UI
│   ├── css/styles.css
│   ├── js/app.js              # UI wiring, editor, PDF/Excel/print exports
│   └── vendor/                # bundled SheetJS, jsPDF, autotable (offline-capable)
├── templates/                 # fill-in Excel templates with dropdowns
├── supabase/migrations/schema.sql
├── scripts/make_templates.py  # regenerate templates (Python + openpyxl)
└── tests/                     # smoke + e2e suites
```

---

## 🗺️ Roadmap

- [ ] Per-staff printable/Pdf timetable view
- [ ] Time labels per period («Period 1 · 9:00–9:50») instead of bare P1–P7
- [ ] Room assignment + room-conflict checks
- [ ] Bulk staff import from college ERP CSV
- [ ] Manual slot override with conflict warnings
- [ ] Auth (single admin vs staff) for multi-user deployments

---

## 📄 License

[MIT](./LICENSE)

---

<p align="center">Made with ❤️ for colleges that still run timetables on paper.</p>