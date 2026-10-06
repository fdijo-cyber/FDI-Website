import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { PDFDocument } from "pdf-lib";
const testTemplate = await PDFDocument.create();
testTemplate.addPage([842, 595]);
const testTemplateBytes = Buffer.from(await testTemplate.save());
import { server, h } from "./support/local-server.ts";
import { preview as createVite } from "vite";
if (!server.listening) await new Promise((r) => server.once("listening", r));
const vite = await createVite({
  preview: {
    host: "127.0.0.1",
    port: 5173,
    proxy: { "/api": "http://127.0.0.1:8787" },
  },
});
const records = await (
  await fetch("http://127.0.0.1:8787/test/records")
).json();
const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox"],
});
const results = [];
const base = "http://127.0.0.1:5173";
async function context(role) {
  const c = await browser.newContext();
  await c.route("https://fdi-test.supabase.co/**", (route) =>
    route.request().url().includes("/storage/")
      ? route.fulfill({
          contentType: "application/pdf",
          headers: { "Access-Control-Allow-Origin": "*" },
          body: testTemplateBytes,
        })
      : route.fulfill({
          json: {
            id:
              role === "staff"
                ? "22222222-2222-4222-8222-222222222222"
                : "11111111-1111-4111-8111-111111111111",
            email:
              role === "staff" ? "scanner@example.com" : "owner@example.com",
            app_metadata: {},
            user_metadata: {},
            aud: "authenticated",
            factors: [],
          },
        }),
  );
  if (role) {
    await c.addInitScript(
      ({ token, id, email }) => {
        sessionStorage.setItem(
          "sb-fdi-test-auth-token",
          JSON.stringify({
            access_token: token,
            refresh_token: "test-only-refresh",
            token_type: "bearer",
            expires_in: 3600,
            expires_at: Math.floor(Date.now() / 1000) + 3600,
            user: {
              id,
              email,
              aud: "authenticated",
              app_metadata: {},
              user_metadata: {},
            },
          }),
        );
      },
      {
        token: role === "staff" ? records.staffToken : records.ownerToken,
        id:
          role === "staff"
            ? "22222222-2222-4222-8222-222222222222"
            : "11111111-1111-4111-8111-111111111111",
        email: role === "staff" ? "scanner@example.com" : "owner@example.com",
      },
    );
  }
  return c;
}
async function check(name, fn) {
  await fn();
  results.push(name);
  console.log("PASS", name);
}
try {
  const c = await context();
  const p = await c.newPage();
  await p.goto(base + "/invite/" + records.token);
  await p.getByRole("button", { name: "Access invitation" }).waitFor();
  await check(
    "Incorrect name and ID stay locked with generic errors",
    async () => {
      await p.getByLabel("Full name", { exact: true }).fill("Wrong Name");
      await p.getByLabel("FDI ID number").fill(records.person.fdi_id);
      await p.getByRole("button", { name: "Access invitation" }).click();
      await p
        .getByRole("alert")
        .filter({ hasText: "We couldn’t verify" })
        .waitFor();
      await p.getByLabel("Full name", { exact: true }).fill("John Smith");
      await p.getByLabel("FDI ID number").fill("#FDI-JPS-P-99999");
      await p.getByRole("button", { name: "Access invitation" }).click();
      await p
        .getByRole("alert")
        .filter({ hasText: "We couldn’t verify" })
        .waitFor();
      assert.equal(
        await p
          .getByRole("button", { name: "Accept invitation", exact: true })
          .count(),
        0,
      );
    },
  );
  await check(
    "Correct name + ID opens invitation and RSVP controls work",
    async () => {
      await p.getByLabel("FDI ID number").fill(records.person.fdi_id);
      await p.getByRole("button", { name: "Access invitation" }).click();
      await p
        .getByRole("button", { name: "Accept invitation", exact: true })
        .waitFor();
      await p
        .getByRole("button", { name: "Accept invitation", exact: true })
        .click();
      await p.getByAltText("Secure FDI pass QR code").waitFor();
      await p
        .getByRole("button", { name: "Decline invitation", exact: true })
        .click();
      await p.waitForFunction(() => !document.querySelector("img.qr"));
      await p
        .getByRole("button", { name: "Accept invitation", exact: true })
        .click();
      await p.getByAltText("Secure FDI pass QR code").waitFor();
      assert.ok(
        !(await p.locator("body").innerText()).includes("Private Person"),
      );
      assert.ok(
        !(await p.locator("body").innerText()).includes("john@example.com"),
      );
    },
  );
  await check(
    "Invitation fits 375,390,430,768,1366,1440px; seal remains 150px",
    async () => {
      for (const width of [375, 390, 430, 768, 1366, 1440]) {
        await p.setViewportSize({ width, height: 900 });
        assert.ok(
          await p.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        );
        assert.equal(
          await p
            .locator(".brand-logo")
            .evaluate((e) => e.getBoundingClientRect().width),
          150,
        );
        await p.screenshot({
          path: `qa/invitation-${width}.png`,
          fullPage: true,
        });
      }
    },
  );
  const ac = await context("owner");
  const a = await ac.newPage();
  await a.goto(base + "/admin");
  await a.getByRole("heading", { name: "Attendees", exact: true }).waitFor();
  await check(
    "Admin stats use actual records; attendee create and search work",
    async () => {
      await a.getByRole("button", { name: "Add person", exact: true }).click();
      await a.getByLabel("Full name", { exact: true }).fill("Maria Lopez");
      await a.getByLabel("Email · admin only").fill("maria@example.com");
      await a
        .getByRole("button", { name: "Create invitation", exact: true })
        .click();
      await a
        .getByText("Attendee created. Copy the personal invitation below.")
        .waitFor();
      await a.getByRole("button", { name: "Close", exact: true }).click();
      await a.getByRole("row").filter({ hasText: "Maria Lopez" }).waitFor();
      await a.getByRole("textbox", { name: "Search attendees" }).fill("Maria");
      assert.equal(await a.locator(".attendees-table tbody tr").count(), 1);
      await a.getByRole("textbox", { name: "Search attendees" }).fill("");
    },
  );
  await check(
    "CSV preview shows row errors and imports valid records",
    async () => {
      await a.getByRole("button", { name: "Import CSV", exact: true }).click();
      await a
        .getByLabel("Upload CSV")
        .setInputFiles({
          name: "attendees.csv",
          mimeType: "text/csv",
          buffer: Buffer.from(
            "full_name,role,email\nSarah Ali,Volunteer,sarah@example.com\nBad Entry,Unknown,bad-email\n",
          ),
        });
      await a.getByText("role_code:", { exact: false }).waitFor();
      await a
        .getByRole("button", { name: "Import 1 valid records", exact: true })
        .click();
      await a.getByRole("row").filter({ hasText: "Sarah Ali" }).waitFor();
    },
  );
  await check(
    "Clipboard list excludes personal contacts and CSV exports",
    async () => {
      await a
        .getByRole("button", { name: "Print list / PDF", exact: true })
        .click();
      assert.ok(
        !(await a.locator(".print-sheet").innerText()).includes(
          "maria@example.com",
        ),
      );
      await a.getByRole("button", { name: "Close", exact: true }).click();
      const download = a.waitForEvent("download");
      await a.getByRole("button", { name: "Export CSV", exact: true }).click();
      const f = await download;
      assert.equal(f.suggestedFilename(), "FDI-attendees.csv");
    },
  );
  await a.setViewportSize({ width: 1440, height: 900 });
  await a.screenshot({ path: "qa/admin-1440.png", fullPage: true });
  const sc = await context("staff");
  const s = await sc.newPage();
  await s.setViewportSize({ width: 390, height: 900 });
  await s.goto(base + "/scan");
  await s.getByRole("button", { name: "Verify pass", exact: true }).waitFor();
  await check(
    "Staff sees only authorized scanner; verification requires confirmation",
    async () => {
      assert.equal(
        await s.getByRole("button", { name: "Attendees", exact: true }).count(),
        0,
      );
      await s
        .getByLabel("Pass link or token")
        .fill(base + "/check/" + records.qr);
      await s.getByRole("button", { name: "Verify pass", exact: true }).click();
      await s
        .getByRole("button", { name: "Confirm attendance", exact: true })
        .waitFor();
      await s.getByText("NOT CHECKED IN", { exact: true }).waitFor();
      await s.screenshot({ path: "qa/scanner-390.png", fullPage: true });
      assert.ok(
        await s.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      );
      await s
        .getByRole("button", { name: "Confirm attendance", exact: true })
        .click();
      await s
        .locator(".scan-status")
        .getByText("CHECKED IN", { exact: true })
        .waitFor();
      await s.getByRole("button", { name: "Verify pass", exact: true }).click();
      await s.getByText("ALREADY CHECKED IN", { exact: true }).waitFor();
    },
  );
  await check(
    "Certificates issue from attendance and public verification stays private",
    async () => {
      await a.reload();
      await a
        .getByRole("row")
        .filter({ hasText: "John Smith" })
        .getByRole("button", { name: "Manage" })
        .click();
      await a
        .getByRole("button", { name: "Issue certificate record", exact: true })
        .click();
      await a
        .getByText("Certificate record issued.", { exact: false })
        .waitFor();
      const url = await a
        .getByRole("link", { name: "View verification" })
        .getAttribute("href");
      const v = await c.newPage();
      await v.goto(base + url);
      await v.getByRole("heading", { name: "Valid FDI certificate" }).waitFor();
      assert.ok(
        !(await v.locator("body").innerText()).includes("john@example.com"),
      );
      await v.screenshot({
        path: "qa/certificate-verification.png",
        fullPage: true,
      });
      const pdfPage = await c.newPage();
      const downloadURL = await a
        .getByRole("link", { name: "Download certificate", exact: true })
        .getAttribute("href");
      await pdfPage.goto(base + downloadURL);
      await pdfPage
        .getByRole("button", { name: "Download certificate PDF" })
        .waitFor();
      const pdfDownload = pdfPage.waitForEvent("download");
      await pdfPage
        .getByRole("button", { name: "Download certificate PDF" })
        .click();
      const file = await pdfDownload;
      assert.match(file.suggestedFilename(), /^FDI-CERT-2026-.*\.pdf$/);
      await a.getByRole("button", { name: "Close", exact: true }).click();
    },
  );
  await check(
    "Admin creates a reusable future event without source edits",
    async () => {
      await a.getByRole("button", { name: "Events", exact: true }).click();
      await a
        .getByRole("button", { name: "Create event", exact: true })
        .click();
      await a
        .getByLabel("Event name", { exact: true })
        .fill("FDI Future Workshop");
      await a.getByLabel("Event code", { exact: true }).fill("NEW");
      await a.getByRole("button", { name: "Save event", exact: true }).click();
      await a
        .getByRole("heading", { name: "FDI Future Workshop", exact: true })
        .waitFor();
    },
  );
  for (const width of [375, 390, 430, 768, 1366, 1440]) {
    await a.setViewportSize({ width, height: 900 });
    assert.ok(
      await a.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
  }
  writeFileSync(
    "qa/browser-results.json",
    JSON.stringify(
      {
        passed: results,
        date: new Date().toISOString(),
        note: "Synthetic auth protocol and database harness. Real Supabase email/auth and physical phone camera require deployment verification.",
      },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
  await new Promise((r) => vite.httpServer.close(r));
  await new Promise((r) => server.close(r));
  h.restore();
  await h.db.close();
}
