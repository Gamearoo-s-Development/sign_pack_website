/**
 * Ram AI request size limits and sanitization (no images/base64/ZIP in upstream prompts).
 */

const MAX_CUSTOM_PROMPT = 2000;
const MAX_SIGNS_JSON_CHARS = 12000;
const MAX_SELECTED_SIGN_CHARS = 4000;
const MAX_TOTAL_MESSAGE_CHARS = 20000;
const MAX_SINGLE_STRING = 2000;
const MAX_TEXTLINE_ROWS = 48;
const MAX_HTTP_JSON_BYTES = 262144; // 256 KiB raw body before parse

/** Drop keys likely to carry raw/binary payloads — not Traffic Control JSON fields like "rectangle". */
const FORBIDDEN_KEY_RE =
  /^(base64|buffer|blob|thumbnail|packedzip|zipbuffer|binarydata|rawbytes|imagedata|datauri)$/i;
const DATA_URL_RE = /^data:/i;

function looksLikeBase64Chunk(s) {
  if (typeof s !== "string" || s.length < 400) return false;
  if (DATA_URL_RE.test(s)) return true;
  const t = s.replace(/\s+/g, "");
  if (t.length < 500) return false;
  return /^[A-Za-z0-9+/]+=*$/.test(t.slice(0, 2000));
}

function truncateStr(s, max) {
  if (typeof s !== "string") return s;
  return s.length > max ? s.slice(0, max) + "…" : s;
}

/**
 * Compact signs.json summary for Ram AI (no texture payloads).
 */
function summarizePackData(pack, localWarnings) {
  const p = pack && typeof pack === "object" ? pack : {};
  const signs = Array.isArray(p.signs) ? p.signs : [];
  const types = new Set();
  let missing = 0;
  signs.forEach((s) => {
    if (!s || typeof s !== "object") return;
    if (s.type) types.add(String(s.type));
    if (!s.name || !s.type || !s.front) missing += 1;
  });
  const first10 = signs.slice(0, 10).map((s) => ({
    name: s && s.name,
    type: s && s.type,
    front: s && s.front,
    back: s && s.back != null ? s.back : null,
    textlineCount: Array.isArray(s && s.textlines) ? s.textlines.length : 0,
  }));
  return {
    packName: p.name,
    pack_id: p.pack_id,
    author: p.author || null,
    signCount: signs.length,
    typesUsed: [...types],
    missingRequiredFieldsApprox: missing,
    firstSigns: first10,
    warnings: Array.isArray(localWarnings) ? localWarnings.slice(0, 20) : [],
  };
}

function tryParsePackJson(str) {
  if (typeof str !== "string" || !str.trim()) return null;
  try {
    return JSON.parse(str);
  } catch (_e) {
    return null;
  }
}

function stripAndClampValue(value, depth, keyHint) {
  if (depth > 10) return "[truncated]";
  if (value == null) return value;
  if (typeof value === "string") {
    if (looksLikeBase64Chunk(value)) return "[omitted: possible binary/base64]";
    return truncateStr(value, MAX_SINGLE_STRING);
  }
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) {
    const cap = keyHint && /textline/i.test(String(keyHint)) ? MAX_TEXTLINE_ROWS : 80;
    return value.slice(0, cap).map((v, i) => stripAndClampValue(v, depth + 1, keyHint));
  }
  if (typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (FORBIDDEN_KEY_RE.test(String(k))) continue;
      if (/pass|secret|token|api[_-]?key|authorization|password/i.test(String(k))) continue;
      const safeKey = String(k).slice(0, 64);
      out[safeKey] = stripAndClampValue(v, depth + 1, k);
    }
    return out;
  }
  return String(value).slice(0, MAX_SINGLE_STRING);
}

/**
 * Remove dangerous fields and clamp strings on a generic context object.
 */
function deepStripContext(obj) {
  if (!obj || typeof obj !== "object") return {};
  return stripAndClampValue(obj, 0, "");
}

function compactSelectedSignForContext(raw) {
  if (!raw || typeof raw !== "object") return {};
  const lines = Array.isArray(raw.textlines) ? raw.textlines : [];
  const slimLines = lines.slice(0, MAX_TEXTLINE_ROWS).map((t, i) => ({
    i: i + 1,
    label: t && t.label,
    x: t && t.x,
    y: t && t.y,
    w: t && t.width,
    color: t && t.color,
  }));
  const block = {
    name: raw.name,
    type: raw.type,
    front: raw.front,
    back: raw.back,
    tooltip: raw.tooltip,
    halfheight: raw.halfheight,
    textlineCount: lines.length,
    textlinesSample: slimLines,
  };
  let json = JSON.stringify(block);
  if (json.length > MAX_SELECTED_SIGN_CHARS) {
    block.textlinesSample = slimLines.slice(0, 12);
    json = JSON.stringify(block);
    if (json.length > MAX_SELECTED_SIGN_CHARS) {
      return {
        _note: "Selected sign context truncated",
        name: raw.name,
        type: raw.type,
        front: raw.front,
        textlineCount: lines.length,
      };
    }
  }
  return block;
}

