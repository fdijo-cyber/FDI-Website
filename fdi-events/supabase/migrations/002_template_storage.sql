-- Only approved blank templates, never attendee PDFs, belong in this public bucket.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('certificate-templates','certificate-templates',true,5242880,array['application/pdf'])
on conflict(id) do nothing;
-- No upload/write policies for anon/authenticated. Uploads go through the scoped Worker.
