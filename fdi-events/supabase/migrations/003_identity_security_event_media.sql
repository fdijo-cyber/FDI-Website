-- Additive upgrade: preserves existing people, registrations, invitations and certificates.
-- Apply after 001 and 002. Do not rerun the original schema on a live database.
alter table public.people add column public_id text;
alter table public.staff add column person_id uuid references public.people(id);
alter table public.staff add column terms_version text;
alter table public.staff add column terms_accepted_at timestamptz;
alter table public.events add column cover_image_url text not null default '';
alter table public.events add column schedule_image_url text not null default '';
alter table public.events add column schedule_items jsonb not null default '[]';
create table public.identifier_claims(identifier text primary key, person_id uuid not null references public.people(id));
insert into public.identifier_claims select upper(fdi_id),person_id from public.event_registrations;
insert into public.identifier_claims select 'FDI-PERSON-'||serial,id from public.people on conflict do nothing;
alter table public.identifier_claims enable row level security;
revoke all on public.identifier_claims from public,anon,authenticated;
grant all on public.identifier_claims to service_role;

create function public.fdi_claim_id(identifier_input text, person_input uuid) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if identifier_input is null then return; end if;
 if identifier_input !~ '^#?[A-Z0-9][A-Z0-9_-]{1,78}$' then raise exception 'INVALID_CUSTOM_ID'; end if;
 insert into identifier_claims values(upper(identifier_input),person_input) on conflict do nothing;
 if not exists(select 1 from identifier_claims where identifier=upper(identifier_input) and person_id=person_input) then raise exception 'ID_ALREADY_USED'; end if;
end $$;
create function public.fdi_person_identifier() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 perform fdi_claim_id('FDI-PERSON-'||new.serial,new.id);
 if new.public_id is not null then
  new.public_id=upper(trim(new.public_id)); perform fdi_claim_id(new.public_id,new.id);
 end if;
 return new;
end $$;
-- New people must exist before their identifier claim can reference them.
create trigger person_identifier after insert or update of public_id on public.people for each row execute function public.fdi_person_identifier();
create function public.fdi_registration_identifier() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin perform fdi_claim_id(new.fdi_id,new.person_id);return new;end $$;
create trigger registration_identifier before insert or update of fdi_id on public.event_registrations for each row execute function public.fdi_registration_identifier();
-- identifier_claims enforces cross-table uniqueness and returns a useful conflict message.
create index people_public_id_lookup on public.people(upper(public_id)) where public_id is not null;
create unique index staff_person_unique on public.staff(person_id) where person_id is not null;

create function public.fdi_security(actor uuid, action text default 'status', version text default null) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare st staff;
begin
 select * into st from staff where user_id=actor and enabled;
 if not found then raise exception 'FORBIDDEN'; end if;
 if action='accept_terms' then
  if version<>'2026-10-07' or version is null then raise exception 'INVALID_TERMS_VERSION'; end if;
  update staff set terms_version=version,terms_accepted_at=now() where user_id=actor;
  perform fdi_audit(actor,null,actor,'STAFF_TERMS_ACCEPTED',jsonb_build_object('version',version));
 elsif action<>'status' then raise exception 'UNKNOWN_ACTION'; end if;
 return jsonb_build_object('terms_version',(select terms_version from staff where user_id=actor),'required_terms_version','2026-10-07');
end $$;
create or replace function public.fdi_invitation_data(iid uuid) returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
 select jsonb_build_object('name',p.full_name,'person_id',coalesce(p.public_id,'FDI-PERSON-'||p.serial),'fdi_id',coalesce(p.public_id,r.fdi_id),'role',l.label,'rsvp',r.rsvp,
 'status',case when e.invitation_expires_at<now() then 'EXPIRED' else i.status end,'qr_token',case when r.rsvp='ACCEPTED' and i.status='ACTIVE' and e.checkin_enabled and e.checkin_closes_at>now() and (e.invitation_expires_at is null or e.invitation_expires_at>now()) then i.qr_token else null end,
 'checked_in_at',ci.checked_in_at,'event',to_jsonb(e),'rsvp_open',now()<=e.rsvp_deadline,
 'certificate',case when c.id is not null then jsonb_build_object('number',c.certificate_number,'token',c.verification_token,'status',c.status,'template_url',c.template_url) else null end)
 from invitations i join event_registrations r on r.id=i.registration_id join people p on p.id=r.person_id join events e on e.id=r.event_id join role_labels l on l.code=r.role_code
 left join check_ins ci on ci.registration_id=r.id left join certificates c on c.registration_id=r.id where i.id=iid and r.removed_at is null
