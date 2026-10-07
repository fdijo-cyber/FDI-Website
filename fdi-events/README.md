See [UPGRADE.md](UPGRADE.md) for the October 7 updates and the safe upgrade sequence for an existing deployment.

# FDI Event Platform

Functional React/TypeScript application, Cloudflare Worker API, and Supabase PostgreSQL/Auth. Built separately from the existing FDI website; no existing site files or DNS are changed.

## Current state

Implemented: reusable events; permanent person records; globally unique registration IDs; invitation name + ID verification; secure invitation cookies; RSVP and history; real QR passes; authenticated camera scanner and manual confirmation; duplicate-proof attendance; role/event scoped staff; MFA enrollment; admin management; CSV preview/import/export; printable clipboard/PDF; invitation revocation/reset; immutable audit logs; email/WhatsApp preparation and delivery logs; certificate records, eligibility, template upload, PDF overlay, public verification, revocation and regeneration.

The initial event is **FDI BFA Workshop, 7 November 2026**, code **JPS**, RSVP deadline **30 October 2026 at 23:59:59 Asia/Amman**. Venue, times, directions, dress code, and schedule are editable empty fields. No attendee or staff accounts are seeded in production.

This source is deployment-prepared and locally tested. **It is not a live production service until Supabase and Cloudflare are connected.** Tests use an isolated PostgreSQL runtime and synthetic Supabase Auth protocol responses. Live Auth/email delivery, Supabase Storage policies, Cloudflare deployment, and physical iPhone/Android camera behavior must be verified after configuration.

## Architecture

- Vite React static assets hosted by a Cloudflare Worker; one origin for UI/API.
- Worker uses a **server-only** Supabase service-role key. Every staff API request verifies the actual Supabase Auth token and reads enabled staff/event permissions in PostgreSQL.
- RLS is enabled on every platform table. `anon` and `authenticated` have no direct table access or function execution. Service-only RPCs perform transactional authorization and mutations. There is no client-side database CRUD.
- Database sequences allocate IDs safely under concurrency. A person has `FDI-PERSON-137`; each event registration has `#FDI-JPS-P-137` using a separate global registration sequence. Registration serials never reset. Gaps after rolled-back imports are normal. Changing an event code affects future IDs; issued IDs remain stable unless role/event is explicitly changed.
- 256-bit invitation/QR/verification tokens; SHA-256 lookups. Invitation cookies are HttpOnly, Secure in production, SameSite=Strict, expire in two hours, and are scoped to invitation API routes. Name matching ignores case/repeated whitespace; ID matching ignores case. Mismatches return one generic error.
- Rate limits are atomic PostgreSQL counters, not unreliable process memory. Raw IP addresses are not stored. `RATE_LIMIT_SECRET` salts rate-limit identifiers. Limits: unlock 30/IP and 20/token per 15 minutes; staff API 300/minute; public certificate verification 60/minute.
- API mutations require the configured same origin. Authenticated operations require a bearer token; all staff require a verified TOTP factor, an `aal2` session, and acceptance of the current staff terms. All output is escaped by React, URLs are validated, and CSP/referrer/cache headers protect private pages.
- Check-in locks the registration and revalidates invitation state before writing. One `check_ins` row per registration. Scanning has no write side effect. Undo is audited and revokes any issued certificate.
- Scanner staff never receive personal email, phone, or emergency contact fields. Admin list responses omit emergency contacts; elevated exports fetch them separately and are audited. Soft-removal preserves history and revokes invitation/certificate access.

## Run locally

Node 22+ (tested with Node 24).

```sh
cd fdi-events
npm ci
cp .env.example .dev.vars
# Fill .dev.vars with your own local/staging Supabase project settings.
npm run dev:api
# In a second terminal:
npm run dev
```

Open http://localhost:5173. In local development the Worker allows that origin. For 127.0.0.1 development, set APP_ORIGIN=http://127.0.0.1:5173. Missing configuration returns a clear unavailable state and never substitutes fake production data.

## Supabase setup

Use a dedicated free Supabase project for FDI events. Do not apply these migrations to an unrelated existing database.

1. Install the Supabase CLI, authenticate, and link the project:
   `supabase login`, then `supabase link --project-ref YOUR_PROJECT_REF`.
2. Run `supabase db push` to apply all four migrations (`001` through `004`).
3. Apply `supabase/seed.sql` once in the SQL editor (or `supabase db reset` for local-only development). Production `db push` does not automatically apply seed data.
4. In Auth settings disable public sign-up. Set Site URL and redirect allowlist to the final origin and `/auth/callback`.
5. Create the owner through Supabase Auth's administrative user creation flow. In the SQL editor run:

```sql
insert into public.staff(user_id,email,role)
select id,email,'SUPER_ADMIN' from auth.users
where email='YOUR_OWNER_EMAIL';
```

6. Sign in as the owner and invite staff from **Staff access**. Staff must be assigned appropriate events.
7. Configure an SMTP provider before using magic links/invitations for external staff. Supabase's built-in test mailer is not a general production mail service. A provider's free tier can be used; no SMTP credentials belong in this application or GitHub.
8. Complete mandatory TOTP enrollment/verification and accept staff terms at first sign-in. The Worker blocks data access until both are complete.

`certificate-templates` is a public Storage bucket for approved **blank** templates only. No client upload policies are created. Scoped Worker uploads use the server key. Personalized certificates are generated on demand in the browser and not stored publicly.

## Required environment variables

