/**
 * Ram AI proxy — POST /api/ask, GET /status, POST /task/stop
 * @see https://ai.rambot.xyz/docs
 *
 * Streaming (stream: true): ignore lines starting with ":" (heartbeats);
 * read X-RamAI-Task-ID from headers; append only assistant text to UI.
 */

const axios = require("axios");
const { getDefaultModelId } = require("./ramAiModels");
const {
  extractTextFromStreamLine,
  parseRawBody,
  parseHttpResponse,
  buildDebugMeta,
  safeTopLevelKeys,
  cleanAssistantText,
  logStreamChunk,
} = require("./ramAiParse");
const {
  MAX_CUSTOM_PROMPT,
  MAX_SIGNS_JSON_CHARS,
  enforceMaxMessageLength,
  deepStripContext,
} = require("./ramAiPayload");

const TC_WIKI =
  "https://github.com/CSX8600/trafficcontrol/wiki/Making-a-Custom-Sign-Pack";

const SYSTEM_PROMPT = `You help users edit signpacks in Signpack Maker for Minecraft Traffic Control.

Follow official Traffic Control signpack rules (ZIP + signs.json, PNG square textures).
Pack: name, pack_id (UUID), signs[]. Optional: author, types.
Sign: id, name, type, front required. Optional: back, tooltip, note, halfheight, textlines.
Do not use deprecated "variant". Textline color is an integer (e.g. red #FF0000 = 16711680).
Textlines use a 16×16 grid. Keep answers short and practical. Do not claim you changed files.
Wiki: ${TC_WIKI}

You are embedded inside Signpack Maker and are NOT a general-purpose chatbot.
Stay focused on:
- Traffic Control signpacks
- signs.json structure and troubleshooting
- textlines and formatting
- sign image/texture setup
- Signpack Maker editor workflows (import/export, multi-block, organization)
- Multi-block sign textures: Traffic Control usually works best at 64×64 PNG tiles (power-of-two)

If the user asks for unrelated help, respond only with this sentence and do not provide unrelated instructions:
"Ram AI in Signpack Maker is focused on Traffic Control signpacks and editor help. I can help with signs.json, textlines, sign textures, multi-block signs, importing/exporting packs, or using this editor."`;

const ALLOWED_ACTIONS = new Set([
  "ask",
  "custom_prompt",
  "explain_field",
  "suggest_metadata",
  "suggest_tooltip",
  "suggest_note",
  "help_textlines",
  "convert_color",
  "generate_readme",
  "validate_json",
]);

function buildAuthHeaders(ramAiConfig) {
  const headers = { "Content-Type": "application/json" };
  const key = ramAiConfig.apiKey;
  if (key) {
    headers.Authorization = "Bearer " + key;
    headers["x-api-key"] = key;
  }
  return headers;
}

/** @deprecated Prefer prepareContextForAction in routes */
function sanitizeContext(context) {
  return deepStripContext(context || {});
}

function truncateStr(s, max) {
  if (typeof s !== "string") return s;
  return s.length > max ? s.slice(0, max) + "…" : s;
}

