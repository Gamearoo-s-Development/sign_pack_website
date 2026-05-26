const {
  normalizeCredentialId,
  normalizePublicKey,
  credentialIdsEqual,
  isStoredPasskeyValid,
  PASSKEY_DEBUG,
  passkeyDebug,
} = require("./passkeys");

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

function pickPasskeyFromUser(user, normalized, raw) {
  if (!user || !Array.isArray(user.passkeys)) return null;
  let passkey = user.passkeys.find((p) => p.credentialID === normalized);
  if (!passkey && raw) {
    passkey = user.passkeys.find((p) => credentialIdsEqual(p.credentialID, normalized));
  }
  if (!passkey) return null;
  return { user, passkey, credentialID: normalized };
}

async function findUserByPasskeyCredentialId(usersDB, rawCredentialId, { restrictUserId } = {}) {
  const normalized = normalizeCredentialId(rawCredentialId);
  if (!normalized) return null;

  const raw = String(rawCredentialId || "").trim();

  const query = { "passkeys.credentialID": normalized };
  if (restrictUserId) query._id = restrictUserId;

  let user = await usersDB.findOne(query);
  let hit = pickPasskeyFromUser(user, normalized, raw);
  if (hit) return hit;

  if (raw && raw !== normalized) {
    user = await usersDB.findOne({
      "passkeys.credentialID": raw,
      ...(restrictUserId ? { _id: restrictUserId } : {}),
    });
    hit = pickPasskeyFromUser(user, normalized, raw);
    if (hit) return hit;
  }

  const scanQuery = { "passkeys.0": { $exists: true } };
  if (restrictUserId) scanQuery._id = restrictUserId;

  const candidates = await usersDB.find(scanQuery).select("_id passkeys").lean();
  for (const doc of candidates) {
    for (const p of doc.passkeys || []) {
      if (credentialIdsEqual(p.credentialID, normalized) || (raw && credentialIdsEqual(p.credentialID, raw))) {
        const full = await usersDB.findOne({ _id: doc._id });
        const picked = pickPasskeyFromUser(full, normalized, raw);
        if (picked) return picked;
      }
    }
  }

  passkeyDebug("login lookup miss", {
    normalizedLen: normalized.length,
    normalizedPrefix: normalized.slice(0, 8),
    restrictUserId: restrictUserId ? "yes" : "no",
    scanned: candidates.length,
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
  buildPasskeyRecord,
  logPasskeySaved,
  persistPasskey,
  findUserByPasskeyCredentialId,
  listPasskeysForUser,
  removePasskey,
  isStoredPasskeyValid,
};
