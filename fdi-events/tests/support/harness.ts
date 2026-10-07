// Isolated PostgreSQL/Supabase protocol substitute for tests. NEVER imported by production.
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { hash, randomToken } from "../../server/worker";
export const testOwner = "11111111-1111-4111-8111-111111111111",
  testStaff = "22222222-2222-4222-8222-222222222222",
  testEvent = "a11fd100-0000-4000-8000-000000000001";
const jwt = (id: string) =>
  Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString(
    "base64url",
  ) +
  "." +
  Buffer.from(
    JSON.stringify({
      sub: id,
      role: "authenticated",
      aal: "aal2",
      exp: Math.floor(Date.now() / 1000) + 3600,
    }),
  ).toString("base64url") +
  ".test-only-signature";
export const ownerToken = jwt(testOwner),
  staffToken = jwt(testStaff);
export const ownerAal1Token =
  ownerToken.split(".")[0] +
  "." +
  Buffer.from(
    JSON.stringify({
      ...JSON.parse(
        Buffer.from(ownerToken.split(".")[1], "base64url").toString(),
      ),
      aal: "aal1",
    }),
  ).toString("base64url") +
  ".test-only-signature";
export async function harness() {
  const authState = { verified: true };
  const uploads: { path: string; type: string | null; size: number }[] = [];
  const db = new PGlite();
  await db.exec(
    `create schema auth;create table auth.users(id uuid primary key,email text,last_sign_in_at timestamptz);create role anon;create role authenticated;create role service_role bypassrls;insert into auth.users(id,email) values('${testOwner}','owner@example.com'),('${testStaff}','scanner@example.com');`,
  );
  await db.exec(readFileSync("supabase/migrations/001_platform.sql", "utf8"));
  await db.exec(
    readFileSync(
      "supabase/migrations/003_identity_security_event_media.sql",
      "utf8",
    ),
  );
  await db.exec(readFileSync("supabase/seed.sql", "utf8"));
  await db.exec(
    `insert into staff(user_id,email,role) values('${testOwner}','owner@example.com','SUPER_ADMIN'),('${testStaff}','scanner@example.com','CHECK_IN_STAFF');insert into staff_events values('${testStaff}','${testEvent}');`,
  );
  await db.exec(
    "update staff set terms_version='2026-10-07',terms_accepted_at=now()",
  );
  await db.exec(
    "update events set certificate_template_url='https://fdi-test.supabase.co/storage/v1/object/public/certificate-templates/test.pdf'",
  );
  const token = "a".repeat(64),
    qr = "b".repeat(64);
  const r = await db.query<{ data: any }>(
    "select fdi_admin($1::uuid,$2,$3::jsonb) data",
    [
      testOwner,
      "attendee_create",
      JSON.stringify({
        event_id: testEvent,
        full_name: "John Smith",
        role_code: "P",
        email: "john@example.com",
        phone: "+962790000000",
        emergency_contact_name: "Private Person",
        emergency_contact_phone: "+962791111111",
        token,
        token_hash: await hash(token),
        qr_token: qr,
        qr_hash: await hash(qr),
      }),
    ],
  );
  const person = r.rows[0].data;
  const actualFetch = globalThis.fetch;
  globalThis.fetch = async (input: any, init?: any) => {
    const request = new Request(input, init);
    const u = new URL(request.url);
    if (u.origin !== "https://fdi-test.supabase.co")
      return actualFetch(input, init);
    let data: any;
    const userId =
      request.headers.get("Authorization") === "Bearer " + staffToken
        ? testStaff
        : testOwner;
    if (
      u.pathname === "/auth/v1/user" &&
      ![ownerToken, staffToken, ownerAal1Token].includes(
        request.headers.get("Authorization")?.replace("Bearer ", "") ?? "",
      )
    )
      return new Response(JSON.stringify({ message: "Invalid JWT" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    if (u.pathname === "/auth/v1/user")
      data = {
        id: userId,
        email:
          userId === testStaff ? "scanner@example.com" : "owner@example.com",
        factors: authState.verified
          ? [
              {
                id: "44444444-4444-4444-8444-444444444444",
                factor_type: "totp",
                status: "verified",
              },
            ]
          : [],
        app_metadata: { provider: "email" },
        user_metadata: {},
        aud: "authenticated",
        created_at: new Date().toISOString(),
      };
    else if (u.pathname.startsWith("/rest/v1/rpc/")) {
      const fn = u.pathname.split("/").pop()!;
      const args = (await request.json()) as any;
      const names = Object.keys(args);
      try {
        const result = await db.query(
          `select ${fn}(${names.map((n, i) => n + " => $" + (i + 1)).join(",")}) data`,
          names.map((n) =>
            typeof args[n] === "object" ? JSON.stringify(args[n]) : args[n],
          ),
        );
        data = (result.rows[0] as any).data;
      } catch (e) {
        return new Response(
          JSON.stringify({
            message: (e as Error).message,
            code: "TEST_DB_ERROR",
          }),
          { status: 400, headers: { "Content-Type": "application/json" } },
        );
      }
    } else if (
      u.pathname.startsWith("/storage/v1/object/event-media/") &&
      request.method === "POST"
    ) {
      uploads.push({
        path: u.pathname,
        type: request.headers.get("Content-Type"),
        size: (await request.arrayBuffer()).byteLength,
      });
      data = { Key: u.pathname.split("/object/")[1] };
    } else throw new Error("Unsupported harness request: " + u.pathname);
    return new Response(JSON.stringify(data), {
      headers: { "Content-Type": "application/json" },
    });
  };
  return {
    db,
    authState,
    uploads,
    person,
    token,
    qr,
    restore() {
      globalThis.fetch = actualFetch;
    },
  };
}