function buildUserPrompt(action, context) {
  const ctx = JSON.stringify(context, null, 2);
  switch (action) {
    case "ask": {
      const q = truncateStr(String(context.question || "").trim(), MAX_CUSTOM_PROMPT);
      const usesContext =
        context.includePackName ||
        context.includeSignMeta ||
        context.includeTextlines ||
        context.includePackJson ||
        context.includePackSummary ||
        context.selectedSignDetail;
      if (usesContext) {
        return buildCustomPromptMessage(context);
      }
      return q || "Help with Traffic Control signpack editing.";
    }

    case "custom_prompt":
      return buildCustomPromptMessage(context);

    case "explain_field":
      return `Explain the Traffic Control signpack field "${context.field || "unknown"}" for Signpack Maker.
Section: ${context.section || "general"}.
${context.hint ? "Hint: " + context.hint : ""}
Short answer (2–6 sentences).`;

    case "suggest_metadata":
      return `Suggest optional sign metadata (advisory only; user copies manually):
Sign name: ${context.signName || "(not set)"}
Type folder: ${context.signType || "(not set)"}
Front texture: ${context.frontFilename || "(not set)"}
Current tooltip: ${context.tooltip || "(empty)"}
Suggest tooltip, note, textline labels, formatting tips. Bullets only.`;

    case "suggest_tooltip":
      return `Suggest a short in-game tooltip for this Traffic Control sign (one or two sentences). User copies manually.
Sign name: ${context.signName || "(not set)"}
Type: ${context.signType || "(not set)"}
Current tooltip: ${context.tooltip || "(empty)"}
Reply with suggested tooltip text only, plus one alternate if helpful.`;

    case "suggest_note":
      return `Suggest a short optional "note" metadata string for this sign in signs.json (internal/description). User copies manually.
Sign name: ${context.signName || "(not set)"}
Type: ${context.signType || "(not set)"}
Reply with 1–2 note ideas as bullets.`;

    case "help_textlines": {
      const tl = truncateStr(
        JSON.stringify(context.textlinesSummary || []),
        MAX_SIGNS_JSON_CHARS
      );
      return `Suggest textline ideas for a Traffic Control sign (16×16 grid). Advisory only.
Sign name: ${context.signName || "(not set)"}
Current textlines summary: ${tl}
Suggest label names and rough x, y, width ideas. Do not output full JSON unless asked. Bullets.`;
    }

    case "convert_color":
      return `Convert this to Traffic Control textline color as an INTEGER for signs.json (not hex in JSON).
Input: "${context.colorInput || ""}"
Give: integer value, hex reference (#RRGGBB), and one-line usage. If ambiguous, list 2–3 common options.`;

    case "generate_readme":
      return `Write a short README/description for a Traffic Control signpack (markdown, under 200 words). User copies manually.
Pack name: ${context.packName || "Untitled"}
Sign count: ${context.signCount ?? "?"}
Type folders: ${(context.typeFolders || []).join(", ") || "unknown"}
Mention install folder .minecraft/tc_signpacks and reload F3 + ].`;

    case "validate_json": {
      const note = context.reviewNote ? String(context.reviewNote) : "";
      if (context.reviewMode === "summary" && context.packSummary) {
        return `Review signs.json for Traffic Control. Warnings only (bullets). No full rewrite. Flag deprecated variant, missing fields, PNG/grid issues.

${note ? note + "\n\n" : ""}Full JSON was too large for this request — use this summarized review context:

${truncateStr(JSON.stringify(context.packSummary, null, 2), MAX_SIGNS_JSON_CHARS)}
${
  context.packJson && String(context.packJson).trim()
    ? "\n\nPartial signs.json excerpt (truncated):\n" + truncateStr(String(context.packJson), 4000)
    : ""
}`;
      }
      const pj = truncateStr(String(context.packJson || ""), MAX_SIGNS_JSON_CHARS);
      return `Review signs.json for Traffic Control. Warnings only (bullets). No full rewrite. Flag deprecated variant, missing fields, PNG/grid issues.

${note ? "Note: " + note + "\n\n" : ""}Pack data:
${pj}`;
    }

    default:
      return `Help with Traffic Control signpack editing.\n${ctx}`;
  }
}

function buildCustomPromptMessage(context) {
  const question = truncateStr(String(context.question || "").trim(), MAX_CUSTOM_PROMPT);
  const blocks = [];
  if (context.includePackName && context.packName) {
    blocks.push("Pack name: " + context.packName);
  }
  if (context.includeSignMeta) {
    if (context.selectedSignDetail && typeof context.selectedSignDetail === "object") {
      blocks.push("Selected sign: " + truncateStr(JSON.stringify(context.selectedSignDetail), 4200));
    } else {
      blocks.push(
        "Sign: " +
          JSON.stringify(
            {
              name: context.signName,
              type: context.signType,
              front: context.frontFilename,
              tooltip: context.tooltip,
            },
            null,
            0
          )
      );
    }
  }
  if (context.includeTextlines && context.textlinesSummary) {
    blocks.push(
      "Textlines: " + truncateStr(JSON.stringify(context.textlinesSummary), MAX_SIGNS_JSON_CHARS)
    );
  }
  if (context.includePackSummary && context.packSummary) {
    blocks.push(
      "signs.json summary:\n" + truncateStr(JSON.stringify(context.packSummary, null, 2), MAX_SIGNS_JSON_CHARS)
    );
  }
  if (context.includePackJson && context.packJsonPreview) {
    blocks.push("signs.json preview:\n" + truncateStr(context.packJsonPreview, MAX_SIGNS_JSON_CHARS));
  }
  const ctxBlock = blocks.length ? "\n\nIncluded context:\n" + blocks.join("\n") : "";
  return (
    "Traffic Control signpack helper question (advisory only; user copies answers manually):\n\n" +
    question +
    ctxBlock
  );
}

