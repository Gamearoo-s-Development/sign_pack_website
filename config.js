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
};

const discord = {
  clientId: pick("DISCORD_CLIENT_ID", local.discord && local.discord.clientId),
  clientSecret: pick("DISCORD_CLIENT_SECRET", local.discord && local.discord.clientSecret),
};

if (!dburl) {
  throw new Error(
    "Missing MONGODB_URI. Copy .env.example to .env, set variables, or add config.local.js (see README)."
  );
}

module.exports = { dburl, email, domain, discord };
