const express = require("express");
const multer = require("multer");
const {
  ensureAvatarDir,
  refreshSessionUser,
  editorUserView,
  validateAvatarFile,
  saveAvatarFromBuffer,
  deleteAvatarFile,
  sanitizeDisplayName,
} = require("../lib/userProfile");
const { publicPasskey } = require("../lib/passkeys");

const avatarUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
});

function createAccountRouter({ usersDB, isLoggedIn, webauthn }) {
  ensureAvatarDir();
  const router = express.Router();

  // Only protect /account/* — do not apply globally (router is mounted at "/").
  router.use("/account", isLoggedIn);

  router.get("/account", async (req, res) => {
    try {
      await refreshSessionUser(req, usersDB);
      const user = editorUserView(req.session.user);
      const doc = await usersDB
        .findOne({ _id: req.session.user._id })
        .select("passkeys")
        .lean();
      const passkeys = Array.isArray(doc?.passkeys)
        ? doc.passkeys.map(publicPasskey)
        : [];
      const flash = req.query.saved === "1" ? "saved" : req.query.error ? "error" : null;
      res.render("account/settings", {
        user,
        passkeys,
        webauthnEnabled: !!webauthn,
        flash,
        flashMessage: req.query.error || null,
      });
    } catch (err) {
      console.error("GET /account failed:", err);
      res.status(500).send("Could not load account settings.");
    }
  });

  router.post("/account/profile", async (req, res) => {
    try {
      const displayName = sanitizeDisplayName(req.body.displayName);
      const doc = await usersDB.findOne({ _id: req.session.user._id });
      if (!doc) {
        return wantsJson(req)
          ? res.status(404).json({ ok: false, message: "User not found." })
          : res.redirect("/account?error=notfound");
      }

      doc.displayName = displayName || null;
      doc.updatedAt = new Date();
      await doc.save();
      await refreshSessionUser(req, usersDB);

      const payload = {
        ok: true,
        displayName: getDisplayNameFromSession(req),
        message: "Profile saved.",
      };
      return wantsJson(req) ? res.json(payload) : res.redirect("/account?saved=1");
    } catch (err) {
      console.error("POST /account/profile failed:", err);
      return wantsJson(req)
        ? res.status(500).json({ ok: false, message: "Could not save profile." })
        : res.redirect("/account?error=save_failed");
    }
  });

  router.post("/account/avatar", avatarUpload.single("avatar"), async (req, res) => {
    try {
      const check = validateAvatarFile(req.file);
      if (!check.ok) {
        return respondAvatarError(req, res, check.message, 400);
      }

      const doc = await usersDB.findOne({ _id: req.session.user._id });
      if (!doc) {
        return respondAvatarError(req, res, "User not found.", 404);
      }

      deleteAvatarFile(doc._id);
      const avatarUrl = await saveAvatarFromBuffer(doc._id, req.file.buffer);
      doc.avatarUrl = avatarUrl;
      doc.updatedAt = new Date();
      await doc.save();
      await refreshSessionUser(req, usersDB);

      return wantsJson(req)
        ? res.json({ ok: true, avatarUrl, message: "Profile picture updated." })
        : res.redirect("/account?saved=1");
    } catch (err) {
      console.error("POST /account/avatar failed:", err);
      return respondAvatarError(req, res, "Could not process image.", 500);
    }
  });

  router.post("/account/avatar/delete", async (req, res) => {
    try {
      const doc = await usersDB.findOne({ _id: req.session.user._id });
      if (!doc) {
        return wantsJson(req)
          ? res.status(404).json({ ok: false, message: "User not found." })
          : res.redirect("/account?error=notfound");
      }

      deleteAvatarFile(doc._id);
      doc.avatarUrl = null;
      doc.updatedAt = new Date();
      await doc.save();
      await refreshSessionUser(req, usersDB);

      return wantsJson(req)
        ? res.json({ ok: true, avatarUrl: null, message: "Profile picture removed." })
        : res.redirect("/account?saved=1");
    } catch (err) {
      console.error("POST /account/avatar/delete failed:", err);
      return wantsJson(req)
        ? res.status(500).json({ ok: false, message: "Could not remove avatar." })
        : res.redirect("/account?error=avatar_delete_failed");
    }
  });

  return router;
}

function wantsJson(req) {
  const accept = String(req.get("accept") || "");
  return (
    req.get("x-requested-with") === "XMLHttpRequest" ||
    accept.includes("application/json") ||
    req.body?.ajax === "1"
  );
}

function getDisplayNameFromSession(req) {
  const u = req.session.user;
  const dn = (u.displayName || "").trim();
  return dn || u.name;
}

function respondAvatarError(req, res, message, status) {
  return wantsJson(req)
    ? res.status(status).json({ ok: false, message })
    : res.redirect(`/account?error=${encodeURIComponent(message)}`);
}

module.exports = { createAccountRouter };
