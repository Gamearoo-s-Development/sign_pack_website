/**
 * Extract assistant text from Ram AI responses (JSON, plain text, SSE).
 */

const {
  isTransportMarker,
  sanitizeAssistantChunk,
  cleanAssistantText,
  looksLikeRawTransportJson,
  logStreamChunk,
} = require("./ramAiText");

function pickString(value) {
  if (typeof value !== "string") return null;
  const t = value.trim();
  return t.length ? t : null;
}

function isHeartbeatLine(line) {
  if (line == null) return true;
  const t = String(line).trim();
  return !t || t.startsWith(":");
}

/**
 * Extract text from a parsed JSON object (many provider shapes).
 */
function extractTextFromObject(obj, depth) {
  if (obj == null || depth > 8) return null;
  if (typeof obj === "string") return pickString(obj);
  if (typeof obj !== "object") return null;

  const directKeys = [
    "response",
    "answer",
    "text",
    "reply",
    "output",
    "content",
    "token",
  ];
  for (let i = 0; i < directKeys.length; i++) {
    const s = pickString(obj[directKeys[i]]);
    if (s) return s;
  }

  if (typeof obj.data === "string") {
    const s = pickString(obj.data);
    if (s) return s;
  }
  if (obj.data && typeof obj.data === "object") {
    const nested = extractTextFromObject(obj.data, depth + 1);
    if (nested) return nested;
  }

  if (obj.message) {
    if (typeof obj.message === "string") {
      const s = pickString(obj.message);
      if (s) return s;
    } else if (typeof obj.message === "object") {
      const s = pickString(obj.message.content) || extractTextFromObject(obj.message, depth + 1);
      if (s) return s;
    }
  }

  if (Array.isArray(obj.choices) && obj.choices.length) {
    const c0 = obj.choices[0];
    if (c0) {
      const fromChoice =
        pickString(c0.text) ||
        (c0.message && pickString(c0.message.content)) ||
        (c0.delta && pickString(c0.delta.content));
      if (fromChoice) return fromChoice;
    }
  }

  if (Array.isArray(obj.messages) && obj.messages.length) {
    for (let i = obj.messages.length - 1; i >= 0; i--) {
      const m = obj.messages[i];
      if (!m || typeof m !== "object") continue;
      if (m.role && m.role !== "assistant" && m.role !== "model") continue;
      const s = pickString(m.content) || extractTextFromObject(m, depth + 1);
      if (s) return s;
    }
  }

  return null;
}

/**
 * Parse one SSE/stream line → text chunk or null.
 * @returns {{ text: string, chunkType: string } | null}
 */
function extractTextFromStreamLine(line) {
  if (isHeartbeatLine(line)) return null;

  const raw = String(line);
  const trimmed = raw.trim();
  if (!trimmed || isTransportMarker(trimmed)) return null;

  if (trimmed.startsWith("data:")) {
    const payload = trimmed.slice(5).trim();
    if (!payload || isTransportMarker(payload)) return null;
    try {
      const j = JSON.parse(payload);
      if (typeof j === "string") {
        const t = sanitizeAssistantChunk(j);
        return t ? { text: t, chunkType: "sse-string" } : null;
      }
      const fromObj = extractTextFromObject(j, 0);
      if (fromObj) {
        const t = sanitizeAssistantChunk(fromObj);
        return t ? { text: t, chunkType: "sse-json" } : null;
      }
      return null;
    } catch (_e) {
      const t = sanitizeAssistantChunk(payload);
      return t ? { text: t, chunkType: "sse-plain" } : null;
    }
  }

  if (looksLikeRawTransportJson(trimmed)) return null;

  try {
    const j = JSON.parse(trimmed);
    const fromObj = extractTextFromObject(j, 0);
    if (fromObj) {
      const t = sanitizeAssistantChunk(fromObj);
      return t ? { text: t, chunkType: "json-line" } : null;
    }
    return null;
  } catch (_e) {
    /* plain assistant text line */
  }

  const t = sanitizeAssistantChunk(raw);
  return t ? { text: t, chunkType: "plain-line" } : null;
}

/**
 * Strip heartbeats and SSE noise from a full body string, then extract text.
 */
