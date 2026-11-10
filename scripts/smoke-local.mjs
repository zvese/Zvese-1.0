import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { createServer } from "node:net";
import { spawn } from "node:child_process";
import assert from "node:assert/strict";

// No hosted targets, browser credentials, provider calls or data writes.
const config = parseEnv(readFileSync(new URL("../.env.local", import.meta.url), "utf8"));
const databaseUrl = new URL(config.NEXT_PUBLIC_SUPABASE_URL);
if (!["127.0.0.1", "localhost", "[::1]"].includes(databaseUrl.hostname)) throw new Error("SMOKE_REQUIRES_LOCAL_SUPABASE");
const reservation = createServer();
await new Promise((resolve, reject) => { reservation.once("error", reject); reservation.listen(0, "127.0.0.1", resolve); });
const port = reservation.address().port;
await new Promise(resolve => reservation.close(resolve));
const app = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-H", "127.0.0.1", "-p", String(port)], {
  cwd: new URL("..", import.meta.url), windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
  env: { ...process.env, ...config, ZVESE_COMMERCE_ENABLED: "false", ZVESE_PAYMENT_MODE: "disabled", NEXT_TELEMETRY_DISABLED: "1" },
});
try {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("LOCAL_APP_START_TIMEOUT")), 45000);
    let output = "";
    app.stdout.on("data", data => { output = (output + data.toString()).slice(-3000); if (/Ready in/.test(output)) { clearTimeout(timer); resolve(); } });
    app.stderr.on("data", () => {}); // Never echo runtime configuration or responses.
    app.once("error", () => { clearTimeout(timer); reject(new Error("LOCAL_APP_START_FAILED")); });
    app.once("exit", code => { clearTimeout(timer); reject(new Error(`LOCAL_APP_EXIT_${code}`)); });
  });
  const base = `http://127.0.0.1:${port}`;
  for (const path of ["/", "/marketplace", "/cart", "/sign-in", "/sign-up"]) {
    const response = await fetch(base + path, { redirect: "manual", signal: AbortSignal.timeout(30000) });
    assert.equal(response.status, 200, path);
    const body = await response.text();
    assert.match(body, /Zvese/);
    assert.doesNotMatch(body, /This page is temporarily unavailable|Could not load|Internal Server Error/);
    console.log(`HTTP_SMOKE_PASS ${path}`);
  }
  for (const path of ["/account/orders", "/admin/orders", "/checkout/11111111-1111-4111-8111-111111111111"]) {
    const response = await fetch(base + path, { redirect: "manual", signal: AbortSignal.timeout(30000) });
    assert.ok([303, 307].includes(response.status), `${path} must require sign-in`);
    assert.match(response.headers.get("location"), /\/sign-in/);
    console.log(`AUTH_SMOKE_PASS ${path}`);
  }
  const callback = await fetch(base + "/api/payments/pesepay", { method: "POST", headers: { "content-type": "application/json" }, body: '{"transactionStatus":"SUCCESS"}', signal: AbortSignal.timeout(15000) });
  assert.equal(callback.status, 503, "disabled payments must fail closed");
  console.log("DISABLED_PAYMENT_SMOKE_PASS");
} finally {
  app.kill(); // Only the local app process created by this test; never a Docker process.
}
