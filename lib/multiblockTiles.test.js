const test = require("node:test");
const assert = require("node:assert/strict");
const {
  normalizeTileSize,
  parseExportOptions,
  fragmentBounds,
  POWER_OF_TWO_SIZES,
} = require("./multiblockTiles");

test("normalizeTileSize snaps to power of two", () => {
  assert.equal(normalizeTileSize(64), 64);
  assert.equal(normalizeTileSize(100), 128);
  assert.equal(normalizeTileSize(48), 64);
  assert.ok(POWER_OF_TWO_SIZES.includes(normalizeTileSize(200)));
});

test("parseExportOptions defaults to 64 fit transparent", () => {
  const opts = parseExportOptions({});
  assert.equal(opts.tileSize, 64);
  assert.equal(opts.scalingMode, "fit");
  assert.equal(opts.preserveAspect, true);
  assert.equal(opts.bgMode, "transparent");
});

test("fragmentBounds respects overlap", () => {
  const b = fragmentBounds(256, 128, 2, 4, 2, 0, 0);
  assert.ok(b.srcW >= 1);
  assert.ok(b.srcH >= 1);
  assert.equal(b.startX, 0);
  const withOverlap = fragmentBounds(256, 128, 2, 4, 2, 0, 1);
  assert.ok(withOverlap.startX >= 0);
});
