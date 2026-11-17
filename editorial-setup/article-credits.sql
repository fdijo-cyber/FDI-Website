begin;

alter table public.editorial_articles
  add column if not exists category text check (category ~ '^[[:alpha:]]{1,30}$'),
  add column if not exists subtitle text check (length(subtitle) <= 300),
  add column if not exists byline_name text check (length(byline_name) <= 120),
  add column if not exists editor_names text check (length(editor_names) <= 240),
  add column if not exists bibliography text check (length(bibliography) <= 12000);

grant insert (category, subtitle, byline_name, editor_names, bibliography),
      update (category, subtitle, byline_name, editor_names, bibliography)
on public.editorial_articles to authenticated;

create or replace function public.editorial_article_feed(article_id uuid default null)
returns table (id uuid, title text, body text, cover_path text, created_at timestamptz,
  home_position integer, category text, subtitle text, byline_name text,
  editor_names text, bibliography text)
language sql stable security definer set search_path = ''
as $$
  select a.id, a.title, case when article_id is null then left(a.body, 240) else a.body end,
         a.cover_path, a.created_at, a.home_position, a.category, a.subtitle,
         a.byline_name, a.editor_names, case when article_id is not null then a.bibliography end
  from public.editorial_articles a
  where a.status = 'approved' and (article_id is null or a.id = article_id)
  order by a.created_at desc, a.id;
$$;
revoke all on function public.editorial_article_feed(uuid) from public;
grant execute on function public.editorial_article_feed(uuid) to anon, authenticated;

notify pgrst, 'reload schema';
commit;