$$;
create or replace function public.fdi_public(action text,payload jsonb) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
 declare inv invitations; reg event_registrations; ev events; cert certificates; iid uuid; out jsonb;
 begin
 if action='event' then
 select jsonb_build_object('name',name,'date',event_date,'description',description,'partner',partner,'venue',venue,'cover_image_url',cover_image_url,'schedule_image_url',schedule_image_url,'schedule_items',schedule_items,'address',address,'maps_url',maps_url,'schedule',schedule,'contact_email',contact_email,'contact_phone',contact_phone) into out from events where id=(payload->>'event_id')::uuid;
 return coalesce(out,'{}');
 elsif action='verify_certificate' then
 select * into cert from certificates where verification_hash=payload->>'token_hash';
 if not found then return jsonb_build_object('status','NOT_FOUND'); end if;
 insert into certificate_verifications(certificate_id) values(cert.id);
 if cert.status='REVOKED' then return jsonb_build_object('status','REVOKED'); end if;
 return jsonb_build_object('status','VALID','name',cert.recipient_name,'event',cert.event_name,'date',cert.event_date,'number',cert.certificate_number,'partner',cert.partner,'issued_at',cert.issued_at);
 elsif action='certificate_download' then
 select * into cert from certificates where verification_hash=payload->>'token_hash' and status='ISSUED';
 if not found then raise exception 'CERTIFICATE_NOT_FOUND'; end if;
 return jsonb_build_object('name',cert.recipient_name,'event',cert.event_name,'date',cert.event_date,'number',cert.certificate_number,'fdi_id',cert.fdi_id,'issued_at',cert.issued_at,'token',cert.verification_token,'template_url',cert.template_url,'layout',cert.template_layout);
 elsif action='metadata' then
 select jsonb_build_object('name',e.name,'date',e.event_date) into out from invitations i join event_registrations r on r.id=i.registration_id join events e on e.id=r.event_id where i.token_hash=payload->>'token_hash' and r.removed_at is null;
 return coalesce(out,jsonb_build_object('name','FDI Event Invitation'));
 elsif action='unlock' then
 select i.* into inv from invitations i join event_registrations r on r.id=i.registration_id join people p on p.id=r.person_id join events e on e.id=r.event_id
 where i.token_hash=payload->>'token_hash' and lower(regexp_replace(trim(p.full_name),'\s+',' ','g'))=lower(regexp_replace(trim(payload->>'name'),'\s+',' ','g')) and upper(trim(coalesce(p.public_id,r.fdi_id)))=upper(trim(payload->>'fdi_id'))
 and r.removed_at is null and i.status not in ('DRAFT','REVOKED') and (e.keep_invitation_record or e.invitation_expires_at is null or e.invitation_expires_at>now());
 if not found then raise exception 'UNVERIFIED'; end if;
 insert into invitation_sessions values(payload->>'session_hash',inv.id,now()+interval '2 hours');
 return public.fdi_invitation_data(inv.id);
 else
 select i.id into iid from invitation_sessions s join invitations i on i.id=s.invitation_id join event_registrations r on r.id=i.registration_id join events e on e.id=r.event_id
 where s.session_hash=payload->>'session_hash' and s.expires_at>now() and i.token_hash=payload->>'token_hash' and i.status not in ('REVOKED','DRAFT') and r.removed_at is null
 and (e.keep_invitation_record or e.invitation_expires_at is null or e.invitation_expires_at>now());
 if not found then raise exception 'UNVERIFIED'; end if;
 if action='rsvp' then
 select r.* into reg from event_registrations r join invitations i on i.registration_id=r.id where i.id=iid for update of r;
 select * into ev from events where id=reg.event_id;
 if now()>ev.rsvp_deadline then raise exception 'RSVP_CLOSED'; end if;
 if payload->>'response' not in ('ACCEPTED','DECLINED') then raise exception 'INVALID_RESPONSE'; end if;
 if exists(select 1 from invitations where id=iid and (status<>'ACTIVE' or (ev.invitation_expires_at is not null and ev.invitation_expires_at<now()))) then raise exception 'INVITATION_INACTIVE'; end if;
 update event_registrations set rsvp=payload->>'response',updated_at=now() where id=reg.id;
 insert into rsvp_history(registration_id,response) values(reg.id,payload->>'response');
 perform fdi_audit(null,reg.event_id,reg.id,'RSVP_CHANGED',jsonb_build_object('response',payload->>'response'));
 elsif action<>'invitation' then raise exception 'UNKNOWN_ACTION'; end if;
 return public.fdi_invitation_data(iid);
 end if;
 end $$;

