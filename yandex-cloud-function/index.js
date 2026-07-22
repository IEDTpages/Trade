"use strict";

const COMTRADE = "https://comtradeapi.un.org";
const SAFE_LIST = /^[0-9A-Z,._-]+$/i;
const MAX_RECORDS = "2000";
const UPSTREAM_TIMEOUT_MS = 40000;
const ALLOWED_PARAMS = new Set([
  "period", "reporterCode", "flowCode", "partnerCode", "partner2Code",
  "cmdCode", "customsCode", "motCode", "aggregateBy", "breakdownMode",
]);

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Accept",
    "Access-Control-Max-Age": "86400",
  };
}

function response(statusCode, payload) {
  return {
    statusCode,
    headers: {
      ...corsHeaders(),
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
    body: payload === null ? "" : JSON.stringify(payload),
    isBase64Encoded: false,
  };
}

function parseBody(event) {
  if (event.body && typeof event.body === "object") return event.body;
  const raw = event.isBase64Encoded
    ? Buffer.from(String(event.body || ""), "base64").toString("utf8")
    : String(event.body || "");
  return JSON.parse(raw);
}

module.exports.handler = async function handler(event) {
  const method = String(event.httpMethod || event.requestContext?.http?.method || "GET").toUpperCase();

  if (method === "OPTIONS") return response(204, null);
  if (method === "GET") {
    return response(200, {
      ok: true,
      service: "UN Comtrade proxy",
      maxRecords: Number(MAX_RECORDS),
    });
  }
  if (method !== "POST") return response(405, { error: "Поддерживаются только POST и OPTIONS." });

  let body;
  try { body = parseBody(event); }
  catch { return response(400, { error: "Некорректное тело запроса." }); }

  const { mode, freq } = body;
  const key = String(body.subscriptionKey || "").trim();
  if (!["availability", "count", "data"].includes(mode)) {
    return response(400, { error: "Неизвестный режим запроса." });
  }
  if (freq !== "A" && freq !== "M") {
    return response(400, { error: "Частота должна быть A или M." });
  }

  const params = new URLSearchParams();
  for (const [name, rawValue] of Object.entries(body.params || {})) {
    if (!ALLOWED_PARAMS.has(name)) continue;
    const value = String(rawValue).trim();
    if (!value || !SAFE_LIST.test(value)) {
      return response(400, { error: `Недопустимое значение параметра ${name}.` });
    }
    params.set(name === "reporterCode" ? "reportercode" : name, value);
  }

  const authenticated = key.length > 0;
  let path;
  if (mode === "availability") {
    path = `/${authenticated ? "data" : "public"}/v1/getDa/C/${freq}/HS`;
  } else {
    path = authenticated ? `/data/v1/get/C/${freq}/HS` : `/public/v1/preview/C/${freq}/HS`;
    params.set("format", "JSON");
    params.set("includeDesc", "true");
    if (mode === "count") params.set("countOnly", "true");
    else params.set("maxRecords", authenticated ? MAX_RECORDS : "500");
  }
  if (authenticated) params.set("subscription-key", key);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    const upstream = await fetch(`${COMTRADE}${path}?${params}`, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    const raw = await upstream.text();
    let payload;
    try { payload = JSON.parse(raw); }
    catch { payload = { error: raw || `UN Comtrade вернул HTTP ${upstream.status}.` }; }
    return response(upstream.status, payload);
  } catch (error) {
    const timedOut = error && error.name === "AbortError";
    return response(timedOut ? 504 : 502, {
      error: timedOut
        ? "UN Comtrade не ответил функции за 40 секунд."
        : `UN Comtrade недоступен: ${error instanceof Error ? error.message : "ошибка сети"}`,
    });
  } finally {
    clearTimeout(timer);
  }
};