function extractTaskId(task) {
  if (!task) return null;
  if (typeof task === "string") return task.slice(0, 128);
  if (typeof task === "object") {
    const id = task.task_id || task.id || task.taskId;
    return typeof id === "string" ? id.slice(0, 128) : null;
  }
  return null;
}

function extractTaskUserId(task) {
  if (!task || typeof task !== "object") return null;
  const uid = task.user_id || task.userId || task.client_id;
  return typeof uid === "string" ? uid : null;
}

/** Public-safe queue status for the browser. */
function sanitizeRamAiStatus(raw) {
  if (!raw || typeof raw !== "object") {
    return { online: false, busy: false, tasks_waiting: 0 };
  }

  const tasks = Array.isArray(raw.tasks) ? raw.tasks : [];
  const activeTasks = Array.isArray(raw.active_tasks) ? raw.active_tasks : [];

  return {
    online: true,
    busy: !!raw.busy,
    active_task_id:
      typeof raw.active_task_id === "string" ? raw.active_task_id.slice(0, 128) : null,
    active_tasks: activeTasks
      .slice(0, 10)
      .map((t) => extractTaskId(t))
      .filter(Boolean),
    tasks_waiting: tasks.length,
    _tasks: tasks,
  };
}

const { buildPublicQueuePayload, findTaskIdForUser } = require("./ramAiQueue");

async function fetchRamAiStatus(ramAiConfig) {
  const url = ramAiConfig.baseUrl + "/status";
  let res;
  try {
    res = await axios.get(url, {
      headers: buildAuthHeaders(ramAiConfig),
      timeout: Math.min(ramAiConfig.timeoutMs, 15000),
      validateStatus: () => true,
    });
  } catch (netErr) {
    const err = new Error("Ram AI status unreachable");
    err.code =
      netErr.code === "ECONNABORTED" || /timeout/i.test(String(netErr.message || ""))
        ? "TIMEOUT"
        : "UPSTREAM";
    throw err;
  }

  if (res.status === 401 || res.status === 403) {
    const err = new Error("Ram AI authentication failed");
    err.code = "AUTH";
    throw err;
  }

  if (res.status < 200 || res.status >= 300) {
    const err = new Error("Ram AI status error");
    err.code = "UPSTREAM";
    throw err;
  }

  return sanitizeRamAiStatus(res.data);
}

async function cancelRamAiTask(ramAiConfig, taskId) {
  const url = ramAiConfig.baseUrl + "/task/stop";
  let res;
  try {
    res = await axios.post(
      url,
      { task_id: taskId },
      {
        headers: buildAuthHeaders(ramAiConfig),
        timeout: 10000,
        validateStatus: () => true,
      }
    );
  } catch (netErr) {
    const err = new Error("Ram AI cancel failed");
    err.code = "UPSTREAM";
    throw err;
  }

  if (res.status >= 200 && res.status < 300) {
    return true;
  }
  const err = new Error("Ram AI cancel rejected");
  err.code = "UPSTREAM";
  throw err;
}

function buildAskBody(ramAiConfig, message, userTag, useStream, modelId) {
  const body = {
    message,
    stream: useStream !== false,
    system: SYSTEM_PROMPT,
    user_id: userTag,
    max_tokens: 0,
  };
  const id =
    typeof modelId === "string" && modelId.trim()
      ? modelId.trim()
      : getDefaultModelId(ramAiConfig);
  if (id) body.model = id;
  return body;
}

function getTaskIdFromHeaders(headers) {
  if (!headers) return null;
  const id =
    headers["x-ramai-task-id"] ||
    headers["X-RamAI-Task-ID"] ||
    headers["x-ramai-task-id".toLowerCase()];
  return typeof id === "string" ? id.slice(0, 128) : null;
}

function throwParseFailure(meta, ramAiConfig) {
  buildDebugMeta(ramAiConfig, {
    status: meta.status,
    contentType: meta.contentType,
    topLevelKeys: meta.topLevelKeys,
    textLength: 0,
    parseSource: "",
    formatAttempts: meta.formatAttempts || [],
  });
  const err = new Error("Ram AI response format not recognized");
  err.code = "PARSE_FAIL";
  throw err;
}