/**
 * Build validate_json context: full JSON if small, else summary + note.
 */
function normalizeValidateJsonContext(ctx, ramAi) {
  const out = { ...ctx };
  const warnings = [];
  let packJson = typeof out.packJson === "string" ? out.packJson : "";
  if (packJson.length > MAX_SIGNS_JSON_CHARS) {
    const parsed = tryParsePackJson(packJson);
    if (parsed) {
      out.packSummary = summarizePackData(parsed, out.localValidationWarnings);
      delete out.packJson;
      out.reviewMode = "summary";
      out.reviewNote =
        "Full JSON was too large, so this is a summarized review context. Focus on structure and the first listed signs.";
      warnings.push(
        "Your signpack is too large to send fully. Ram AI will review a summary instead."
      );
    } else {
      out.packJson = truncateStr(packJson, MAX_SIGNS_JSON_CHARS);
      out.reviewNote = "signs.json string was truncated to size limits.";
      warnings.push("signs.json preview was truncated for size limits.");
    }
  } else if (packJson.length > 0) {
    out.reviewMode = "full";
  }
  if (ramAi && ramAi.debug) {
    const approx = JSON.stringify(out).length;
    console.log("[ram-ai:debug] validate_json context chars ~%d", approx);
  }
  return { context: out, warnings };
}

/**
 * Clamp custom ask / custom_prompt context blocks.
 */
function normalizeAskContext(ctx) {
  const out = deepStripContext(ctx);
  if (typeof out.question === "string") {
    out.question = truncateStr(out.question.trim(), MAX_CUSTOM_PROMPT);
  }
  if (out.packJsonPreview && typeof out.packJsonPreview === "string") {
    if (out.packJsonPreview.length > MAX_SIGNS_JSON_CHARS) {
      out.packJsonPreview = truncateStr(out.packJsonPreview, MAX_SIGNS_JSON_CHARS);
      out._packJsonTruncated = true;
    }
  }
  if (out.selectedSignDetail && typeof out.selectedSignDetail === "object") {
    const compact = compactSelectedSignForContext(out.selectedSignDetail);
    out.selectedSignDetail = compact;
  }
  if (out.packSummary && typeof out.packSummary === "object") {
    let sum = out.packSummary;
    let sjson = JSON.stringify(sum);
    while (sjson.length > MAX_SIGNS_JSON_CHARS && Array.isArray(sum.firstSigns) && sum.firstSigns.length > 3) {
      sum = { ...sum, firstSigns: sum.firstSigns.slice(0, Math.max(3, sum.firstSigns.length - 2)) };
      sjson = JSON.stringify(sum);
    }
    if (sjson.length > MAX_SIGNS_JSON_CHARS) {
      sum = { ...sum, firstSigns: (sum.firstSigns || []).slice(0, 3), _truncated: true };
    }
    out.packSummary = sum;
  }
  if (out.textlinesSummary && Array.isArray(out.textlinesSummary)) {
    out.textlinesSummary = out.textlinesSummary.slice(0, MAX_TEXTLINE_ROWS);
  }
  return out;
}

function prepareContextForAction(action, rawContext, ramAi) {
  const base = rawContext && typeof rawContext === "object" ? rawContext : {};
  let warnings = [];

  if (action === "validate_json") {
    const stripped = deepStripContext(base);
    return normalizeValidateJsonContext(stripped, ramAi);
  }

  const ctx = normalizeAskContext(base);
  if (ctx._packJsonTruncated) {
    warnings.push("signs.json preview was truncated for size limits.");
  }
  return { context: ctx, warnings };
}

function enforceMaxMessageLength(message, ramAi) {
  if (typeof message !== "string") return "";
  if (message.length <= MAX_TOTAL_MESSAGE_CHARS) return message;
  const cut = truncateStr(message, MAX_TOTAL_MESSAGE_CHARS - 120);
  const note = "\n\n[Message truncated: exceeded " + MAX_TOTAL_MESSAGE_CHARS + " character limit for Ram AI.]";
  if (ramAi && ramAi.debug) {
    console.log("[ram-ai:debug] final message truncated from %d to ~%d", message.length, cut.length + note.length);
  }
  return cut + note;
}

module.exports = {
  MAX_CUSTOM_PROMPT,
  MAX_SIGNS_JSON_CHARS,
  MAX_SELECTED_SIGN_CHARS,
  MAX_TOTAL_MESSAGE_CHARS,
  MAX_HTTP_JSON_BYTES,
  summarizePackData,
  deepStripContext,
  prepareContextForAction,
  enforceMaxMessageLength,
  compactSelectedSignForContext,
};
