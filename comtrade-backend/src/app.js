import crypto from "node:crypto";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import express from "express";

const SAFE_LIST = /^[0-9A-Z,._-]+$/i;
const ALLOWED_PARAMS = new Set([
  "period",
  "reporterCode",
  "flowCode",
  "partnerCode",
  "partner2Code",
  "cmdCode",
  "customsCode",
  "motCode",
  "aggregateBy",
  "breakdownMode",
]);
const RETRYABLE_STATUSES = new Set([429, 502, 503, 504]);

function positiveInteger(value, fallback, maximum = Number.MAX_SAFE_INTEGER) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, maximum) : fallback;
}

export function loadConfig(env = process.env) {
  return {
    host: env.HOST || "0.0.0.0",
    port: positiveInteger(env.PORT, 3000, 65_535),
    comtradeBaseUrl: (env.COMTRADE_BASE_URL || "https://comtradeapi.un.org").replace(/\/+$/, ""),
    maxRecords: positiveInteger(env.MAX_RECORDS, 50_000, 100_000),
    requestIntervalMs: positiveInteger(env.REQUEST_INTERVAL_MS, 1_100, 60_000),
    upstreamTimeoutMs: positiveInteger(env.UPSTREAM_TIMEOUT_MS, 180_000, 900_000),
    maxRetries: positiveInteger(env.MAX_RETRIES, 3, 8),
    cacheTtlMs: positiveInteger(env.CACHE_TTL_MS, 21_600_000, 86_400_000),
    cacheMaxEntries: positiveInteger(env.CACHE_MAX_ENTRIES, 100, 5_000),
    cacheMaxEntryBytes: positiveInteger(env.CACHE_MAX_ENTRY_BYTES, 26_214_400, 104_857_600),
    allowedOrigins: env.ALLOWED_ORIGINS || "*",
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRetryAfter(value) {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1_000;
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : null;
}

class MemoryCache {
  constructor({ ttlMs, maxEntries, maxEntryBytes }) {
    this.ttlMs = ttlMs;
    this.maxEntries = maxEntries;
    this.maxEntryBytes = maxEntryBytes;
    this.entries = new Map();
  }

  get(key) {
    const item = this.entries.get(key);
    if (!item) return null;
    if (item.expiresAt <= Date.now()) {
      this.entries.delete(key);
      return null;
    }
    this.entries.delete(key);
    this.entries.set(key, item);
    return item;
  }

  set(key, item) {
    if (!item.body || item.body.byteLength > this.maxEntryBytes) return;
    this.entries.delete(key);
    this.entries.set(key, { ...item, expiresAt: Date.now() + this.ttlMs });
    while (this.entries.size > this.maxEntries) {
      this.entries.delete(this.entries.keys().next().value);
    }
  }

  get size() {
    return this.entries.size;
  }
}

function createQueue(intervalMs) {
  let tail = Promise.resolve();
  let pending = 0;
  let lastRequestStartedAt = 0;

  async function waitForRequestSlot() {
    const elapsed = Date.now() - lastRequestStartedAt;
    const delay = Math.max(0, intervalMs - elapsed);
    if (delay > 0) await sleep(delay);
    lastRequestStartedAt = Date.now();
  }

  function enqueue(job) {
    pending += 1;
    const queuedAt = Date.now();
    const result = tail.then(
      () => job({ waitForRequestSlot, queuedAt }),
      () => job({ waitForRequestSlot, queuedAt }),
    );
    tail = result.catch(() => undefined).finally(() => {
      pending -= 1;
    });
    return result;
  }

  return {
    enqueue,
    get pending() {
      return pending;
    },
  };
}

function createCorsPolicy(rawAllowedOrigins) {
  const allowAll = rawAllowedOrigins.trim() === "*";
  const allowed = new Set(
    rawAllowedOrigins
      .split(",")
      .map((value) => value.trim().replace(/\/+$/, ""))
      .filter(Boolean),
  );

  return function corsPolicy(req, res, next) {
    const origin = req.get("Origin");
    if (allowAll) {
      res.set("Access-Control-Allow-Origin", "*");
    } else if (origin && allowed.has(origin.replace(/\/+$/, ""))) {
      res.set("Access-Control-Allow-Origin", origin);
      res.set("Vary", "Origin");
    }
    res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type, Accept");
    res.set("Access-Control-Max-Age", "86400");
    if (req.method === "OPTIONS") {
      if (!allowAll && origin && !allowed.has(origin.replace(/\/+$/, ""))) {
        return res.status(403).json({ error: "Этот Origin не разрешён настройками прокси." });
      }
      return res.status(204).end();
    }
    return next();
  };
}

function parseRequest(body, config) {
  const mode = String(body?.mode || "");
  const freq = String(body?.freq || "");
  const subscriptionKey = String(body?.subscriptionKey || "").trim();

  if (!["availability", "count", "data"].includes(mode)) {
    throw Object.assign(new Error("Неизвестный режим запроса."), { status: 400 });
  }
  if (!["A", "M"].includes(freq)) {
    throw Object.assign(new Error("Частота должна быть A или M."), { status: 400 });
  }

  const params = new URLSearchParams();
  for (const [name, rawValue] of Object.entries(body?.params || {})) {
    if (!ALLOWED_PARAMS.has(name)) continue;
    const value = String(rawValue).trim();
    if (!value || !SAFE_LIST.test(value)) {
      throw Object.assign(new Error(`Недопустимое значение параметра ${name}.`), { status: 400 });
    }
    params.set(name === "reporterCode" ? "reportercode" : name, value);
  }

  const authenticated = subscriptionKey.length > 0;
  let path;
  if (mode === "availability") {
    path = `/${authenticated ? "data" : "public"}/v1/getDa/C/${freq}/HS`;
  } else {
    path = authenticated ? `/data/v1/get/C/${freq}/HS` : `/public/v1/preview/C/${freq}/HS`;
    params.set("format", "JSON");
    params.set("includeDesc", "true");
    if (mode === "count") params.set("countOnly", "true");
    else params.set("maxRecords", authenticated ? String(config.maxRecords) : "500");
  }
  if (authenticated) params.set("subscription-key", subscriptionKey);

  const publicParams = new URLSearchParams(params);
  publicParams.delete("subscription-key");
  const cacheKey = crypto
    .createHash("sha256")
    .update(JSON.stringify({ mode, freq, authenticated, params: publicParams.toString() }))
    .digest("hex");

  return {
    mode,
    url: `${config.comtradeBaseUrl}${path}?${params}`,
    cacheKey,
  };
}

async function fetchWithRetries({ url, fetchImpl, config, waitForRequestSlot, signal }) {
  let lastResponse = null;
  for (let attempt = 0; attempt <= config.maxRetries; attempt += 1) {
    await waitForRequestSlot();
    const controller = new AbortController();
    const onAbort = () => controller.abort(signal?.reason);
    if (signal) signal.addEventListener("abort", onAbort, { once: true });
    const timer = setTimeout(() => controller.abort(new Error("upstream timeout")), config.upstreamTimeoutMs);

    try {
      const response = await fetchImpl(url, {
        headers: { Accept: "application/json" },
        signal: controller.signal,
      });
      lastResponse = response;
      if (!RETRYABLE_STATUSES.has(response.status) || attempt === config.maxRetries) {
        return response;
      }
      await response.arrayBuffer().catch(() => undefined);
      const retryAfter = parseRetryAfter(response.headers.get("retry-after"));
      const fallback = [5_000, 15_000, 30_000, 60_000][attempt] ?? 60_000;
      await sleep(Math.min(retryAfter ?? fallback, 120_000));
    } catch (error) {
      if (signal?.aborted) throw error;
      if (attempt === config.maxRetries) throw error;
      const fallback = [5_000, 15_000, 30_000, 60_000][attempt] ?? 60_000;
      await sleep(fallback);
    } finally {
      clearTimeout(timer);
      if (signal) signal.removeEventListener("abort", onAbort);
    }
  }
  return lastResponse;
}

function setResponseHeaders(res, { status, contentType, cacheStatus, queuedAt }) {
  res.status(status);
  res.set("Content-Type", contentType || "application/json; charset=utf-8");
  res.set("Cache-Control", "no-store");
  res.set("X-Proxy-Cache", cacheStatus);
  res.set("X-Queue-Wait-Ms", String(Math.max(0, Date.now() - queuedAt)));
}

export function createApp(options = {}) {
  const config = options.config || loadConfig();
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const cache = new MemoryCache({
    ttlMs: config.cacheTtlMs,
    maxEntries: config.cacheMaxEntries,
    maxEntryBytes: config.cacheMaxEntryBytes,
  });
  const queue = createQueue(config.requestIntervalMs);
  const app = express();

  app.disable("x-powered-by");
  app.use(createCorsPolicy(config.allowedOrigins));
  app.use(express.json({ limit: "256kb" }));

  const health = (_req, res) => {
    res.json({
      ok: true,
      service: "UN Comtrade proxy",
      maxRecords: config.maxRecords,
      requestIntervalMs: config.requestIntervalMs,
      queuePending: queue.pending,
      cacheEntries: cache.size,
    });
  };

  app.get("/", health);
  app.get("/health", health);
  app.get("/api/comtrade", health);

  app.post("/api/comtrade", async (req, res) => {
    let parsed;
    try {
      parsed = parseRequest(req.body, config);
    } catch (error) {
      return res.status(error.status || 400).json({ error: error.message });
    }

    const cached = cache.get(parsed.cacheKey);
    if (cached) {
      setResponseHeaders(res, {
        status: cached.status,
        contentType: cached.contentType,
        cacheStatus: "HIT",
        queuedAt: Date.now(),
      });
      return res.send(cached.body);
    }

    const disconnectController = new AbortController();
    res.on("close", () => {
      if (!res.writableEnded) disconnectController.abort(new Error("client disconnected"));
    });

    try {
      await queue.enqueue(async ({ waitForRequestSlot, queuedAt }) => {
        if (disconnectController.signal.aborted) return;
        const upstream = await fetchWithRetries({
          url: parsed.url,
          fetchImpl,
          config,
          waitForRequestSlot,
          signal: disconnectController.signal,
        });
        if (!upstream) throw new Error("UN Comtrade не вернул ответ.");

        const contentType = upstream.headers.get("content-type") || "application/json; charset=utf-8";
        const contentLength = Number(upstream.headers.get("content-length") || 0);
        const shouldBuffer = parsed.mode !== "data"
          || (contentLength > 0 && contentLength <= config.cacheMaxEntryBytes);

        if (shouldBuffer) {
          const body = Buffer.from(await upstream.arrayBuffer());
          if (upstream.ok) {
            cache.set(parsed.cacheKey, { status: upstream.status, contentType, body });
          }
          setResponseHeaders(res, {
            status: upstream.status,
            contentType,
            cacheStatus: "MISS",
            queuedAt,
          });
          res.send(body);
          return;
        }

        setResponseHeaders(res, {
          status: upstream.status,
          contentType,
          cacheStatus: "BYPASS",
          queuedAt,
        });
        if (!upstream.body) {
          res.end();
          return;
        }
        await pipeline(Readable.fromWeb(upstream.body), res);
      });
    } catch (error) {
      if (res.headersSent || disconnectController.signal.aborted) return;
      const timedOut = error?.name === "AbortError"
        || String(error?.message || "").toLowerCase().includes("timeout");
      res.status(timedOut ? 504 : 502).json({
        error: timedOut
          ? `UN Comtrade не ответил за ${Math.round(config.upstreamTimeoutMs / 1_000)} секунд.`
          : `UN Comtrade недоступен: ${error instanceof Error ? error.message : "ошибка сети"}`,
      });
    }
  });

  // Express recognises an error handler by its four-argument signature.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((error, _req, res, _next) => {
    if (error?.type === "entity.too.large") {
      return res.status(413).json({ error: "Тело запроса слишком велико." });
    }
    if (error instanceof SyntaxError) {
      return res.status(400).json({ error: "Некорректный JSON." });
    }
    return res.status(500).json({ error: "Внутренняя ошибка прокси." });
  });

  return app;
}
