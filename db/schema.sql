-- Streaming Machine — Postgres schema (Supabase or any Postgres 14+)
-- Run once: npm run db:init  (or paste into the Supabase SQL editor)

create extension if not exists pgcrypto;

-- Every title that has appeared in a tracked chart
create table if not exists titles (
  id            text primary key,            -- slug of show + season, e.g. "wednesday-season-2"
  platform      text not null default 'netflix',
  kind          text not null check (kind in ('tv','film')),
  name          text not null,               -- display name, e.g. "Wednesday: Season 2"
  show_title    text not null,
  first_seen    date not null default current_date
);

-- Official chart positions, one row per title per chart week
create table if not exists chart_entries (
  platform      text not null default 'netflix',
  chart_week    date not null,               -- week-ending date from the source
  kind          text not null,
  rank          int  not null,
  title_id      text not null references titles(id),
  weeks_in_top10 int,
  primary key (platform, chart_week, kind, rank)
);

-- One survey wave per day: the title set shown and the Prolific study that recruits for it
create table if not exists survey_waves (
  id                 serial primary key,
  wave_date          date not null unique,
  survey_version     text not null,
  title_ids          text[] not null,
  decoy              text not null,
  prolific_study_id  text,
  completion_code    text not null,
  places             int not null default 0,
  status             text not null default 'draft',  -- draft | active | stopped
  created_at         timestamptz not null default now()
);

-- One row per person who finished (or was screened out of) a wave
create table if not exists respondents (
  id              uuid primary key default gen_random_uuid(),
  wave_id         int references survey_waves(id),
  prolific_pid    text,
  session_id      text,
  status          text not null,               -- complete | screened
  started_at      timestamptz,
  completed_at    timestamptz not null default now(),
  duration_sec    int,
  age             int,
  region          text,
  services        text[],
  hours           text,
  gender          text,
  household       text[],
  social_grade    text,                        -- AB | C1 | C2 | DE
  genres          text[],
  attitudes       jsonb,
  best_title      text,
  attention_ok    boolean,
  decoy_claimed   boolean,
  straightliner   boolean,
  uk              jsonb,                       -- UK Pulse statements, 1-5
  uk_check        smallint,
  uk_seconds      int,
  past_vote       text
);
create index if not exists respondents_completed_idx on respondents (completed_at);
create index if not exists respondents_pid_idx on respondents (prolific_pid);

-- A1–A4: one row per respondent per title shown
create table if not exists viewing (
  respondent_id uuid not null references respondents(id) on delete cascade,
  title_id      text not null,
  status        text not null,                 -- finished | watching | stopped | heard | never
  stop_reason   text,
  plan_to_watch boolean,
  heard_via     text,
  primary key (respondent_id, title_id)
);

-- B + C: deep-dive ratings, up to 4 titles per respondent
create table if not exists ratings (
  respondent_id uuid not null references respondents(id) on delete cascade,
  title_id      text not null,
  rating        int  not null check (rating between 1 and 10),
  recommend     int  not null check (recommend between 0 and 10),
  watched_with  text[],
  loyalty       text,
  attributes    jsonb not null,               -- { gripping: 1-5, ... }
  occasions     text[],
  kid_safe      text,
  primary key (respondent_id, title_id)
);

-- Daily published dataset the dashboard reads
create table if not exists snapshots (
  id            serial primary key,
  snapshot_date date not null,
  published     boolean not null default false,
  guardrails    jsonb not null,
  data          jsonb not null,
  created_at    timestamptz not null default now()
);
create index if not exists snapshots_pub_idx on snapshots (published, snapshot_date desc);