create or replace function public.fdi_scan(actor uuid,eid uuid,qr_hash_input text,confirm boolean default false,device_input text default '') returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
 declare inv invitations; reg event_registrations; ev events; person_name text; role_name text; ci check_ins; state text;
 begin
 if not fdi_scope(actor,eid,true) then raise exception 'FORBIDDEN'; end if;
 select * into inv from invitations where qr_hash=qr_hash_input;
 if not found then return jsonb_build_object('status','INVALID_INVITATION'); end if;
 select * into reg from event_registrations where id=inv.registration_id for update;
 select * into inv from invitations where registration_id=reg.id;
 if reg.event_id<>eid then return jsonb_build_object('status','WRONG_EVENT'); end if;
 select * into ev from events where id=eid;
 state=case when reg.removed_at is not null or inv.status='REVOKED' then 'REVOKED_INVITATION'
 when inv.status='EXPIRED' or ev.checkin_closes_at<=now() or ev.invitation_expires_at<=now() or not ev.checkin_enabled then 'EXPIRED_INVITATION'
 when inv.status='DRAFT' then 'INVALID_INVITATION' when reg.rsvp='DECLINED' then 'DECLINED_INVITATION' when reg.rsvp<>'ACCEPTED' then 'NOT_YET_ACCEPTED' else 'VALID_INVITATION' end;
 if state<>'VALID_INVITATION' then return jsonb_build_object('status',state); end if;
 select * into ci from check_ins where registration_id=reg.id;
 if found then state='ALREADY_CHECKED_IN';
 elsif confirm then
 insert into check_ins(registration_id,checked_in_by,device) values(reg.id,actor,left(device_input,200)) returning * into ci;
 perform fdi_audit(actor,eid,reg.id,'CHECKED_IN'); state='CHECKED_IN';
 end if;
 select full_name into person_name from people where id=reg.person_id;
 select label into role_name from role_labels where code=reg.role_code;
 return jsonb_build_object('status',state,'name',person_name,'role',role_name,'fdi_id',coalesce((select public_id from people where id=reg.person_id),reg.fdi_id),'event',ev.name,'rsvp',reg.rsvp,'checked_in_at',ci.checked_in_at,'checked_in_by',ci.checked_in_by,'checked_in_by_email',(select email from staff where user_id=ci.checked_in_by));
 end $$;

create or replace function public.fdi_registration_row(rid uuid,with_tokens boolean default false) returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
 select jsonb_build_object('id',r.id,'person_id',p.id,'person_fdi_id',coalesce(p.public_id,'FDI-PERSON-'||p.serial),'public_id',coalesce(p.public_id,''),'event_id',r.event_id,'name',p.full_name,'fdi_id',coalesce(p.public_id,r.fdi_id),'serial',r.serial,'role_code',r.role_code,'role',l.label,'email',p.email,'phone',p.phone,
 'emergency_contact_name',case when with_tokens then p.emergency_contact_name else null end,'emergency_contact_phone',case when with_tokens then p.emergency_contact_phone else null end,'rsvp',r.rsvp,'invitation_status',case when e.invitation_expires_at<now() then 'EXPIRED' else i.status end,
 'checked_in_at',ci.checked_in_at,'certificate_status',coalesce(c.status,case when ci.registration_id is not null then 'ELIGIBLE' else 'NOT_ELIGIBLE' end),
 'invitation_token',case when with_tokens then i.token else null end,'qr_token',case when with_tokens then i.qr_token else null end,'certificate_token',case when with_tokens then c.verification_token else null end,'created_at',r.created_at)
 from event_registrations r join people p on p.id=r.person_id join role_labels l on l.code=r.role_code join invitations i on i.registration_id=r.id join events e on e.id=r.event_id left join check_ins ci on ci.registration_id=r.id left join certificates c on c.registration_id=r.id where r.id=rid
