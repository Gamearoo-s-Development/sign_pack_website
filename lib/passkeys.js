const {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} = require("@simplewebauthn/server");
const { isoBase64URL } = require("@simplewebauthn/server/helpers");

const PASSKEY_DEBUG =
  process.env.PASSKEY_DEBUG === "1" ||
  process.env.PASSKEY_DEBUG === "true" ||
  process.env.AUTH_DEBUG === "1" ||
  process.env.AUTH_DEBUG === "true";

function passkeyDebug(label, meta) {
  if (!PASSKEY_DEBUG) return;
  console.debug("[passkey]", label, meta);
}

/**
 * Canonical base64url string for credential IDs (storage + lookup).
 */
function normalizeCredentialId(value) {
  if (value == null || value === "") return "";

  if (value instanceof Uint8Array || Buffer.isBuffer(value)) {
    return isoBase64URL.fromBuffer(value);
  }

  if (typeof value === "object" && value.type === "Buffer" && Array.isArray(value.data)) {
    return isoBase64URL.fromBuffer(Buffer.from(value.data));
  }

  const str = String(value).trim();
  if (!str) return "";

  try {
    if (isoBase64URL.isBase64URL(str)) {
      return isoBase64URL.fromBuffer(isoBase64URL.toBuffer(str));
    }
  } catch (_err) {
    /* try base64 fallback */
  }

  try {
    const b64 = str.replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
    const buf = Buffer.from(padded, "base64");
    if (buf.length) return isoBase64URL.fromBuffer(buf);
  } catch (_err) {
    /* ignore */
  }

  return str.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function credentialIdsEqual(a, b) {
  const na = normalizeCredentialId(a);
  const nb = normalizeCredentialId(b);
  return Boolean(na && nb && na === nb);
}

function toBuffer(base64url) {
  const normalized = normalizeCredentialId(base64url);
  if (!normalized) return Buffer.alloc(0);
  return isoBase64URL.toBuffer(normalized);
}

function toBase64Url(buf) {
  if (!buf) return "";
  return normalizeCredentialId(buf);
}

function credentialIdFromAuthBody(body) {
  if (!body || typeof body !== "object") return "";
  return normalizeCredentialId(body.id ?? body.rawId);
}

function publicPasskey(passkey) {
  return {
    credentialID: normalizeCredentialId(passkey.credentialID),
    transports: Array.isArray(passkey.transports) ? passkey.transports : [],
    name: passkey.name || "Passkey",
    createdAt: passkey.createdAt || null,
    lastUsedAt: passkey.lastUsedAt || null,
  };
}

function saveSession(req) {
  return new Promise((resolve, reject) => {
    if (!req.session) return resolve();
    req.session.save((err) => (err ? reject(err) : resolve()));
  });
}

async function registrationOptions(user, webauthn) {
  const excludeCredentials = Array.isArray(user.passkeys)
    ? user.passkeys.map((p) => ({
        id: toBuffer(p.credentialID),
        type: "public-key",
        transports: Array.isArray(p.transports) ? p.transports : [],
      }))
    : [];

  return generateRegistrationOptions({
    rpName: webauthn.rpName,
    rpID: webauthn.rpID,
    userName: String(user._id),
    userDisplayName: String(user.displayName || user.name || user._id),
    userID: Buffer.from(String(user._id)),
    timeout: 60000,
    attestationType: "none",
    authenticatorSelection: {
      residentKey: "preferred",
      userVerification: "preferred",
    },
    excludeCredentials,
  });
}

async function verifyRegistration(credential, expectedChallenge, webauthn) {
  return verifyRegistrationResponse({
    response: credential,
    expectedChallenge,
    expectedOrigin: webauthn.origin,
    expectedRPID: webauthn.rpID,
    requireUserVerification: false,
  });
}

async function authenticationOptions(allowCredentialIDs, webauthn) {
  const allowCredentials = Array.isArray(allowCredentialIDs)
    ? allowCredentialIDs
        .map((id) => normalizeCredentialId(id))
        .filter(Boolean)
        .map((id) => ({
          id: isoBase64URL.toBuffer(id),
          type: "public-key",
        }))
    : [];

  return generateAuthenticationOptions({
    rpID: webauthn.rpID,
    timeout: 60000,
    userVerification: "preferred",
    allowCredentials,
  });
}

async function verifyAuthentication(credential, expectedChallenge, authenticator, webauthn) {
  return verifyAuthenticationResponse({
    response: credential,
    expectedChallenge,
    expectedOrigin: webauthn.origin,
    expectedRPID: webauthn.rpID,
    authenticator,
    requireUserVerification: false,
  });
}

function authenticatorFromPasskey(passkey) {
  return {
    credentialID: toBuffer(passkey.credentialID),
    credentialPublicKey: toBuffer(passkey.credentialPublicKey),
    counter: Number(passkey.counter || 0),
    transports: Array.isArray(passkey.transports) ? passkey.transports : [],
  };
}

module.exports = {
  PASSKEY_DEBUG,
  passkeyDebug,
  normalizeCredentialId,
  credentialIdsEqual,
  credentialIdFromAuthBody,
  toBase64Url,
  toBuffer,
  publicPasskey,
  saveSession,
  registrationOptions,
  verifyRegistration,
  authenticationOptions,
  verifyAuthentication,
  authenticatorFromPasskey,
};
