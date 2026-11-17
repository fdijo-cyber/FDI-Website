begin;

-- Check the same email, code and expiry used by the signup trigger.
-- The trigger still consumes the invitation atomically at signup.
create or replace function public.editorial_check_invite(target_email text, invitation_code text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce(exists (
    select 1
    from editorial_private.invites
    where email = lower(trim(target_email))
      and expires_at > now()
      and code_hash = extensions.digest(trim(invitation_code), 'sha256')
  ), false);
$$;
revoke all on function public.editorial_check_invite(text, text) from public;
grant execute on function public.editorial_check_invite(text, text) to anon, authenticated;

commit;
