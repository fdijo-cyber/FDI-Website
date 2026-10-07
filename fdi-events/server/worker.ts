import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { adminSchema, validateAdmin, identifierSchema } from "./validation";
export interface Env {
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  APP_ORIGIN: string;
  RATE_LIMIT_SECRET: string;
  ASSETS: Fetcher;
}
export const randomToken = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
export const hash = async (s: string) =>
  Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)),
    ),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
const tokenSchema = z.string().regex(/^[a-f0-9]{64}$/);
const securityHeaders = {
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Permissions-Policy": "camera=(self), microphone=(), geolocation=()",
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; connect-src 'self' https://*.supabase.co wss://*.supabase.co; frame-src https://www.google.com; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
};
export async function handle(request: Request, env: Env): Promise<Response> {
  const u = new URL(request.url);
  let extra: Record<string, string> = {};
  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), {
      status,
      headers: {
        ...securityHeaders,
        ...extra,
        "Content-Type": "application/json",
      },
    });
  try {
    if (!u.pathname.startsWith("/api/")) {
      const response = await env.ASSETS.fetch(request);
      const h = new Headers(response.headers);
      Object.entries(securityHeaders).forEach(([k, v]) => h.set(k, v));
      h.set(
        "Cache-Control",
        u.pathname.startsWith("/assets/")
          ? "public,max-age=31536000,immutable"
          : "no-store",
      );
      return new Response(response.body, {
        status: response.status,
        headers: h,
      });
    }
    if (
      !env.SUPABASE_URL ||
      !env.SUPABASE_SERVICE_ROLE_KEY ||
      !env.SUPABASE_ANON_KEY ||
      !env.RATE_LIMIT_SECRET
    )
      return json(
        { error: "The platform is awaiting secure database configuration." },
        503,
      );
    if (
      request.method === "POST" &&
      request.headers.get("Origin") !== env.APP_ORIGIN &&
      !(
        u.hostname === "localhost" &&
        request.headers.get("Origin") === "http://localhost:5173"
      )
    )
      return json({ error: "Request origin is not allowed." }, 403);
    if (!["GET", "POST"].includes(request.method))
      return json({ error: "Method not allowed" }, 405);
    const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const rpc = async (name: string, args: Record<string, unknown>) => {
      const { data, error } = await db.rpc(name, args);
      if (error) throw new Error(error.message);
      return data;
    };
    const rate = async (key: string, max: number, seconds: number) => {
      if (
        !(await rpc("fdi_rate_limit", {
          k: await hash(env.RATE_LIMIT_SECRET + ":" + key),
          max_attempts: max,
          seconds,
        }))
      )
        throw new Error("RATE_LIMIT");
    };
    const ip = request.headers.get("CF-Connecting-IP") ?? "local";
    const body = async () => {
      const raw = await request.text();
      if (raw.length > 500_000) throw new Error("PAYLOAD_TOO_LARGE");
      return JSON.parse(raw);
    };
    const pub = (action: string, payload: Record<string, unknown>) =>
      rpc("fdi_public", { action, payload });
    if (u.pathname === "/api/config" && request.method === "GET")
      return json({
        supabaseUrl: env.SUPABASE_URL,
        supabaseAnonKey: env.SUPABASE_ANON_KEY,
      });
    if (
      u.pathname === "/api/certificate/download" &&
      request.method === "GET"
    ) {
      const token = tokenSchema.parse(u.searchParams.get("token"));
      return new Response(null, {
        status: 303,
        headers: { ...securityHeaders, Location: "/certificate/" + token },
      });
    }
    if (u.pathname === "/api/certificate/content" && request.method === "GET") {
      await rate("cert-download:" + ip, 20, 60);
      const c = await pub("certificate_download", {
        token_hash: await hash(tokenSchema.parse(u.searchParams.get("token"))),
      });
      if (!c.template_url)
        return json(
          {
            error:
              "The official certificate template has not been configured. Contact FDI.",
          },
          409,
        );
      const target = new URL(c.template_url);
      if (
        target.origin !== new URL(env.SUPABASE_URL).origin ||
        !target.pathname.startsWith(
          "/storage/v1/object/public/certificate-templates/",
        )
      )
        throw new Error("INVALID_TEMPLATE");
      return json(c);
    }
    if (u.pathname === "/api/certificate" && request.method === "GET") {
      await rate("cert:" + ip, 60, 60);
      return json(
        await pub("verify_certificate", {
          token_hash: await hash(
            tokenSchema.parse(u.searchParams.get("token")),
          ),
        }),
      );
    }
    if (u.pathname === "/api/event" && request.method === "GET") {
      await rate("event:" + ip, 60, 60);
      return json(
        await pub("event", {
          event_id: z.uuid().parse(u.searchParams.get("id")),
        }),
      );
    }
    if (u.pathname.startsWith("/api/invitation")) {
      const tok = tokenSchema.parse(u.searchParams.get("token"));
      const token_hash = await hash(tok);
      if (u.pathname === "/api/invitation/meta" && request.method === "GET") {
        await rate("meta:" + ip, 60, 60);
        return json(await pub("metadata", { token_hash }));
      }
      const session =
        request.headers
          .get("Cookie")
          ?.match(/(?:^|;\s*)fdi_invite=([a-f0-9]{64})(?:;|$)/)?.[1] ?? "";
      if (
        u.pathname === "/api/invitation/unlock" &&
        request.method === "POST"
      ) {
        await rate("unlock-ip:" + ip, 30, 900);
        await rate("unlock-token:" + token_hash, 20, 900);
        const b = z
          .object({
            name: z.string().trim().min(2).max(160),
            fdi_id: z.string().trim().min(2).max(80),
          })
          .parse(await body());
        const newSession = randomToken();
        const data = await pub("unlock", {
          ...b,
          token_hash,
          session_hash: await hash(newSession),
        });
        extra["Set-Cookie"] =
          `fdi_invite=${newSession}; HttpOnly; ${u.protocol === "https:" ? "Secure; " : ""}SameSite=Strict; Path=/api/invitation; Max-Age=7200`;
        return json(data);
      }
      if (!session) throw new Error("UNVERIFIED");
      if (u.pathname === "/api/invitation" && request.method === "GET")
        return json(
          await pub("invitation", {
            token_hash,
            session_hash: await hash(session),
          }),
        );
      if (u.pathname === "/api/invitation/rsvp" && request.method === "POST") {
        await rate("rsvp:" + token_hash, 20, 60);
        const b = z
          .object({ response: z.enum(["ACCEPTED", "DECLINED"]) })
          .parse(await body());
        return json(
          await pub("rsvp", {
            ...b,
            token_hash,
            session_hash: await hash(session),
          }),
        );
      }
      return json({ error: "Not found" }, 404);
    }
    const bearer = request.headers
      .get("Authorization")
      ?.match(/^Bearer (.+)$/)?.[1];
    if (!bearer)
      return json({ error: "Sign in with an authorized FDI account." }, 401);
    const { data: user, error: authError } = await db.auth.getUser(bearer);
    if (authError || !user.user)
      return json(
        { error: "Your session has expired. Please sign in again." },
        401,
      );
    const actor = user.user.id;
    await rate("staff:" + actor, 300, 60);
    // getUser validates the bearer before its assurance claim is used.
    const claims = JSON.parse(
      atob(bearer.split(".")[1].replaceAll("-", "+").replaceAll("_", "/")),
    );
    const verifiedFactor =
      user.user.factors?.some(
        (f) => f.factor_type === "totp" && f.status === "verified",
      ) ?? false;
    const security = await rpc("fdi_security", {
      actor,
      action: "status",
      version: null,
    });
    const needsMfa = !verifiedFactor || claims.aal !== "aal2";
    const needsTerms =
      security.terms_version !== security.required_terms_version;
    if (u.pathname === "/api/security" && request.method === "GET")
      return json({
        ...security,
        needs_mfa: needsMfa,
        needs_enrollment: !verifiedFactor,
        needs_terms: needsTerms,
      });
    if (needsMfa)
      return json(
        {
          error:
            "Set up and verify your authenticator to access the staff workspace.",
          code: "MFA_REQUIRED",
        },
        403,
      );
    if (u.pathname === "/api/security/terms" && request.method === "POST") {
      const b = z
        .object({ version: z.literal("2026-10-07") })
        .parse(await body());
      return json(
        await rpc("fdi_security", {
          actor,
          action: "accept_terms",
          version: b.version,
        }),
      );
    }
    if (needsTerms)
      return json(
        {
          error:
            "Accept the current privacy and staff terms before accessing FDI records.",
          code: "TERMS_REQUIRED",
        },
        403,
      );
    const bootstrap = await rpc("fdi_admin", {
      actor,
      action: "bootstrap",
      payload: {},
    });
    if (u.pathname === "/api/media" && request.method === "POST") {
      const eid = z.uuid().parse(u.searchParams.get("event"));
      if (
        bootstrap.staff.role === "CHECK_IN_STAFF" ||
        !bootstrap.events.some((e: any) => e.id === eid)
      )
        throw new Error("FORBIDDEN");
      const length = Number(request.headers.get("Content-Length") || 0);
      if (length > 5242880) throw new Error("PAYLOAD_TOO_LARGE");
      const bytes = new Uint8Array(await request.arrayBuffer());
      if (bytes.length > 5242880 || bytes.length < 12)
        throw new Error("PAYLOAD_TOO_LARGE");
      const mime =
        bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
          ? "image/jpeg"
          : bytes
                .slice(0, 8)
                .every((v, i) => v === [137, 80, 78, 71, 13, 10, 26, 10][i])
            ? "image/png"
            : new TextDecoder().decode(bytes.slice(0, 4)) === "RIFF" &&
                new TextDecoder().decode(bytes.slice(8, 12)) === "WEBP"
              ? "image/webp"
              : "";
      if (!mime || request.headers.get("Content-Type")?.split(";")[0] !== mime)
        throw new Error("INVALID_IMAGE");
      const path = eid + "/" + randomToken() + "." + mime.split("/")[1];
      const { error } = await db.storage
        .from("event-media")
        .upload(path, bytes, { contentType: mime, upsert: false });
      if (error) throw new Error("UPLOAD_FAILED");
      return json({
        url: db.storage.from("event-media").getPublicUrl(path).data.publicUrl,
      });
    }
    if (u.pathname === "/api/template" && request.method === "POST") {
      const eid = z.uuid().parse(u.searchParams.get("event"));
      if (
        bootstrap.staff.role === "CHECK_IN_STAFF" ||
        !bootstrap.events.some((e: any) => e.id === eid)
      )
        throw new Error("FORBIDDEN");
      const bytes = await request.arrayBuffer();
      if (bytes.byteLength > 5242880 || bytes.byteLength < 8)
        throw new Error("PAYLOAD_TOO_LARGE");
      if (new TextDecoder().decode(bytes.slice(0, 5)) !== "%PDF-")
        throw new Error("INVALID_TEMPLATE");
      const path = eid + "/" + randomToken() + ".pdf";
      const { error } = await db.storage
        .from("certificate-templates")
        .upload(path, bytes, { contentType: "application/pdf", upsert: false });
      if (error) throw new Error("UPLOAD_FAILED");
      const { data } = db.storage
        .from("certificate-templates")
        .getPublicUrl(path);
      return json({ url: data.publicUrl });
    }
    if (u.pathname === "/api/scan" && request.method === "POST") {
      const b = z
        .object({
          event_id: z.uuid(),
          token: tokenSchema,
          confirm: z.boolean().default(false),
          device: z.string().max(200).default(""),
        })
        .parse(await body());
      return json(
        await rpc("fdi_scan", {
          actor,
          eid: b.event_id,
          qr_hash_input: await hash(b.token),
          confirm: b.confirm,
          device_input: b.device,
        }),
      );
    }
    if (u.pathname === "/api/staff/invite" && request.method === "POST") {
      if (bootstrap.staff.role !== "SUPER_ADMIN") throw new Error("FORBIDDEN");
      await rate("staff-invite:" + actor, 10, 3600);
      const b = z
        .object({
          attendee_role_code: z
            .enum(["P", "T", "V", "TR", "S", "G"])
            .default("T"),
          create_event_passes: z.boolean().default(true),
          full_name: z.string().trim().min(2).max(160),
          public_id: identifierSchema.refine(
            (v) => v.length >= 2,
            "Enter the staff ID",
          ),
          person_id: z.uuid().optional(),
          email: z.email(),
          role: z.enum([
            "SUPER_ADMIN",
            "ADMIN",
            "EVENT_MANAGER",
            "CHECK_IN_STAFF",
          ]),
          events: z.array(z.uuid()).max(100),
        })
        .parse(await body());
      if (
        b.events.some(
          (id) => !bootstrap.events.some((e: any) => e.id === id),
        ) ||
        (["EVENT_MANAGER", "CHECK_IN_STAFF"].includes(b.role) &&
          !b.events.length)
      )
        return json(
          { error: "Choose valid assigned events for this staff role." },
          400,
        );
      await rpc("fdi_staff_preflight", { actor, payload: b });
      const existingId = await rpc("fdi_auth_lookup", {
        actor,
        email_input: b.email,
      });
      let userId = existingId;
      if (!userId) {
        const invited = await db.auth.admin.inviteUserByEmail(b.email, {
          redirectTo: env.APP_ORIGIN + "/auth/callback",
        });
        if (invited.error || !invited.data.user)
          throw new Error("STAFF_INVITE_FAILED");
        userId = invited.data.user.id;
      }
      const event_passes = b.create_event_passes
        ? await Promise.all(
            b.events.map(async (event_id) => {
              const token = randomToken(),
                qr_token = randomToken();
              return {
                event_id,
                role_code: b.attendee_role_code,
                token,
                qr_token,
                token_hash: await hash(token),
                qr_hash: await hash(qr_token),
              };
            }),
          )
        : [];
      const saved = await rpc("fdi_admin", {
        actor,
        action: "staff_save",
        payload: { user_id: userId, ...b, enabled: true, event_passes },
      });
      if (existingId) {
        const sent = await db.auth.signInWithOtp({
          email: b.email,
          options: {
            shouldCreateUser: false,
            emailRedirectTo: env.APP_ORIGIN + "/auth/callback",
          },
        });
        if (sent.error)
          return json({
            ok: true,
            event_invitations: saved.event_invitations,
            message:
              "Access saved, but the email could not be delivered. Ask the staff member to request a sign-in link from /admin.",
          });
      }
      return json({ ok: true, event_invitations: saved.event_invitations });
    }
    if (u.pathname === "/api/admin" && request.method === "POST") {
      const b = adminSchema.parse(await body());
      let p = validateAdmin(b.action, b.payload);
      const tokens = async () => {
        const token = randomToken(),
          qr_token = randomToken();
        return {
          token,
          token_hash: await hash(token),
          qr_token,
          qr_hash: await hash(qr_token),
        };
      };
      if (b.action === "event_save" && p.certificate_template_url) {
        const t = new URL(String(p.certificate_template_url));
        if (
          t.origin !== new URL(env.SUPABASE_URL).origin ||
          !t.pathname.startsWith(
            "/storage/v1/object/public/certificate-templates/",
          )
        )
          return json(
            {
              error:
                "Upload the official PDF using the certificate template upload control.",
            },
            400,
          );
      }
      if (["attendee_create", "reset", "attendee_move"].includes(b.action))
        p = { ...p, ...(await tokens()) };
      if (b.action === "import") {
        const rows = p.rows as Record<string, unknown>[];
        p = {
          ...p,
          rows: await Promise.all(
            rows.map(async (row) => ({ ...row, ...(await tokens()) })),
          ),
        };
      }
      if (["issue_certificate", "regenerate_certificate"].includes(b.action)) {
        const verification_token = randomToken();
        p = {
          ...p,
          verification_token,
          verification_hash: await hash(verification_token),
        };
      }
      return json(
        await rpc("fdi_admin", { actor, action: b.action, payload: p }),
      );
    }
    return json({ error: "Not found" }, 404);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg.includes("RATE_LIMIT"))
      return json(
        { error: "Too many attempts. Please wait and try again." },
        429,
      );
    if (msg.includes("UNVERIFIED"))
      return json(
        { error: "We couldn’t verify these invitation details." },
        401,
      );
    if (msg.includes("FORBIDDEN"))
      return json(
        {
          error:
            "Your account does not have permission for this action or event.",
        },
        403,
      );
    if (e instanceof z.ZodError)
      return json(
        {
          error: "Please check your entries.",
          issues: e.issues.map((i) => ({
            field: i.path.join("."),
            message: i.message,
          })),
        },
        400,
      );
    const known = [
      "ID_ALREADY_USED",
      "EVENT_ASSIGNMENT_REQUIRED",
      "INVALID_CUSTOM_ID",
      "INVALID_IMAGE",
      "RSVP_CLOSED",
      "INVITATION_INACTIVE",
      "LIKELY_DUPLICATE",
      "NOT_ELIGIBLE",
      "CERTIFICATES_DISABLED",
      "CANNOT_CHANGE_OWN_ACCESS",
      "PERSON_SHARED_REQUIRES_ADMIN",
      "CANNOT_MOVE_AFTER_ATTENDANCE",
    ];
    const messages: Record<string, string> = {
      ID_ALREADY_USED:
        "This ID is already reserved for another person. Choose a unique ID or select the existing person.",
      EVENT_ASSIGNMENT_REQUIRED:
        "Assign at least one event for this staff role.",
      INVALID_CUSTOM_ID:
        "Use a valid ID with letters, numbers, hyphens or underscores.",
      INVALID_IMAGE: "Upload a PNG, JPEG or WebP image.",
      RSVP_CLOSED: "The RSVP deadline has passed. Contact FDI for assistance.",
      INVITATION_INACTIVE: "This invitation is inactive.",
      LIKELY_DUPLICATE:
        "A person with matching details already exists. Search existing people or explicitly allow a separate record.",
      NOT_ELIGIBLE: "Attendance is required for certificate eligibility.",
      CERTIFICATES_DISABLED: "Certificates are disabled for this event.",
      CANNOT_CHANGE_OWN_ACCESS: "You cannot change your own access.",
      PERSON_SHARED_REQUIRES_ADMIN:
        "A global administrator must edit this person because they attend other events.",
      CANNOT_MOVE_AFTER_ATTENDANCE:
        "A checked-in or certified registration cannot be moved.",
    };
    const code = known.find((c) => msg.includes(c));
    if (code) return json({ error: messages[code] }, 409);
    if (msg.includes("unique constraint"))
      return json(
        { error: "This record already exists. No duplicate was created." },
        409,
      );
    if (msg === "PAYLOAD_TOO_LARGE")
      return json(
        { error: "Upload is too large. Import at most 500 rows." },
        413,
      );
    return json(
      {
        error:
          "The request could not be completed. Check your details and try again.",
      },
      400,
    );
  }
}
export default { fetch: handle };