function emitParsedText(text, writeLine) {
  if (!text || !writeLine) return false;
  writeLine({ event: "chunk", text });
  return true;
}

/**
 * Stream Ram AI /api/ask → NDJSON lines for the browser proxy.
 * @param {(obj: object) => void} writeLine
 */
async function streamRamAiToClient(ramAiConfig, action, context, userTag, writeLine, modelId) {
  const message = enforceMaxMessageLength(buildUserPrompt(action, context), ramAiConfig);
  const url = ramAiConfig.baseUrl + "/api/ask";
  const body = buildAskBody(ramAiConfig, message, userTag, true, modelId);

  if (ramAiConfig.debug) {
    console.log("[ram-ai:debug] POST /api/ask stream=true content-type=application/json");
  }

  let response;
  try {
    response = await axios.post(url, body, {
      headers: buildAuthHeaders(ramAiConfig),
      responseType: "stream",
      timeout: 0,
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
      validateStatus: () => true,
    });
  } catch (netErr) {
    const err = new Error("Ram AI network error");
    err.code = netErr.code === "ECONNREFUSED" || netErr.code === "ENOTFOUND" ? "NETWORK" : "UPSTREAM";
    throw err;
  }

  const status = response.status;
  const contentType = String(response.headers["content-type"] || "");
  const taskId = getTaskIdFromHeaders(response.headers);

  if (status === 401 || status === 403) {
    const err = new Error("Ram AI authentication failed");
    err.code = "AUTH";
    throw err;
  }

  if (status >= 500 || status >= 400) {
    const err = new Error(status >= 500 ? "Ram AI server error" : "Ram AI request rejected");
    err.code = "UPSTREAM";
    throw err;
  }

  if (status < 200 || status >= 300) {
    const err = new Error("Ram AI upstream error");
    err.code = "UPSTREAM";
    throw err;
  }

  const stream = response.data;
  let rawAccumulator = "";
  let lineBuffer = "";
  let gotContent = false;
  let formatAttempts = [];

  const tryFinalizeRaw = () => {
    if (gotContent) return true;
    const parsed = parseRawBody(rawAccumulator, contentType);
    formatAttempts = formatAttempts.concat(parsed.attempts);
    if (parsed.text) {
      const cleaned = cleanAssistantText(parsed.text, { final: true });
      gotContent = emitParsedText(cleaned, writeLine);
      buildDebugMeta(ramAiConfig, {
        status,
        contentType,
        topLevelKeys: [],
        textLength: parsed.text.length,
        parseSource: "stream-body-fallback",
        formatAttempts,
      });
      return true;
    }
    return false;
  };

  return new Promise((resolve, reject) => {
    const timeoutMs = Number(ramAiConfig && ramAiConfig.timeoutMs) || 0;
    let inactivityTimer = null;
    let sawAnyStreamData = false;

    function clearInactivityTimer() {
      if (inactivityTimer) {
        clearTimeout(inactivityTimer);
        inactivityTimer = null;
      }
    }

    function bumpInactivityTimer() {
      if (!timeoutMs || timeoutMs <= 0) return;
      clearInactivityTimer();
      inactivityTimer = setTimeout(() => {
        stream.destroy();
        const err = new Error("Ram AI stream inactive");
        err.code = "TIMEOUT";
        reject(err);
      }, timeoutMs);
    }

    bumpInactivityTimer();

    stream.on("data", (chunk) => {
      sawAnyStreamData = true;
      bumpInactivityTimer();
      const piece = chunk.toString("utf8");
      rawAccumulator += piece;
      lineBuffer += piece;
      let newlineAt;
      while ((newlineAt = lineBuffer.indexOf("\n")) >= 0) {
        const line = lineBuffer.slice(0, newlineAt);
        lineBuffer = lineBuffer.slice(newlineAt + 1);
        const parsed = extractTextFromStreamLine(line);
        if (parsed && parsed.text) {
          gotContent = true;
          formatAttempts.push("stream-line");
          logStreamChunk(ramAiConfig, {
            chunkType: parsed.chunkType,
            textLength: parsed.text.length,
          });
          writeLine({ event: "chunk", text: parsed.text });
        }
      }
    });

    stream.on("end", async () => {
      clearInactivityTimer();
      try {
        if (lineBuffer) {
          const parsed = extractTextFromStreamLine(lineBuffer);
          if (parsed && parsed.text) {
            gotContent = true;
            formatAttempts.push("stream-tail");
            logStreamChunk(ramAiConfig, {
              chunkType: parsed.chunkType,
              textLength: parsed.text.length,
            });
            writeLine({ event: "chunk", text: parsed.text });
          }
        }

        if (!gotContent) {
          tryFinalizeRaw();
        }

        if (!gotContent) {
          let topLevelKeys = [];
          try {
            topLevelKeys = safeTopLevelKeys(JSON.parse(rawAccumulator));
          } catch (_e) {
            /* not JSON */
          }
          throwParseFailure(
            {
              status,
              contentType,
              topLevelKeys,
              formatAttempts,
            },
            ramAiConfig
          );
        }

        logStreamChunk(ramAiConfig, {
          chunkType: "complete",
          textLength: rawAccumulator.length,
          streamComplete: true,
          parseSource: "stream-chunks",
        });

        buildDebugMeta(ramAiConfig, {
          status,
          contentType,
          topLevelKeys: [],
          textLength: rawAccumulator.length,
          parseSource: "stream-chunks",
          formatAttempts,
        });

        resolve({ task_id: taskId });
      } catch (e) {
        reject(e);
      }
    });

    stream.on("error", (streamErr) => {
      clearInactivityTimer();
      const err = new Error(streamErr.message || "Ram AI stream error");
      err.code = sawAnyStreamData || gotContent ? "UPSTREAM" : "NETWORK";
      reject(err);
    });
  });
}

