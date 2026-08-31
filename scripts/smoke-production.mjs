#!/usr/bin/env node
/**
 * Production smoke test — run this against a LIVE deployment.
 *
 *   node scripts/smoke-production.mjs https://zemainspect.vercel.app
 *   node scripts/smoke-production.mjs https://zemainspect.vercel.app zi_live_yourkey
 *
 * Without an API key it verifies everything reachable anonymously: pages
 * render, protected routes redirect, the API rejects unauthenticated calls,
 * the model and edge runtime are actually deployed, and secrets are not
 * leaking. Pass an API key and it additionally runs a REAL inspection and
 * checks the detections and latency a factory would see.
 *
 * Exit code is non-zero if anything fails, so it can gate a deploy.
 */

const base = (process.argv[2] || "").replace(/\/$/, "");
const apiKey = process.argv[3];

if (!base) {
  console.error("usage: node scripts/smoke-production.mjs <url> [api-key]");
  process.exit(2);
}

let pass = 0;
let fail = 0;
const failures = [];

function ok(name, detail = "") {
  pass += 1;
  console.log(`  \x1b[32mPASS\x1b[0m  ${name}${detail ? "  — " + detail : ""}`);
}
function bad(name, detail) {
  fail += 1;
  failures.push(`${name}: ${detail}`);
  console.log(`  \x1b[31mFAIL\x1b[0m  ${name}  — ${detail}`);
}
function section(t) {
  console.log(`\n\x1b[1m${t}\x1b[0m`);
}

async function req(path, init = {}) {
  const started = Date.now();
  try {
    const res = await fetch(`${base}${path}`, {
      redirect: "manual",
      ...init,
      headers: { "User-Agent": "ZemaInspect-SmokeTest/1.0", ...(init.headers ?? {}) },
    });
    return { res, ms: Date.now() - started };
  } catch (err) {
    return { error: err.message, ms: Date.now() - started };
  }
}

async function expectStatus(name, path, expected, init) {
  const { res, error, ms } = await req(path, init);
  if (error) return bad(name, `request failed: ${error}`);
  const list = Array.isArray(expected) ? expected : [expected];
  if (list.includes(res.status)) ok(name, `HTTP ${res.status} in ${ms}ms`);
  else bad(name, `expected ${list.join("/")}, got ${res.status}`);
  return res;
}

console.log(`\nZemaInspect production smoke test\ntarget: ${base}\n${"─".repeat(56)}`);

section("1. Public pages");
await expectStatus("landing page", "/", 200);
await expectStatus("pricing page", "/pricing", 200);
await expectStatus("sign-in page", "/signin", 200);
await expectStatus("sign-up page", "/signup", 200);

section("2. Auth gating (must redirect, never render)");
await expectStatus("/dashboard redirects when signed out", "/dashboard", [302, 307]);
await expectStatus("/admin redirects when signed out", "/admin", [302, 307]);
await expectStatus("/settings redirects when signed out", "/settings", [302, 307]);

section("3. API rejects unauthenticated callers");
await expectStatus("GET /api/inspections -> 401", "/api/inspections", 401);
await expectStatus("POST /api/v1/inspect without key -> 401", "/api/v1/inspect", 401, { method: "POST" });
await expectStatus("POST /api/v1/inspect with bad key -> 401", "/api/v1/inspect", 401, {
  method: "POST",
  headers: { Authorization: "Bearer zi_live_definitely_not_valid" },
});
await expectStatus("cron endpoint without token -> 401", "/api/cron/check-thresholds", [401, 403]);
await expectStatus("admin user API -> 403", "/api/admin/users", 403, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email: "smoke@example.com", role: "SUPER_ADMIN" }),
});

section("3b. Sign-in forms are wired up");
{
  const { res, error } = await req("/signin");
  if (error) bad("password sign-in offered", error);
  else {
    const html = await res.text();
    if (/type="password"/.test(html)) ok("password sign-in offered");
    else bad("password sign-in offered", "no password field on /signin");
  }
}
{
  // Registration must reject a weak password before it reaches the database.
  const { res, error } = await req("/api/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: `smoke-${Date.now()}@example.invalid`, password: "short" }),
  });
  if (error) bad("registration rejects a weak password", error);
  else if (res.status === 400) ok("registration rejects a weak password");
  else bad("registration rejects a weak password", `HTTP ${res.status} — check password rules`);
}

section("4. Webhooks reject forged signatures");
await expectStatus("paystack, no signature -> 401", "/api/webhooks/paystack", 401, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ event: "charge.success", data: {} }),
});
await expectStatus("paystack, forged signature -> 401", "/api/webhooks/paystack", 401, {
  method: "POST",
  headers: { "Content-Type": "application/json", "x-paystack-signature": "deadbeef" },
  body: JSON.stringify({ event: "charge.success", data: {} }),
});

