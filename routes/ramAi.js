const express = require("express");
const rateLimit = require("express-rate-limit");
const {
  ALLOWED_ACTIONS,
  streamRamAiToClient,
  callRamAi,
  fetchRamAiStatus,
  cancelRamAiTask,
  findTaskIdForUser,
  publicQueueStatus,
  MAX_CUSTOM_PROMPT,
  buildUserPrompt,
} = require("../lib/ramAi");
const {
  prepareContextForAction,
  MAX_HTTP_JSON_BYTES,
  enforceMaxMessageLength,
} = require("../lib/ramAiPayload");
const { publicError, mapUpstreamFailure } = require("../lib/ramAiErrors");
const { resolveRequestModelId, fetchPublicModelList } = require("../lib/ramAiModels");
const { getCachedRamAiStatus } = require("../lib/ramAiStatusCache");
const {
  classifySignpackRelevance,
  enforceFocusedResponse,
  isOffTopicOutput,
} = require("../lib/ramAiGuardrails");

const STATUS_POLL_RATE_MSG =
  "Ram AI status is being checked too often. Waiting before retrying…";

function requireAuthSession(req, res, next) {
  if (req.session?.isAuth) return next();
  return res.status(401).json({
    ok: false,
    enabled: false,
    code: "UNAUTHORIZED",
    error: publicError("UNAUTHORIZED"),
  });
}

function ramAiUserTag(req) {
  const name =
    req.session?.user?.name ||
    req.session?.user?.username ||
    req.session?.user?._id ||
    "user";
  return "signpack:" + String(name).slice(0, 64);
}

function sessionRateKey(req) {
  if (req.sessionID) return "sess:" + req.sessionID;
  const user = req.session?.user?.name || req.session?.user?.username;
  if (user) return "user:" + user;
  return "ip:" + (req.ip || req.socket?.remoteAddress || "unknown");
}

function createRamAiLimiter(ramAi) {
  const windowMs = Math.min(
    Math.max(Number(ramAi.rateLimitWindowMs) || 60000, 10000),
    3600000
  );
  const max = Math.min(Math.max(Number(ramAi.rateLimitMax) || 20, 1), 120);

  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: sessionRateKey,
    handler: function (_req, res) {
      return res.status(429).json({
        ok: false,
        enabled: true,
        code: "RATE_LIMIT",
        error: publicError("RATE_LIMIT"),
      });
    },
  });
}

/** Lighter limit for GET /status (cached upstream; separate from helper POST budget). */
function createRamAiStatusLimiter(ramAi) {
  const windowMs = Math.min(
    Math.max(Number(ramAi.rateLimitWindowMs) || 60000, 10000),
    3600000
  );
  const max = Math.min(Math.max(Number(ramAi.statusRateLimitMax) || 45, 20), 120);

  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: function (req) {
      return "status:" + sessionRateKey(req);
    },
    handler: function (_req, res) {
      return res.status(429).json({
        ok: false,
        enabled: true,
        code: "STATUS_POLL_RATE",
        error: STATUS_POLL_RATE_MSG,
        retryAfterMs: 10000,
      });
    },
  });
}

function writeNdjson(res, obj) {
  if (res.writableEnded) return;
  res.write(JSON.stringify(obj) + "\n");
}

