-- =====================================================================
-- UC CITCS Exam Reviewer — upload site database setup
-- Run ONCE in Supabase: Dashboard → SQL Editor → New query → paste → Run.
-- Safe to re-run: it updates what already exists.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. The class upload code (students type it; no student accounts)
--    Change it any time from the admin page, or with:
--      update public.app_settings set upload_code = 'NEW-CODE';
--    Letters, numbers, - and _ only (4–64 characters).
-- ---------------------------------------------------------------------
create table if not exists public.app_settings (
  id          int  primary key default 1 check (id = 1),
  upload_code text not null check (upload_code ~ '^[A-Za-z0-9_-]{4,64}$')
);
insert into public.app_settings (id, upload_code)
values (1, 'CITCS')
on conflict (id) do nothing;
alter table public.app_settings enable row level security;

-- ---------------------------------------------------------------------
-- 2. Admins (you). Only accounts listed here can see uploads.
-- ---------------------------------------------------------------------
create table if not exists public.admins (
  user_id uuid primary key references auth.users (id) on delete cascade
);
alter table public.admins enable row level security;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public
as $$ select exists (select 1 from public.admins where user_id = auth.uid()) $$;

create or replace function public.check_upload_code(code text) returns boolean
language sql stable security definer set search_path = public
as $$ select exists (select 1 from public.app_settings where upload_code = code) $$;

-- ---------------------------------------------------------------------
-- 3. Submissions: one row per uploaded file, with what it is about
-- ---------------------------------------------------------------------
create table if not exists public.submissions (
  id            uuid        primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  upload_code   text        not null,
  file_path     text        not null check (char_length(file_path) <= 200),
  file_name     text        not null check (char_length(file_name) <= 200),
  file_size     bigint      not null check (file_size > 0 and file_size <= 20971520),
  file_type     text        not null check (char_length(file_type) <= 120),
  sha256        text        not null check (char_length(sha256) <= 64),
  course        text        not null check (char_length(course) between 1 and 60),
  year_section  text                 check (char_length(year_section) <= 60),
  subject       text        not null check (char_length(subject) between 1 and 80),
  teacher       text        not null check (char_length(teacher) between 1 and 80),
  exam_period   text        not null check (exam_period in ('Prelim', 'Midterm', 'Finals', 'Other')),
  material_type text                 check (char_length(material_type) <= 40),
  title         text                 check (char_length(title) <= 150),
  uploader      text                 check (char_length(uploader) <= 80),
  note          text                 check (char_length(note) <= 500),
  status        text        not null default 'pending'
                            check (status in ('pending', 'approved', 'used', 'rejected')),
  admin_note    text                 check (char_length(admin_note) <= 500)
);
create index if not exists submissions_created_idx on public.submissions (created_at desc);
create index if not exists submissions_sha_idx     on public.submissions (sha256);
alter table public.submissions enable row level security;

-- ---------------------------------------------------------------------
-- 4. Who can do what (row level security)
-- ---------------------------------------------------------------------
drop policy if exists "admins read own row" on public.admins;
create policy "admins read own row" on public.admins
  for select to authenticated using (user_id = auth.uid());

drop policy if exists "admins read settings" on public.app_settings;
create policy "admins read settings" on public.app_settings
  for select to authenticated using (public.is_admin());
drop policy if exists "admins update settings" on public.app_settings;
create policy "admins update settings" on public.app_settings
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- Students: may ADD a submission if the code is right. They can never read the list.
drop policy if exists "submit with code" on public.submissions;
create policy "submit with code" on public.submissions
  for insert to anon, authenticated
  with check (
    public.check_upload_code(upload_code)
    and starts_with(file_path, upload_code || '/')
    and status = 'pending'
    and admin_note is null
  );

drop policy if exists "admins read submissions" on public.submissions;
create policy "admins read submissions" on public.submissions
  for select to authenticated using (public.is_admin());
drop policy if exists "admins update submissions" on public.submissions;
create policy "admins update submissions" on public.submissions
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists "admins delete submissions" on public.submissions;
create policy "admins delete submissions" on public.submissions
  for delete to authenticated using (public.is_admin());

-- Start from zero, then give back only what Hive needs. This keeps things tight
-- even if "Automatically expose new tables" was ON when the project was created.
revoke all on public.submissions, public.app_settings, public.admins from anon, authenticated;
revoke execute on function public.check_upload_code(text), public.is_admin() from public;

grant usage on schema public to anon, authenticated;
grant insert                 on public.submissions  to anon, authenticated;
grant select, update, delete on public.submissions  to authenticated;
grant select, update         on public.app_settings to authenticated;
grant select                 on public.admins       to authenticated;
grant execute on function public.check_upload_code(text) to anon, authenticated;
grant execute on function public.is_admin()              to anon, authenticated;

-- ---------------------------------------------------------------------
-- 5. File storage: private bucket, 20 MB max, documents / PDF / slides only
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'uploads', 'uploads', false, 20971520,
  array[
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation'
  ]
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Files are stored as  <upload code>/<sha256>.<ext>, so identical files are kept once.
drop policy if exists "upload with code" on storage.objects;
create policy "upload with code" on storage.objects
  for insert to anon, authenticated
  with check (
    bucket_id = 'uploads'
    and public.check_upload_code((storage.foldername(name))[1])
  );

drop policy if exists "admins read files" on storage.objects;
create policy "admins read files" on storage.objects
  for select to authenticated using (bucket_id = 'uploads' and public.is_admin());

drop policy if exists "admins delete files" on storage.objects;
create policy "admins delete files" on storage.objects
  for delete to authenticated using (bucket_id = 'uploads' and public.is_admin());

-- ---------------------------------------------------------------------
-- 6. LAST STEP — make yourself the admin.
--    First create your account: Authentication → Users → Add user
--    (email + password, tick "Auto Confirm User"). Then run this line
--    with your email:
--
-- insert into public.admins (user_id)
-- select id from auth.users where email = 'YOUR-EMAIL@example.com'
-- on conflict do nothing;
-- ---------------------------------------------------------------------
