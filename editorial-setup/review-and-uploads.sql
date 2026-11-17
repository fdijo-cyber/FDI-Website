begin;

alter table public.editorial_articles add column if not exists cover_path text;
grant insert (cover_path), update (cover_path) on public.editorial_articles to authenticated;

create table if not exists public.editorial_comments (
  id uuid primary key default gen_random_uuid(),
  article_id uuid not null references public.editorial_articles on delete cascade,
  author_id uuid not null default auth.uid() references public.editorial_members on delete cascade,
  author_role text not null default 'editor' check (author_role in ('editor', 'super_admin')),
  body text not null check (length(trim(body)) between 1 and 4000),
  created_at timestamptz not null default now()
);
alter table public.editorial_comments enable row level security;
revoke all on public.editorial_comments from anon, authenticated;
grant select on public.editorial_comments to authenticated;
grant insert (article_id, author_role, body) on public.editorial_comments to authenticated;
drop policy if exists "Read comments on accessible drafts" on public.editorial_comments;
create policy "Read comments on accessible drafts" on public.editorial_comments for select to authenticated
using (exists (select 1 from public.editorial_articles where id = article_id));
drop policy if exists "Editors leave comments" on public.editorial_comments;
create policy "Editors leave comments" on public.editorial_comments for insert to authenticated
with check (author_id = auth.uid() and exists (
  select 1 from public.editorial_members m
  where m.id = auth.uid() and m.role in ('editor', 'super_admin') and m.role = author_role
));

alter table public.editorial_media add column if not exists storage_path text;
grant insert (storage_path) on public.editorial_media to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('editorial-covers', 'editorial-covers', false, 5242880, array['image/jpeg','image/png','image/webp']),
  ('editorial-media', 'editorial-media', true, 52428800, array['video/mp4','video/webm','audio/mpeg','audio/mp4','audio/x-m4a','audio/wav','audio/webm','audio/ogg'])
on conflict (id) do nothing;

drop policy if exists "Editorial covers upload" on storage.objects;
create policy "Editorial covers upload" on storage.objects for insert to authenticated
with check (bucket_id = 'editorial-covers' and (storage.foldername(name))[1] = auth.uid()::text
  and exists (select 1 from public.editorial_members where id = auth.uid()));
drop policy if exists "Editorial covers read" on storage.objects;
create policy "Editorial covers read" on storage.objects for select to authenticated
using (bucket_id = 'editorial-covers' and (
  (storage.foldername(name))[1] = auth.uid()::text or exists (
    select 1 from public.editorial_members where id = auth.uid() and role in ('editor','super_admin')
  )
));
drop policy if exists "Editorial covers delete own" on storage.objects;
create policy "Editorial covers delete own" on storage.objects for delete to authenticated
using (bucket_id = 'editorial-covers' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "Editorial media upload" on storage.objects;
create policy "Editorial media upload" on storage.objects for insert to authenticated
with check (bucket_id = 'editorial-media' and (storage.foldername(name))[1] = auth.uid()::text
  and exists (select 1 from public.editorial_members where id = auth.uid() and role in ('editor','super_admin')));
drop policy if exists "Editorial media manage files" on storage.objects;
create policy "Editorial media manage files" on storage.objects for select to authenticated
using (bucket_id = 'editorial-media' and exists (
  select 1 from public.editorial_members where id = auth.uid() and role in ('editor','super_admin')
));
drop policy if exists "Editorial media remove files" on storage.objects;
create policy "Editorial media remove files" on storage.objects for delete to authenticated
using (bucket_id = 'editorial-media' and exists (
  select 1 from public.editorial_members where id = auth.uid() and role in ('editor','super_admin')
));

commit;
