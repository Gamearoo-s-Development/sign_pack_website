/**
 * Ram AI model labels (UI) ↔ upstream model ids. Server-only id resolution.
 * @see https://ai.rambot.xyz/docs
 */

const axios = require("axios");

/** Display label → upstream id (Signpack Maker defaults). */
const LABEL_TO_ID = {
  "Ram AI Code Agent 1.0 - fast": "ram-ai-7b",
  "Ram AI Code Agent 1.0 - slow": "ram-ai-32b",
  "Ram AI Code Agent 1.0": "ram-ai-32b",
  "Ram AI Chat 2.0 - medium": "ram-ai-2",
  "Ram AI Chat 2.0 - vision": "ram-ai-2-vision",
  "Ram AI Chat": "ram-ai-2",
  "Ram AI Chat 1.0 - fast": "ram-ai-1-fast",
  "Ram AI Chat 1.0 - medium": "ram-ai-1-medium",
  "Ram AI Chat 1.0 - slow": "ram-ai-1-slow",
  "Ram AI Vision 1.0 - medium": "ram-ai-vision",
};

/** Upstream id → preferred UI label. */
const ID_TO_LABEL = {
  "ram-ai-7b": "Ram AI Code Agent 1.0 - fast",
  "ram-ai-32b": "Ram AI Code Agent 1.0 - slow",
  "ram-ai-2": "Ram AI Chat 2.0 - medium",
  "ram-ai-2-vision": "Ram AI Chat 2.0 - vision",
  "ram-ai-1-fast": "Ram AI Chat 1.0 - fast",
  "ram-ai-1-medium": "Ram AI Chat 1.0 - medium",
  "ram-ai-1-slow": "Ram AI Chat 1.0 - slow",
  "ram-ai-vision": "Ram AI Vision 1.0 - medium",
};

const DEFAULT_MODEL_LABEL = "Ram AI Code Agent 1.0 - fast";

const ALL_KNOWN_LABELS = Array.from(new Set(Object.keys(LABEL_TO_ID)));

function normalizeKey(s) {
  return String(s || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[·•]/g, "-")
    .replace(/\s*-\s*/g, " - ");
}

function labelForId(id) {
  if (!id) return null;
  const key = String(id).trim();
  if (LABEL_TO_ID[key]) return key;
  return ID_TO_LABEL[key] || null;
}

function idForLabel(label) {
  if (!label) return null;
  const raw = String(label).trim();
  if (LABEL_TO_ID[raw]) return LABEL_TO_ID[raw];
  const norm = normalizeKey(raw);
  for (const entry of Object.entries(LABEL_TO_ID)) {
    if (normalizeKey(entry[0]) === norm) return entry[1];
  }
  if (ID_TO_LABEL[raw]) return raw;
  return null;
}

function getDefaultLabel(ramAiConfig) {
  const fromEnv = ramAiConfig && ramAiConfig.defaultModel;
  if (fromEnv && String(fromEnv).trim()) return String(fromEnv).trim();
  return DEFAULT_MODEL_LABEL;
}

function getDefaultModelId(ramAiConfig) {
  if (ramAiConfig && ramAiConfig.legacyModelId) {
    const legacy = String(ramAiConfig.legacyModelId).trim();
    if (legacy) return legacy;
  }
  const label = getDefaultLabel(ramAiConfig);
  return idForLabel(label) || "ram-ai-7b";
}

function getConfiguredAllowlist(ramAiConfig) {
  const list = ramAiConfig && ramAiConfig.allowedModels;
  return Array.isArray(list) && list.length ? list.slice() : null;
}

function isLabelAllowed(label, ramAiConfig) {
  const allow = getConfiguredAllowlist(ramAiConfig);
  if (!allow) return true;
  const norm = normalizeKey(label);
  return allow.some((a) => normalizeKey(a) === norm);
}

function buildAllowedLabelSet(ramAiConfig) {
  const allow = getConfiguredAllowlist(ramAiConfig);
  const defaultLabel = getDefaultLabel(ramAiConfig);
  const labels = new Set();

  if (allow && allow.length) {
    allow.forEach((name) => {
      const trimmed = String(name).trim();
      if (!trimmed) return;
      const id = idForLabel(trimmed);
      const label = labelForId(trimmed) || (id ? labelForId(id) : null) || trimmed;
      if (id || LABEL_TO_ID[trimmed]) labels.add(label);
      else labels.add(trimmed);
    });
  } else {
    ALL_KNOWN_LABELS.forEach((l) => labels.add(l));
  }

  labels.add(defaultLabel);
  const resolvedDefault = labelForId(defaultLabel) || defaultLabel;
  labels.add(resolvedDefault);

  return Array.from(labels).filter((l) => idForLabel(l) || LABEL_TO_ID[l]);
}

