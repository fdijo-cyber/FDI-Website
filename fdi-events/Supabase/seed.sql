insert into public.events(id,name,short_name,code,event_date,rsvp_deadline,partner,checkin_closes_at,invitation_expires_at)
values('a11fd100-0000-4000-8000-000000000001','FDI BFA Workshop','BFA Workshop','JPS','2026-11-07','2026-10-30T23:59:59+03:00','Jordan Paramedic Society (JPS)','2026-11-07T23:59:59+03:00','2026-11-07T23:59:59+03:00')
on conflict(id) do nothing;
-- Bootstrap a real owner after creating their Supabase Auth user:
-- insert into public.staff(user_id,email,role) select id,email,'SUPER_ADMIN' from auth.users where email='YOUR_OWNER_EMAIL';
