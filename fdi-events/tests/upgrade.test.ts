import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  harness,
  testOwner,
  testStaff,
  testEvent,
  ownerToken,
  ownerAal1Token,
} from "./support/harness";
import { handle, hash, randomToken } from "../server/worker";
import { validateAdmin } from "../server/validation";
let h: Awaited<ReturnType<typeof harness>>;
const rpc = async (action: string, payload: any = {}, actor = testOwner) =>
  (
    await h.db.query<any>("select fdi_admin($1::uuid,$2,$3::jsonb) data", [
      actor,
      action,
      JSON.stringify(payload),
    ])
  ).rows[0].data;
const pub = async (action: string, payload: any) =>
  (
    await h.db.query<any>("select fdi_public($1,$2::jsonb) data", [
      action,
      JSON.stringify(payload),
    ])
  ).rows[0].data;
const mint = async () => {
  const token = randomToken(),
    qr_token = randomToken();
  return {
    token,
    qr_token,
    token_hash: await hash(token),
    qr_hash: await hash(qr_token),
  };
};
before(async () => {
  h = await harness();
});
after(async () => {
  h.restore();
  await h.db.close();
});
test("Custom IDs edit, authenticate, survive role changes, and reuse across future events", async () => {
  const base = {
    event_id: testEvent,
    registration_id: h.person.id,
    full_name: "John Smith",
    role_code: "T",
    email: "john@example.com",
  };
  const old = await pub("unlock", {
    token_hash: await hash(h.token),
    name: "John Smith",
    fdi_id: h.person.fdi_id,
    session_hash: await hash("old-session"),
  });
  assert.equal(old.name, "John Smith");
  const edited = await rpc("attendee_edit", { ...base, public_id: "FDI-137" });
  assert.equal(edited.fdi_id, "FDI-137");
  await assert.rejects(
    async () =>
      pub("invitation", {
        token_hash: await hash(h.token),
        session_hash: await hash("old-session"),
      }),
    /UNVERIFIED/,
  );
  await assert.rejects(
    async () =>
      pub("unlock", {
        token_hash: await hash(h.token),
        name: "John Smith",
        fdi_id: h.person.fdi_id,
        session_hash: await hash("new-session"),
      }),
    /UNVERIFIED/,
  );
  const unlocked = await pub("unlock", {
    token_hash: await hash(h.token),
    name: "John Smith",
    fdi_id: "fdi-137",
    session_hash: await hash("new-session"),
  });
  assert.equal(unlocked.fdi_id, "FDI-137");
  assert.equal(unlocked.email, undefined);
  const next = await rpc("event_save", {
    name: "Future event",
    code: "BLS",
    event_date: "2027-01-01",
    rsvp_deadline: "2026-12-01T00:00:00Z",
    checkin_closes_at: "2027-01-01T23:00:00Z",
  });
  const reused = await rpc("attendee_create", {
    event_id: next.id,
    person_id: edited.person_id,
    role_code: "TR",
    ...(await mint()),
  });
  assert.equal(reused.fdi_id, "FDI-137");
  assert.equal(reused.person_id, edited.person_id);
  await assert.rejects(
    async () =>
      rpc("attendee_create", {
        event_id: testEvent,
        full_name: "Another Person",
        public_id: "fdi-137",
        role_code: "P",
        ...(await mint()),
      }),
    /ID_ALREADY_USED/,
  );
  await rpc("attendee_edit", { ...base, public_id: "FDI-138" });
  await assert.rejects(
    async () =>
      rpc("attendee_create", {
        event_id: testEvent,
        full_name: "Yet Another Person",
        public_id: "FDI-137",
        role_code: "P",
        ...(await mint()),
      }),
    /ID_ALREADY_USED/,
  );
  const auto = await rpc("attendee_create", {
    event_id: testEvent,
    full_name: "Automatic Identity",
    public_id: "#FDI-JPS-P-9999",
    role_code: "P",
    ...(await mint()),
  });
  assert.equal(auto.fdi_id, "#FDI-JPS-P-9999");
});
test("Staff ID links, edits, role scope and terms acceptance are audited without public access", async () => {
  await rpc("staff_save", {
    user_id: testStaff,
    email: "scanner@example.com",
    role: "CHECK_IN_STAFF",
    enabled: true,
    events: [testEvent],
    full_name: "FDI Scanner",
    public_id: "STAFF-42",
  });
  const passTokens = await mint();
  const created = await rpc("staff_save", {
    user_id: testStaff,
    email: "scanner@example.com",
    role: "CHECK_IN_STAFF",
    enabled: true,
    events: [testEvent],
    full_name: "FDI Scanner",
    public_id: "STAFF-42",
    event_passes: [{ event_id: testEvent, role_code: "T", ...passTokens }],
  });
  assert.equal(created.event_invitations.length, 1);
  assert.equal(created.event_invitations[0].fdi_id, "STAFF-42");
  assert.equal(created.event_invitations[0].qr_token, passTokens.qr_token);
  assert.equal(
    (
      await rpc("staff_save", {
        user_id: testStaff,
        email: "scanner@example.com",
        role: "CHECK_IN_STAFF",
        enabled: true,
        events: [testEvent],
        full_name: "FDI Scanner",
        public_id: "STAFF-42",
        event_passes: [
          { event_id: testEvent, role_code: "T", ...(await mint()) },
        ],
      })
    ).event_invitations[0].id,
    created.event_invitations[0].id,
  );
  const list = await rpc("staff_list");
  const s = list.find((s: any) => s.user_id === testStaff);
  assert.equal(s.public_id, "STAFF-42");
  assert.equal(s.full_name, "FDI Scanner");
  assert.ok(s.person_id);
  await rpc("staff_save", {
    ...s,
    full_name: "FDI Scanner Updated",
    public_id: "STAFF-43",
  });
  assert.equal(
    (await rpc("staff_list")).find((s: any) => s.user_id === testStaff)
      .public_id,
    "STAFF-43",
  );
  await assert.rejects(
    async () => rpc("staff_save", { ...s, events: [] }),
    /EVENT_ASSIGNMENT_REQUIRED/,
  );
  await assert.rejects(
    async () => rpc("staff_list", {}, testStaff),
    /FORBIDDEN/,
  );
  await assert.rejects(
    async () =>
      h.db.exec(
        "set role anon;select fdi_security('11111111-1111-4111-8111-111111111111');",
      ),
    /permission denied/,
  );
  await h.db.exec("reset role");
});
test("Server allows optional enrollment but enforces activated TOTP and current staff terms", async () => {
  const env = {
    SUPABASE_URL: "https://fdi-test.supabase.co",
    SUPABASE_ANON_KEY: "test",
    SUPABASE_SERVICE_ROLE_KEY: "test",
    RATE_LIMIT_SECRET: "test",
    APP_ORIGIN: "https://fdi.test",
    ASSETS: {} as any,
  };
  const req = (path: string, body?: any, token = ownerToken) =>
    handle(
      new Request("https://fdi.test/api" + path, {
        method: body ? "POST" : "GET",
        headers: {
          Origin: "https://fdi.test",
          Authorization: "Bearer " + token,
          "Content-Type": "application/json",
        },
        body: body ? JSON.stringify(body) : undefined,
      }),
      env,
    );
  h.authState.verified = false;
  assert.equal(
    (await req("/admin", { action: "bootstrap" }, ownerAal1Token)).status,
    200,
  );
  let gate: any = await (await req("/security")).json();
  assert.equal(gate.needs_enrollment, true);
  assert.equal(gate.needs_mfa, false);
  h.authState.needsPassword = true;
  assert.equal(
    (await req("/admin", { action: "bootstrap" }, ownerAal1Token)).status,
    403,
  );
  gate = await (await req("/security", undefined, ownerAal1Token)).json();
  assert.equal(gate.needs_password, true);
  const beforePeople = await h.db.query(
    "select id,serial,public_id from people order by id",
  );
  const beforeStaff = await h.db.query(
    "select user_id,role,enabled from staff order by user_id",
  );
  assert.equal(
    (await req("/security/password", { password: "short" }, ownerAal1Token))
      .status,
    400,
  );
  assert.equal(
    (
      await req(
        "/security/password",
        { password: "A-long-test-password-2026" },
        ownerAal1Token,
      )
    ).status,
    200,
  );
  assert.equal(h.authState.passwordUpdates, 1);
  assert.equal(h.authState.needsPassword, false);
  assert.deepEqual(
    (await h.db.query("select id,serial,public_id from people order by id"))
      .rows,
    beforePeople.rows,
  );
  assert.deepEqual(
    (
      await h.db.query(
        "select user_id,role,enabled from staff order by user_id",
      )
    ).rows,
    beforeStaff.rows,
  );
  assert.equal(
    (await req("/admin", { action: "bootstrap" }, ownerAal1Token)).status,
    200,
  );
  h.authState.verified = true;
  assert.equal(
    (await req("/admin", { action: "bootstrap" }, ownerAal1Token)).status,
    403,
  );
  assert.equal(
    (await req("/security/terms", { version: "2026-10-07" }, ownerAal1Token))
      .status,
    403,
  );
  await h.db.exec(
    `update staff set terms_version=null where user_id='${testOwner}'`,
  );
  assert.equal((await req("/admin", { action: "bootstrap" })).status, 403);
  assert.equal((await req("/security/terms", { version: "old" })).status, 400);
  assert.equal(
    (await req("/security/terms", { version: "2026-10-07" })).status,
    200,
  );
  assert.equal((await req("/admin", { action: "bootstrap" })).status, 200);
  const audit = await h.db.query<any>(
    "select * from audit_logs where action='STAFF_TERMS_ACCEPTED'",
  );
  assert.equal(audit.rows.length, 1);
  assert.equal(audit.rows[0].metadata.version, "2026-10-07");
});
test("Event media and structured schedules save and render through safe projections", async () => {
  const saved = await rpc("event_save", {
    id: testEvent,
    name: "FDI BFA Workshop",
    code: "JPS",
    event_date: "2026-11-07",
    rsvp_deadline: "2026-10-30T23:59:59+03:00",
    checkin_closes_at: "2026-11-07T23:59:59+03:00",
    cover_image_url: "https://example.com/cover.png",
    schedule_image_url: "https://example.com/schedule.png",
    schedule_items: [
      {
        time: "09:00",
        title: "Welcome",
        details: "Registration",
        track: "Main",
      },
    ],
  });
  assert.equal(saved.schedule_items[0].title, "Welcome");
  const event = await pub("event", { event_id: testEvent });
  assert.equal(event.cover_image_url, "https://example.com/cover.png");
  assert.equal(event.email, undefined);
  assert.throws(() =>
    validateAdmin("event_save", {
      ...saved,
      cover_image_url: "javascript:alert(1)",
    }),
  );
  assert.throws(() =>
    validateAdmin("event_save", {
      ...saved,
      schedule_items: [{ time: "9", title: "" }],
    }),
  );
});
test("Badge export provides private QR URLs only to scoped management and records an audit", async () => {
  const badges = await rpc("badge_export", { event_id: testEvent });
  assert.ok(badges.length > 0);
  assert.equal(badges[0].email, undefined);
  assert.equal(badges[0].phone, undefined);
  assert.equal(badges[0].emergency_contact_name, undefined);
  assert.equal(badges[0].qr_token, h.qr);
  await assert.rejects(
    async () => rpc("badge_export", { event_id: testEvent }, testStaff),
    /FORBIDDEN/,
  );
  await rpc("revoke", { event_id: testEvent, registration_id: h.person.id });
  assert.ok(
    !(await rpc("badge_export", { event_id: testEvent })).some(
      (r: any) => r.qr_token === h.qr,
    ),
  );
});