function filterLabelsByUpstreamIds(labels, upstreamIds) {
  if (!upstreamIds || !upstreamIds.length) return labels;
  const idSet = new Set(upstreamIds.map((id) => String(id).trim()));
  const filtered = labels.filter((label) => {
    const id = idForLabel(label);
    return id && idSet.has(id);
  });
  return filtered.length ? filtered : labels;
}

function buildAuthHeaders(ramAiConfig) {
  const headers = { "Content-Type": "application/json" };
  const key = ramAiConfig.apiKey;
  if (key) {
    headers.Authorization = "Bearer " + key;
    headers["x-api-key"] = key;
  }
  return headers;
}

function extractIdsFromStatus(data) {
  if (!data || typeof data !== "object") return [];
  const raw = data.available_models || data.models;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((m) => {
      if (typeof m === "string") return m.trim();
      if (m && typeof m === "object") return String(m.id || m.model || m.name || "").trim();
      return "";
    })
    .filter(Boolean);
}

function extractIdsFromOpenAiList(data) {
  if (!data || typeof data !== "object") return [];
  const list = data.data;
  if (!Array.isArray(list)) return [];
  return list
    .map((m) => (m && typeof m.id === "string" ? m.id.trim() : ""))
    .filter(Boolean);
}

async function fetchUpstreamModelIds(ramAiConfig) {
  if (!ramAiConfig || !ramAiConfig.enabled || !ramAiConfig.apiKey) return [];

  const headers = buildAuthHeaders(ramAiConfig);
  const timeout = Math.min(ramAiConfig.timeoutMs || 180000, 15000);

  try {
    const statusRes = await axios.get(ramAiConfig.baseUrl + "/status", {
      headers,
      timeout,
      validateStatus: () => true,
    });
    if (statusRes.status >= 200 && statusRes.status < 300) {
      const ids = extractIdsFromStatus(statusRes.data);
      if (ids.length) return ids;
    }
  } catch (_e) {
    /* try OpenAI list */
  }

  try {
    const modelsRes = await axios.get(ramAiConfig.baseUrl + "/v1/models", {
      headers,
      timeout,
      validateStatus: () => true,
    });
    if (modelsRes.status >= 200 && modelsRes.status < 300) {
      return extractIdsFromOpenAiList(modelsRes.data);
    }
  } catch (_e) {
    /* use catalog only */
  }

  return [];
}

/**
 * Resolve client-selected model name to upstream id (validated against allowlist).
 */
function resolveRequestModelId(clientModel, ramAiConfig) {
  const defaultId = getDefaultModelId(ramAiConfig);
  const raw = typeof clientModel === "string" ? clientModel.trim() : "";
  if (!raw) return defaultId;

  const id = idForLabel(raw);
  if (!id) return defaultId;

  const label = labelForId(raw) || raw;
  if (!isLabelAllowed(label, ramAiConfig)) return defaultId;

  return id;
}

/**
 * Public model list for GET /api/ram-ai/models (display names only).
 */
async function fetchPublicModelList(ramAiConfig) {
  const defaultLabel = getDefaultLabel(ramAiConfig);
  let labels = buildAllowedLabelSet(ramAiConfig);

  if (ramAiConfig.enabled && ramAiConfig.apiKey) {
    const upstreamIds = await fetchUpstreamModelIds(ramAiConfig);
    if (upstreamIds.length) {
      labels = filterLabelsByUpstreamIds(labels, upstreamIds);
      if (!labels.some((l) => normalizeKey(l) === normalizeKey(defaultLabel))) {
        labels.unshift(defaultLabel);
      }
    }
  }

  const seen = new Set();
  const models = [];
  labels.forEach((name) => {
    const norm = normalizeKey(name);
    if (seen.has(norm)) return;
    seen.add(norm);
    if (!idForLabel(name) && !LABEL_TO_ID[name]) return;
    models.push({ name });
  });

  if (!models.length) {
    models.push({ name: defaultLabel });
  }

  models.sort((a, b) => {
    if (normalizeKey(a.name) === normalizeKey(defaultLabel)) return -1;
    if (normalizeKey(b.name) === normalizeKey(defaultLabel)) return 1;
    return a.name.localeCompare(b.name);
  });

  return {
    default: defaultLabel,
    models,
  };
}

module.exports = {
  DEFAULT_MODEL_LABEL,
  LABEL_TO_ID,
  idForLabel,
  labelForId,
  getDefaultLabel,
  getDefaultModelId,
  resolveRequestModelId,
  fetchPublicModelList,
  buildAllowedLabelSet,
  isLabelAllowed,
};
