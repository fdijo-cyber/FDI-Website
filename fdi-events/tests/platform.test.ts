import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { hash, randomToken, handle } from "../server/worker";
import { csvSafe, personSchema, validateAdmin } from "../server/validation";
let db: PGlite;
const owner = "11111111-1111-4111-8111-111111111111",
  staff = "22222222-2222-4222-8222-222222222222",
  manager = "33333333-3333-4333-8333-333333333333",
  eid = "a11fd100-0000-4000-8000-000000000001";
let a: any;
let tokens: any;
const query = async (sql: string, args: any[] = []) => {
  const r = await db.query(sql, args);
  return r.rows as any[];
};
const rpc = async (action: string, payload: any = {}, actor = owner) =>
  (
    await query("select fdi_admin($1::uuid,$2,$3::jsonb) as data", [
      actor,
      action,
      JSON.stringify(payload),
    ])
  )[0].data;
const pub = async (action: string, payload: any) =>
  (
    await query("select fdi_public($1,$2::jsonb) as data", [
      action,
      JSON.stringify(payload),
    ])
  )[0].data;
const scan = async (
  confirm = false,
  qr = tokens.qr_hash,
  event = eid,
  actor = staff,
) =>
  (
    await query("select fdi_scan($1::uuid,$2::uuid,$3,$4,$5) as data", [
      actor,
      event,
      qr,
      confirm,
      "Test device",
    ])
  )[0].data;
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
  db = new PGlite();
  await db.exec(
    `create schema auth;create table auth.users(id uuid primary key,email text,last_sign_in_at timestamptz);create role anon;create role authenticated;create role service_role bypassrls;insert into auth.users(id,email) values('${owner}','owner@example.com'),('${staff}','staff@example.com'),('${manager}','manager@example.com');`,
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
    `insert into staff(user_id,email,role) values('${owner}','owner@example.com','SUPER_ADMIN'),('${staff}','staff@example.com','CHECK_IN_STAFF'),('${manager}','manager@example.com','EVENT_MANAGER');insert into staff_events values('${staff}','${eid}'),('${manager}','${eid}');update events set rsvp_deadline=now()+interval '1 day',checkin_closes_at=now()+interval '2 days',invitation_expires_at=now()+interval '2 days' where id='${eid}';`,
  );
  tokens = await mint();
  a = await rpc("attendee_create", {
    event_id: eid,
    full_name: "John Smith",
    role_code: "P",
    email: "john@example.com",
    phone: "+962700000001",
    emergency_contact_name: "Secret Contact",
    emergency_contact_phone: "+962700000002",
    ...tokens,
  });
});
after(() => db.close());
test("IDs and tokens are globally unique; people are separate from registrations", async () => {
  assert.match(a.fdi_id, /^#FDI-JPS-P-\d+$/);
  assert.match(a.person_fdi_id, /^FDI-PERSON-\d+$/);
  assert.equal(tokens.token.length, 64);
  assert.notEqual(tokens.token, tokens.qr_token);
  const other = await rpc("event_save", {
    name: "Future workshop",
    code: "BLS",
    event_date: "2027-01-01",
    rsvp_deadline: new Date(Date.now() + 86400000).toISOString(),
    checkin_closes_at: new Date(Date.now() + 172800000).toISOString(),
  });
  const b = await rpc("attendee_create", {
    event_id: other.id,
    person_id: a.person_id,
    role_code: "TR",
    ...(await mint()),
  });
  assert.equal(b.person_id, a.person_id);
  assert.notEqual(b.serial, a.serial);
  assert.match(b.fdi_id, /^#FDI-BLS-TR-/);
});
test("No attendee data is returned before name + ID verification", async () => {
  const m = await pub("metadata", { token_hash: tokens.token_hash });
  assert.deepEqual(Object.keys(m).sort(), ["date", "name"]);
  await assert.rejects(
    pub("unlock", {
      token_hash: tokens.token_hash,
      name: "Wrong",
      fdi_id: a.fdi_id,
      session_hash: await hash("s"),
    }),
    /UNVERIFIED/,
  );
  await assert.rejects(
    pub("unlock", {
      token_hash: tokens.token_hash,
      name: "John Smith",
      fdi_id: "#FDI-JPS-P-99999",
      session_hash: await hash("s"),
    }),
    /UNVERIFIED/,
  );
  await assert.rejects(
    pub("invitation", {
      token_hash: tokens.token_hash,
      session_hash: await hash("unknown"),
    }),
    /UNVERIFIED/,
  );
});
test("Correct name + ID unlocks a restricted invitation projection", async () => {
  const v = await pub("unlock", {
    token_hash: tokens.token_hash,
    name: "  john   smith ",
    fdi_id: a.fdi_id.toLowerCase(),
    session_hash: await hash("good-session"),
  });
  assert.equal(v.name, "John Smith");
  assert.equal(v.qr_token, null);
  for (const key of [
    "email",
    "phone",
    "emergency_contact_name",
    "emergency_contact_phone",
  ])
    assert.equal(v[key], undefined);
  assert.ok(!JSON.stringify(v).includes("Secret Contact"));
});
test("RSVP activates/deactivates QR; deadline and history are enforced", async () => {
  const args = {
    token_hash: tokens.token_hash,
    session_hash: await hash("good-session"),
  };
  let v = await pub("rsvp", { ...args, response: "ACCEPTED" });
  assert.equal(v.qr_token, tokens.qr_token);
  v = await pub("rsvp", { ...args, response: "DECLINED" });
  assert.equal(v.qr_token, null);
  assert.equal((await scan()).status, "DECLINED_INVITATION");
  await pub("rsvp", { ...args, response: "ACCEPTED" });
  await db.exec(
    `update events set rsvp_deadline=now()-interval '1 second' where id='${eid}'`,
  );
  await assert.rejects(
    pub("rsvp", { ...args, response: "DECLINED" }),
    /RSVP_CLOSED/,
  );
  await rpc("rsvp_override", {
    event_id: eid,
    registration_id: a.id,
    response: "ACCEPTED",
  });
  await db.exec(
    `update events set rsvp_deadline=now()+interval '1 day' where id='${eid}'`,
  );
  assert.equal(
    (await query("select count(*)::int n from rsvp_history"))[0].n,
    4,
  );
});
test("Scanner only verifies; manual confirmation records one check-in", async () => {
  const v = await scan();
  assert.equal(v.status, "VALID_INVITATION");
  assert.equal((await query("select count(*)::int n from check_ins"))[0].n, 0);
  assert.equal(v.email, undefined);
  const results = await Promise.all([scan(true), scan(true), scan(true)]);
  assert.equal(results.filter((r) => r.status === "CHECKED_IN").length, 1);
  assert.equal((await query("select count(*)::int n from check_ins"))[0].n, 1);
  assert.equal((await scan()).status, "ALREADY_CHECKED_IN");
});
test("Invalid, revoked, expired, wrong-event, pending passes return no identity", async () => {
  assert.deepEqual(await scan(false, await hash("nonexistent")), {
    status: "INVALID_INVITATION",
  });
  await rpc("revoke", { event_id: eid, registration_id: a.id, reason: "Test" });
  assert.deepEqual(await scan(), { status: "REVOKED_INVITATION" });
  await assert.rejects(
    pub("invitation", {
      token_hash: tokens.token_hash,
      session_hash: await hash("good-session"),
    }),
    /UNVERIFIED/,
  );
  await rpc("reactivate", { event_id: eid, registration_id: a.id });
  await db.exec(
    `update events set invitation_expires_at=now()-interval '1 second' where id='${eid}'`,
  );
  assert.deepEqual(await scan(), { status: "EXPIRED_INVITATION" });
  await db.exec(
    `update events set invitation_expires_at=now()+interval '1 day' where id='${eid}'`,
  );
  const other = (
    await query(`select id from events where id<>'${eid}' limit 1`)
  )[0].id;
  assert.deepEqual(await scan(false, tokens.qr_hash, other, owner), {
    status: "WRONG_EVENT",
  });
  await rpc("rsvp_override", {
    event_id: eid,
    registration_id: a.id,
    response: "PENDING",
  });
  assert.deepEqual(await scan(), { status: "NOT_YET_ACCEPTED" });
  await rpc("rsvp_override", {
    event_id: eid,
    registration_id: a.id,
    response: "ACCEPTED",
  });
});
test("Least privilege, event scope, RLS and service-only functions hold", async () => {
  await assert.rejects(rpc("attendees", { event_id: eid }, staff), /FORBIDDEN/);
  await assert.rejects(rpc("staff_list", {}, manager), /FORBIDDEN/);
  await assert.rejects(
    rpc("staff_save", {
      user_id: owner,
      email: "owner@example.com",
      role: "ADMIN",
      enabled: true,
      events: [],
    }),
    /CANNOT_CHANGE_OWN_ACCESS/,
  );
  const other = (
    await query(`select id from events where id<>'${eid}' limit 1`)
  )[0].id;
  await assert.rejects(scan(false, tokens.qr_hash, other, staff), /FORBIDDEN/);
  await db.exec("set role anon");
  await assert.rejects(query("select * from people"), /permission denied/);
  await assert.rejects(
    pub("metadata", { token_hash: tokens.token_hash }),
    /permission denied/,
  );
  await db.exec("reset role");
  await db.exec("set role authenticated");
  await assert.rejects(query("select * from invitations"), /permission denied/);
  await db.exec("reset role");
  await db.exec(`update staff set enabled=false where user_id='${staff}'`);
  await assert.rejects(scan(), /FORBIDDEN/);
  await db.exec(`update staff set enabled=true where user_id='${staff}'`);
});
test("Certificate eligibility, idempotent issuance, restricted public verification and revocation", async () => {
  const token = randomToken();
  const c = await rpc("issue_certificate", {
    event_id: eid,
    registration_id: a.id,
    verification_token: token,
    verification_hash: await hash(token),
  });
  assert.match(c.certificate_number, /FDI-CERT-2026-\d+/);
  const again = await rpc("issue_certificate", {
    event_id: eid,
    registration_id: a.id,
    verification_token: randomToken(),
    verification_hash: await hash(randomToken()),
  });
  assert.equal(again.id, c.id);
  const v = await pub("verify_certificate", { token_hash: await hash(token) });
  assert.equal(v.status, "VALID");
  assert.equal(v.name, "John Smith");
  assert.equal(v.email, undefined);
  await rpc("revoke_certificate", { event_id: eid, registration_id: a.id });
  assert.deepEqual(
    await pub("verify_certificate", { token_hash: await hash(token) }),
    { status: "REVOKED" },
  );
  assert.deepEqual(
    await pub("verify_certificate", { token_hash: await hash("missing") }),
    { status: "NOT_FOUND" },
  );
  await rpc("undo_checkin", {
    event_id: eid,
    registration_id: a.id,
    reason: "test",
  });
  const b = await mint();
  await assert.rejects(
    rpc("issue_certificate", {
      event_id: eid,
      registration_id: a.id,
      verification_token: b.token,
      verification_hash: b.token_hash,
    }),
    /NOT_ELIGIBLE/,
  );
});
test("CSV validation, duplicate prevention, import transaction, formula-safe export", async () => {
  assert.equal(
    personSchema.safeParse({ full_name: "A", role_code: "P", email: "bad" })
      .success,
    false,
  );
  assert.equal(
    personSchema.safeParse({ full_name: "Good Name", role_code: "FAKE" })
      .success,
    false,
  );
  const rows = [
    { full_name: "Jane Smith", role_code: "V", ...(await mint()) },
    { full_name: "John Smith", role_code: "G", ...(await mint()) },
  ];
  await assert.rejects(
    rpc("import", { event_id: eid, rows }),
    /LIKELY_DUPLICATE/,
  );
  assert.equal(
    (
      await query(
        "select count(*)::int n from people where full_name='Jane Smith'",
      )
    )[0].n,
    0,
  );
  await rpc("import", { event_id: eid, rows: [rows[0]] });
  await assert.rejects(
    rpc("import", { event_id: eid, rows: [rows[0]] }),
    /LIKELY_DUPLICATE/,
  );
  assert.equal(csvSafe('=HYPERLINK("bad")'), '\'=HYPERLINK("bad")');
  assert.equal(csvSafe("John Smith"), "John Smith");
});
test("Invitation reset invalidates old links and passes; audit cannot be modified", async () => {
  const fresh = await mint();
  await rpc("reset", { event_id: eid, registration_id: a.id, ...fresh });
  assert.deepEqual(await scan(false, tokens.qr_hash), {
    status: "INVALID_INVITATION",
  });
  await assert.rejects(query("delete from audit_logs"), /AUDIT_IMMUTABLE/);
  await assert.rejects(
    query("update audit_logs set action='HIDDEN'"),
    /AUDIT_IMMUTABLE/,
  );
});
test("Rate limiter enforces burst limits and public API fails closed without configuration", async () => {
  for (let i = 0; i < 3; i++) {
    const v = (
      await query("select fdi_rate_limit($1,2,900) allowed", ["test-rate"])
    )[0].allowed;
    assert.equal(v, i < 2);
  }
  const response = await handle(
    new Request("https://example.com/api/admin", { method: "POST" }),
    {} as any,
  );
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.throws(() => validateAdmin("staff_save", { role: "ADMIN" }));
});