| Variable                  | Where                                   | Purpose                                        |
| ------------------------- | --------------------------------------- | ---------------------------------------------- |
| SUPABASE_URL              | Worker secret/runtime                   | Supabase project URL                           |
| SUPABASE_ANON_KEY         | Worker runtime; returned to Auth client | Public Auth key, never a service key           |
| SUPABASE_SERVICE_ROLE_KEY | Worker secret only                      | Authorized database and Storage operations     |
| APP_ORIGIN                | Worker runtime                          | Exact HTTPS origin, no trailing slash          |
| RATE_LIMIT_SECRET         | Worker secret only                      | Random 32+ byte secret for hashed limiter keys |

Use `openssl rand -hex 32` for RATE_LIMIT_SECRET. `.env.example` contains placeholders only. `.dev.vars` and `.env*` are ignored. No real secrets are committed. Worker request-body logging is disabled in the supplied configuration.

## Deploy without breaking the public website

Recommended first deployment: **events.futuredoctorinitiative.org** using a Cloudflare Worker with static assets. This follows the requested Cloudflare infrastructure and avoids replacing the current Pages project. Cloudflare Workers is used instead of Pages Functions because UI/API deployment and origin security are straightforward in one project.

1. `npm ci && npm run build && npm test`.
2. Authenticate with `npx wrangler login` using the Cloudflare account that controls the domain.
3. Configure the variables using `npx wrangler secret put VARIABLE_NAME` for each secret/key and URL. `APP_ORIGIN` is in `wrangler.jsonc`; edit it for staging/final origin.
4. Deploy a staging Worker with `npm run deploy`. If using a workers.dev origin first, set APP_ORIGIN and Supabase redirect URLs to that exact origin and redeploy.
5. Verify the live checklist below with test records, then request owner confirmation of the integration strategy before attaching the custom domain. Add the approved custom domain in Cloudflare. Do not replace the existing Pages domain/root routes.
6. For custom-domain deployment via Wrangler, add `routes: [{pattern: "events.futuredoctorinitiative.org", custom_domain: true}]` to the config only after the owner approves that DNS change.

An alternative future integration can route `/invite/*`, `/verify/*`, `/check/*`, `/scan`, `/admin`, `/events/*`, `/auth/*`, `/api/*`, and the platform's assets through a Worker. This requires reviewing existing Pages routes/assets first; the subdomain avoids that complexity.

No automatic deploy workflow is included, so committing the project cannot silently replace the existing site. The CI workflow runs validation only.

## Certificate workflow

1. Upload FDI's approved one-page PDF under Events → Edit event → Certificates.
2. Configure overlay field positions; preview the template locally/with a test certificate. X/Y are fractions of the page and Y starts at the bottom. Text centers on X. Text/QR sizes are PDF points.
3. Save the event, select checked-in attendees, and issue certificate records. Global admins can override eligibility with a recorded reason.
4. Download the certificate from attendee management or the holder's invitation. The browser overlays name, program, date, FDI ID, issue date, certificate ID, and a genuine verification QR on the provided template, using certificate data validated by the backend.
5. Regenerate explicitly if the template or recipient details change. This rotates the verification token and invalidates the previous link. Revocation immediately fails verification/download.

**No final certificate artwork is invented.** Without an official template, metadata and verification work, while PDF download is unavailable. Templates/positions are snapshotted on issuance. The included licensed DejaVu subset supports Latin and Arabic names. Review bilingual shaping/layout on FDI's final template before distributing official PDFs.

## Sending invitations

Copy link/message, open email (`mailto:`), or prepare WhatsApp (`wa.me`). No paid messaging API, Gmail password, or automatic attendee email delivery is required. Preparing a message logs PREPARED; mark SENT only after actually sending it. Delivery tracking does not pretend to prove delivery or reading.

## Testing and QA

```sh
npm test                        # database/API/security/QR/PDF and upgrade tests
npm run build                   # strict TypeScript and production build
npx wrangler deploy --dry-run    # verify Worker packaging without deploying
npx playwright install chromium
npm run test:e2e                 # run after build; isolated test API + browser; synthetic records only
```

The browser harness is never imported by production and opens isolated local servers for that command only. It verifies unlock failures/success, RSVP toggles, privacy, CSV preview/import/export, printable list, attendee creation/search, staff scanner/manual/duplicate confirmation, certificates and reusable event creation. It checks invitation/admin widths at 375, 390, 430, 768, 1366, and 1440 pixels, including no document overflow and a 150px seal. Screenshots/results are written under `qa/`.

Live launch checks still required: external staff email invitation/magic-link delivery; MFA challenge/enrollment; real Supabase grants and Storage upload; iPhone Safari and Android Chrome camera permissions/focus; Cloudflare headers/domain; approved certificate layout; revoke a live test pass and ensure staff immediately sees revoked; remove test registrations.

## Operating limits

The first version handles event rosters in one event-scoped response with filtering/sorting in the client; event/person/QR lookups are indexed. This is sensible for 70 to low thousands of attendees. For very large rosters, add database pagination/search rather than adding enterprise infrastructure.

PDF rendering runs in the browser, avoiding Cloudflare’s tight free-tier CPU limit. Certificate issuance/revocation and verification remain backend-controlled. No paid upgrade is assumed or enabled.

Check-in requires a network connection; offline attendance synchronization is not implemented. Browser printing provides actual PDF output; no paid PDF service is used. The database intentionally retains audit history; plan retention/export/backups before holding sensitive records long-term. Export only what FDI needs and restrict files to authorized personnel.

Brand assets and palette were taken from the supplied FDI guide: primary navy #041F54, blue #0D3C92, teal #0B7C75, soft blue #EEF0FE, lines #DAE3F7, error #B30000. The seal is not altered and remains 150px with conservative clear space.

## Verified provider guidance

- Supabase Auth SMTP requirements: https://supabase.com/docs/guides/auth/auth-smtp
- Supabase database security: https://supabase.com/docs/guides/database/secure-data
- Cloudflare Worker limits: https://developers.cloudflare.com/workers/platform/limits/