section("5. Model + edge runtime actually deployed");
{
  // Ask for the first 2 KB rather than issuing a HEAD. A CDN that compresses
  // the response drops content-length from a HEAD reply, which used to make a
  // perfectly healthy 12 MB model look like 0 bytes. A ranged GET reports the
  // real size in content-range and lets us confirm the bytes are an ONNX
  // ModelProto (field 1, ir_version) rather than an HTML error page.
  const { res, error, ms } = await req("/models/yolov8n-neu.onnx", {
    headers: { Range: "bytes=0-2047", "Accept-Encoding": "identity" },
  });
  if (error) bad("ONNX model served", error);
  else if (res.status !== 200 && res.status !== 206) {
    bad("ONNX model served", `HTTP ${res.status} — inference will 503`);
  } else {
    const head = new Uint8Array(await res.arrayBuffer());
    const range = res.headers.get("content-range") || "";
    const total = Number(
      range.match(/\/(\d+)$/)?.[1] ??
        (res.status === 200 ? head.byteLength : res.headers.get("content-length")) ??
        0,
    );
    const cache = res.headers.get("cache-control") || "";

    if (head[0] !== 0x08) {
      bad("ONNX model served", "not an ONNX model — first bytes are not a ModelProto");
    } else if (total < 1_000_000) {
      bad("ONNX model served", `suspiciously small: ${total} bytes`);
    } else {
      ok("ONNX model served", `${(total / 1024 / 1024).toFixed(1)} MB in ${ms}ms`);
    }

    if (cache.includes("immutable")) ok("model cached immutably", cache);
    else bad("model cached immutably", `got "${cache}" — every edge client refetches ~12 MB`);
  }
}
for (const f of [
  "ort.webgpu.min.mjs",
  "ort-wasm-simd-threaded.wasm",
  "ort-wasm-simd-threaded.jsep.wasm",
  "ort-wasm-simd-threaded.asyncify.wasm",
]) {
  const { res, error } = await req(`/ort/${f}`, { method: "HEAD" });
  if (error) bad(`edge runtime ${f}`, error);
  else if (res.status === 200) ok(`edge runtime ${f}`);
  else bad(`edge runtime ${f}`, `HTTP ${res.status} — browser inference will fail to start`);
}

section("6. No secret leakage");
{
  const { res, error } = await req("/");
  if (error) bad("homepage readable", error);
  else {
    const html = await res.text();
    const leaks = [
      [/sk_live_[A-Za-z0-9]/, "Paystack/Stripe LIVE secret key"],
      [/sk_test_[A-Za-z0-9]/, "Paystack/Stripe test secret key"],
      [/postgres(ql)?:\/\/[^\s"']+/, "database connection string"],
      [/whsec_[A-Za-z0-9]/, "webhook signing secret"],
    ];
    const found = leaks.filter(([re]) => re.test(html)).map(([, n]) => n);
    if (found.length) bad("no secrets in HTML", found.join(", "));
    else ok("no secrets in HTML");
  }
}

if (apiKey) {
  section("7. REAL inference (API key supplied)");
  // A 1x1 PNG is a valid image the model can run on; we care that the
  // pipeline executes end to end, not what it detects in one pixel.
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
    "base64",
  );
  const form = new FormData();
  form.append("image", new Blob([png], { type: "image/png" }), "probe.png");
  form.append("product_category", "steel");
  form.append("line_id", "smoke-test");

  const started = Date.now();
  try {
    const res = await fetch(`${base}/api/v1/inspect`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });
    const ms = Date.now() - started;
    const body = await res.json().catch(() => ({}));

    if (res.status === 200) {
      ok("inspection succeeded", `${ms}ms wall, ${body.processing_time_ms}ms inference, model=${body.model_variant}`);
      if (body.inspection_id && body.result && Array.isArray(body.defects)) {
        ok("response shape matches API contract", `result=${body.result}, defects=${body.defects.length}`);
      } else {
        bad("response shape matches API contract", JSON.stringify(body).slice(0, 160));
      }
      if (ms > 25000) bad("cold-start latency", `${ms}ms — investigate before a live pilot`);
      else ok("latency acceptable", `${ms}ms`);
    } else if (res.status === 503 && body?.error?.code === "model_unavailable") {
      bad("inspection succeeded", "model_unavailable — weights not deployed");
    } else {
      bad("inspection succeeded", `HTTP ${res.status}: ${JSON.stringify(body).slice(0, 200)}`);
    }
  } catch (err) {
    bad("inspection succeeded", err.message);
  }

  section("8. Second call (warm latency — what the line actually sees)");
  {
    const form2 = new FormData();
    form2.append("image", new Blob([png], { type: "image/png" }), "probe.png");
    form2.append("product_category", "steel");
    const started2 = Date.now();
    try {
      const res = await fetch(`${base}/api/v1/inspect`, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` },
        body: form2,
      });
      const ms = Date.now() - started2;
      if (res.ok) ok("warm inspection", `${ms}ms round trip`);
      else bad("warm inspection", `HTTP ${res.status}`);
    } catch (err) {
      bad("warm inspection", err.message);
    }
  }
} else {
  section("7. Real inference — SKIPPED");
  console.log("  Pass an API key to test actual inference:");
  console.log("    node scripts/smoke-production.mjs <url> zi_live_...");
}

console.log(`\n${"─".repeat(56)}`);
console.log(`${pass} passed, ${fail} failed`);
if (fail) {
  console.log("\nFailures:");
  failures.forEach((f) => console.log(`  • ${f}`));
  process.exit(1);
}
console.log("\nAll checks passed.");
