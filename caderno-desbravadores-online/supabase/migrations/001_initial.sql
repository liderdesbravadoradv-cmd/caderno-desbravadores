-- Banco online do Caderno de Classes.
-- A interface do aplicativo continua a mesma; este banco substitui apenas
-- o armazenamento local do protótipo.

create schema if not exists private;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique not null,
  role text not null check (role in ('DESBRAVADOR','ADMIN','REGIONAL','DIRECTOR')),
  name text not null,
  birth_date date,
  club text,
  unit text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.director_credentials (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  password_plain text not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.club_state (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  submissions jsonb not null default '{}'::jsonb,
  messages jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create index if not exists club_state_updated_at_idx
  on public.club_state (updated_at);

create or replace function private.current_role()
returns text
language sql
security definer
set search_path = ''
stable
as $$
  select p.role
  from public.profiles p
  where p.id = (select auth.uid())
  limit 1;
$$;

revoke execute on function private.current_role() from public;
grant usage on schema private to authenticated;
grant execute on function private.current_role() to authenticated;

alter table public.profiles enable row level security;
alter table public.director_credentials enable row level security;
alter table public.club_state enable row level security;

revoke all on table public.profiles from anon, authenticated;
revoke all on table public.director_credentials from anon, authenticated;
revoke all on table public.club_state from anon, authenticated;

grant select on table public.profiles to authenticated;
grant select, insert, update on table public.club_state to authenticated;
grant select on table public.director_credentials to authenticated;

create policy "Profiles visible to the account owner and club evaluators"
on public.profiles
for select
to authenticated
using (
  id = (select auth.uid())
  or (select private.current_role()) in ('DIRECTOR','ADMIN','REGIONAL')
);

create policy "Each user sees only the state it is allowed to see"
on public.club_state
for select
to authenticated
using (
  profile_id = (select auth.uid())
  or (select private.current_role()) in ('DIRECTOR','ADMIN','REGIONAL')
);

create policy "Each user inserts only allowed state"
on public.club_state
for insert
to authenticated
with check (
  profile_id = (select auth.uid())
  or (select private.current_role()) in ('DIRECTOR','ADMIN','REGIONAL')
);

create policy "Each user updates only allowed state"
on public.club_state
for update
to authenticated
using (
  profile_id = (select auth.uid())
  or (select private.current_role()) in ('DIRECTOR','ADMIN','REGIONAL')
)
with check (
  profile_id = (select auth.uid())
  or (select private.current_role()) in ('DIRECTOR','ADMIN','REGIONAL')
);

create policy "Only the Director can read managed passwords"
on public.director_credentials
for select
to authenticated
using ((select private.current_role()) = 'DIRECTOR');

-- Bucket privado para fotos, vídeos e PDFs das atividades.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'evidence',
  'evidence',
  false,
  52428800,
  array['image/*','video/*','application/pdf']
)
on conflict (id) do update set
  public = false,
  file_size_limit = 52428800,
  allowed_mime_types = array['image/*','video/*','application/pdf'];

create policy "Evidence can be downloaded by the owner or evaluators"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'evidence'
  and (
    (storage.foldername(name))[1] = (select auth.uid()::text)
    or (select private.current_role()) in ('DIRECTOR','ADMIN','REGIONAL')
  )
);

create policy "Evidence can be uploaded by the owner"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'evidence'
  and (
    (storage.foldername(name))[1] = (select auth.uid()::text)
    or (select private.current_role()) in ('DIRECTOR','ADMIN','REGIONAL')
  )
);

create policy "Evidence can be deleted by the owner or Director"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'evidence'
  and (
    (storage.foldername(name))[1] = (select auth.uid()::text)
    or (select private.current_role()) = 'DIRECTOR'
  )
);
