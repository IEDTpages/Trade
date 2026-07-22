const assert = require("node:assert/strict");
const test = require("node:test");
const { handler } = require("../yandex-cloud-function/index.js");

test("preflight is accepted from GitHub Pages", async () => {
  const result = await handler({
    httpMethod: "OPTIONS",
    headers: {
      origin: "https://username.github.io",
      "access-control-request-method": "POST",
    },
  });
  assert.equal(result.statusCode, 204);
  assert.equal(result.headers["Access-Control-Allow-Origin"], "*");
  assert.match(result.headers["Access-Control-Allow-Methods"], /POST/);
});

test("health check includes CORS and queue limit", async () => {
  const result = await handler({ httpMethod: "GET" });
  assert.equal(result.statusCode, 200);
  assert.equal(result.headers["Access-Control-Allow-Origin"], "*");
  assert.deepEqual(JSON.parse(result.body), {
    ok: true,
    service: "UN Comtrade proxy",
    maxRecords: 15000,
  });
});

test("invalid POST is rejected with CORS", async () => {
  const result = await handler({ httpMethod: "POST", body: "{" });
  assert.equal(result.statusCode, 400);
  assert.equal(result.headers["Access-Control-Allow-Origin"], "*");
});

test("data request is forwarded to the official API with the serverless limit", async () => {
  const originalFetch = global.fetch;
  let requestedUrl = "";
  global.fetch = async (url) => {
    requestedUrl = String(url);
    return new Response(JSON.stringify({ data: [{ period: "2025" }] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  try {
    const result = await handler({
      httpMethod: "POST",
      body: JSON.stringify({
        mode: "data",
        freq: "A",
        subscriptionKey: "test-key",
        params: {
          period: "2025",
          reporterCode: "643",
          flowCode: "X",
          partnerCode: "0",
          cmdCode: "TOTAL",
        },
      }),
    });
    assert.equal(result.statusCode, 200);
    assert.match(requestedUrl, /^https:\/\/comtradeapi\.un\.org\/data\/v1\/get\/C\/A\/HS\?/);
    assert.match(requestedUrl, /reportercode=643/);
    assert.match(requestedUrl, /maxRecords=15000/);
    assert.match(requestedUrl, /subscription-key=test-key/);
  } finally {
    global.fetch = originalFetch;
  }
});
