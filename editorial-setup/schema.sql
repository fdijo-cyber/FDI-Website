-- Run once in a dedicated Supabase project.
create schema if not exists editorial_private;
create extension if not exists pgcrypto with schema extensions;

create table public.editorial_members (
  id uuid primary key references auth.users on delete cascade,
  email text not null,
  role text not null check (role in ('super_admin', 'editor', 'writer'))
);
alter table public.editorial_members enable row level security;
revoke all on public.editorial_members from anon, authenticated;
grant select on public.editorial_members to authenticated;
create policy "Read own editorial role" on public.editorial_members
  for select to authenticated using (id = auth.uid());

create table editorial_private.invites (
  email text primary key,
  role text not null check (role in ('editor', 'writer')),
  code_hash bytea not null,
  expires_at timestamptz not null
);

create function public.editorial_invite(target_email text, target_role text)
returns text language plpgsql security definer set search_path = '' as $$
declare
  email_address text := lower(trim(target_email));
  code text := encode(extensions.gen_random_bytes(24), 'hex');
begin
  if not exists (select 1 from public.editorial_members
                 where id = auth.uid() and role = 'super_admin') then
    raise exception 'Super admin access required';
  end if;
  if email_address is null or email_address !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
     or target_role is null or target_role not in ('editor', 'writer') then
    raise exception 'Enter a valid email and role';
  end if;
  if exists (select 1 from auth.users where lower(email) = email_address) then
    raise exception 'This email already has an account';
  end if;
  insert into editorial_private.invites values (
    email_address, target_role, extensions.digest(code, 'sha256'), now() + interval '72 hours'
  )
  on conflict (email) do update set role = excluded.role, code_hash = excluded.code_hash,
                                    expires_at = excluded.expires_at;
  return code;
end;
$$;
revoke all on function public.editorial_invite(text, text) from public, anon;
grant execute on function public.editorial_invite(text, text) to authenticated;

create function editorial_private.register_member()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  invited_role text;
begin
  delete from editorial_private.invites
  where email = lower(new.email) and expires_at > now()
    and code_hash = extensions.digest(new.raw_user_meta_data ->> 'editorial_code', 'sha256')
  returning role into invited_role;
  if invited_role is null then
    raise exception 'A valid editorial invitation is required';
  end if;
  insert into public.editorial_members values (new.id, lower(new.email), invited_role);
  return new;
end;
$$;
create trigger editorial_register_member after insert on auth.users
  for each row execute function editorial_private.register_member();

create table public.editorial_articles (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null default auth.uid() references public.editorial_members on delete cascade,
  title text not null check (length(trim(title)) between 1 and 160),
  body text not null check (length(trim(body)) between 1 and 50000),
  status text not null default 'draft' check (status in ('draft', 'submitted', 'approved')),
  created_at timestamptz not null default now()
);
alter table public.editorial_articles enable row level security;
revoke all on public.editorial_articles from anon, authenticated;
grant select on public.editorial_articles to authenticated;
grant insert (title, body), update (title, body, status) on public.editorial_articles to authenticated;

create policy "Read editorial drafts" on public.editorial_articles for select to authenticated
using (exists (
  select 1 from public.editorial_members m where m.id = auth.uid()
  and (m.role in ('super_admin', 'editor') or author_id = m.id)
));
create policy "Create editorial drafts" on public.editorial_articles for insert to authenticated
with check (author_id = auth.uid() and status = 'draft' and exists (
  select 1 from public.editorial_members where id = auth.uid()
));
create policy "Update editorial drafts" on public.editorial_articles for update to authenticated
using (exists (
  select 1 from public.editorial_members m where m.id = auth.uid()
  and (m.role in ('super_admin', 'editor') or (author_id = m.id and status = 'draft'))
))
with check (exists (
  select 1 from public.editorial_members m where m.id = auth.uid()
  and (m.role in ('super_admin', 'editor') or (author_id = m.id and status in ('draft', 'submitted')))
));
