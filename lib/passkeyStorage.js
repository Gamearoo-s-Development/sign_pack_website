const { isoBase64URL } = require("@simplewebauthn/server/helpers");
const { normalizeCredentialId, credentialIdsEqual, PASSKEY_DEBUG, passkeyDebug } = require("./passkeys");

/**
 * Store COSE public key bytes as base64url string.
 */
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

function buildPasskeyRecord({ credentialID, credentialPublicKey, counter, transports, name }) {
  const record = {
    credentialID: normalizeCredentialId(credentialID),
    credentialPublicKey: normalizePublicKey(credentialPublicKey),
    counter: Number(counter || 0),
    transports: Array.isArray(transports) ? transports.map(String).slice(0, 8) : [],
    name: String(name || "Passkey").slice(0, 80) || "Passkey",
    createdAt: new Date(),
    lastUsedAt: null,
  };

  if (!record.credentialID) {
    const err = new Error("Missing credential ID");
    err.code = "MISSING_CREDENTIAL_ID";
    throw err;
  }
  if (!record.credentialPublicKey) {
    const err = new Error("Missing credential public key");
    err.code = "MISSING_PUBLIC_KEY";
    throw err;
  }

  return record;
}

function logPasskeySaved(userId, userName, meta) {
  if (!PASSKEY_DEBUG) return;
  console.debug("[passkey] saved", {
    userId: String(userId || "").slice(0, 3) + "…",
    username: userName || "?",
    passkeyCount: meta.passkeyCount,
    credentialIdLen: meta.credentialIdLen,
    credentialIdPrefix: meta.credentialIdPrefix,
    persisted: meta.persisted,
    duplicate: !!meta.duplicate,
  });
}

/**
 * Append passkey with $push and confirm it exists in MongoDB after write.
 */
async function persistPasskey(usersDB, userId, fields) {
  const record = buildPasskeyRecord(fields);

  const existing = await usersDB
    .findOne({ _id: userId, "passkeys.credentialID": record.credentialID })
    .select("_id passkeys name")
    .lean();

  if (existing) {
    return {
      saved: false,
      duplicate: true,
      record,
      passkeyCount: Array.isArray(existing.passkeys) ? existing.passkeys.length : 0,
      userName: existing.name,
    };
  }

  const update = await usersDB.updateOne(
    { _id: userId },
    {
      $push: { passkeys: record },
      $set: { updatedAt: new Date() },
    }
  );

  if (update.matchedCount < 1) {
    const err = new Error("User not found");
    err.code = "USER_NOT_FOUND";
    throw err;
  }

  const fresh = await usersDB.findOne({ _id: userId }).select("passkeys name").lean();
  const passkeys = Array.isArray(fresh?.passkeys) ? fresh.passkeys : [];
  const persisted = passkeys.some((p) => p.credentialID === record.credentialID);

  if (!persisted) {
    const err = new Error("Passkey was not saved to the database");
    err.code = "PASSKEY_NOT_PERSISTED";
    throw err;
  }

  return {
    saved: true,
    duplicate: false,
    record,
    passkeyCount: passkeys.length,
    userName: fresh?.name,
  };
}

async function findUserByPasskeyCredentialId(usersDB, rawCredentialId, { restrictUserId } = {}) {
  const normalized = normalizeCredentialId(rawCredentialId);
  if (!normalized) return null;

  const query = { "passkeys.credentialID": normalized };
  if (restrictUserId) query._id = restrictUserId;

  let user = await usersDB.findOne(query);
  if (user) {
    const passkey = (user.passkeys || []).find((p) => p.credentialID === normalized);
    if (passkey) return { user, passkey, credentialID: normalized };
  }

  passkeyDebug("login lookup miss", {
    normalizedLen: normalized.length,
    normalizedPrefix: normalized.slice(0, 8),
    restrictUserId: restrictUserId ? "yes" : "no",
  });

  return null;
}

async function listPasskeysForUser(usersDB, userId) {
  const doc = await usersDB.findOne({ _id: userId }).select("passkeys").lean();
  return Array.isArray(doc?.passkeys) ? doc.passkeys : [];
}

async function removePasskey(usersDB, userId, rawCredentialId) {
  const normalized = normalizeCredentialId(rawCredentialId);
  if (!normalized) return { removed: false };

  const result = await usersDB.updateOne(
    { _id: userId },
    { $pull: { passkeys: { credentialID: normalized } }, $set: { updatedAt: new Date() } }
  );

  return { removed: result.modifiedCount > 0, credentialID: normalized };
}

module.exports = {
  normalizePublicKey,
  buildPasskeyRecord,
  logPasskeySaved,
  persistPasskey,
  findUserByPasskeyCredentialId,
  listPasskeysForUser,
  removePasskey,
  credentialIdsEqual,
};
