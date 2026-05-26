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

function normalizePublicKey(value) {
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
    /* fall through */
  }

  try {
    const b64 = str.replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
    const buf = Buffer.from(padded, "base64");
    if (buf.length) return isoBase64URL.fromBuffer(buf);
  } catch (_err) {
    /* ignore */
  }

  return "";
}

function isStoredPasskeyValid(passkey) {
  if (!passkey || typeof passkey !== "object") return false;
  const id = normalizeCredentialId(passkey.credentialID);
  const publicKey = normalizePublicKey(passkey.credentialPublicKey);
  if (!id || !publicKey) return false;
  try {
    const buf = isoBase64URL.toBuffer(publicKey);
    return buf.length > 0;
  } catch (_err) {
    return false;
  }
}

function passkeyNeedsReregister(passkey) {
  return !isStoredPasskeyValid(passkey);
}

/**
 * @simplewebauthn/server v13+ WebAuthnCredential shape for verifyAuthenticationResponse.
 */
function webAuthnCredentialFromPasskey(passkey) {
  if (!isStoredPasskeyValid(passkey)) {
    return null;
  }

  const id = normalizeCredentialId(passkey.credentialID);
  const publicKeyStr = normalizePublicKey(passkey.credentialPublicKey);
  let counter = Number(passkey.counter);
  if (!Number.isFinite(counter) || counter < 0) {
    if (PASSKEY_DEBUG) {
      console.debug("[passkey] counter missing/invalid, defaulting to 0", {
        counterType: typeof passkey.counter,
      });
    }
    counter = 0;
  }

  let publicKey;
  try {
    publicKey = new Uint8Array(isoBase64URL.toBuffer(publicKeyStr));
  } catch (_err) {
    return null;
  }

  if (!publicKey.length) return null;

  return {
    id,
    publicKey,
    counter,
    transports: Array.isArray(passkey.transports) ? passkey.transports : [],
  };
}

function publicPasskey(passkey) {
  const needsReregister = passkeyNeedsReregister(passkey);
  return {
    credentialID: normalizeCredentialId(passkey.credentialID),
    transports: Array.isArray(passkey.transports) ? passkey.transports : [],
    name: passkey.name || "Passkey",
    createdAt: passkey.createdAt || null,
    lastUsedAt: passkey.lastUsedAt || null,
    needsReregister,
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

async function verifyAuthentication(response, expectedChallenge, storedPasskey, webauthn) {
  const credential = webAuthnCredentialFromPasskey(storedPasskey);
  if (!credential) {
    const err = new Error("Invalid stored passkey record");
    err.code = "INVALID_STORED_PASSKEY";
    throw err;
  }

  passkeyDebug("verifyAuthenticationResponse", {
    idLen: credential.id.length,
    idPrefix: credential.id.slice(0, 8),
    counter: credential.counter,
    counterType: typeof credential.counter,
    publicKeyBytes: credential.publicKey.length,
  });

  return verifyAuthenticationResponse({
    response,
    expectedChallenge,
    expectedOrigin: webauthn.origin,
    expectedRPID: webauthn.rpID,
    credential,
    requireUserVerification: false,
  });
}

module.exports = {
  PASSKEY_DEBUG,
  passkeyDebug,
  normalizeCredentialId,
  normalizePublicKey,
  credentialIdsEqual,
  credentialIdFromAuthBody,
  isStoredPasskeyValid,
  passkeyNeedsReregister,
  webAuthnCredentialFromPasskey,
  toBase64Url,
  toBuffer,
  publicPasskey,
  saveSession,
  registrationOptions,
  verifyRegistration,
  authenticationOptions,
  verifyAuthentication,
};
