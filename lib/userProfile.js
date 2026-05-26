const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const AVATAR_DIR = path.join(__dirname, "..", "uploads", "avatars");
const AVATAR_MAX_BYTES = 5 * 1024 * 1024;
const AVATAR_SIZE = 256;
const ALLOWED_EXT = new Set([".png", ".jpg", ".jpeg", ".webp"]);
const ALLOWED_MIME = new Set(["image/png", "image/jpeg", "image/webp"]);

function ensureAvatarDir() {
  if (!fs.existsSync(AVATAR_DIR)) {
    fs.mkdirSync(AVATAR_DIR, { recursive: true });
  }
}

function avatarBasename(email) {
  const hash = crypto.createHash("sha256").update(String(email)).digest("hex").slice(0, 32);
  return `avatar-${hash}`;
}

function avatarFilePath(email, ext) {
  return path.join(AVATAR_DIR, `${avatarBasename(email)}${ext || ".webp"}`);
}

function avatarPublicPath(email, ext) {
  return `/uploads/avatars/${avatarBasename(email)}${ext || ".webp"}`;
}

function getInitials(name) {
  const parts = String(name || "?")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}

function getDisplayName(user) {
  if (!user) return "";
  const dn = (user.displayName || "").trim();
  return dn || user.name || "";
}

function sessionUserFromDoc(doc) {
  if (!doc) return null;
  return {
    _id: doc._id,
    name: doc.name,
    displayName: doc.displayName || null,
    avatarUrl: doc.avatarUrl || null,
    discord: doc.discordId || null,
  };
}

function editorUserView(sessionUser) {
  const display = getDisplayName(sessionUser);
  return {
    username: sessionUser.name,
    displayName: display,
    displayNameInput: (sessionUser.displayName || "").trim(),
    email: sessionUser._id,
    avatarUrl: sessionUser.avatarUrl || null,
    initials: getInitials(display),
    discord: sessionUser.discord,
  };
}

async function refreshSessionUser(req, usersDB) {
  if (!req.session?.isAuth || !req.session.user?._id) return null;
  const doc = await usersDB
    .findOne({ _id: req.session.user._id })
    .select("_id name displayName avatarUrl discordId")
    .lean();
  if (!doc) return null;
  req.session.user = sessionUserFromDoc(doc);
  return req.session.user;
}

function safeExtension(originalname) {
  const ext = path.extname(String(originalname || "")).toLowerCase();
  return ALLOWED_EXT.has(ext) ? ext : null;
}

function validateAvatarFile(file) {
  if (!file || !file.buffer) {
    return { ok: false, message: "No image file provided." };
  }
  if (file.size > AVATAR_MAX_BYTES) {
    return { ok: false, message: "Image must be 5 MB or smaller." };
  }
  const ext = safeExtension(file.originalname);
  if (!ext) {
    return { ok: false, message: "Only PNG, JPG, JPEG, or WEBP images are allowed." };
  }
  const mime = String(file.mimetype || "").toLowerCase();
  if (!ALLOWED_MIME.has(mime)) {
    return { ok: false, message: "Invalid image type." };
  }
  if (mime === "image/svg+xml" || ext === ".svg") {
    return { ok: false, message: "SVG uploads are not allowed." };
  }
  return { ok: true, ext };
}

async function saveAvatarWithSharp(buffer, outPath) {
  const sharp = require("sharp");
  await sharp(buffer)
    .rotate()
    .resize(AVATAR_SIZE, AVATAR_SIZE, { fit: "cover", position: "centre" })
    .webp({ quality: 82 })
    .toFile(outPath);
}

async function saveAvatarWithJimp(buffer, outPath) {
  const { Jimp } = require("jimp");
  const image = await Jimp.read(buffer);
  image.cover({ w: AVATAR_SIZE, h: AVATAR_SIZE });
  await image.write(outPath);
}

async function saveAvatarFromBuffer(email, buffer) {
  ensureAvatarDir();
  deleteAvatarFile(email);
  const resolvedDir = path.resolve(AVATAR_DIR);

  try {
    const outPath = avatarFilePath(email, ".webp");
    const resolvedOut = path.resolve(outPath);
    if (!resolvedOut.startsWith(resolvedDir + path.sep)) {
      throw new Error("Invalid avatar path");
    }
    await saveAvatarWithSharp(buffer, outPath);
    return avatarPublicPath(email, ".webp");
  } catch (sharpErr) {
    const outPath = avatarFilePath(email, ".png");
    const resolvedOut = path.resolve(outPath);
    if (!resolvedOut.startsWith(resolvedDir + path.sep)) {
      throw new Error("Invalid avatar path");
    }
    await saveAvatarWithJimp(buffer, outPath);
    return avatarPublicPath(email, ".png");
  }
}

function deleteAvatarFile(email) {
  const resolvedDir = path.resolve(AVATAR_DIR);
  let removed = false;
  for (const ext of [".webp", ".png", ".jpg", ".jpeg"]) {
    const filePath = avatarFilePath(email, ext);
    const resolvedFile = path.resolve(filePath);
    if (!resolvedFile.startsWith(resolvedDir + path.sep)) continue;
    if (fs.existsSync(resolvedFile)) {
      fs.unlinkSync(resolvedFile);
      removed = true;
    }
  }
  return removed;
}

function sanitizeDisplayName(raw) {
  const name = String(raw || "").trim().replace(/\s+/g, " ");
  if (!name) return "";
  if (name.length > 48) return name.slice(0, 48);
  return name;
}

module.exports = {
  AVATAR_DIR,
  AVATAR_MAX_BYTES,
  ensureAvatarDir,
  avatarBasename,
  avatarFilePath,
  avatarPublicPath,
  getInitials,
  getDisplayName,
  sessionUserFromDoc,
  editorUserView,
  refreshSessionUser,
  validateAvatarFile,
  saveAvatarFromBuffer,
  deleteAvatarFile,
  sanitizeDisplayName,
};
