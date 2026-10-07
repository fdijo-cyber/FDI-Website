-- Public event artwork only. Never upload badges or personal documents here.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('event-media','event-media',true,5242880,array['image/png','image/jpeg','image/webp']) on conflict(id) do nothing;
-- No client upload policies. The Worker checks role, scope, size and file signature.
