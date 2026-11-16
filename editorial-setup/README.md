# FDI editorial dashboard setup

1. Create a dedicated Supabase project for editorial accounts. Keep the events project separate.
2. In Authentication → Users, create your own confirmed email/password account before installing the SQL below. Use a unique password, entered privately in Supabase.
3. Run schema.sql in the SQL Editor. Then run the following SQL with your own confirmed account email:
   ```sql
   insert into public.editorial_members (id, email, role)
   select id, lower(email), 'super_admin'
   from auth.users
   where lower(email) = lower('YOUR_EMAIL_HERE') and email_confirmed_at is not null;
   ```
   Verify that this returns an insert count of 1.
4. In Supabase Authentication, enable Email signups and email confirmation. Add the exact deployed dashboard URL (for example https://futuredoctorinitiative.org/dashboard.html) to the redirect allowlist and configure SMTP for your team. Add the development dashboard URL if you are testing separately.
5. Set the project URL and public publishable key in editorial-config.js. Keep all service-role keys and passwords out of Git.
6. Open dashboard.html and sign in. Create an invitation for each approved email and send its link yourself. The account holder selects their own password and confirms their email before signing in.

An invitation expires after 72 hours and can be used once. Creating another invitation for the same email invalidates the previous one. Writers work on their own drafts and submit them. Editors and the super admin can edit, approve, and return drafts. Approval is an internal review status. Public publishing is managed separately.
