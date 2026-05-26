const express = require("express");
const {
  toBase64Url,
  publicPasskey,
  registrationOptions,
  verifyRegistration,
  authenticationOptions,
  verifyAuthentication,
  authenticatorFromPasskey,
} = require("../lib/passkeys");

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

      const verification = await verifyRegistration(
        req.body,
        expectedChallenge,
        webauthn
      );

      if (!verification.verified || !verification.registrationInfo) {
        return res.status(400).json({ ok: false, error: "Passkey setup could not be verified." });
      }

      const info = verification.registrationInfo;
      const credentialID = toBase64Url(info.credential.id);

      const doc = await usersDB.findOne({ _id: req.session.user._id });
      if (!doc) return res.status(404).json({ ok: false, error: "User not found." });

      const exists = (doc.passkeys || []).some((p) => p.credentialID === credentialID);
      if (!exists) {
        doc.passkeys = doc.passkeys || [];
        doc.passkeys.push({
          credentialID,
          credentialPublicKey: toBase64Url(info.credential.publicKey),
          counter: Number(info.credential.counter || 0),
          transports: Array.isArray(req.body?.response?.transports)
            ? req.body.response.transports.slice(0, 8)
            : [],
          name: String(req.body?.passkeyName || "Passkey").slice(0, 80) || "Passkey",
          createdAt: new Date(),
          lastUsedAt: null,
        });
      }

      doc.updatedAt = new Date();
      await doc.save();

      req.session.webauthnRegChallenge = null;
      req.session.webauthnRegUser = null;

      return res.json({
        ok: true,
        passkeys: (doc.passkeys || []).map(publicPasskey),
        message: "Passkey added.",
      });
    } catch (err) {
      console.error("passkey register verify failed", err);
      return res.status(400).json({ ok: false, error: "Passkey verification failed." });
    }
  });

  router.post("/account/passkeys/delete", requireAuth, async (req, res) => {
    try {
      const credentialID = String(req.body?.credentialID || "").trim();
      if (!credentialID) {
        return res.status(400).json({ ok: false, error: "Missing passkey id." });
      }
      const doc = await usersDB.findOne({ _id: req.session.user._id });
      if (!doc) return res.status(404).json({ ok: false, error: "User not found." });

      const before = (doc.passkeys || []).length;
      doc.passkeys = (doc.passkeys || []).filter((p) => p.credentialID !== credentialID);
      if (doc.passkeys.length === before) {
        return res.status(404).json({ ok: false, error: "Passkey not found." });
      }
      doc.updatedAt = new Date();
      await doc.save();

      return res.json({
        ok: true,
        passkeys: (doc.passkeys || []).map(publicPasskey),
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
        const user = await usersDB.findOne({ _id: email }).select("passkeys").lean();
        const list = (user && Array.isArray(user.passkeys) ? user.passkeys : []).map(
          (p) => p.credentialID
        );
        if (!list.length) {
          return res.status(404).json({ ok: false, error: "No passkeys found for this account." });
        }
        allowCredentialIDs = list;
      }

      const options = await authenticationOptions(allowCredentialIDs, webauthn);
      req.session.webauthnAuthChallenge = options.challenge;
      req.session.webauthnAuthEmail = email || null;

      return res.json({ ok: true, options });
    } catch (err) {
      console.error("passkey login options failed", err);
      return res.status(500).json({ ok: false, error: "Could not start passkey login." });
    }
  });

  router.post("/login/passkey/verify", async (req, res) => {
    try {
      const expectedChallenge = req.session.webauthnAuthChallenge;
      if (!expectedChallenge) {
        return res.status(400).json({ ok: false, error: "Passkey login session expired. Try again." });
      }

      const credentialID = String(req.body?.id || "").trim();
      if (!credentialID) {
        return res.status(400).json({ ok: false, error: "Missing credential id." });
      }

      const user = await usersDB.findOne({ "passkeys.credentialID": credentialID });
      if (!user) {
        return res.status(404).json({ ok: false, error: "Passkey account not found." });
      }

      if (req.session.webauthnAuthEmail && req.session.webauthnAuthEmail !== user._id) {
        return res.status(403).json({ ok: false, error: "Passkey does not match that email." });
      }

      const passkey = (user.passkeys || []).find((p) => p.credentialID === credentialID);
      if (!passkey) {
        return res.status(404).json({ ok: false, error: "Passkey not found." });
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
      await user.save();

      req.session.isAuth = true;
      req.session.user = mapSessionUser(user);
      req.session.webauthnAuthChallenge = null;
      req.session.webauthnAuthEmail = null;

      return res.json({ ok: true, redirectTo: "/signpack" });
    } catch (err) {
      console.error("passkey login verify failed", err);
      return res.status(400).json({ ok: false, error: "Could not verify passkey login." });
    }
  });

  return router;
}

module.exports = { createPasskeyRouter };
