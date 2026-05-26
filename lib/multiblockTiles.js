/**
 * Multi-block sign tile extraction and export sizing for Traffic Control textures.
 */

const POWER_OF_TWO_SIZES = [16, 32, 64, 128, 256];

const DEFAULT_TILE_SIZE = 64;
const DEFAULT_SCALING_MODE = "fit";
const DEFAULT_BG_MODE = "transparent";

function normalizeTileSize(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_TILE_SIZE;
  if (POWER_OF_TWO_SIZES.includes(n)) return n;
  const clamped = Math.min(256, Math.max(16, Math.round(n)));
  const pow = Math.pow(2, Math.round(Math.log2(clamped)));
  return Math.min(256, Math.max(16, pow));
}

function parseExportOptions(body) {
  const tileSize = normalizeTileSize(body.tileExportSize);
  const scalingMode = ["fit", "fill", "stretch"].includes(body.scalingMode)
    ? body.scalingMode
    : DEFAULT_SCALING_MODE;
  const preserveAspect =
    body.preserveAspect === "0" || body.preserveAspect === "false" ? false : true;
  const bgMode = ["transparent", "solid", "bleed"].includes(body.bgMode)
    ? body.bgMode
    : DEFAULT_BG_MODE;
  const bgColor = String(body.bgColor || "#000000").trim() || "#000000";
  const overlap = Math.max(0, Math.min(32, parseInt(body.tileOverlap, 10) || 0));
  const transparentCleanup = body.transparentCleanup !== "0" && body.transparentCleanup !== "false";

  return {
    tileSize,
    scalingMode,
    preserveAspect,
    bgMode,
    bgColor,
    overlap,
    transparentCleanup,
  };
}

/**
 * Compute source fragment rectangle for grid cell (r, c).
 */
function fragmentBounds(imageWidth, imageHeight, rows, cols, overlap, row, col) {
  const tileW = imageWidth / cols;
  const tileH = imageHeight / rows;
  const startX = Math.max(0, Math.round(col * tileW) - overlap);
  const startY = Math.max(0, Math.round(row * tileH) - overlap);
  const endX = Math.min(imageWidth, Math.round((col + 1) * tileW) + overlap);
  const endY = Math.min(imageHeight, Math.round((row + 1) * tileH) + overlap);
  const srcW = Math.max(1, endX - startX);
  const srcH = Math.max(1, endY - startY);
  return { startX, startY, srcW, srcH, tileW, tileH };
}

function parseHexColor(hex) {
  const m = String(hex || "").trim().match(/^#?([0-9a-f]{6})$/i);
  if (!m) return { r: 0, g: 0, b: 0, alpha: 1 };
  const v = parseInt(m[1], 16);
  return {
    r: (v >> 16) & 255,
    g: (v >> 8) & 255,
    b: v & 255,
    alpha: 1,
  };
}

let sharpAvailable = null;

function getSharp() {
  if (sharpAvailable !== null) return sharpAvailable;
  try {
    // eslint-disable-next-line global-require
    require("sharp");
    sharpAvailable = true;
  } catch (_err) {
    sharpAvailable = false;
  }
  return sharpAvailable;
}

/**
 * Resize a PNG/JPEG/WebP buffer to a square power-of-two PNG tile using sharp.
 */
async function renderTilePng(inputBuffer, options) {
  const {
    tileSize,
    scalingMode = DEFAULT_SCALING_MODE,
    preserveAspect = true,
    bgMode = DEFAULT_BG_MODE,
    bgColor = "#000000",
    transparentCleanup = true,
  } = options;

  const size = normalizeTileSize(tileSize);
  const bg = parseHexColor(bgColor);

  if (!getSharp()) {
    throw new Error("Image processing unavailable (sharp not installed)");
  }

  const sharp = require("sharp");
  let pipeline = sharp(inputBuffer);

  const bleedPad = bgMode === "bleed" ? Math.min(8, Math.max(2, Math.round(size * 0.06))) : 0;

  if (bleedPad > 0) {
    pipeline = pipeline.extend({
      top: bleedPad,
      bottom: bleedPad,
      left: bleedPad,
      right: bleedPad,
      background: bg,
    });
  } else if (bgMode === "solid") {
    pipeline = pipeline.flatten({ background: bg });
  } else {
    pipeline = pipeline.ensureAlpha();
  }

  let fitMode = "contain";
  if (scalingMode === "fill") {
    fitMode = preserveAspect ? "cover" : "fill";
  } else if (scalingMode === "stretch" || (scalingMode === "fit" && !preserveAspect)) {
    fitMode = "fill";
  }

  const kernel = scalingMode === "stretch" ? sharp.kernel.fill : sharp.kernel.lanczos3;

  pipeline = pipeline.resize(size, size, {
    fit: fitMode,
    position: "centre",
    kernel,
    background: bgMode === "transparent" ? { r: 0, g: 0, b: 0, alpha: 0 } : bg,
  });

  if (transparentCleanup && bgMode === "transparent") {
    pipeline = pipeline.png({ compressionLevel: 9, force: true });
  } else {
    pipeline = pipeline.png({ compressionLevel: 9 });
  }

  return pipeline.toBuffer();
}

module.exports = {
  POWER_OF_TWO_SIZES,
  DEFAULT_TILE_SIZE,
  DEFAULT_SCALING_MODE,
  DEFAULT_BG_MODE,
  normalizeTileSize,
  parseExportOptions,
  fragmentBounds,
  parseHexColor,
  renderTilePng,
  getSharp,
};