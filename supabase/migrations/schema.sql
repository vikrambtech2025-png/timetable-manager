create extension if not exists btree_gist;

create table if not exists staff (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  department text not null default ''
);

create table if not exists week (
  id uuid primary key default gen_random_uuid(),
  week_start date not null unique,
  status text not null default 'OPEN' check (status in ('OPEN', 'LOCKED')),
  locked_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists college_slot (
  id uuid primary key default gen_random_uuid(),
  week_id uuid not null references week(id) on delete cascade,
  day text not null,
  period int not null,
  status text not null default 'FREE' check (status in ('FREE', 'BLOCKED')),
  label text,
  unique (week_id, day, period)
);

create table if not exists staff_request (
  id uuid primary key default gen_random_uuid(),
  week_id uuid not null references week(id) on delete cascade,
  staff_id uuid not null references staff(id) on delete cascade,
  subject_name text not null,
  classes_per_week int not null check (classes_per_week >= 1),
  class_type text not null default 'Normal' check (class_type in ('Normal', 'Lab')),
  duration_per_class int not null default 1 check (duration_per_class between 1 and 3),
  pattern text not null default 'Separate' check (pattern in ('Continuous', 'Separate')),
  preferred_day text,
  sort_idx int not null default 0,
  status text not null default 'UNRESOLVED' check (status in ('PLACED', 'UNRESOLVED')),
  issue text,
  created_at timestamptz not null default now()
);

create table if not exists booking (
  id uuid primary key default gen_random_uuid(),
  week_id uuid not null references week(id) on delete cascade,
  request_id uuid not null references staff_request(id) on delete cascade,
  day text not null,
  period_start int not null,
  period_end int not null,
  created_at timestamptz not null default now(),
  constraint booking_no_overlap exclude using gist (
    week_id with =,
    day with =,
    int4range(period_start, period_end, '[]') with &&
  )
);

create index if not exists idx_booking_week on booking (week_id);
create index if not exists idx_request_week on staff_request (week_id);
create index if not exists idx_slot_week on college_slot (week_id);