import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { harness, ownerToken, staffToken, testEvent } from "./support/harness";
import { handle } from "../server/worker";
import { PDFDocument } from "pdf-lib";
import { renderCertificate } from "../src/certificate-pdf";
import QRCode from "qrcode";
import { PNG } from "pngjs";
import {
  RGBLuminanceSource,
  HybridBinarizer,
  BinaryBitmap,
  QRCodeReader,
} from "@zxing/library";
let h: Awaited<ReturnType<typeof harness>>;
let cookie = "";
const origin = "https://fdi.test";
const env = {
  SUPABASE_URL: "https://fdi-test.supabase.co",
  SUPABASE_ANON_KEY: "test-anon",
  SUPABASE_SERVICE_ROLE_KEY: "test-server",
  RATE_LIMIT_SECRET: "test-rate",
  APP_ORIGIN: origin,
  ASSETS: {} as any,
};
async function request(
  path: string,
  body?: any,
  token?: string,
  originOverride = origin,
) {
  const headers: Record<string, string> = { Origin: originOverride };
  if (body) headers["Content-Type"] = "application/json";
  if (cookie) headers.Cookie = cookie;
  if (token) headers.Authorization = "Bearer " + token;
  const response = await handle(
    new Request(origin + "/api" + path, {
      method: body ? "POST" : "GET",
      headers,
      body: body ? JSON.stringify(body) : undefined,
    }),
    env,
  );
  if (response.headers.get("Set-Cookie"))
    cookie = response.headers.get("Set-Cookie")!.split(";")[0];
  return { response, data: (await response.json()) as any };
}
before(async () => {
  h = await harness();
});
after(async () => {
  h.restore();
  await h.db.close();
});
test("Worker protects API auth, origins, private fields and secure invitation cookies", async () => {
  assert.equal(
    (await request("/admin", { action: "bootstrap" })).response.status,
    401,
  );
  assert.equal(
    (await request("/admin", { action: "bootstrap" }, "forged-token")).response
      .status,
    401,
  );
  assert.equal(
    (
      await request(
        "/admin",
        { action: "bootstrap" },
        ownerToken,
        "https://evil.test",
      )
    ).response.status,
    403,
  );
  const pre = await request("/invitation?token=" + h.token);
  assert.equal(pre.response.status, 401);
  const bad = await request("/invitation/unlock?token=" + h.token, {
    name: "Wrong",
    fdi_id: h.person.fdi_id,
  });
  assert.equal(bad.response.status, 401);
  assert.equal(bad.data.error, "We couldn’t verify these invitation details.");
  const good = await request("/invitation/unlock?token=" + h.token, {
    name: "John Smith",
    fdi_id: h.person.fdi_id,
  });
  assert.equal(good.response.status, 200);
  assert.match(
    good.response.headers.get("Set-Cookie")!,
    /HttpOnly; Secure; SameSite=Strict/,
  );
  assert.equal(good.data.email, undefined);
  const rsvp = await request("/invitation/rsvp?token=" + h.token, {
    response: "ACCEPTED",
  });
  assert.equal(rsvp.data.qr_token, h.qr);
  assert.equal(rsvp.response.headers.get("Cache-Control"), "no-store");
});
test("Worker staff scanner performs explicit confirmation and cannot fetch admin people", async () => {
  assert.equal(
    (
      await request(
        "/admin",
        { action: "attendees", payload: { event_id: testEvent } },
        staffToken,
      )
    ).response.status,
    403,
  );
  let result = await request(
    "/scan",
    { event_id: testEvent, token: h.qr },
    staffToken,
  );
  assert.equal(result.data.status, "VALID_INVITATION");
  assert.equal(result.data.email, undefined);
  result = await request(
    "/scan",
    { event_id: testEvent, token: h.qr, confirm: true },
    staffToken,
  );
  assert.equal(result.data.status, "CHECKED_IN");
  result = await request(
    "/scan",
    { event_id: testEvent, token: h.qr, confirm: true },
    staffToken,
  );
  assert.equal(result.data.status, "ALREADY_CHECKED_IN");
});
test("Worker validation rejects malformed input and never returns service credentials", async () => {
  const b = await request(
    "/admin",
    {
      action: "attendee_create",
      payload: {
        event_id: testEvent,
        full_name: "Good Name",
        role_code: "P",
        email: "invalid",
      },
    },
    ownerToken,
  );
  assert.equal(b.response.status, 400);
  const config = await request("/config");
  assert.deepEqual(Object.keys(config.data).sort(), [
    "supabaseAnonKey",
    "supabaseUrl",
  ]);
  assert.ok(!JSON.stringify(config.data).includes("test-server"));
  assert.equal(
    (await request("/admin", { action: "unknown", payload: {} }, ownerToken))
      .response.status,
    400,
  );
});
test("Actual QR encodes only the secure pass URL and decodes correctly", async () => {
  const url = origin + "/check/" + h.qr;
  const png = PNG.sync.read(
    await QRCode.toBuffer(url, { width: 400, margin: 4 }),
  );
  const pixels = new Uint8ClampedArray(png.width * png.height);
  for (let i = 0; i < pixels.length; i++)
    pixels[i] =
      (png.data[i * 4] + png.data[i * 4 + 1] + png.data[i * 4 + 2]) / 3;
  const result = new QRCodeReader().decode(
    new BinaryBitmap(
      new HybridBinarizer(
        new RGBLuminanceSource(pixels, png.width, png.height),
      ),
    ),
  );
  assert.equal(result.getText(), url);
  assert.ok(!result.getText().includes("John"));
});
test("Certificate PDF overlays provided template and includes a real verification QR", async () => {
  const pdf = await PDFDocument.create();
  pdf.addPage([842, 595]);
  const output = await renderCertificate(
    await pdf.save(),
    {
      name: "John Smith",
      event: "FDI BFA Workshop",
      date: "2026-11-07",
      number: "FDI-CERT-2026-000001",
      fdi_id: h.person.fdi_id,
      issued_at: new Date().toISOString(),
      token: "c".repeat(64),
      layout: {},
    },
    origin,
  );
  const rendered = await PDFDocument.load(output);
  assert.equal(rendered.getPageCount(), 1);
  assert.ok(output.length > 2000);
  const arabic = await renderCertificate(
    await pdf.save(),
    {
      name: "شهاب غاندي",
      event: "FDI BFA Workshop",
      date: "2026-11-07",
      number: "FDI-CERT-2026-000002",
      fdi_id: h.person.fdi_id,
      issued_at: new Date().toISOString(),
      token: "d".repeat(64),
      layout: {},
    },
    origin,
    new Uint8Array(
      (await import("node:fs")).readFileSync("public/certificate-font.ttf"),
    ),
  );
  assert.ok(arabic.length > 2000);
});
