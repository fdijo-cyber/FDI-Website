import { test } from "node:test";
import assert from "node:assert/strict";
import { harness, ownerToken, staffToken, testEvent } from "./support/harness";
import { handle } from "../server/worker";
import { normalizeId, normalizeName } from "../server/invitation-identity";

test("identity normalization handles copied formatting without fuzzy matches", () => {
  assert.equal(normalizeId(" #ＦＤＩ–JPS–P–١٣٧\u200e "), "FDI-JPS-P-137");
  assert.equal(normalizeName(" JOHN\u00a0  Smith\u200f "), "john smith");
  assert.notEqual(normalizeName("John Smith"), normalizeName("John Smyth"));
  assert.notEqual(normalizeId("FDI-JPS-P-137"), normalizeId("FDI-JPS-P-138"));
});

test("unlock accepts sent event IDs and reusable IDs, rejects wrong identity and revoked passes", async () => {
  const h = await harness();
  const env = { SUPABASE_URL: "https://fdi-test.supabase.co", SUPABASE_ANON_KEY: "test-anon", SUPABASE_SERVICE_ROLE_KEY: "test-server", RATE_LIMIT_SECRET: "test-rate", APP_ORIGIN: "https://fdi.test", ASSETS: {} as any };
  const unlock = (name: string, fdi_id: string) => handle(new Request("https://fdi.test/api/invitation/unlock?token=" + h.token, {method:"POST", headers:{Origin:env.APP_ORIGIN,"Content-Type":"application/json"}, body:JSON.stringify({name,fdi_id})}), env);
  try {
    await h.db.exec("update people set public_id='CUSTOM-137'");
    for (const id of [h.person.fdi_id, "#custom–١٣٧"]) {
      const response = await unlock(" JOHN\u00a0 Smith\u200f ", id);
      assert.equal(response.status, 200);
      const data = await response.json() as any;
      assert.equal(data.fdi_id, "CUSTOM-137");
      assert.equal(data.email, undefined);
      assert.equal(data.emergency_contact_name, undefined);
    }
    assert.equal((await unlock("Wrong Name", "CUSTOM-137")).status, 401);
    assert.equal((await unlock("John Smith", "CUSTOM-138")).status, 401);
    // An installation with the original SQL must still accept a custom ID
    // after the server has verified it against the actual person record.
    const original = (await h.db.query<{definition:string}>("select pg_get_functiondef('fdi_public(text,jsonb)'::regprocedure) definition")).rows[0].definition;
    await h.db.exec(original.replace("coalesce(p.public_id,r.fdi_id)", "r.fdi_id"));
    assert.equal((await unlock("John Smith", "CUSTOM-137")).status, 200);
    await h.db.exec("update invitations set status='REVOKED'");
    assert.equal((await unlock("John Smith", "CUSTOM-137")).status, 401);
    await h.db.exec("update invitations set status='ACTIVE'; update events set keep_invitation_record=false,invitation_expires_at=now()-interval '1 day'");
    assert.equal((await unlock("John Smith", "CUSTOM-137")).status, 401);
  } finally { h.restore(); await h.db.close(); }
});


test("admin diagnostic checks pending and accepted passes, blocks scanner staff, and removes probe sessions", async () => {
  const h = await harness();
  const env = { SUPABASE_URL: "https://fdi-test.supabase.co", SUPABASE_ANON_KEY: "test-anon", SUPABASE_SERVICE_ROLE_KEY: "test-server", RATE_LIMIT_SECRET: "test-rate", APP_ORIGIN: "https://fdi.test", ASSETS: {} as any };
  const diagnose = (token: string) => handle(new Request("https://fdi.test/api/invitation-diagnostic", { method: "POST", headers: { Origin: env.APP_ORIGIN, "Content-Type": "application/json", Authorization: "Bearer " + token }, body: JSON.stringify({event_id: testEvent, registration_id: h.person.id}) }), env);
  try {
    assert.equal((await diagnose(staffToken)).status, 403);
    for (const rsvp of ["PENDING", "ACCEPTED", "DECLINED"]) {
      await h.db.query("update event_registrations set rsvp=$1", [rsvp]);
      const response = await diagnose(ownerToken);
      assert.equal(response.status, 200);
      const result = await response.json() as any;
      assert.equal(result.ok, true, JSON.stringify(result));
      assert.equal(result.rsvp, rsvp);
      assert.equal(result.email, undefined);
      assert.equal((await h.db.query<{count:number}>("select count(*)::int count from invitation_sessions")).rows[0].count, 0);
    }
    await h.db.exec("update invitations set status='REVOKED'");
    const result = await (await diagnose(ownerToken)).json() as any;
    assert.equal(result.ok, false);
    assert.match(result.message, /revoked/);
    await h.db.exec("update invitations set status='ACTIVE',token_hash=repeat('0',64)");
    assert.match(((await (await diagnose(ownerToken)).json()) as any).message, /hash do not match/);
  } finally { h.restore(); await h.db.close(); }
});
