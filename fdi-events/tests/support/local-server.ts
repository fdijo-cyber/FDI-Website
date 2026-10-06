import { createServer } from "node:http";
import { harness, ownerToken, staffToken } from "./harness";
import { handle } from "../../server/worker";
export const h = await harness();
const env = {
  SUPABASE_URL: "https://fdi-test.supabase.co",
  SUPABASE_ANON_KEY: "test-public",
  SUPABASE_SERVICE_ROLE_KEY: "test-server",
  RATE_LIMIT_SECRET: "test-only",
  APP_ORIGIN: "http://127.0.0.1:5173",
  ASSETS: {} as any,
};
export const server = createServer(async (req, res) => {
  try {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const data = Buffer.concat(chunks);
    if (req.url === "/test/records") {
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          person: h.person,
          token: h.token,
          qr: h.qr,
          ownerToken,
          staffToken,
        }),
      );
      return;
    }
    const r = await handle(
      new Request("http://localhost:8787" + req.url, {
        method: req.method,
        headers: req.headers as any,
        body: !["GET", "HEAD"].includes(req.method ?? "GET") ? data : undefined,
      }),
      env,
    );
    res.writeHead(r.status, Object.fromEntries(r.headers));
    res.end(Buffer.from(await r.arrayBuffer()));
  } catch (e) {
    res.writeHead(500);
    res.end(String(e));
  }
});
server.listen(8787, "127.0.0.1", () =>
  console.log("Isolated test API on 127.0.0.1:8787. Synthetic data only."),
);
