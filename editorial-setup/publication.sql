begin;

alter table public.editorial_articles add column if not exists cover_path text;
alter table public.editorial_articles add column if not exists home_position integer
  check (home_position between 0 and 99);
alter table public.editorial_media add column if not exists home_position integer
  check (home_position between 0 and 99);
grant update (home_position) on public.editorial_articles, public.editorial_media to authenticated;

-- Keep the write permissions on homepage placement with editorial leads.
create or replace function editorial_private.guard_article_placement()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.home_position is distinct from old.home_position and not exists (
    select 1 from public.editorial_members where id = auth.uid() and role in ('editor','super_admin')
  ) then
    raise exception 'Editor access is required to change homepage placement';
  end if;
  return new;
end;
$$;
drop trigger if exists editorial_guard_placement on public.editorial_articles;
create trigger editorial_guard_placement before update of home_position on public.editorial_articles
  for each row execute function editorial_private.guard_article_placement();

drop policy if exists "Editorial leads arrange media" on public.editorial_media;
create policy "Editorial leads arrange media" on public.editorial_media for update to authenticated
using (exists (select 1 from public.editorial_members where id = auth.uid() and role in ('editor','super_admin')))
with check (exists (select 1 from public.editorial_members where id = auth.uid() and role in ('editor','super_admin')));

-- New cover references must point to the current uploader's folder.
create or replace function editorial_private.guard_cover_reference()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then
    if new.cover_path is not distinct from old.cover_path then return new; end if;
  end if;
  if new.cover_path is not null and split_part(new.cover_path, '/', 1) is distinct from auth.uid()::text then
    raise exception 'The cover must come from your own upload folder';
  end if;
  return new;
end;
$$;
drop trigger if exists editorial_guard_cover on public.editorial_articles;
create trigger editorial_guard_cover before insert or update of cover_path on public.editorial_articles
  for each row execute function editorial_private.guard_cover_reference();

-- Anonymous readers can only see approved articles and these public fields.
create or replace function public.editorial_public_articles(article_id uuid default null)
returns table (id uuid, title text, body text, cover_path text, created_at timestamptz, home_position integer)
language sql stable security definer set search_path = ''
as $$
  select a.id, a.title, case when article_id is null then left(a.body, 240) else a.body end,
         a.cover_path, a.created_at, a.home_position
  from public.editorial_articles a
  where a.status = 'approved' and (article_id is null or a.id = article_id)
  order by a.created_at desc, a.id;
$$;
revoke all on function public.editorial_public_articles(uuid) from public;
grant execute on function public.editorial_public_articles(uuid) to anon, authenticated;

create or replace function editorial_private.is_published_cover(object_path text)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.editorial_articles
    where status = 'approved' and cover_path = object_path
  );
$$;
revoke all on function editorial_private.is_published_cover(text) from public;
grant execute on function editorial_private.is_published_cover(text) to anon, authenticated;
drop policy if exists "Published article covers" on storage.objects;
create policy "Published article covers" on storage.objects for select to anon, authenticated
using (bucket_id = 'editorial-covers' and editorial_private.is_published_cover(name));

notify pgrst, 'reload schema';
commit;