$$;
create or replace function public.fdi_admin(actor uuid,action text,payload jsonb default '{}') returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
 declare st staff; eid uuid; rid uuid; pid uuid; ev events; reg event_registrations; row jsonb; result jsonb; item jsonb; cert certificates; role_in text; new_id uuid; ser bigint; event_ids jsonb; person_data jsonb;
 begin
 select * into st from staff where user_id=actor and enabled;
 if not found then raise exception 'FORBIDDEN'; end if;
 if action='bootstrap' then
 return jsonb_build_object('staff',to_jsonb(st),'events',coalesce((select jsonb_agg(to_jsonb(e) order by e.event_date desc) from events e where fdi_scope(actor,e.id,true)),'[]'),'roles',(select jsonb_agg(to_jsonb(l)) from role_labels l));
 end if;
 if action in ('staff_list','staff_save','staff_remove','roles_save') then
 if st.role<>'SUPER_ADMIN' then raise exception 'FORBIDDEN'; end if;
 if action='staff_list' then return coalesce((select jsonb_agg(to_jsonb(s)||jsonb_build_object('full_name',(select full_name from people where id=s.person_id),'public_id',(select coalesce(public_id,'FDI-PERSON-'||serial) from people where id=s.person_id))||jsonb_build_object('last_login',(select last_sign_in_at from auth.users where id=s.user_id))||jsonb_build_object('events',coalesce((select jsonb_agg(event_id) from staff_events where user_id=s.user_id),'[]'))) from staff s),'[]'); end if;
 if action='roles_save' then
 update role_labels set label=payload->>'label' where code=payload->>'code'; perform fdi_audit(actor,null,null,'ROLE_LABEL_CHANGED',payload); return '{}';
 end if;
 new_id=(payload->>'user_id')::uuid;
 if new_id=actor then
  if action='staff_remove' or payload->>'role' is distinct from st.role or (payload->>'enabled')::boolean is distinct from st.enabled
    or coalesce((select jsonb_agg(v order by v) from jsonb_array_elements_text(coalesce(payload->'events','[]')) v),'[]') is distinct from coalesce((select jsonb_agg(event_id::text order by event_id::text) from staff_events where user_id=actor),'[]')
  then raise exception 'CANNOT_CHANGE_OWN_ACCESS';end if;
 end if;
 if action='staff_remove' then
 update staff set enabled=false where user_id=new_id; delete from staff_events where user_id=new_id;
 perform fdi_audit(actor,null,new_id,'STAFF_DISABLED');return '{}';
 end if;
 insert into staff(user_id,email,role,enabled) values(new_id,payload->>'email',payload->>'role',coalesce((payload->>'enabled')::boolean,true)) on conflict(user_id) do update set role=excluded.role,enabled=excluded.enabled;
 -- A staff account may link to an existing person only by explicit selection.
 if payload->>'person_id' is not null then
  pid=(payload->>'person_id')::uuid;
  if not exists(select 1 from people where id=pid) then raise exception 'NOT_FOUND'; end if;
  update staff set person_id=pid where user_id=new_id;
  if nullif(payload->>'full_name','') is not null then
   update people set full_name=trim(payload->>'full_name'),public_id=nullif(upper(trim(payload->>'public_id')),''),updated_at=now() where id=pid;
  end if;
 elsif nullif(payload->>'full_name','') is not null then
  select person_id into pid from staff where user_id=new_id;
  if pid is null then
   if exists(select 1 from people where lower(email)=lower(payload->>'email') and email<>'') then raise exception 'LIKELY_DUPLICATE'; end if;
   insert into people(full_name,email,public_id) values(trim(payload->>'full_name'),payload->>'email',nullif(upper(trim(payload->>'public_id')),'')) returning id into pid;
   update staff set person_id=pid where user_id=new_id;
  else
   update people set full_name=trim(payload->>'full_name'),public_id=nullif(upper(trim(payload->>'public_id')),''),updated_at=now() where id=pid;
  end if;
 end if;
 delete from invitation_sessions where invitation_id in (select i.id from invitations i join event_registrations r on r.id=i.registration_id where r.person_id=pid);
 if payload->>'role' in ('EVENT_MANAGER','CHECK_IN_STAFF') and jsonb_array_length(coalesce(payload->'events','[]'))=0 then raise exception 'EVENT_ASSIGNMENT_REQUIRED'; end if;
 delete from staff_events where user_id=new_id;
 for item in select value from jsonb_array_elements(coalesce(payload->'events','[]')) loop insert into staff_events values(new_id,(item#>>'{}')::uuid); end loop;
 result='[]';
 for item in select value from jsonb_array_elements(coalesce(payload->'event_passes','[]')) loop
  if pid is null or not exists(select 1 from staff_events where user_id=new_id and event_id=(item->>'event_id')::uuid) then raise exception 'FORBIDDEN';end if;
  select id into rid from event_registrations where person_id=pid and event_id=(item->>'event_id')::uuid and removed_at is null;
  if rid is null then
   row=fdi_admin(actor,'attendee_create',item||jsonb_build_object('person_id',pid));
  else row=fdi_registration_row(rid,true);end if;
  result=result||jsonb_build_array(row);
 end loop;
 perform fdi_audit(actor,null,new_id,'STAFF_ACCESS_CHANGED',jsonb_build_object('role',payload->>'role','enabled',payload->'enabled','events',payload->'events'));
 return jsonb_build_object('person_id',pid,'event_invitations',result);
 end if;
 if action='event_save' then
 if st.role not in ('SUPER_ADMIN','ADMIN') and not (st.role='EVENT_MANAGER' and payload->>'id' is not null and fdi_scope(actor,(payload->>'id')::uuid)) then raise exception 'FORBIDDEN'; end if;
 if payload->>'id' is not null then select * into ev from events where id=(payload->>'id')::uuid; if not found then raise exception 'NOT_FOUND'; end if; else ev.id=gen_random_uuid(); end if;
 -- Explicit allowlist: no privilege or audit data can be supplied as an event field.
 ev.name=payload->>'name'; ev.code=upper(payload->>'code'); ev.short_name=coalesce(payload->>'short_name',''); ev.description=coalesce(payload->>'description','');
 ev.event_date=(payload->>'event_date')::date; ev.timezone=coalesce(payload->>'timezone','Asia/Amman'); ev.rsvp_deadline=(payload->>'rsvp_deadline')::timestamptz;
 ev.arrival_time=coalesce(payload->>'arrival_time','');ev.start_time=coalesce(payload->>'start_time','');ev.end_time=coalesce(payload->>'end_time','');ev.venue=coalesce(payload->>'venue','');ev.address=coalesce(payload->>'address','');
 ev.directions_url=coalesce(payload->>'directions_url','');ev.maps_url=coalesce(payload->>'maps_url','');ev.dress_code=coalesce(payload->>'dress_code','');ev.contact_email=coalesce(payload->>'contact_email','info@futuredoctorinitiative.org');ev.contact_phone=coalesce(payload->>'contact_phone','+962 7 9055 6148');
 ev.partner=coalesce(payload->>'partner','');ev.partner_logo_url=coalesce(payload->>'partner_logo_url','');ev.schedule=coalesce(payload->>'schedule','');ev.instructions=coalesce(payload->>'instructions','');
 ev.cover_image_url=coalesce(payload->>'cover_image_url','');ev.schedule_image_url=coalesce(payload->>'schedule_image_url','');ev.schedule_items=coalesce(payload->'schedule_items','[]');
 ev.disclaimer=coalesce(payload->>'disclaimer','This invitation is personal and non-transferable. FDI reserves the right to verify the identity of the invitation holder.');
 ev.certificates_enabled=coalesce((payload->>'certificates_enabled')::boolean,true);ev.checkin_enabled=coalesce((payload->>'checkin_enabled')::boolean,true);ev.invitation_expires_at=nullif(payload->>'invitation_expires_at','')::timestamptz;
 ev.checkin_closes_at=(payload->>'checkin_closes_at')::timestamptz;ev.keep_invitation_record=coalesce((payload->>'keep_invitation_record')::boolean,true);ev.certificate_template_url=coalesce(payload->>'certificate_template_url','');ev.certificate_layout=coalesce(payload->'certificate_layout','{}');ev.created_at=coalesce(ev.created_at,now());ev.updated_at=now();
 insert into events select ev.* on conflict(id) do update set name=excluded.name,code=excluded.code,short_name=excluded.short_name,description=excluded.description,event_date=excluded.event_date,timezone=excluded.timezone,rsvp_deadline=excluded.rsvp_deadline,arrival_time=excluded.arrival_time,start_time=excluded.start_time,end_time=excluded.end_time,venue=excluded.venue,address=excluded.address,directions_url=excluded.directions_url,maps_url=excluded.maps_url,dress_code=excluded.dress_code,contact_email=excluded.contact_email,contact_phone=excluded.contact_phone,partner=excluded.partner,partner_logo_url=excluded.partner_logo_url,schedule=excluded.schedule,cover_image_url=excluded.cover_image_url,schedule_image_url=excluded.schedule_image_url,schedule_items=excluded.schedule_items,instructions=excluded.instructions,disclaimer=excluded.disclaimer,certificates_enabled=excluded.certificates_enabled,checkin_enabled=excluded.checkin_enabled,invitation_expires_at=excluded.invitation_expires_at,checkin_closes_at=excluded.checkin_closes_at,keep_invitation_record=excluded.keep_invitation_record,certificate_template_url=excluded.certificate_template_url,certificate_layout=excluded.certificate_layout,updated_at=now();
 perform fdi_audit(actor,ev.id,ev.id,'EVENT_SAVED');return to_jsonb(ev);
 end if;
 eid=(payload->>'event_id')::uuid;
 if not fdi_scope(actor,eid) then raise exception 'FORBIDDEN'; end if;
 select * into ev from events where id=eid;
 if action='badge_export' then
 perform fdi_audit(actor,eid,null,'BADGE_QR_EXPORTED');
 return coalesce((select jsonb_agg(jsonb_build_object('name',p.full_name,'fdi_id',coalesce(p.public_id,r.fdi_id),'role',l.label,'qr_token',i.qr_token)) from event_registrations r join people p on p.id=r.person_id join invitations i on i.registration_id=r.id join role_labels l on l.code=r.role_code where r.event_id=eid and r.removed_at is null and i.status='ACTIVE'),'[]');
 elsif action='attendees' then
 return coalesce((select jsonb_agg(fdi_registration_row(r.id) order by r.serial) from event_registrations r where r.event_id=eid and r.removed_at is null),'[]');
 elsif action='emergency_export' then
 if st.role not in ('SUPER_ADMIN','ADMIN') then raise exception 'FORBIDDEN'; end if;
 perform fdi_audit(actor,eid,null,'EMERGENCY_CONTACTS_EXPORTED');
 return coalesce((select jsonb_agg(fdi_registration_row(r.id,true)-'invitation_token'-'qr_token'-'certificate_token') from event_registrations r where r.event_id=eid and r.removed_at is null),'[]');
 elsif action='audit' then
 return coalesce((select jsonb_agg(to_jsonb(a)) from (select * from audit_logs where event_id=eid order by id desc limit 500) a),'[]');
 elsif action='people_search' then
 -- Only people in assigned events; global admins may search all.
 return coalesce((select jsonb_agg(to_jsonb(p)) from (select p.* from people p where (st.role in ('SUPER_ADMIN','ADMIN') or exists(select 1 from event_registrations r where r.person_id=p.id and fdi_scope(actor,r.event_id))) and (lower(p.full_name) like '%'||lower(payload->>'query')||'%' or lower(p.email)=lower(payload->>'query') or p.phone=payload->>'query' or upper(coalesce(p.public_id,'FDI-PERSON-'||p.serial))=upper(payload->>'query')) limit 20) p),'[]');
 elsif action='import_preview' then
 result='[]';ser=0;
 for item in select value from jsonb_array_elements(payload->'rows') loop
 result=result||jsonb_build_array(jsonb_build_object('index',ser,'duplicate',exists(select 1 from people p where lower(p.full_name)=lower(trim(item->>'full_name')) or (coalesce(item->>'email','')<>'' and lower(p.email)=lower(item->>'email')) or (coalesce(item->>'phone','')<>'' and p.phone=item->>'phone'))));ser=ser+1;
 end loop;return result;
 elsif action='import' then
 result='[]';
 for item in select value from jsonb_array_elements(payload->'rows') loop
 result=result||jsonb_build_array(fdi_admin(actor,'attendee_create',item||jsonb_build_object('event_id',eid,'allow_duplicate',false)));
 end loop; return result;
 elsif action='attendee_create' then
 if payload->>'person_id' is not null then
 pid=(payload->>'person_id')::uuid;
 if not exists(select 1 from people p where p.id=pid and (st.role in ('SUPER_ADMIN','ADMIN') or exists(select 1 from event_registrations r where r.person_id=pid and fdi_scope(actor,r.event_id)))) then raise exception 'FORBIDDEN'; end if;
 else
 if not coalesce((payload->>'allow_duplicate')::boolean,false) and exists(select 1 from people p where lower(p.full_name)=lower(trim(payload->>'full_name')) or (coalesce(payload->>'email','')<>'' and lower(p.email)=lower(payload->>'email')) or (coalesce(payload->>'phone','')<>'' and p.phone=payload->>'phone')) then raise exception 'LIKELY_DUPLICATE'; end if;
 insert into people(full_name,email,phone,emergency_contact_name,emergency_contact_phone,public_id) values(trim(payload->>'full_name'),coalesce(payload->>'email',''),coalesce(payload->>'phone',''),coalesce(payload->>'emergency_contact_name',''),coalesce(payload->>'emergency_contact_phone',''),nullif(upper(trim(payload->>'public_id')),'')) returning id into pid;
 end if;
 ser=nextval('public.fdi_registration_serial');
 while exists(select 1 from identifier_claims where identifier=upper('#FDI-'||ev.code||'-'||(payload->>'role_code')||'-'||ser)) loop ser=nextval('public.fdi_registration_serial');end loop;
 insert into event_registrations(event_id,person_id,serial,role_code,fdi_id) values(eid,pid,ser,payload->>'role_code','#FDI-'||ev.code||'-'||(payload->>'role_code')||'-'||ser) returning id into rid;
 insert into invitations(registration_id,token,token_hash,qr_token,qr_hash) values(rid,payload->>'token',payload->>'token_hash',payload->>'qr_token',payload->>'qr_hash');
 perform fdi_audit(actor,eid,rid,'ATTENDEE_CREATED');return fdi_registration_row(rid,true);
 end if;
 rid=(payload->>'registration_id')::uuid;
 select * into reg from event_registrations where id=rid and event_id=eid and removed_at is null for update;
 if not found then raise exception 'NOT_FOUND'; end if;
 if action='attendee_detail' then return fdi_registration_row(rid,true);
 elsif action='attendee_edit' then
 -- Global person details affect all registrations; event managers need authority across those events.
 if st.role='EVENT_MANAGER' and exists(select 1 from event_registrations where person_id=reg.person_id and not fdi_scope(actor,event_id)) then raise exception 'PERSON_SHARED_REQUIRES_ADMIN'; end if;
 if st.role='EVENT_MANAGER' and exists(select 1 from staff where person_id=reg.person_id) then raise exception 'PERSON_SHARED_REQUIRES_ADMIN';end if;
 update people set full_name=trim(payload->>'full_name'),email=coalesce(payload->>'email',''),phone=coalesce(payload->>'phone',''),emergency_contact_name=coalesce(payload->>'emergency_contact_name',''),emergency_contact_phone=coalesce(payload->>'emergency_contact_phone',''),public_id=case when payload ? 'public_id' then nullif(upper(trim(payload->>'public_id')),'') else public_id end,updated_at=now() where id=reg.person_id;
 update event_registrations set role_code=payload->>'role_code',fdi_id='#FDI-'||ev.code||'-'||(payload->>'role_code')||'-'||serial,updated_at=now() where id=rid;
 delete from invitation_sessions where invitation_id in (select i.id from invitations i join event_registrations r on r.id=i.registration_id where r.person_id=reg.person_id);
 perform fdi_audit(actor,eid,rid,'ATTENDEE_EDITED');
 elsif action='attendee_move' then
 if not fdi_scope(actor,(payload->>'new_event_id')::uuid) then raise exception 'FORBIDDEN'; end if;
 if exists(select 1 from check_ins where registration_id=rid) or exists(select 1 from certificates where registration_id=rid) then raise exception 'CANNOT_MOVE_AFTER_ATTENDANCE'; end if;
 select * into ev from events where id=(payload->>'new_event_id')::uuid;
 update event_registrations set event_id=ev.id,rsvp='PENDING',fdi_id='#FDI-'||ev.code||'-'||role_code||'-'||serial,updated_at=now() where id=rid;
 update invitations set token=payload->>'token',token_hash=payload->>'token_hash',qr_token=payload->>'qr_token',qr_hash=payload->>'qr_hash' where registration_id=rid;
 delete from invitation_sessions where invitation_id=(select id from invitations where registration_id=rid);
 perform fdi_audit(actor,eid,rid,'ATTENDEE_MOVED',jsonb_build_object('destination',ev.id));perform fdi_audit(actor,ev.id,rid,'ATTENDEE_MOVED_IN');
 elsif action='remove' then
 update event_registrations set removed_at=now() where id=rid; update invitations set status='REVOKED',revoked_by=actor,revoked_at=now() where registration_id=rid;
 update certificates set status='REVOKED' where registration_id=rid;
 delete from invitation_sessions where invitation_id=(select id from invitations where registration_id=rid);
 perform fdi_audit(actor,eid,rid,'ATTENDEE_REMOVED');
 elsif action in ('revoke','reactivate') then
 update invitations set status=case when action='revoke' then 'REVOKED' else 'ACTIVE' end,revoked_at=case when action='revoke' then now() else null end,revoked_by=case when action='revoke' then actor else null end,reason=payload->>'reason' where registration_id=rid;
 delete from invitation_sessions where invitation_id=(select id from invitations where registration_id=rid);
 perform fdi_audit(actor,eid,rid,case when action='revoke' then 'INVITATION_REVOKED' else 'INVITATION_REACTIVATED' end,jsonb_build_object('reason',payload->>'reason'));
 elsif action='reset' then
 update invitations set token=payload->>'token',token_hash=payload->>'token_hash',qr_token=payload->>'qr_token',qr_hash=payload->>'qr_hash' where registration_id=rid;
 delete from invitation_sessions where invitation_id=(select id from invitations where registration_id=rid);
 perform fdi_audit(actor,eid,rid,'INVITATION_RESET');
 elsif action='rsvp_override' then
 if payload->>'response' not in ('PENDING','ACCEPTED','DECLINED') then raise exception 'INVALID_RESPONSE'; end if;
 update event_registrations set rsvp=payload->>'response',updated_at=now() where id=rid;
 insert into rsvp_history(registration_id,response,actor) values(rid,payload->>'response',actor);
 perform fdi_audit(actor,eid,rid,'RSVP_OVERRIDDEN',jsonb_build_object('response',payload->>'response'));
 elsif action='manual_checkin' then
 return fdi_scan(actor,eid,(select qr_hash from invitations where registration_id=rid),true,'Admin manual confirmation');
 elsif action='undo_checkin' then
 delete from check_ins where registration_id=rid;
 update certificates set status='REVOKED' where registration_id=rid;
 perform fdi_audit(actor,eid,rid,'CHECKIN_UNDONE',jsonb_build_object('reason',payload->>'reason','certificates_revoked',true));
 elsif action in ('issue_certificate','regenerate_certificate') then
 if not ev.certificates_enabled then raise exception 'CERTIFICATES_DISABLED'; end if;
 if not exists(select 1 from check_ins where registration_id=rid) then
 if st.role not in ('SUPER_ADMIN','ADMIN') or not coalesce((payload->>'override')::boolean,false) or length(coalesce(payload->>'reason',''))<5 then raise exception 'NOT_ELIGIBLE'; end if;
 end if;
 select * into cert from certificates where registration_id=rid;
 if found and cert.status='ISSUED' and action='issue_certificate' then return to_jsonb(cert); end if;
 if found then
 update certificates set status='ISSUED',verification_token=payload->>'verification_token',verification_hash=payload->>'verification_hash',issued_at=now(),issued_by=actor,template_url=ev.certificate_template_url,template_layout=ev.certificate_layout,recipient_name=(select full_name from people where id=reg.person_id),event_name=ev.name,event_date=ev.event_date,fdi_id=coalesce((select public_id from people where id=reg.person_id),reg.fdi_id) where id=cert.id returning * into cert;
 else
 ser=nextval('public.fdi_certificate_serial');
 insert into certificates(registration_id,certificate_number,verification_token,verification_hash,recipient_name,event_name,event_date,fdi_id,partner,issued_by,template_url,template_layout) select rid,'FDI-CERT-'||extract(year from ev.event_date)||'-'||lpad(ser::text,greatest(6,length(ser::text)),'0'),payload->>'verification_token',payload->>'verification_hash',p.full_name,ev.name,ev.event_date,coalesce(p.public_id,reg.fdi_id),ev.partner,actor,ev.certificate_template_url,ev.certificate_layout from people p where p.id=reg.person_id returning * into cert;
 end if;
 perform fdi_audit(actor,eid,rid,case when action='regenerate_certificate' then 'CERTIFICATE_REGENERATED' else 'CERTIFICATE_ISSUED' end,jsonb_build_object('number',cert.certificate_number,'override',payload->'override','reason',payload->>'reason'));return to_jsonb(cert);
 elsif action='revoke_certificate' then
 update certificates set status='REVOKED' where registration_id=rid;perform fdi_audit(actor,eid,rid,'CERTIFICATE_REVOKED');
 elsif action='delivery' then
 insert into delivery_logs(registration_id,channel,state,actor) values(rid,payload->>'channel',payload->>'state',actor);perform fdi_audit(actor,eid,rid,'INVITATION_DELIVERY_LOGGED',jsonb_build_object('channel',payload->>'channel','state',payload->>'state'));
 else raise exception 'UNKNOWN_ACTION'; end if;
 return fdi_registration_row(rid,true);
 end $$;

-- RLS is defense in depth. Browsers cannot directly read/write platform tables.

revoke all on function public.fdi_claim_id(text,uuid),public.fdi_person_identifier(),public.fdi_registration_identifier(),public.fdi_security(uuid,text,text) from public,anon,authenticated;
grant execute on function public.fdi_security(uuid,text,text) to service_role;

create function public.fdi_staff_preflight(actor uuid,payload jsonb) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare pid uuid;
begin
 if not exists(select 1 from staff where user_id=actor and enabled and role='SUPER_ADMIN') then raise exception 'FORBIDDEN';end if;
 pid=nullif(payload->>'person_id','')::uuid;
 if pid is not null then
  if not exists(select 1 from people where id=pid) then raise exception 'NOT_FOUND';end if;
  if exists(select 1 from staff where person_id=pid) then raise exception 'LIKELY_DUPLICATE';end if;
 else
  if exists(select 1 from people where lower(email)=lower(payload->>'email') and email<>'') then raise exception 'LIKELY_DUPLICATE';end if;
 end if;
 if exists(select 1 from identifier_claims where identifier=upper(payload->>'public_id') and person_id is distinct from pid) then raise exception 'ID_ALREADY_USED';end if;
end $$;
revoke all on function public.fdi_staff_preflight(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.fdi_staff_preflight(uuid,jsonb) to service_role;

create function public.fdi_next_person_serial() returns bigint language plpgsql security definer set search_path=public,pg_temp as $$
declare n bigint;
begin
 loop
  n=nextval('public.fdi_person_serial');
  if not exists(select 1 from identifier_claims where identifier='FDI-PERSON-'||n) then return n;end if;
 end loop;
end $$;
alter table public.people alter column serial set default public.fdi_next_person_serial();
revoke all on function public.fdi_next_person_serial() from public,anon,authenticated;
create function public.fdi_auth_lookup(actor uuid,email_input text) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if not exists(select 1 from staff where user_id=actor and enabled and role='SUPER_ADMIN') then raise exception 'FORBIDDEN';end if;
 return (select id from auth.users where lower(email)=lower(email_input) limit 1);
end $$;
revoke all on function public.fdi_auth_lookup(uuid,text) from public,anon,authenticated;
grant execute on function public.fdi_auth_lookup(uuid,text) to service_role;
