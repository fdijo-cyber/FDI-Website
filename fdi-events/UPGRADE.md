# October 7, 2026 platform update

Based on `fdijo-cyber/FDI-Website` main commit `d09594d7a7c87f36e3dc8c3bcaa5c8e7fc897d52` (the uploaded source was compared with local file hashes). Changes are confined to `fdi-events/`; the public website, DNS, and certificate PDF at the repository root are untouched. This package is source code, not a backup of the Supabase database or live credentials.

## Upgrade the existing deployment

1. Take a Supabase database backup using the dashboard's available backup/export options or `supabase db dump` from an authenticated environment. Preserve existing Cloudflare environment variables separately; never put them in this source archive.
2. Apply **only the new migrations** in order to the existing platform database:
   - `supabase/migrations/003_identity_security_event_media.sql`
   - `supabase/migrations/004_event_media_storage.sql`
   Use `supabase db push` with the correct project linked, or run these two files in the SQL editor. Do not rerun `001_platform.sql` on a live database. The new migrations extend the existing schema and replace its RPC definitions; they preserve people, IDs, invitations, tokens, check-ins, certificates and audit history.
3. In Supabase Auth enable TOTP enrollment and verification. Disable public signup. Ensure the Site URL is `https://events.futuredoctorinitiative.org` and the redirect allowlist includes `https://events.futuredoctorinitiative.org/auth/callback`. If an authenticator is lost, verify the account holder before recovery through Supabase's authorized account administration.
4. Configure a working Auth email sender. Supabase's built-in sender has low limits and restricts external recipients; general staff invitations normally require custom SMTP. Use an existing or free SMTP provider appropriate to FDI, with credentials kept in Supabase settings. Do not place email passwords in this repository. Test an invitation to an actual external staff email. See https://supabase.com/docs/guides/auth/auth-smtp .
5. Upload this `fdi-events/` folder to the repository, retaining other website files, or merge the prepared source changes once write access is granted. Run `npm ci`, `npm run build`, `npm test`, and `npm run test:e2e` from `fdi-events/`. Install Chromium for browser tests with `npx playwright install chromium` if needed.
6. Deploy the existing Cloudflare Worker from `fdi-events/` using its current environment variables. `npm run deploy` builds and deploys. Keep `APP_ORIGIN` set to the exact custom origin. There are no new required secret variables and no DNS changes are needed for the existing event subdomain.
7. Sign in as the current owner, enroll or verify TOTP, accept the staff terms, and test a real invitation, upload, RSVP, camera scan, manual attendance confirmation and certificate download on physical phones. This update has not been applied to your live Supabase or Cloudflare services from this session.

## What changed

**Custom permanent IDs.** Manage an attendee and enter a full custom ID such as `FDI-JPS-T-137`, `#FDI-JPS-T-137`, or `FDI-137`. Letters, numbers, hyphens and underscores are allowed, normalized to uppercase. The ID belongs to the person and follows them when you select the existing person for a future event. A blank custom ID retains the automatically allocated event registration ID. Internal UUIDs and global serials remain separate. Previous IDs stay reserved for their owner, so a different person cannot inherit an old credential. Identity changes invalidate that person's existing invitation sessions. Certificate snapshots already issued remain historical; regenerate explicitly when appropriate.

**Staff directory.** Super admins can invite by name, email and reusable ID; choose SUPER_ADMIN, ADMIN, EVENT_MANAGER or CHECK_IN_STAFF; select events; link an existing person explicitly; and later edit identity, role or scope or disable access. Role assignment is stored and enforced by the server. Visiting or forwarding `/admin` never grants privileges. You can edit your own identity while your own role, enabled state and event permissions stay protected from modification. Staff access and an event attendee role are separate.

**Staff event invitations.** During a staff invitation, the default option also creates personal QR invitations for selected events using the chosen attendee role. Existing registrations are reused. Copy the event invitation message and download the badge QR from the result. The Auth email takes the staff member to the workspace; event invitation messages are prepared separately for email/WhatsApp. Event passes remain pending until accepted. Changing staff permissions alone does not automatically revoke their separate event participation; revoke the event invitation when necessary.

**TOTP protection.** All staff APIs require both a verified TOTP factor and `aal2`, including users who previously had no factor. The first-login gate handles enrollment, setup QR/manual key, six-digit verification, stale unverified enrollment cleanup and staff agreement acceptance. Subsequent sign-ins challenge the verified authenticator. Session state updates on MFA verification and token refresh. The browser client uses the implicit email flow because Supabase's `inviteUserByEmail` does not support PKCE and invitations must work across tabs/devices. See https://supabase.com/docs/reference/javascript/auth-admin-inviteuserbyemail and https://supabase.com/docs/guides/auth/auth-mfa/totp .

**Badge designs.** Each attendee has SVG and 1200px PNG QR exports. “Badge import CSV” exports name, ID, role, event and a real private QR URL, with no personal contact or emergency information. Use the QR_URL column in a badge design tool that supports QR generation, or place the SVG/PNG directly. Keep these exports confidential. Pass payloads contain only random secure URLs; scans still verify first and require the staff member to press Confirm Attendance.

**Event presentation.** Upload a cover photo and schedule image from the event editor (PNG/JPEG/WebP, 5MB maximum). Create/save a new event before uploading. The public invitation displays the artwork and highlighted date. Open Google Maps loads a map in a window only after the user chooses it, with a link to external directions. Enter a venue and address for the embedded map; an exact Maps URL remains available through the external link.

**Interactive schedules.** Plain text and an image remain supported. Paste a JSON array into Schedule code, preview it, then save. Visitors can filter tracks and expand session details. Arbitrary HTML/JavaScript is deliberately not executed in an attendee session. Example:

```json
[
  {"time":"09:00","title":"Welcome & registration","details":"Present your QR pass.","track":"Main program"},
  {"time":"10:00","title":"Practical workshop","details":"Follow the trainer's instructions.","track":"Skills"}
]
```

**Privacy and terms.** `/privacy` and `/terms` explain data handling, limited access, public certificate visibility, external providers, participant responsibilities and staff confidentiality. Staff acceptance records version and timestamp in the database and audit log. These texts are an operational starting point and need review by a qualified Jordanian legal/privacy adviser against FDI's actual organization, retention practices, processing locations, lawful basis and event activities before public launch. They are not a guarantee against claims, a blanket liability waiver, or a substitute for consent where required. Jordan's Ministry provides the law, current instructions and consent/rights forms at https://modee.gov.jo/EN/List/The_law_regulations_and_instructions . Do not import data before satisfying the applicable notice and lawful-processing requirements.

## Validation and limitations

The existing and upgrade database/API suites test custom ID changes/reuse/conflicts, invitation access/session invalidation, roles/RLS, mandatory TOTP/assurance checks, staff agreement audit, media/schedule schema, private badge export and all original check-in/certificate workflows. Headless Chromium tests exercise enrollment with a real time-based code calculation against an isolated Supabase protocol substitute, wrong-code rejection, terms gating, SVG/CSV downloads, maps/schedule controls, RSVP, scanner confirmation and responsive widths 375, 390, 430, 768, 1366 and 1440px. This does not verify your live Supabase Auth/email configuration, actual cloud uploads, or physical phone cameras. Those require the live launch checks above.

The update is prepared on `feature/fdi-platform-updates` in `fdijo-cyber/FDI-Website`. Apply the two new database migrations before merging if main automatically deploys to Cloudflare. No live Supabase migration or Cloudflare deployment has been performed from this session.
