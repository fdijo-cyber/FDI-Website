begin;

create or replace function editorial_private.is_super_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.editorial_members where id = auth.uid() and role = 'super_admin'
  );
$$;
revoke all on function editorial_private.is_super_admin() from public;
grant execute on function editorial_private.is_super_admin() to authenticated;
drop policy if exists "Super admin can read team access" on public.editorial_members;
create policy "Super admin can read team access" on public.editorial_members
  for select to authenticated using (editorial_private.is_super_admin());

create table if not exists public.editorial_media (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(trim(title)) between 1 and 160),
  kind text not null check (kind in ('video', 'podcast')),
  url text not null check (length(url) <= 2048 and url ~ '^https://[^[:space:]]+$'),
  published_at timestamptz not null default now()
);
alter table public.editorial_media enable row level security;
revoke all on public.editorial_media from anon, authenticated;
grant select on public.editorial_media to anon, authenticated;
grant insert (title, kind, url), delete on public.editorial_media to authenticated;
drop policy if exists "Public media library" on public.editorial_media;
create policy "Public media library" on public.editorial_media for select using (true);
drop policy if exists "Editorial leads publish media" on public.editorial_media;
create policy "Editorial leads publish media" on public.editorial_media for insert to authenticated
  with check (exists (select 1 from public.editorial_members where id = auth.uid() and role in ('super_admin', 'editor')));
drop policy if exists "Editorial leads unpublish media" on public.editorial_media;
create policy "Editorial leads unpublish media" on public.editorial_media for delete to authenticated
  using (exists (select 1 from public.editorial_members where id = auth.uid() and role in ('super_admin', 'editor')));

commit;