async function callRamAi(ramAiConfig, action, context, userTag, modelId) {
  const url = ramAiConfig.baseUrl + "/api/ask";
  const prompt = enforceMaxMessageLength(buildUserPrompt(action, context), ramAiConfig);
  const body = buildAskBody(ramAiConfig, prompt, userTag, false, modelId);

  if (ramAiConfig.debug) {
    console.log("[ram-ai:debug] POST /api/ask stream=false content-type=application/json");
  }

  let res;
  try {
    res = await axios.post(url, body, {
      headers: buildAuthHeaders(ramAiConfig),
      timeout: ramAiConfig.timeoutMs,
      validateStatus: () => true,
    });
  } catch (netErr) {
    const err = new Error("Ram AI network error");
    err.code =
      netErr.code === "ECONNABORTED" || /timeout/i.test(String(netErr.message || ""))
        ? "TIMEOUT"
        : "UPSTREAM";
    throw err;
  }

  if (res.status === 401 || res.status === 403) {
    const err = new Error("Ram AI authentication failed");
    err.code = "AUTH";
    throw err;
  }

  if (res.status < 200 || res.status >= 300) {
    const err = new Error("Ram AI upstream error");
    err.code = "UPSTREAM";
    throw err;
  }

  const parsed = parseHttpResponse(res, ramAiConfig);
  if (!parsed.text) {
    throwParseFailure(parsed, ramAiConfig);
  }

  return {
    text: cleanAssistantText(parsed.text, { final: true }),
    task_id:
      (typeof res.data === "object" &&
        res.data &&
        typeof res.data.task_id === "string" &&
        res.data.task_id) ||
      null,
  };
}

function namedColorToInt(name) {
  const map = {
    red: 16711680,
    green: 65280,
    blue: 255,
    yellow: 16776960,
    white: 16777215,
    black: 0,
    orange: 16753920,
    cyan: 65535,
    magenta: 16711935,
    gray: 8421504,
    grey: 8421504,
    purple: 8388736,
    pink: 16761035,
    lime: 65280,
  };
  const key = String(name || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");
  return map[key];
}

function publicQueueStatus(sanitized, enabled, inFlight, opts) {
  return buildPublicQueuePayload(sanitized, enabled, inFlight, opts || {});
}

module.exports = {
  SYSTEM_PROMPT,
  ALLOWED_ACTIONS,
  MAX_CUSTOM_PROMPT,
  sanitizeContext,
  buildUserPrompt,
  callRamAi,
  streamRamAiToClient,
  fetchRamAiStatus,
  cancelRamAiTask,
  findTaskIdForUser,
  publicQueueStatus,
  namedColorToInt,
};
