const COMTRADE = "https://comtradeapi.un.org";
const SAFE_LIST = /^[0-9A-Z,._-]+$/i;
const ALLOWED_PARAMS = new Set([
  "period", "reporterCode", "flowCode", "partnerCode", "partner2Code",
  "cmdCode", "customsCode", "motCode", "aggregateBy", "breakdownMode",
]);

function corsHeaders(request, env) {
  const origin = request.headers.get("Origin") || "";
  const configured = String(env.ALLOWED_ORIGINS || "*")
    .split(",").map((value) => value.trim()).filter(Boolean);
  const allowAny = configured.includes("*");
  const allowed = allowAny || configured.includes(origin);
  return {
    "Access-Control-Allow-Origin": allowed ? (allowAny ? "*" : origin) : "null",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Accept",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

function json(request, env, payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...corsHeaders(request, env),
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const cors = corsHeaders(request, env);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (url.pathname !== "/api/comtrade" || request.method !== "POST") {
      return json(request, env, { error: "Маршрут не найден." }, 404);
    }
    if (cors["Access-Control-Allow-Origin"] === "null") {
      return json(request, env, { error: "Источник запроса не разрешён." }, 403);
    }

    let body;
    try { body = await request.json(); }
    catch { return json(request, env, { error: "Некорректное тело запроса." }, 400); }

    const { mode, freq } = body;
    const key = String(body.subscriptionKey || "").trim();
    if (!["availability", "count", "data"].includes(mode)) {
      return json(request, env, { error: "Неизвестный режим запроса." }, 400);
    }
    if (freq !== "A" && freq !== "M") {
      return json(request, env, { error: "Частота должна быть A или M." }, 400);
    }

    const params = new URLSearchParams();
    for (const [name, rawValue] of Object.entries(body.params || {})) {
      if (!ALLOWED_PARAMS.has(name)) continue;
      const value = String(rawValue).trim();
      if (!value || !SAFE_LIST.test(value)) {
        return json(request, env, { error: `Недопустимое значение параметра ${name}.` }, 400);
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
      else params.set("maxRecords", authenticated ? "100000" : "500");
    }
    if (authenticated) params.set("subscription-key", key);

    try {
      const upstream = await fetch(`${COMTRADE}${path}?${params}`, {
        headers: { Accept: "application/json" },
      });
      const raw = await upstream.text();
      let payload;
      try { payload = JSON.parse(raw); }
      catch { payload = { error: raw || `UN Comtrade вернул HTTP ${upstream.status}.` }; }
      return json(request, env, payload, upstream.status);
    } catch (error) {
      return json(request, env, {
        error: `UN Comtrade недоступен: ${error instanceof Error ? error.message : "ошибка сети"}`,
      }, 502);
    }
  },
};