function parseRawBody(rawBody, contentType) {
  const attempts = [];
  if (!rawBody || !String(rawBody).trim()) {
    return { text: null, attempts };
  }

  const body = String(rawBody);
  attempts.push("raw-length:" + body.length);

  if (contentType && contentType.includes("application/json")) {
    attempts.push("content-type-json");
  }

  try {
    const parsed = JSON.parse(body);
    const fromJson = extractTextFromObject(parsed, 0);
    if (fromJson) {
      attempts.push("json-root");
      return { text: fromJson, attempts };
    }
    if (typeof parsed === "string" && parsed.trim()) {
      attempts.push("json-string-root");
      return { text: parsed.trim(), attempts };
    }
  } catch (_e) {
    attempts.push("not-json-root");
  }

  const lines = body.split(/\r?\n/);
  const plainParts = [];
  let sseParts = [];

  for (let i = 0; i < lines.length; i++) {
    const parsed = extractTextFromStreamLine(lines[i]);
    if (parsed && parsed.text) {
      sseParts.push(parsed.text);
    } else if (!isHeartbeatLine(lines[i])) {
      const line = lines[i];
      const t = sanitizeAssistantChunk(line);
      if (t) plainParts.push(t);
    }
  }

  if (sseParts.length) {
    attempts.push("sse-lines:" + sseParts.length);
    return { text: cleanAssistantText(sseParts.join(""), { final: true }), attempts };
  }

  if (plainParts.length) {
    attempts.push("plain-lines:" + plainParts.length);
    const joined = plainParts.join("\n");
    try {
      const j = JSON.parse(joined);
      const t = extractTextFromObject(j, 0);
      if (t) {
        attempts.push("plain-json");
        return { text: cleanAssistantText(t, { final: true }), attempts };
      }
    } catch (_e) {
      /* use plain */
    }
    return { text: cleanAssistantText(joined, { final: true }), attempts };
  }

  const trimmed = body.trim();
  if (!trimmed.startsWith(":") && trimmed.length && !isTransportMarker(trimmed)) {
    attempts.push("trimmed-fallback");
    const t = sanitizeAssistantChunk(trimmed);
    if (t) return { text: cleanAssistantText(t, { final: true }), attempts };
  }

  return { text: null, attempts };
}

function safeTopLevelKeys(data) {
  if (data == null) return [];
  if (typeof data === "object" && !Buffer.isBuffer(data) && !Array.isArray(data)) {
    return Object.keys(data).slice(0, 24);
  }
  if (typeof data === "string") return ["<string>"];
  return [typeof data];
}

function buildDebugMeta(ramAiConfig, meta) {
  if (!ramAiConfig || !ramAiConfig.debug) return;
  const safe = {
    status: meta.status,
    contentType: meta.contentType || "",
    topLevelKeys: meta.topLevelKeys || [],
    textLength: meta.textLength != null ? meta.textLength : 0,
    parseSource: meta.parseSource || "",
    formatAttempts: (meta.formatAttempts || []).slice(0, 12),
  };
  console.log("[ram-ai:debug] " + JSON.stringify(safe));
}

/**
 * Parse a completed HTTP response (non-streaming axios).
 */
function parseHttpResponse(res, ramAiConfig) {
  const status = res.status;
  const contentType = String(
    (res.headers && (res.headers["content-type"] || res.headers["Content-Type"])) || ""
  );
  const topLevelKeys = safeTopLevelKeys(res.data);
  let text = null;
  let parseSource = "";
  let formatAttempts = [];

  if (status < 200 || status >= 300) {
    return { text: null, status, contentType, topLevelKeys, parseSource, formatAttempts };
  }

  if (typeof res.data === "object" && res.data !== null && !Buffer.isBuffer(res.data)) {
    text = extractTextFromObject(res.data, 0);
    if (text) {
      text = cleanAssistantText(text, { final: true });
      parseSource = "axios-json-object";
      formatAttempts.push("axios-object");
    }
  }

  if (!text && typeof res.data === "string") {
    const parsed = parseRawBody(res.data, contentType);
    text = parsed.text;
    formatAttempts = parsed.attempts;
    if (text) parseSource = "axios-string-body";
  }

  if (!text && Buffer.isBuffer(res.data)) {
    const parsed = parseRawBody(res.data.toString("utf8"), contentType);
    text = parsed.text;
    formatAttempts = parsed.attempts;
    if (text) parseSource = "axios-buffer";
  }

  buildDebugMeta(ramAiConfig, {
    status,
    contentType,
    topLevelKeys,
    textLength: text ? text.length : 0,
    parseSource,
    formatAttempts,
  });

  if (text) text = cleanAssistantText(text, { final: true });

  return { text, status, contentType, topLevelKeys, parseSource, formatAttempts };
}

/**
 * Consume a readable stream into a string.
 */
function consumeStreamToString(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on("data", (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    stream.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    stream.on("error", reject);
  });
}

module.exports = {
  pickString,
  extractTextFromObject,
  extractTextFromStreamLine,
  parseRawBody,
  parseHttpResponse,
  consumeStreamToString,
  buildDebugMeta,
  safeTopLevelKeys,
  isHeartbeatLine,
  cleanAssistantText,
  logStreamChunk,
};
