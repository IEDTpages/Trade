import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { createApp, loadConfig } from "../src/app.js";

const servers = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))));
});

async function start(fetchImpl, overrides = {}) {
  const config = {
    ...loadConfig({}),
    port: 0,
    requestIntervalMs: 40,
    upstreamTimeoutMs: 2_000,
    maxRetries: 1,
    cacheTtlMs: 60_000,
    ...overrides,
  };
  const app = createApp({ config, fetchImpl });
  const server = app.listen(0, "127.0.0.1");
  servers.push(server);
  await new Promise((resolve) => server.once("listening", resolve));
  return `http://127.0.0.1:${server.address().port}`;
}

function requestBody(mode = "data") {
  return {
    mode,
    freq: "A",
    params: {
      period: "2024",
      reporterCode: "643",
      partnerCode: "0",
      flowCode: "X",
      cmdCode: "TOTAL",
    },
    subscriptionKey: "test-key",
  };
}

test("health and preflight include permissive CORS headers", async () => {
  const base = await start(async () => new Response("{}"));
  const health = await fetch(`${base}/health`);
  assert.equal(health.status, 200);
  assert.equal((await health.json()).maxRecords, 50_000);

  const preflight = await fetch(`${base}/api/comtrade`, {
    method: "OPTIONS",
    headers: { Origin: "https://example.github.io" },
  });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get("access-control-allow-origin"), "*");
});

test("alwaysdata IP environment variable is used as the listening address", () => {
  const config = loadConfig({ IP: "::1", HOST: "127.0.0.1", PORT: "8080" });
  assert.equal(config.host, "::1");
  assert.equal(config.port, 8080);
});

test("authenticated data request uses maxRecords=50000 and never exposes the key", async () => {
  let requestedUrl = "";
  const base = await start(async (url) => {
    requestedUrl = String(url);
    const body = JSON.stringify({ data: [{ period: "2024" }] });
    return new Response(body, {
      status: 200,
      headers: { "Content-Type": "application/json", "Content-Length": String(Buffer.byteLength(body)) },
    });
  });

  const response = await fetch(`${base}/api/comtrade`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(requestBody()),
  });
  assert.equal(response.status, 200);
  assert.match(requestedUrl, /maxRecords=50000/);
  assert.match(requestedUrl, /subscription-key=test-key/);
  assert.doesNotMatch(JSON.stringify(await response.json()), /test-key/);
});

test("global queue starts upstream requests no faster than configured interval", async () => {
  const starts = [];
  const base = await start(async () => {
    starts.push(Date.now());
    const body = JSON.stringify({ count: 1 });
    return new Response(body, {
      status: 200,
      headers: { "Content-Type": "application/json", "Content-Length": String(Buffer.byteLength(body)) },
    });
  });

  await Promise.all([
    fetch(`${base}/api/comtrade`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody("count")),
    }),
    fetch(`${base}/api/comtrade`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...requestBody("count"), params: { ...requestBody("count").params, period: "2023" } }),
    }),
  ]);

  assert.equal(starts.length, 2);
  assert.ok(starts[1] - starts[0] >= 35, `interval was only ${starts[1] - starts[0]} ms`);
});

test("429 is retried by the backend before returning the successful response", async () => {
  let calls = 0;
  const base = await start(async () => {
    calls += 1;
    if (calls === 1) {
      return new Response(JSON.stringify({ error: "Rate limit is exceeded" }), {
        status: 429,
        headers: { "Content-Type": "application/json", "Retry-After": "0" },
      });
    }
    return new Response(JSON.stringify({ count: 7 }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });

  const response = await fetch(`${base}/api/comtrade`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(requestBody("count")),
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { count: 7 });
  assert.equal(calls, 2);
});

test("successful small responses are reused from cache without another upstream call", async () => {
  let calls = 0;
  const base = await start(async () => {
    calls += 1;
    return new Response(JSON.stringify({ count: 12 }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });
  const options = {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(requestBody("count")),
  };

  const first = await fetch(`${base}/api/comtrade`, options);
  const second = await fetch(`${base}/api/comtrade`, options);
  assert.equal(first.headers.get("x-proxy-cache"), "MISS");
  assert.equal(second.headers.get("x-proxy-cache"), "HIT");
  assert.equal(calls, 1);
});

test("large data responses bypass the in-memory cache and stream intact", async () => {
  const body = JSON.stringify({ data: [{ payload: "x".repeat(32_000) }] });
  const base = await start(async () => new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Content-Length": String(Buffer.byteLength(body)),
    },
  }), {
    cacheMaxEntryBytes: 1_024,
  });

  const response = await fetch(`${base}/api/comtrade`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(requestBody("data")),
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-proxy-cache"), "BYPASS");
  assert.equal(await response.text(), body);
});

test("cache total size stays inside the free-hosting memory budget", async () => {
  let calls = 0;
  const base = await start(async (url) => {
    calls += 1;
    const period = new URL(String(url)).searchParams.get("period");
    const body = JSON.stringify({ data: [{ period, payload: "x".repeat(700) }] });
    return new Response(body, {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Content-Length": String(Buffer.byteLength(body)),
      },
    });
  }, {
    cacheMaxEntryBytes: 2_048,
    cacheMaxTotalBytes: 1_200,
    cacheMaxEntries: 10,
  });

  for (const period of ["2022", "2023", "2024"]) {
    await fetch(`${base}/api/comtrade`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...requestBody(),
        params: { ...requestBody().params, period },
      }),
    });
  }

  const health = await fetch(`${base}/health`).then((response) => response.json());
  assert.ok(health.cacheBytes <= 1_200);
  assert.ok(health.cacheEntries < 3);
  assert.equal(calls, 3);
});
