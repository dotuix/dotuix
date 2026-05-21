import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { syncRouter } from "./routes.js";

const app = new Hono();

app.get("/health", (c) => c.json({ ok: true, time: Date.now() }));
app.route("/sync", syncRouter);

const port = Number(process.env.PORT ?? 3131);

serve({ fetch: app.fetch, port }, () => {
  console.log(`dotuix sync-server  →  http://localhost:${port}`);
  console.log(`  POST /sync        push + pull records`);
  console.log(`  GET  /health      liveness check`);
});
