require("dotenv").config();

function loadLocal() {
  try {
    return require("./config.local");
  } catch (err) {
    if (err.code === "MODULE_NOT_FOUND") return {};
    throw err;
  }
}

const local = loadLocal();

function pick(envKey, legacyValue) {
  const fromEnv = process.env[envKey];
  if (fromEnv !== undefined && fromEnv !== "") return fromEnv;
  if (legacyValue !== undefined && legacyValue !== "") return legacyValue;
  return undefined;
}

const dburl = pick("MONGODB_URI", local.dburl);
const domain = pick("APP_DOMAIN", local.domain);

const email = {
  host: pick("SMTP_HOST", local.email && local.email.host),
  port: Number(pick("SMTP_PORT", local.email && local.email.port) || 587),
  user: pick("SMTP_USER", local.email && local.email.user),
  pass: pick("SMTP_PASS", local.email && local.email.pass),
  from: pick("SMTP_FROM", local.email && local.email.from),
};

const discord = {
  clientId: pick("DISCORD_CLIENT_ID", local.discord && local.discord.clientId),
  clientSecret: pick("DISCORD_CLIENT_SECRET", local.discord && local.discord.clientSecret),
};

const supportEmail =
  pick("SUPPORT_EMAIL", local.supportEmail) || "support@gamearoo.dev";

function envBool(key, legacy) {
  const raw = pick(key, legacy);
  if (raw === undefined || raw === "") return false;
  return raw === "true" || raw === "1";
}

// ramAi.apiKey is server-only — never pass to EJS, static JS, or API responses.
const ramAi = {
  enabled: envBool("RAM_AI_ENABLED", local.ramAi && local.ramAi.enabled),
  baseUrl:
    pick("RAM_AI_BASE_URL", local.ramAi && local.ramAi.baseUrl) ||
    "https://ai.rambot.xyz",
  apiKey: pick("RAM_AI_API_KEY", local.ramAi && local.ramAi.apiKey),
  defaultModel:
    pick("RAM_AI_DEFAULT_MODEL", local.ramAi && local.ramAi.defaultModel) ||
    "Ram AI Code Agent 1.0 - fast",
  allowedModels: (function () {
    const raw = pick("RAM_AI_ALLOWED_MODELS", local.ramAi && local.ramAi.allowedModels);
    if (!raw) return null;
    return String(raw)
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  })(),
  // Optional legacy: direct upstream model id for default (server-only).
  legacyModelId: pick("RAM_AI_MODEL", local.ramAi && local.ramAi.model) || undefined,
  timeoutMs: (function () {
    const raw = pick("RAM_AI_TIMEOUT_MS", local.ramAi && local.ramAi.timeoutMs);
    if (raw === "0" || raw === 0) return 0;
    const n = Number(raw || 600000);
    if (!Number.isFinite(n) || n <= 0) return 600000;
    return Math.min(Math.max(n, 15000), 600000);
  })(),
  statusPollMs: Math.min(
    Math.max(
      Number(pick("RAM_AI_STATUS_POLL_MS", local.ramAi && local.ramAi.statusPollMs)) || 5000,
      5000
    ),
    10000
  ),
  statusCacheTtlMs: Math.min(
    Math.max(
      Number(pick("RAM_AI_STATUS_CACHE_MS", local.ramAi && local.ramAi.statusCacheTtlMs)) || 3000,
      2000
    ),
    10000
  ),
  statusRateLimitMax: Math.min(
    Math.max(
      Number(pick("RAM_AI_STATUS_RATE_LIMIT_MAX", local.ramAi && local.ramAi.statusRateLimitMax)) ||
        45,
      20
    ),
    120
  ),
  rateLimitMax: Number(
    pick("RAM_AI_RATE_LIMIT_MAX", local.ramAi && local.ramAi.rateLimitMax) || 20
  ),
  rateLimitWindowMs: Number(
    pick("RAM_AI_RATE_LIMIT_WINDOW_MS", local.ramAi && local.ramAi.rateLimitWindowMs) ||
      60000
  ),
  debug: envBool("RAM_AI_DEBUG", local.ramAi && local.ramAi.debug),
};

function normalizeOrigin(raw) {
  if (!raw) return undefined;
  try {
    return new URL(raw).origin;
  } catch (_err) {
    return undefined;
  }
}

const webauthnOrigin =
  normalizeOrigin(pick("WEBAUTHN_ORIGIN", local.webauthn && local.webauthn.origin)) ||
  normalizeOrigin(domain) ||
  "http://localhost:8090";

const webauthn = {
  rpName:
    pick("WEBAUTHN_RP_NAME", local.webauthn && local.webauthn.rpName) ||
    "Signpack Maker",
  rpID:
    pick("WEBAUTHN_RP_ID", local.webauthn && local.webauthn.rpID) ||
    (function () {
      try {
        return new URL(webauthnOrigin).hostname;
      } catch (_err) {
        return "localhost";
      }
    })(),
  origin: webauthnOrigin,
};

if (!dburl) {
  throw new Error(
    "Missing MONGODB_URI. Copy .env.example to .env, set variables, or add config.local.js (see README)."
  );
}

module.exports = { dburl, email, domain, discord, supportEmail, ramAi, webauthn };
