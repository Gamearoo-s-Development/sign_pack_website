const express = require("express");
const {
  publicPasskey,
  registrationOptions,
  verifyRegistration,
  authenticationOptions,
  verifyAuthentication,
  authenticatorFromPasskey,
  normalizeCredentialId,
  credentialIdFromAuthBody,
  saveSession,
  passkeyDebug,
} = require("../lib/passkeys");
const {
  persistPasskey,
  logPasskeySaved,
  findUserByPasskeyCredentialId,
  listPasskeysForUser,
  removePasskey,
} = require("../lib/passkeyStorage");

const PASSKEY_NOT_FOUND_MSG =
  "Passkey not found for this account. Sign in with your password and add a passkey in Account Settings.";

function requireAuth(req, res, next) {
  if (req.session?.isAuth && req.session?.user?._id) return next();
  return res.status(401).json({ ok: false, error: "Sign in required." });
}

function mapSessionUser(doc) {
  return {
    _id: doc._id,
    name: doc.name,
    displayName: doc.displayName || null,
    avatarUrl: doc.avatarUrl || null,
    discord: doc.discordId || null,
  };
}

function createPasskeyRouter({ usersDB, webauthn }) {
  const router = express.Router();

  if (process.env.NODE_ENV !== "production") {
    router.get("/dev/passkeys/me", requireAuth, async (req, res) => {
      try {
        const passkeys = await listPasskeysForUser(usersDB, req.session.user._id);
        return res.json({
          ok: true,
          count: passkeys.length,
          passkeys: passkeys.map((p) => ({
            name: p.name || "Passkey",
            credentialIdPrefix: normalizeCredentialId(p.credentialID).slice(0, 8),
            credentialIdLen: normalizeCredentialId(p.credentialID).length,
            createdAt: p.createdAt || null,
            lastUsedAt: p.lastUsedAt || null,
          })),
        });
      } catch (err) {
        console.error("dev passkeys/me failed", err);
        return res.status(500).json({ ok: false, error: "Could not load passkeys." });
      }
    });
  }

  router.post("/account/passkeys/register/options", requireAuth, async (req, res) => {
    try {
      const user = await usersDB
        .findOne({ _id: req.session.user._id })
        .select("_id name displayName passkeys")
        .lean();
      if (!user) return res.status(404).json({ ok: false, error: "User not found." });

      const options = await registrationOptions(user, webauthn);
      req.session.webauthnRegChallenge = options.challenge;
      req.session.webauthnRegUser = user._id;
      await saveSession(req);

      return res.json({ ok: true, options });
    } catch (err) {
      console.error("passkey register options failed", err);
      return res.status(500).json({ ok: false, error: "Could not start passkey setup." });
    }
  });

  router.post("/account/passkeys/register/verify", requireAuth, async (req, res) => {
    try {
      const expectedChallenge = req.session.webauthnRegChallenge;
      const expectedUser = req.session.webauthnRegUser;
      if (!expectedChallenge || expectedUser !== req.session.user._id) {
        return res.status(400).json({ ok: false, error: "Passkey setup session expired. Try again." });
      }

      const verification = await verifyRegistration(req.body, expectedChallenge, webauthn);

      if (!verification.verified || !verification.registrationInfo) {
        return res.status(400).json({ ok: false, error: "Passkey setup could not be verified." });
      }

      const info = verification.registrationInfo;
      const credentialID = normalizeCredentialId(req.body?.id ?? req.body?.rawId);
      const verifiedId = normalizeCredentialId(info.credential?.id);

      if (!credentialID) {
        return res.status(400).json({ ok: false, error: "Missing credential id from browser." });
      }

      if (verifiedId && verifiedId !== credentialID) {
        passkeyDebug("register id mismatch", {
          bodyLen: credentialID.length,
          verifiedLen: verifiedId.length,
        });
      }

      const persist = await persistPasskey(usersDB, req.session.user._id, {
        credentialID,
        credentialPublicKey: info.credential.publicKey,
        counter: info.credential.counter,
        transports: req.body?.response?.transports ?? info.credential.transports,
        name: req.body?.passkeyName || "Passkey",
      });

      logPasskeySaved(req.session.user._id, persist.userName, {
        passkeyCount: persist.passkeyCount,
        credentialIdLen: credentialID.length,
        credentialIdPrefix: credentialID.slice(0, 8),
        persisted: persist.saved || persist.duplicate,
        duplicate: persist.duplicate,
      });

      if (!persist.saved && !persist.duplicate) {
        return res.status(500).json({ ok: false, error: "Passkey could not be saved." });
      }

      req.session.webauthnRegChallenge = null;
      req.session.webauthnRegUser = null;
      await saveSession(req);

      const passkeys = await listPasskeysForUser(usersDB, req.session.user._id);

      return res.json({
        ok: true,
        passkeys: passkeys.map(publicPasskey),
        message: persist.duplicate ? "Passkey already registered." : "Passkey added.",
      });
    } catch (err) {
      console.error("passkey register verify failed", err);
      if (err.code === "PASSKEY_NOT_PERSISTED") {
        return res.status(500).json({
          ok: false,
          error: "Passkey verified but not saved. Check database schema and try again.",
        });
      }
      if (err.code === "MISSING_PUBLIC_KEY" || err.code === "MISSING_CREDENTIAL_ID") {
        return res.status(400).json({ ok: false, error: err.message });
      }
      return res.status(400).json({ ok: false, error: "Passkey verification failed." });
    }
  });

  router.post("/account/passkeys/delete", requireAuth, async (req, res) => {
    try {
      const result = await removePasskey(usersDB, req.session.user._id, req.body?.credentialID);
      if (!result.removed) {
        return res.status(404).json({ ok: false, error: "Passkey not found." });
      }

      const passkeys = await listPasskeysForUser(usersDB, req.session.user._id);
      return res.json({
        ok: true,
        passkeys: passkeys.map(publicPasskey),
        message: "Passkey removed.",
      });
    } catch (err) {
      console.error("passkey delete failed", err);
      return res.status(500).json({ ok: false, error: "Could not remove passkey." });
    }
  });

  router.post("/login/passkey/options", async (req, res) => {
    try {
      const email = String(req.body?.email || "").trim();
      let allowCredentialIDs = [];

      if (email) {
        const passkeys = await listPasskeysForUser(usersDB, email);
        allowCredentialIDs = passkeys
          .map((p) => normalizeCredentialId(p.credentialID))
          .filter(Boolean);
        if (!allowCredentialIDs.length) {
          return res.status(404).json({
            ok: false,
            error: "No passkeys found for this account.",
          });
        }
      }

      const options = await authenticationOptions(allowCredentialIDs, webauthn);
      req.session.webauthnAuthChallenge = options.challenge;
      req.session.webauthnAuthEmail = email || null;
      await saveSession(req);

      passkeyDebug("login options", {
        challenge: !!options.challenge,
        allowCount: allowCredentialIDs.length,
        emailProvided: !!email,
      });

      return res.json({ ok: true, options });
    } catch (err) {
      console.error("passkey login options failed", err);
      return res.status(500).json({ ok: false, error: "Could not start passkey login." });
    }
  });

  router.post("/login/passkey/verify", async (req, res) => {
    try {
      const expectedChallenge = req.session.webauthnAuthChallenge;
      const credentialID = credentialIdFromAuthBody(req.body);

      passkeyDebug("login verify", {
        challenge: !!expectedChallenge,
        credentialIdLen: credentialID.length,
        credentialIdPrefix: credentialID.slice(0, 8),
      });

      if (!expectedChallenge) {
        return res.status(400).json({
          ok: false,
          error: "Passkey challenge expired. Try again.",
        });
      }

      if (!credentialID) {
        return res.status(400).json({ ok: false, error: "Missing credential id." });
      }

      const restrictUserId = req.session.webauthnAuthEmail || null;
      const found = await findUserByPasskeyCredentialId(usersDB, credentialID, {
        restrictUserId: restrictUserId || undefined,
      });

      if (!found) {
        return res.status(404).json({ ok: false, error: PASSKEY_NOT_FOUND_MSG });
      }

      const { user, passkey } = found;

      if (restrictUserId && String(restrictUserId) !== String(user._id)) {
        return res.status(403).json({ ok: false, error: "Passkey does not match that email." });
      }

      const verification = await verifyAuthentication(
        req.body,
        expectedChallenge,
        authenticatorFromPasskey(passkey),
        webauthn
      );

      if (!verification.verified) {
        return res.status(400).json({ ok: false, error: "Passkey login failed." });
      }

      passkey.counter = Number(verification.authenticationInfo.newCounter || passkey.counter || 0);
      passkey.lastUsedAt = new Date();
      user.updatedAt = new Date();
      user.markModified("passkeys");
      await user.save();

      req.session.isAuth = true;
      req.session.user = mapSessionUser(user);
      req.session.webauthnAuthChallenge = null;
      req.session.webauthnAuthEmail = null;
      await saveSession(req);

      return res.json({ ok: true, redirectTo: "/signpack" });
    } catch (err) {
      console.error("passkey login verify failed", err);
      return res.status(400).json({ ok: false, error: "Could not verify passkey login." });
    }
  });

  return router;
}

module.exports = { createPasskeyRouter };