function createRamAiRouter({ ramAi }) {
  const router = express.Router();
  const helperLimiter = createRamAiLimiter(ramAi);
  const statusLimiter = createRamAiStatusLimiter(ramAi);

  router.use(requireAuthSession);
  router.use(express.json({ limit: Math.min(MAX_HTTP_JSON_BYTES, 512 * 1024) }));

  router.get("/models", async (req, res) => {
    if (!ramAi.enabled) {
      return res.json({
        ok: true,
        enabled: false,
        default: null,
        models: [],
      });
    }

    try {
      const payload = await fetchPublicModelList(ramAi);
      return res.json({
        ok: true,
        enabled: true,
        default: payload.default,
        models: payload.models,
      });
    } catch (_err) {
      const { DEFAULT_MODEL_LABEL } = require("../lib/ramAiModels");
      return res.json({
        ok: true,
        enabled: true,
        default: ramAi.defaultModel || DEFAULT_MODEL_LABEL,
        models: [{ name: ramAi.defaultModel || DEFAULT_MODEL_LABEL }],
      });
    }
  });

  router.get("/status", statusLimiter, async (req, res) => {
    if (!ramAi.enabled) {
      return res.json({ ok: true, enabled: false, state: "offline" });
    }

    const inFlight = !!req.session.ramAiInFlight;
    const statusOpts = {
      userTaskId: req.session.ramAiActiveTaskId || null,
      userTag: req.session.ramAiUserTag || ramAiUserTag(req),
    };

    try {
      const raw = await getCachedRamAiStatus(ramAi, fetchRamAiStatus);
      const payload = publicQueueStatus(raw, true, inFlight, statusOpts);
      return res.json({ ok: true, ...payload });
    } catch (err) {
      if (inFlight) {
        return res.json({
          ok: true,
          enabled: true,
          state: "queued",
          busy: true,
          queued: true,
          generating: false,
          active: false,
          queuePosition: null,
          requestsAhead: null,
          positionKnown: false,
          status_unreachable: true,
        });
      }
      const mapped = mapUpstreamFailure(err);
      return res.status(502).json({
        ok: false,
        enabled: true,
        state: "offline",
        code: mapped.code,
        error: mapped.message,
      });
    }
  });

  router.post("/cancel", helperLimiter, async (req, res) => {
    if (!ramAi.enabled) {
      return res.status(503).json({
        ok: false,
        code: "DISABLED",
        error: publicError("DISABLED"),
      });
    }

    if (!req.session.ramAiInFlight) {
      return res.status(400).json({
        ok: false,
        code: "NO_REQUEST",
        error: "No active Ram AI helper request to cancel.",
      });
    }

    const tag = req.session.ramAiUserTag || ramAiUserTag(req);
    let taskId = req.session.ramAiActiveTaskId || null;

    try {
      if (!taskId) {
        const status = await fetchRamAiStatus(ramAi);
        taskId = findTaskIdForUser(status, tag);
      }
    } catch (_err) {
      /* cancel may still clear in-flight */
    }

    req.session.ramAiInFlight = false;
    req.session.ramAiActiveTaskId = null;

    if (!taskId) {
      return res.json({
        ok: true,
        cancelled: false,
        message: "No queued task found. The request may have already finished.",
      });
    }

    try {
      await cancelRamAiTask(ramAi, taskId);
      return res.json({ ok: true, cancelled: true });
    } catch (err) {
      const mapped = mapUpstreamFailure(err);
      return res.json({
        ok: true,
        cancelled: false,
        message: mapped.message,
      });
    }
  });

  router.post("/helper", helperLimiter, async (req, res) => {
    if (!ramAi.enabled) {
      return res.status(503).json({
        ok: false,
        enabled: false,
        code: "DISABLED",
        error: publicError("DISABLED"),
      });
    }

    const action =
      typeof req.body?.action === "string" ? req.body.action.trim() : "";
    if (!ALLOWED_ACTIONS.has(action)) {
      return res.status(400).json({
        ok: false,
        code: "BAD_ACTION",
        error: publicError("BAD_ACTION"),
      });
    }

    let context;
    let payloadWarnings = [];
    try {
      const prepared = prepareContextForAction(action, req.body?.context, ramAi);
      context = prepared.context;
      payloadWarnings = prepared.warnings || [];
    } catch (prepErr) {
      console.warn("[ram-ai] context prepare:", prepErr && prepErr.message);
      return res.status(400).json({
        ok: false,
        code: "BAD_REQUEST",
        error: publicError("BAD_REQUEST"),
      });
    }

    if (action === "validate_json") {
      const hasJson =
        typeof context.packJson === "string" && String(context.packJson).trim().length > 0;
      const hasSummary = context.packSummary && typeof context.packSummary === "object";
      if (!hasJson && !hasSummary) {
        return res.status(400).json({
          ok: false,
          code: "BAD_REQUEST",
          error: "No signs.json data to review. Open a signpack first.",
        });
      }
    }

    if (action === "ask" || action === "custom_prompt") {
      const q = String(context.question || "").trim();
      if (!q) {
        return res.status(400).json({
          ok: false,
          code: "BAD_REQUEST",
          error: "Please enter a question or prompt.",
        });
      }
      if (q.length > MAX_CUSTOM_PROMPT) {
        return res.status(400).json({
          ok: false,
          code: "BAD_REQUEST",
          error: "Prompt is too long. Please shorten it.",
        });
      }
    }
    if (action === "convert_color" && !String(context.colorInput || "").trim()) {
      return res.status(400).json({
        ok: false,
        code: "BAD_REQUEST",
        error: "Enter a color name or hex to convert.",
      });
    }
    if (action === "explain_field" && !String(context.field || "").trim()) {
      return res.status(400).json({
        ok: false,
        code: "BAD_REQUEST",
        error: "Select a field first.",
      });
    }

    const outboundMsg = enforceMaxMessageLength(buildUserPrompt(action, context), ramAi);
    const relevance = classifySignpackRelevance({
      action,
      context,
      userText: String(context && context.question ? context.question : outboundMsg),
    });
    if (ramAi.debug) {
      console.log(
        "[ram-ai:guardrail] action=%s allowed=%s score=%d category=%s",
        action,
        relevance.allowed,
        Number(relevance.score || 0),
        relevance.category
      );
    }
    if (!relevance.allowed) {
      return res.status(400).json({
        ok: false,
        enabled: true,
        code: "OFF_TOPIC",
        error: relevance.message,
        guardrail: {
          score: relevance.score,
          category: relevance.category,
          suggestions: relevance.suggestions,
        },
      });
    }
    const msgLen = outboundMsg.length;
    let contextTier = "small";
    if (msgLen >= 14000) contextTier = "large";
    else if (msgLen >= 5000) contextTier = "medium";
    if (ramAi.debug) {
      const keys = Object.keys(context || {});
      const ctxKinds = [];
      if (context && context.includeSignMeta) ctxKinds.push("selected-sign");
      if (context && context.includeTextlines) ctxKinds.push("textlines");
      if (context && context.includePackSummary) ctxKinds.push("pack-summary");
      if (context && context.includePackJson) ctxKinds.push("pack-json");
      if (context && context.includePackName) ctxKinds.push("pack-name");
      console.log(
        "[ram-ai:debug] action=%s promptLen=%d contextKeys=%s contextKinds=%s",
        action,
        msgLen,
        keys.join(","),
        ctxKinds.join(",")
      );
    }

    const tag = ramAiUserTag(req);
    const modelId = resolveRequestModelId(req.body?.model, ramAi);
    req.session.ramAiUserTag = tag;
    req.session.ramAiInFlight = true;
    req.session.ramAiActiveTaskId = null;

    const started = Date.now();
    let clientClosed = false;

    const finish = () => {
      req.session.ramAiInFlight = false;
    };

    req.on("close", () => {
      clientClosed = true;
      finish();
    });

    const useStream = req.body?.stream !== false;

    if (useStream) {
      res.status(200);
      res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no");
      if (typeof res.flushHeaders === "function") {
        res.flushHeaders();
      }

      writeNdjson(res, { event: "phase", phase: "connecting" });
      writeNdjson(res, {
        event: "meta",
        contextTier,
        outboundChars: msgLen,
        warnings: payloadWarnings,
      });

      try {
        let streamedText = "";
        const result = await streamRamAiToClient(
          ramAi,
          action,
          context,
          tag,
          (obj) => {
            if (clientClosed) return;
            if (obj.event === "chunk" && obj.text) {
              streamedText += obj.text;
            }
          },
          modelId
        );

        if (result && result.task_id) {
          req.session.ramAiActiveTaskId = result.task_id;
          if (!clientClosed) {
            res.setHeader("X-RamAI-Task-ID", result.task_id);
          }
        }

        finish();
        if (!clientClosed) {
          const safeText = enforceFocusedResponse(streamedText);
          if (safeText) {
            writeNdjson(res, { event: "chunk", text: safeText });
          }
          writeNdjson(res, {
            event: "done",
            ok: true,
            latencyMs: Date.now() - started,
          });
          res.end();
        }
        console.log(
          "[ram-ai] stream action=%s user=%s ms=%d",
          action,
          req.session?.user?.name || "?",
          Date.now() - started
        );
        return;
      } catch (streamErr) {
        try {
          const fallback = await callRamAi(ramAi, action, context, tag, modelId);
          finish();
          if (!clientClosed) {
            writeNdjson(res, { event: "chunk", text: enforceFocusedResponse(fallback.text) });
            writeNdjson(res, {
              event: "done",
              ok: true,
              latencyMs: Date.now() - started,
              fallback: true,
            });
            res.end();
          }
          return;
        } catch (fallbackErr) {
          finish();
          const mapped = mapUpstreamFailure(fallbackErr || streamErr);
          console.warn(
            "[ram-ai] stream action=%s user=%s code=%s",
            action,
            req.session?.user?.name || "?",
            mapped.code
          );
          if (!clientClosed) {
            writeNdjson(res, {
              event: "error",
              ok: false,
              code: mapped.code,
              error: mapped.message,
            });
            res.end();
          }
          return;
        }
      }
    }

    try {
      const result = await callRamAi(ramAi, action, context, tag, modelId);
      finish();
      const safeText = enforceFocusedResponse(result.text);
      if (ramAi.debug && isOffTopicOutput(result.text)) {
        console.log("[ram-ai:guardrail] replaced off-topic upstream response");
      }
      return res.json({
        ok: true,
        enabled: true,
        text: safeText,
        latencyMs: Date.now() - started,
      });
    } catch (err) {
      finish();
      const mapped = mapUpstreamFailure(err);
      const httpStatus =
        mapped.code === "TIMEOUT" ? 408 : mapped.code === "AUTH" ? 502 : 502;
      return res.status(httpStatus).json({
        ok: false,
        enabled: true,
        code: mapped.code,
        error: mapped.message,
      });
    }
  });

  return router;
}

module.exports = { createRamAiRouter, requireAuthSession };
