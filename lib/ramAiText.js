/**
 * Clean assistant text and filter Ram AI transport markers (server-side).
 */

const TRANSPORT_MARKERS = new Set([
  "[DONE]",
  "[done]",
  "[stream_end]",
  "[STREAM_END]",
  "[Stream_End]",
  "[END]",
  "[end]",
]);

const TRANSPORT_INLINE_RE =
  /\[stream_end\]|\[STREAM_END\]|\[DONE\]|\[done\]|\[END\]|\[end\]/gi;

const JSON_LIKE_RE = /^\s*[\[{]/;

function isTransportMarker(value) {
  if (value == null) return true;
  const t = String(value).trim();
  if (!t) return true;
  if (TRANSPORT_MARKERS.has(t)) return true;
  if (/^\[(?:done|stream_end|end)\]$/i.test(t)) return true;
  return false;
}

/**
 * Remove transport tokens from a text chunk; return null if nothing left.
 */
function sanitizeAssistantChunk(text) {
  if (text == null) return null;
  let s = String(text);
  if (!s) return null;
  if (isTransportMarker(s)) return null;

  s = s.replace(TRANSPORT_INLINE_RE, "");
  if (isTransportMarker(s)) return null;

  const trimmed = s.trim();
  if (isTransportMarker(trimmed)) return null;
  if (trimmed === "data:" || trimmed === "event:") return null;

  return s.length ? s : null;
}

/**
 * Full cleanup before sending to client or final storage.
 */
function cleanAssistantText(text, options) {
  const opts = options || {};
  if (text == null) return "";
  let s = String(text);
  if (!s) return "";

  s = s.replace(TRANSPORT_INLINE_RE, "");
  s = s.replace(/^\s*data:\s*/gm, "");
  s = s.replace(/\r\n/g, "\n");

  if (opts.final) {
    s = s.replace(/\n{4,}/g, "\n\n\n");
    s = s.replace(/[ \t]+\n/g, "\n");
    s = s.trim();
  }

  return s;
}

/**
 * True if line looks like raw JSON/SSE wrapper without usable assistant text.
 */
function looksLikeRawTransportJson(trimmed) {
  if (!trimmed || !JSON_LIKE_RE.test(trimmed)) return false;
  return isTransportMarker(trimmed);
}

function logStreamChunk(ramAiConfig, meta) {
  if (!ramAiConfig || !ramAiConfig.debug) return;
  const safe = {
    chunkType: meta.chunkType || "",
    textLength: meta.textLength != null ? meta.textLength : 0,
    streamComplete: !!meta.streamComplete,
    parseSource: meta.parseSource || "",
  };
  console.log("[ram-ai:debug:stream] " + JSON.stringify(safe));
}

module.exports = {
  isTransportMarker,
  sanitizeAssistantChunk,
  cleanAssistantText,
  looksLikeRawTransportJson,
  logStreamChunk,
};