test("Owner can edit own identity while self-demotion remains blocked; old unlinked staff inputs validate", async () => {
  validateAdmin("staff_save", {
    user_id: testStaff,
    email: "scanner@example.com",
    role: "CHECK_IN_STAFF",
    enabled: true,
    events: [testEvent],
    full_name: null,
    public_id: null,
    person_id: null,
  });
  await rpc("staff_save", {
    user_id: testOwner,
    email: "owner@example.com",
    role: "SUPER_ADMIN",
    enabled: true,
    events: [],
    full_name: "FDI Owner",
    public_id: "FDI-OWNER-1",
  });
  const owner = (await rpc("staff_list")).find(
    (r: any) => r.user_id === testOwner,
  );
  assert.equal(owner.public_id, "FDI-OWNER-1");
  await assert.rejects(
    async () => rpc("staff_save", { ...owner, role: "ADMIN" }),
    /CANNOT_CHANGE_OWN_ACCESS/,
  );
});

test("Media upload checks file signatures, size and event permissions before storing artwork", async () => {
  const env = {
    SUPABASE_URL: "https://fdi-test.supabase.co",
    SUPABASE_ANON_KEY: "test",
    SUPABASE_SERVICE_ROLE_KEY: "test",
    RATE_LIMIT_SECRET: "test",
    APP_ORIGIN: "https://fdi.test",
    ASSETS: {} as any,
  };
  const upload = (bytes: Uint8Array, type: string, token = ownerToken) =>
    handle(
      new Request("https://fdi.test/api/media?event=" + testEvent, {
        method: "POST",
        headers: {
          Origin: env.APP_ORIGIN,
          Authorization: "Bearer " + token,
          "Content-Type": type,
        },
        body: bytes,
      }),
      env,
    );
  const png = new Uint8Array(
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a4RsAAAAASUVORK5CYII=",
      "base64",
    ),
  );
  const good = await upload(png, "image/png");
  assert.equal(good.status, 200);
  assert.match(((await good.json()) as any).url, /event-media/);
  assert.equal(h.uploads.length, 1);
  assert.equal(
    (
      await upload(
        new TextEncoder().encode('<svg onload="alert(1)"></svg>'),
        "image/svg+xml",
      )
    ).status,
    409,
  );
  assert.equal((await upload(png, "image/jpeg")).status, 409);
  assert.equal(
    (await upload(new Uint8Array(5242881), "image/png")).status,
    413,
  );
  const { staffToken } = await import("./support/harness");
  assert.equal((await upload(png, "image/png", staffToken)).status, 403);
  assert.equal(h.uploads.length, 1);
});
