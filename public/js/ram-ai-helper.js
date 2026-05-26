/**
 * Ram AI chat drawer UI — same-origin /api/ram-ai/* only.
 */
(function () {
  var RAM_AI_LOGO = "https://ai.rambot.xyz/static/logo.png";

  var IDS = {
    launcher: "ramAiLauncherBtn",
    launcherBadge: "ramAiLauncherBadge",
    launcherQueueBadge: "ramAiLauncherQueueBadge",
    drawer: "ramAiDrawer",
    backdrop: "ramAiBackdrop",
    close: "ramAiCloseBtn",
    statusBadge: "ramAiIdleStatus",
    queueChip: "ramAiInlineQueueChip",
    queueStatus: "ramAiQueueStatus",
    typingRow: "ramAiTypingRow",
    typingLabel: "ramAiTypingLabel",
    messages: "ramAiChatMessages",
    composer: "ramAiCustomPrompt",
    cancel: "ramAiCancelBtn",
    tools: "ramAiResponseTools",
    copy: "ramAiCopyBtn",
    retry: "ramAiRetryBtn",
    followUp: "ramAiFollowUpBtn",
    clear: "ramAiClearResponseBtn",
    clearPrompt: "ramAiClearPromptBtn",
    insertTooltip: "ramAiInsertTooltipBtn",
    model: "ramAiModelSelect",
    toast: "ramAiToast",
  };

  var inFlight = false;
  var ramAiRequestActive = false;
  var drawerOpen = false;
  var ramAiStatusPollTimer = null;
  var statusPollState = "idle";
  var statusPollDelayMs = 0;
  var statusPollSession = 0;
  var statusPollActiveCount = 0;
  var helperAbort = null;
  var requestStartedAt = 0;
  var statusBackoffMs = 0;
  var statusStrikes = 0;
  var unreadCount = 0;
  var lastRawResponse = "";
  var streamingAiMessageId = null;
  var lastAiActivityAt = 0;
  var chatMessages = [];
  var lastRequestMeta = null;
  var defaultModelName = "Ram AI Code Agent 1.0 - fast";
  var LIMITS = { PROMPT: 2000, SIGNS_JSON: 12000, SELECTED_SIGN: 4000 };
  var GUARDRAIL_SUGGESTIONS = [
    { action: "validate_json", label: "Review signpack" },
    { action: "help_textlines", label: "Explain textlines" },
    { action: "explain_selected", label: "Help with sign types" },
    { action: "ask_quick", label: "Multi-block sign tips" },
    { action: "generate_readme", label: "Generate README" },
  ];
  var FOCUSED_REDIRECT_MESSAGE =
    "Ram AI in Signpack Maker is focused on Traffic Control signpacks and editor help. I can help with signs.json, textlines, sign textures, multi-block signs, importing/exporting packs, or using this editor.";
  var POLL_MS = {
    queued: 5000,
    generating: 3000,
    hidden: 12000,
    offlineRetry: 12000,
    inactiveCutoff: 120000,
    rateLimited: 10000,
  };

  var FIELD_HINTS = {
    packName: { field: "name", section: "pack", hint: "Pack display name in signs.json" },
    signtype_folder: { field: "type", section: "sign", hint: "Folder in ZIP" },
    signtype_label: { field: "types", section: "pack", hint: "Category label map" },
    signText: { field: "name", section: "sign", hint: "In-game sign name" },
    signTool: { field: "tooltip", section: "sign", hint: "In-game help" },
    front: { field: "front", section: "sign", hint: "PNG front texture" },
    back: { field: "back", section: "sign", hint: "Optional back PNG" },
    halfheight: { field: "halfheight", section: "sign", hint: "Half-height flag" },
    textlines: { field: "textlines", section: "sign", hint: "16x16 grid fields" },
    color: { field: "color", section: "textline", hint: "Integer color" },
  };

  function $(id) {
    return document.getElementById(id);
  }

  function md() {
    return typeof RamAiMarkdown !== "undefined" ? RamAiMarkdown : null;
  }

  function escapeHtml(s) {
    var helper = md();
    return helper ? helper.escapeHtml(String(s)) : String(s).replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function getEnabled() {
    return document.body.getAttribute("data-ram-ai-enabled") === "true";
  }

  function isDebug() {
    return document.body.getAttribute("data-ram-ai-debug") === "true";
  }

  function debugPoll(msg) {
    if (!isDebug()) return;
    console.log("[ram-ai:poll] " + msg);
  }

  function getPollMs() {
    var raw = parseInt(document.body.getAttribute("data-ram-ai-poll-ms") || "5000", 10);
    if (isNaN(raw)) return 5000;
    return Math.max(5000, Math.min(raw, 10000));
  }

  function cleanupText(raw, final) {
    var helper = md();
    if (helper) return helper.cleanupResponseText(raw || "", !!final);
    return String(raw || "").replace(/\r\n/g, "\n").replace(/\[stream_end\]|\[DONE\]/gi, "");
  }

  function renderMd(raw, final) {
    var text = cleanupText(raw, final);
    if (!text.trim()) return "";
    var helper = md();
    if (helper) return helper.render(text, { final: !!final });
    return "<p>" + escapeHtml(text).replace(/\n/g, "<br>") + "</p>";
  }

  function nowTime() {
    return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  function userChatMeta() {
    var avatar = document.body.getAttribute("data-user-avatar") || "";
    var initials = document.body.getAttribute("data-user-initials") || "?";
    var display = document.body.getAttribute("data-user-display") || "You";
    var username = document.body.getAttribute("data-user-username") || "";
    return { avatar: avatar, initials: initials, display: display, username: username };
  }

  function msgIdentity(role) {
    if (role === "system") {
      return { title: "System", subtitle: "Signpack Maker" };
    }
    if (role === "ai") {
      return { title: "Ram AI", subtitle: "AI Assistant" };
    }
    var meta = userChatMeta();
    return {
      title: meta.display || meta.username || "You",
      subtitle: meta.username ? "@" + meta.username : "Account user",
    };
  }

  function msgAvatarHtml(role) {
    if (role === "system") {
      return (
        '<img class="ram-ai-msg-avatar is-system" src="/images/brand/signpack-maker-logo.png" alt="Signpack Maker" width="28" height="28" />'
      );
    }
    if (role === "ai") {
      return (
        '<img class="ram-ai-msg-avatar is-ai" src="' +
        escapeHtml(RAM_AI_LOGO) +
        '" alt="Ram AI avatar" width="28" height="28" />'
      );
    }
    var meta = userChatMeta();
    if (meta.avatar) {
      return (
        '<img class="ram-ai-msg-avatar" src="' +
        escapeHtml(meta.avatar) +
        '" alt="' +
        escapeHtml((meta.display || "User") + " avatar") +
        '" width="28" height="28" />'
      );
    }
    return (
      '<span class="ram-ai-msg-avatar is-initials" aria-hidden="true">' +
      escapeHtml(meta.initials) +
      "</span>"
    );
  }

  function setLauncherBadge(text, mode) {
    var badge = $(IDS.launcherBadge);
    if (!badge) return;
    if (!text || isNaN(parseInt(text, 10))) {
      badge.hidden = true;
      badge.textContent = "";
      badge.className = "ram-ai-launcher-badge";
      return;
    }
    badge.hidden = false;
    badge.textContent = text;
    badge.className = "ram-ai-launcher-badge" + (mode ? " " + mode : "");
  }

  function setLauncherQueueBadge(text, mode) {
    var badge = $(IDS.launcherQueueBadge);
    if (!badge) return;
    if (!text) {
      badge.hidden = true;
      badge.textContent = "";
      badge.className = "ram-ai-launcher-queue-badge";
      return;
    }
    badge.hidden = false;
    badge.textContent = text;
    badge.className = "ram-ai-launcher-queue-badge" + (mode ? " " + mode : "");
  }

  function setStatusBadge(label, style) {
    var el = $(IDS.statusBadge);
    if (!el) return;
    el.textContent = label || "Available";
    el.className = "ram-ai-status-badge " + (style || "ram-ai-status-available");
  }

  function setQueueChip(text, show) {
    var chip = $(IDS.queueChip);
    if (!chip) return;
    chip.hidden = !show;
    if (show) chip.textContent = text || "Queued";
  }

  function showToast(text) {
    var toast = $(IDS.toast);
    if (!toast || drawerOpen || !text) return;
    toast.textContent = text;
    toast.hidden = false;
    toast.classList.add("show");
    setTimeout(function () {
      toast.classList.remove("show");
      setTimeout(function () {
        toast.hidden = true;
      }, 250);
    }, 2800);
  }

  function getSelectedModel() {
    var select = $(IDS.model);
    return select && select.value ? select.value : defaultModelName;
  }

  function setUiBusy(busy) {
    var selectors =
      "[data-ram-ai-action], #ramAiColorInput, #ramAiFieldSelect, #ramAiModelSelect, .ram-ai-context-opt input, .ram-ai-chip, .ram-ai-send-btn";
    document.querySelectorAll(selectors).forEach(function (el) {
      el.disabled = !!busy;
    });
    var cancelBtn = $(IDS.cancel);
    if (cancelBtn) cancelBtn.hidden = !busy;
    if (!busy) setTypingRow(false);
  }

  function setTypingRow(show, label) {
    var row = $(IDS.typingRow);
    var labelEl = $(IDS.typingLabel);
    if (!row) return;
    row.hidden = !show;
    if (labelEl && label) labelEl.textContent = label;
  }

  function scrollMessagesToEnd(smooth) {
    var box = $(IDS.messages);
    if (!box) return;
    var top = box.scrollHeight;
    if (smooth && box.scrollTo) {
      box.scrollTo({ top: top, behavior: "smooth" });
    } else {
      box.scrollTop = top;
    }
  }

  function emptyStateHtml() {
    return (
      '<div class="ram-ai-empty">' +
      '<p class="ram-ai-empty-lead">Hi — I can help with Traffic Control signpacks.</p>' +
      '<p class="ram-ai-empty-note">Nothing is sent until you send a message or choose a quick action.</p>' +
      '<div class="ram-ai-help-grid" role="list">' +
      '<div class="ram-ai-help-card" role="listitem">' +
      '<i class="fa fa-shield-halved" aria-hidden="true"></i>' +
      "<strong>Secure by design</strong>" +
      "<span>Requests are handled through Signpack Maker — credentials stay protected.</span>" +
      "</div>" +
      '<div class="ram-ai-help-card" role="listitem">' +
      '<i class="fa fa-hourglass-half" aria-hidden="true"></i>' +
      "<strong>Queue-aware</strong>" +
      "<span>Live status while Ram AI works — you can cancel anytime.</span>" +
      "</div>" +
      '<div class="ram-ai-help-card" role="listitem">' +
      '<i class="fa fa-lightbulb" aria-hidden="true"></i>' +
      "<strong>Advisory only</strong>" +
      "<span>You review suggestions and choose what to save.</span>" +
      "</div>" +
      "</div></div>"
    );
  }

  function ensureMessagesEmptyState() {
    var box = $(IDS.messages);
    if (!box) return;
    if (chatMessages.length) return;
    box.innerHTML = emptyStateHtml();
  }

  function isRelevantToSignpackMaker(prompt, context) {
    var text = String(prompt || "").toLowerCase().trim();
    var positive = [
      "signpack",
      "sign pack",
      "traffic control",
      "signs.json",
      "textline",
      "sign type",
      "sign texture",
      "fragment",
      "multi-block",
      "minecraft sign",
      "tooltip",
      "pack_id",
      "import",
      "export",
    ];
    var negative = [
      "discord bot",
      "discord.py",
      "bot token",
      "discord developer portal",
      "install discord",
      "pip install discord.py",
      "code me a discord bot",
      "make a website",
      "politics",
      "election",
      "roleplay",
      "trivia",
      "relationship advice",
      "medical advice",
      "system prompt",
      "jailbreak",
      "ignore previous instructions",
      "celebrity",
    ];

    function countHits(terms) {
      var c = 0;
      for (var i = 0; i < terms.length; i++) if (text.indexOf(terms[i]) !== -1) c++;
      return c;
    }

    var pos = countHits(positive);
    var neg = countHits(negative);
    var contextHint = !!(context && (context.packName || context.signType || context.signName || context.selectedSignDetail || context.packSummary || context.packJsonPreview));
    var jsonHint = text.indexOf("json") !== -1 && (text.indexOf("sign") !== -1 || text.indexOf("pack") !== -1);
    var score = pos * 2 - neg * 2 + (contextHint ? 2 : 0) + (jsonHint ? 2 : 0);
    var jailbreak = text.indexOf("ignore previous instructions") !== -1 || text.indexOf("system prompt") !== -1 || text.indexOf("jailbreak") !== -1;
    if (jailbreak) score -= 8;
    var allowed = !jailbreak && (score >= 2 || pos >= 1 || contextHint || jsonHint);
    var category = jailbreak ? "jailbreak" : allowed ? "on_topic" : "off_topic";

    return { allowed: allowed, score: score, category: category };
  }

  function isOffTopicOutput(text) {
    var t = String(text || "").toLowerCase();
    var bad = [
      "discord.py",
      "bot token",
      "discord developer portal",
      "pip install discord.py",
      "from discord.ext import commands",
      "discord.js",
      "make a website",
      "client.run(",
    ];
    for (var i = 0; i < bad.length; i++) {
      if (t.indexOf(bad[i]) !== -1) return true;
    }
    return false;
  }

  function pushGuardrailMessage() {
    return pushMessage(
      "system",
      FOCUSED_REDIRECT_MESSAGE,
      { done: true }
    );
  }

  function renderChat() {
    var box = $(IDS.messages);
    if (!box) return;
    if (!chatMessages.length) {
      ensureMessagesEmptyState();
      return;
    }
    var html = "";
    for (var i = 0; i < chatMessages.length; i++) {
      var m = chatMessages[i];
      var bubbleClass = m.role === "user" ? "user" : m.role === "system" ? "system" : "ai";
      var identity = msgIdentity(m.role);
      var body = m.role === "ai" ? renderMd(m.text || "", m.done) : "<p>" + escapeHtml(m.text || "") + "</p>";
      var suggestionsHtml = "";
      if (Array.isArray(m.suggestions) && m.suggestions.length) {
        var chips = m.suggestions
          .map(function (s) {
            return (
              '<button type="button" class="ram-ai-suggest-chip" data-ram-ai-action="' +
              escapeHtml(String(s.action || "ask_quick")) +
              '">' +
              escapeHtml(String(s.label || "Try this")) +
              "</button>"
            );
          })
          .join("");
        suggestionsHtml = '<div class="ram-ai-suggest-row">' + chips + "</div>";
      }

      html +=
        '<article class="ram-ai-msg ' +
        bubbleClass +
        '" data-mid="' +
        m.id +
        '">' +
        msgAvatarHtml(m.role) +
        '<div class="ram-ai-msg-col">' +
        '<div class="ram-ai-msg-head">' +
        '<div class="ram-ai-msg-who">' +
        '<strong class="ram-ai-msg-name">' +
        escapeHtml(identity.title) +
        "</strong>" +
        '<span class="ram-ai-msg-role">' +
        escapeHtml(identity.subtitle) +
        "</span></div>" +
        '<span class="ram-ai-msg-time">' +
        escapeHtml(m.time || "") +
        "</span></div>" +
        '<div class="ram-ai-msg-bubble">' +
        body +
        (m.streaming ? '<span class="ram-ai-stream-cursor" aria-hidden="true"></span>' : "") +
        suggestionsHtml +
        "</div>" +
        '<div class="ram-ai-msg-meta">' +
        (m.role === "ai" && m.text
          ? '<button class="ram-ai-msg-copy" data-copy-mid="' +
            m.id +
            '" type="button" aria-label="Copy message"><i class="fa fa-copy"></i></button>'
          : "") +
        "</div></div></article>";
    }
    box.innerHTML = html;
    scrollMessagesToEnd(true);
  }

  function pushMessage(role, text, extras) {
    var msg = Object.assign(
      {
        id: "m_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8),
        role: role,
        text: text || "",
        time: nowTime(),
        streaming: false,
        done: true,
      },
      extras || {}
    );
    chatMessages.push(msg);
    touchAiActivity();
    renderChat();
    syncResponseTools();
    if (!drawerOpen && role === "ai") {
      unreadCount += 1;
      setLauncherBadge(String(unreadCount), "is-unread");
    }
    return msg.id;
  }

  function syncResponseTools() {
    var tools = $(IDS.tools);
    if (!tools) return;
    var hasAi = chatMessages.some(function (m) {
      return m.role === "ai" && m.text && m.text.trim();
    });
    tools.hidden = !hasAi;
  }

  function updateMessage(id, updater) {
    for (var i = 0; i < chatMessages.length; i++) {
      if (chatMessages[i].id === id) {
        updater(chatMessages[i]);
        break;
      }
    }
    renderChat();
    touchAiActivity();
  }

  function setQueueStatusHtml(html) {
    var status = $(IDS.queueStatus);
    if (!status) return;
    if (!html) {
      status.hidden = true;
      status.innerHTML = "";
      return;
    }
    status.hidden = false;
    status.innerHTML = html;
  }

  function queueHtml(payload) {
    if (!payload) return "";
    if (payload.state === "generating" || payload.generating) {
      var elapsed = requestStartedAt ? Math.max(0, Math.floor((Date.now() - requestStartedAt) / 1000)) : 0;
      return (
        '<div class="ram-ai-live-status">' +
        '<span class="ram-ai-pill-sub ram-ai-status-byline">Ram AI</span>' +
        '<span class="ram-ai-pill ram-ai-pill-generating"><span class="ram-ai-pill-dot"></span> Generating…</span>' +
        '<span class="ram-ai-pill-sub">Ram AI is still generating. Elapsed ' + elapsed + "s</span></div>"
      );
    }
    if (payload.state === "queued" || payload.queued) {
      var pos =
        payload.queuePosition != null
          ? "Queue position: " + payload.queuePosition
          : "Waiting in queue…";
      var ahead =
        payload.requestsAhead != null && payload.requestsAhead > 0
          ? payload.requestsAhead + " ahead"
          : "";
      return (
        '<div class="ram-ai-live-status">' +
        '<span class="ram-ai-pill-sub ram-ai-status-byline">Ram AI</span>' +
        '<span class="ram-ai-pill ram-ai-pill-queued"><span class="ram-ai-pill-dot"></span> ' +
        escapeHtml(pos) +
        "</span>" +
        (ahead ? '<span class="ram-ai-pill-sub">' + escapeHtml(ahead) + "</span>" : "") +
        "</div>"
      );
    }
    return (
      '<div class="ram-ai-live-status">' +
      '<span class="ram-ai-pill-sub ram-ai-status-byline">Ram AI</span>' +
      '<span class="ram-ai-pill ram-ai-pill-waiting"><span class="ram-ai-pill-dot"></span> Waiting…</span>' +
      '<span class="ram-ai-pill-sub">Connecting to Ram AI</span></div>'
    );
  }

  function updateQueueUI(payload) {
    if (!inFlight) {
      setQueueStatusHtml("");
      setQueueChip("", false);
      setStatusBadge("Available", "ram-ai-status-available");
      setLauncherQueueBadge("", "");
      if (!drawerOpen && !unreadCount) setLauncherBadge("", "");
      return;
    }
    setQueueStatusHtml(queueHtml(payload));
    if (payload && (payload.state === "queued" || payload.queued)) {
      var qLabel = payload.queuePosition != null ? "Queue " + payload.queuePosition : "Queued";
      setQueueChip(qLabel, true);
      setStatusBadge("Queued", "ram-ai-status-queued");
      setTypingRow(true, "Waiting in queue…");
      if (!drawerOpen) {
        setLauncherQueueBadge(qLabel, "is-queued");
        setLauncherBadge("", "");
      }
    } else if (payload && (payload.state === "generating" || payload.generating || receivedChunk())) {
      setQueueChip("Generating", true);
      setStatusBadge("Generating", "ram-ai-status-thinking");
      setTypingRow(true, "Generating…");
      if (!drawerOpen) {
        setLauncherQueueBadge("Generating", "is-active");
        setLauncherBadge("", "");
      }
    } else if (payload && payload.state === "offline") {
      setQueueChip("Offline", true);
      setStatusBadge("Offline", "ram-ai-status-offline");
      setTypingRow(true, "Status unavailable…");
      if (!drawerOpen) {
        setLauncherQueueBadge("Offline", "is-active");
        setLauncherBadge("", "");
      }
    } else {
      setQueueChip("Waiting", true);
      setStatusBadge("Connecting", "ram-ai-status-busy");
      setTypingRow(true, "Waiting…");
      if (!drawerOpen) {
        setLauncherQueueBadge("Waiting", "is-active");
        setLauncherBadge("", "");
      }
    }
  }

  function receivedChunk() {
    return !!(streamingAiMessageId && chatMessages.some(function (m) { return m.id === streamingAiMessageId && m.text; }));
  }

  function touchAiActivity() {
    lastAiActivityAt = Date.now();
  }

  function nextPollDelayMs() {
    if (statusBackoffMs > 0) return statusBackoffMs;
    if (statusPollState === "generating") return POLL_MS.generating;
    if (statusPollState === "queued" || statusPollState === "connecting") return POLL_MS.queued;
    return 0;
  }

  function stopRamAiStatusPolling(reason) {
    if (ramAiStatusPollTimer) {
      clearTimeout(ramAiStatusPollTimer);
      ramAiStatusPollTimer = null;
      statusPollActiveCount = Math.max(0, statusPollActiveCount - 1);
    }
    statusPollDelayMs = 0;
    if (isDebug()) console.debug("Ram AI polling stopped", reason || "none");
  }

  function startRamAiStatusPolling(reason, delay) {
    stopRamAiStatusPolling("restart");
    if (!ramAiRequestActive || !drawerOpen) {
      if (isDebug()) console.debug("Ram AI polling skipped: idle");
      return;
    }
    var waitMs = Math.max(300, Number(delay || nextPollDelayMs()) || 0);
    if (!waitMs) {
      if (isDebug()) console.debug("Ram AI polling skipped: idle");
      return;
    }
    statusPollDelayMs = waitMs;
    var session = statusPollSession;
    statusPollActiveCount += 1;
    if (isDebug()) console.debug("Ram AI polling started", reason || "none");
    ramAiStatusPollTimer = setTimeout(function () {
      if (session !== statusPollSession) return;
      statusPollActiveCount = Math.max(0, statusPollActiveCount - 1);
      ramAiStatusPollTimer = null;
      pollStatus();
    }, waitMs);
  }

  function pollStatus() {
    if (!ramAiRequestActive || !drawerOpen) {
      stopRamAiStatusPolling("idle");
      return;
    }
    fetch("/api/ram-ai/status", { credentials: "same-origin" })
      .then(function (res) {
        if (res.status === 429) {
          statusStrikes = Math.min(statusStrikes + 1, 3);
          statusBackoffMs = statusStrikes === 1 ? 10000 : statusStrikes === 2 ? 20000 : 30000;
          statusPollState = "queued";
          updateQueueUI({ state: "queued", queued: true });
          setQueueStatusHtml(
            '<div class="ram-ai-live-status"><span class="ram-ai-pill ram-ai-pill-waiting"><span class="ram-ai-pill-dot"></span> Paused</span><span class="ram-ai-pill-sub">Status checks slowed — retrying soon</span></div>'
          );
          setTypingRow(true, "Waiting…");
          startRamAiStatusPolling("rate_limited", Math.max(statusBackoffMs, POLL_MS.rateLimited));
          return null;
        }
        statusStrikes = 0;
        statusBackoffMs = 0;
        return res.json();
      })
      .then(function (data) {
        if (!data) return;
        if (data.ok === false && data.code === "STATUS_POLL_RATE") {
          statusPollState = "queued";
          startRamAiStatusPolling("status_rate_limit", POLL_MS.rateLimited);
          return;
        }
        if (data.state === "generating" || data.generating) {
          statusPollState = "generating";
        } else if (data.state === "queued" || data.queued || data.state === "connecting") {
          statusPollState = data.state === "connecting" ? "connecting" : "queued";
        } else if (data.state === "offline") {
          statusPollState = "offline";
        } else {
          statusPollState = "idle";
        }
        updateQueueUI(data);
        if (statusPollState === "idle") {
          stopRamAiStatusPolling("idle");
          if (isDebug()) console.debug("Ram AI polling skipped: idle");
          return;
        }
        startRamAiStatusPolling("status_update", nextPollDelayMs());
      })
      .catch(function () {
        statusPollState = "offline";
        updateQueueUI({ state: "offline" });
        setStatusBadge("Offline", "ram-ai-status-offline");
        startRamAiStatusPolling("status_error", POLL_MS.offlineRetry);
      });
  }

  function fetchStatusOnce(reason) {
    if (!drawerOpen) return;
    fetch("/api/ram-ai/status", { credentials: "same-origin" })
      .then(function (res) {
        return res.json();
      })
      .then(function (data) {
        if (!data) return;
        if (!ramAiRequestActive) {
          setStatusBadge("Available", "ram-ai-status-available");
          setQueueChip("", false);
          setQueueStatusHtml("");
          if (isDebug()) console.debug("Ram AI polling skipped: idle");
          return;
        }
        updateQueueUI(data);
      })
      .catch(function () {
        if (isDebug()) console.debug("Ram AI polling skipped: idle");
      });
  }

  function setDrawerOpen(open) {
    var drawer = $(IDS.drawer);
    var backdrop = $(IDS.backdrop);
    var launcher = $(IDS.launcher);
    if (!drawer || !launcher) return;
    drawerOpen = !!open;
    drawer.classList.toggle("is-open", drawerOpen);
    drawer.setAttribute("aria-hidden", drawerOpen ? "false" : "true");
    launcher.setAttribute("aria-expanded", drawerOpen ? "true" : "false");
    launcher.classList.toggle("is-drawer-open", drawerOpen);
    if (backdrop) backdrop.hidden = !drawerOpen;
    if (drawerOpen) {
      touchAiActivity();
      unreadCount = 0;
      setLauncherBadge("", "");
      setLauncherQueueBadge("", "");
      var composer = $(IDS.composer);
      if (composer) composer.focus();
      renderChat();
      scrollMessagesToEnd(false);
      if (ramAiRequestActive) {
        startStatusLoop("drawer_open");
      } else {
        fetchStatusOnce("drawer_open_once");
      }
    } else if (inFlight) {
      updateQueueUI({ state: "connecting" });
      stopRamAiStatusPolling("drawer_closed");
    } else if (unreadCount) {
      setLauncherBadge(String(unreadCount), "is-unread");
    }
  }

  function currentFrontFilename() {
    var input = $("frontImageInput");
    if (input && input.files && input.files[0]) return input.files[0].name;
    var img = $("previewSignImage");
    if (img && img.src && img.src !== "#") {
      var parts = img.src.split("/");
      return parts[parts.length - 1].split("?")[0] || "";
    }
    return "";
  }

  function val(id) {
    var el = $(id);
    return el ? String(el.value || "").trim() : "";
  }

  function collectTextlinesDetail() {
    var lines = [];
    document.querySelectorAll("#textlinesContainer .editor-textline-card").forEach(function (card, i) {
      var get = function (suffix) {
        var input = card.querySelector('[name$="[' + suffix + ']"]');
        return input ? input.value : "";
      };
      lines.push({ index: i + 1, label: get("label"), x: get("x"), y: get("y"), width: get("width"), color: get("color") });
    });
    return lines;
  }

  function getPackSnapshot() {
    var el = $("ramAiPackSnapshot");
    if (!el || !el.textContent) return null;
    try {
      return JSON.parse(el.textContent);
    } catch (_e) {
      return null;
    }
  }

  function getSelectedSignIndex() {
    var sel = document.querySelector(".editor-picker-native[onchange*='updateSignIndex']");
    if (!sel || sel.value === "") return -1;
    return parseInt(sel.value, 10);
  }

  function buildPackJsonForReview() {
    var snap = getPackSnapshot();
    if (!snap) return JSON.stringify({ name: val("packName"), signs: [] }, null, 2);
    var clone = JSON.parse(JSON.stringify(snap));
    clone.name = val("packName") || clone.name;
    var idx = getSelectedSignIndex();
    if (clone.signs && idx >= 0 && clone.signs[idx]) {
      clone.signs[idx].name = val("signText") || clone.signs[idx].name;
      clone.signs[idx].type = val("signtype_folder") || clone.signs[idx].type;
      clone.signs[idx].tooltip = val("signTool") || clone.signs[idx].tooltip;
    }
    return JSON.stringify(clone, null, 2);
  }

  function signContextBase() {
    return {
      signName: val("signText"),
      signType: val("signtype_folder"),
      frontFilename: currentFrontFilename(),
      tooltip: val("signTool"),
      packName: val("packName"),
      textlinesSummary: collectTextlinesDetail(),
    };
  }

  function buildPackSummary() {
    var snap = getPackSnapshot() || {};
    var signs = Array.isArray(snap.signs) ? snap.signs : [];
    var types = {};
    var missing = 0;
    signs.forEach(function (s) {
      if (!s) return;
      if (s.type) types[s.type] = true;
      if (!s.name || !s.type || !s.front) missing += 1;
    });
    return {
      packName: val("packName") || snap.name || "",
      author: snap.author || null,
      signCount: signs.length,
      typesUsed: Object.keys(types),
      missingRequiredFieldsApprox: missing,
      firstSigns: signs.slice(0, 10).map(function (s) {
        return {
          name: s && s.name,
          type: s && s.type,
          front: s && s.front,
          back: s && s.back != null ? s.back : null,
          textlineCount: Array.isArray(s && s.textlines) ? s.textlines.length : 0,
        };
      }),
      warnings: missing ? ["Some signs appear to miss required fields (name/type/front)."] : [],
    };
  }

  function selectedSignDetail() {
    var snap = getPackSnapshot();
    var idx = getSelectedSignIndex();
    if (!snap || !Array.isArray(snap.signs) || idx < 0 || !snap.signs[idx]) return null;
    var s = snap.signs[idx];
    var lines = Array.isArray(s.textlines) ? s.textlines : [];
    var detail = {
      name: s.name || val("signText"),
      type: s.type || val("signtype_folder"),
      front: s.front || currentFrontFilename(),
      back: s.back || null,
      tooltip: s.tooltip || val("signTool"),
      textlines: lines.slice(0, 40).map(function (t, i) {
        return { i: i + 1, label: t && t.label, x: t && t.x, y: t && t.y, w: t && t.width, color: t && t.color };
      }),
    };
    var raw = JSON.stringify(detail);
    if (raw.length > LIMITS.SELECTED_SIGN) {
      detail.textlines = detail.textlines.slice(0, 10);
      detail._note = "Selected sign context truncated.";
    }
    return detail;
  }

  function buildCustomContext(question) {
    var ctx = {
      question: String(question || val(IDS.composer) || "").slice(0, LIMITS.PROMPT),
      includePackName: !!($("ramAiCtxPackName") && $("ramAiCtxPackName").checked),
      includeSignMeta: !!($("ramAiCtxSignMeta") && $("ramAiCtxSignMeta").checked),
      includeTextlines: !!($("ramAiCtxTextlines") && $("ramAiCtxTextlines").checked),
      includePackSummary: !!($("ramAiCtxPackSummary") && $("ramAiCtxPackSummary").checked),
      includePackJson: !!($("ramAiCtxPackJson") && $("ramAiCtxPackJson").checked),
    };
    if (ctx.includePackName) ctx.packName = val("packName");
    if (ctx.includeSignMeta) {
      Object.assign(ctx, signContextBase());
      ctx.selectedSignDetail = selectedSignDetail();
    }
    if (ctx.includeTextlines) ctx.textlinesSummary = collectTextlinesDetail();
    if (ctx.includePackSummary) ctx.packSummary = buildPackSummary();
    if (ctx.includePackJson) {
      var preview = buildPackJsonForReview();
      if (preview.length > LIMITS.SIGNS_JSON) {
        preview = preview.slice(0, LIMITS.SIGNS_JSON) + "…";
        ctx._packJsonTruncated = true;
      }
      ctx.packJsonPreview = preview;
    }
    return ctx;
  }

  function buildRamAiPrompt(action, context) {
    if (!context || typeof context !== "object") context = {};
    function t(v, n) { return String(v || "").trim().slice(0, n || 180); }
    if (action === "explain_selected") {
      var field = t(context.field, 64);
      if (!field) return "";
      var extra = [];
      if (context.signName) extra.push("selected sign '" + t(context.signName, 90) + "'");
      if (context.signType) extra.push("type '" + t(context.signType, 64) + "'");
      return (
        "Explain the Traffic Control signpack field '" +
        field +
        "' and how it should be used." +
        (extra.length ? " Context: " + extra.join(", ") + "." : "")
      );
    }
    if (action === "validate_json") {
      return "Review this Traffic Control signpack configuration and list possible issues, warnings, or improvements.";
    }
    if (action === "convert_color") {
      var color = t(context.colorInput || context.color, 64);
      if (!color) return "";
      return "Convert the color '" + color + "' into the integer format used by Traffic Control signpacks.";
    }
    if (action === "help_textlines") {
      var signName = t(context.signName, 120) || "this sign";
      return "Help me improve textlines for '" + signName + "' in a Traffic Control signpack using the 16x16 grid.";
    }
    if (action === "suggest_tooltip") {
      var name = t(context.signName, 120) || "this sign";
      return "Suggest a short tooltip for '" + name + "' in this Traffic Control signpack.";
    }
    if (action === "suggest_note") {
      var n = t(context.signName, 120) || "this sign";
      return "Suggest a concise metadata note for '" + n + "' in this Traffic Control signpack.";
    }
    if (action === "generate_readme") {
      var pn = t(context.packName, 120) || "this signpack";
      return "Generate a concise README for the Traffic Control signpack '" + pn + "'.";
    }
    return t(context.question, LIMITS.PROMPT);
  }

  function actionPayload(action) {
    switch (action) {
      case "explain_selected": {
        var sel = $("ramAiFieldSelect");
        var fieldKey = sel ? sel.value : "signText";
        var meta = FIELD_HINTS[fieldKey] || { field: fieldKey, section: "general" };
        var signMeta = signContextBase();
        var explainCtx = Object.assign({}, meta, signMeta);
        if (!meta.field) return { action: "explain_field", context: {}, userText: "" };
        return {
          action: "explain_field",
          context: explainCtx,
          userText: buildRamAiPrompt("explain_selected", explainCtx),
        };
      }
      case "validate_json": {
        var packJson = buildPackJsonForReview();
        var ctx =
          packJson.length > LIMITS.SIGNS_JSON
            ? {
                reviewMode: "summary",
                reviewNote: "Full JSON was too large, so this is a summarized review context.",
                packSummary: buildPackSummary(),
                packJson: packJson.slice(0, 4000) + "…",
              }
            : { reviewMode: "full", packJson: packJson };
        return {
          action: "validate_json",
          context: ctx,
          userText: buildRamAiPrompt("validate_json", ctx),
        };
      }
      case "suggest_tooltip":
        return { action: "suggest_tooltip", context: signContextBase(), userText: buildRamAiPrompt("suggest_tooltip", signContextBase()) };
      case "suggest_note":
        return { action: "suggest_note", context: signContextBase(), userText: buildRamAiPrompt("suggest_note", signContextBase()) };
      case "help_textlines":
        return { action: "help_textlines", context: signContextBase(), userText: buildRamAiPrompt("help_textlines", signContextBase()) };
      case "convert_color":
        return {
          action: "convert_color",
          context: { colorInput: val("ramAiColorInput") },
          userText: buildRamAiPrompt("convert_color", { colorInput: val("ramAiColorInput") }),
        };
      case "generate_readme": {
        var snap = getPackSnapshot();
        var folders = [];
        if (snap && snap.signs) {
          snap.signs.forEach(function (s) {
            if (s.type && folders.indexOf(s.type) === -1) folders.push(s.type);
          });
        }
        return {
          action: "generate_readme",
          context: { packName: val("packName") || (snap && snap.name), signCount: snap && snap.signs ? snap.signs.length : 0, typeFolders: folders },
          userText: buildRamAiPrompt("generate_readme", { packName: val("packName") || (snap && snap.name) }),
        };
      }
      case "custom_prompt":
      case "ask_quick":
      case "ask":
      default: {
        var q = val(IDS.composer);
        var customContext = buildCustomContext(q);
        return { action: "ask", context: customContext, userText: buildRamAiPrompt("ask", customContext) };
      }
    }
  }

  function readNdjsonStream(response, onEvent) {
    if (!response.body || !response.body.getReader) {
      return response.text().then(function (text) {
        text.split("\n").forEach(function (line) {
          if (!line || !line.trim()) return;
          try {
            onEvent(JSON.parse(line));
          } catch (_e) {}
        });
      });
    }
    var reader = response.body.getReader();
    var decoder = new TextDecoder();
    var buf = "";
    return new Promise(function (resolve, reject) {
      function pump() {
        reader.read().then(function (result) {
          if (result.done) {
            if (buf.trim()) {
              try {
                onEvent(JSON.parse(buf.trim()));
              } catch (_e) {}
            }
            resolve();
            return;
          }
          buf += decoder.decode(result.value, { stream: true });
          var lines = buf.split("\n");
          buf = lines.pop() || "";
          lines.forEach(function (line) {
            if (!line || !line.trim()) return;
            try {
              onEvent(JSON.parse(line));
            } catch (_e) {}
          });
          pump();
        }, reject);
      }
      pump();
    });
  }

  function handleError(code, msg) {
    var text = msg || "Ram AI could not complete this request.";
    if (code === "PARSE_FAIL") text = "Ram AI responded, but the app could not read the response format. Check server logs.";
    if (code === "RATE_LIMIT") text = "Too many requests. Please wait and try again.";
    if (code === "TIMEOUT") text = "Connection to Ram AI was lost while waiting. Please retry.";
    if (code === "NETWORK" || code === "UPSTREAM") text = "Ram AI is unavailable right now. Check connection/server and retry.";
    pushMessage("ai", text, { done: true });
    updateQueueUI({ state: "available" });
    setStatusBadge("Available", "ram-ai-status-available");
  }

  function startRequest(meta) {
    inFlight = true;
    ramAiRequestActive = true;
    helperAbort = new AbortController();
    requestStartedAt = Date.now();
    streamingAiMessageId = null;
    lastRawResponse = "";
    lastRequestMeta = meta;
    setUiBusy(true);
    setTypingRow(true, "Waiting…");
    updateQueueUI({ state: "connecting" });
    touchAiActivity();
    startStatusLoop("request_start");
  }

  function finishRequest() {
    inFlight = false;
    ramAiRequestActive = false;
    requestStartedAt = 0;
    statusPollState = "idle";
    stopRamAiStatusPolling("request_finished");
    setUiBusy(false);
    setQueueChip("", false);
    setQueueStatusHtml("");
    setStatusBadge("Available", "ram-ai-status-available");
    setLauncherQueueBadge("", "");
    if (!drawerOpen) {
      setLauncherBadge(unreadCount ? String(unreadCount) : "", unreadCount ? "is-unread" : "");
    }
    syncResponseTools();
    if (drawerOpen) fetchStatusOnce("request_finished_once");
  }

  function sendAction(action) {
    if (!getEnabled()) return;
    if (inFlight) return;
    var payload = actionPayload(action);
    if (!payload.userText || !payload.userText.trim()) {
      pushMessage("ai", action === "ask_quick" || action === "ask" ? "Please enter a question first." : "Select a field or sign first.", { done: true });
      return;
    }

    if (payload.action === "ask" || payload.action === "custom_prompt") {
      var relevance = isRelevantToSignpackMaker(payload.userText, payload.context || {});
      if (isDebug()) {
        console.log(
          "[ram-ai:guardrail] allowed=%s score=%d category=%s",
          relevance.allowed,
          Number(relevance.score || 0),
          relevance.category
        );
      }
      if (!relevance.allowed) {
        pushMessage("user", payload.userText, { done: true });
        pushGuardrailMessage();
        return;
      }
    }
    if (isDebug()) {
      console.log("[ram-ai:debug] action=%s prompt_len=%d context_keys=%o", payload.action, payload.userText.length, Object.keys(payload.context || {}));
      var mf = $("ramAiMetaFeedback");
      if (mf) {
        mf.hidden = false;
        mf.textContent = "Prompt preview: " + payload.userText.slice(0, 220);
      }
    }

    pushMessage("user", payload.userText, { done: true });
    $(IDS.composer).value = "";
    startRequest({ action: payload.action, context: payload.context, userText: payload.userText });

    fetch("/api/ram-ai/helper", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      signal: helperAbort.signal,
      body: JSON.stringify({
        action: payload.action,
        context: payload.context || {},
        stream: true,
        model: getSelectedModel(),
      }),
    })
      .then(function (res) {
        var ct = res.headers.get("content-type") || "";
        if (ct.indexOf("ndjson") !== -1) {
          var aiId = pushMessage("ai", "", { done: false, streaming: true });
          streamingAiMessageId = aiId;
          return readNdjsonStream(res, function (ev) {
            if (!ev || !ev.event) return;
            if (ev.event === "phase") {
              updateQueueUI(ev.phase === "connecting" ? { state: "connecting" } : { state: "queued", queued: true });
              return;
            }
            if (ev.event === "meta") {
              var metaBox = $("ramAiMetaFeedback");
              if (metaBox && isDebug()) {
                metaBox.hidden = false;
                metaBox.textContent = "Action " + payload.action + " · " + (ev.contextTier || "n/a") + " · " + (ev.outboundChars || 0) + " chars";
              }
              return;
            }
            if (ev.event === "chunk" && ev.text) {
              lastRawResponse += ev.text;
              if (isOffTopicOutput(lastRawResponse)) {
                updateMessage(aiId, function (m) {
                  m.text = FOCUSED_REDIRECT_MESSAGE;
                  m.streaming = false;
                  m.done = true;
                });
                return;
              }
              updateMessage(aiId, function (m) {
                m.text = cleanupText(lastRawResponse, false);
                m.streaming = true;
                m.done = false;
              });
              updateQueueUI({ state: "generating", generating: true, active: true });
              setTypingRow(false);
              return;
            }
            if (ev.event === "error") {
              updateMessage(aiId, function (m) {
                m.streaming = false;
                m.done = true;
              });
              handleError(ev.code, ev.error);
            }
            if (ev.event === "done") {
              var finalText = cleanupText(lastRawResponse || "", true);
              updateMessage(aiId, function (m) {
                m.text = isOffTopicOutput(finalText) ? FOCUSED_REDIRECT_MESSAGE : cleanupText(lastRawResponse || m.text, true);
                m.streaming = false;
                m.done = true;
              });
            }
          }).then(function () {
            return { streamed: true };
          });
        }
        return res.json().then(function (data) {
          return { streamed: false, res: res, data: data || {} };
        });
      })
      .then(function (result) {
        if (!result) return;
        if (!result.streamed) {
          if (result.data && result.data.ok && result.data.text) {
            var safeText = isOffTopicOutput(result.data.text) ? FOCUSED_REDIRECT_MESSAGE : cleanupText(result.data.text, true);
            pushMessage("ai", safeText, { done: true });
          } else if (result.data && result.data.code === "OFF_TOPIC") {
            pushGuardrailMessage();
          } else {
            handleError(result.data.code, result.data.error);
          }
        }
      })
      .catch(function (err) {
        if (err && err.name === "AbortError") return;
        handleError("NETWORK", "Could not connect to Ram AI. Try again.");
      })
      .finally(function () {
        finishRequest();
        if (!drawerOpen) showToast("Ram AI response ready.");
        renderChat();
      });
  }

  function cancelRequest() {
    if (!inFlight) return;
    if (helperAbort) helperAbort.abort();
    fetch("/api/ram-ai/cancel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: "{}",
    }).finally(function () {
      finishRequest();
      pushMessage("ai", "Ram AI request cancelled.", { done: true });
    });
  }

  function startStatusLoop() {
    statusPollSession += 1;
    statusStrikes = 0;
    statusBackoffMs = 0;
    statusPollState = "connecting";
    if (!ramAiRequestActive || !drawerOpen) {
      debugPoll("not started (conditions unmet)");
      return;
    }
    debugPoll("started session=" + statusPollSession);
    startRamAiStatusPolling("active_request", 0);
  }

  function loadModels() {
    if (!getEnabled()) return Promise.resolve();
    return fetch("/api/ram-ai/models", { credentials: "same-origin" })
      .then(function (res) {
        return res.json();
      })
      .then(function (data) {
        var select = $(IDS.model);
        if (!select || !data || !data.models) return;
        select.innerHTML = "";
        defaultModelName = data.default || defaultModelName;
        data.models.forEach(function (m) {
          if (!m || !m.name) return;
          var opt = document.createElement("option");
          opt.value = m.name;
          opt.textContent = m.name;
          select.appendChild(opt);
        });
        if (!select.options.length) {
          var fallback = document.createElement("option");
          fallback.value = defaultModelName;
          fallback.textContent = defaultModelName;
          select.appendChild(fallback);
        }
        select.value = defaultModelName;
      })
      .catch(function () {});
  }

  function bindUi() {
    if (!getEnabled()) return;

    var launcher = $(IDS.launcher);
    var closeBtn = $(IDS.close);
    var backdrop = $(IDS.backdrop);
    var cancelBtn = $(IDS.cancel);
    var clearPrompt = $(IDS.clearPrompt);
    var copyBtn = $(IDS.copy);
    var retryBtn = $(IDS.retry);
    var followUpBtn = $(IDS.followUp);
    var clearBtn = $(IDS.clear);
    var insertBtn = $(IDS.insertTooltip);
    var composer = $(IDS.composer);

    if (launcher && !launcher.dataset.ramAiHelperBound) {
      launcher.dataset.ramAiHelperBound = "1";
      launcher.addEventListener("click", function (e) {
        e.preventDefault();
        setDrawerOpen(!drawerOpen);
      });
    }
    if (closeBtn) closeBtn.addEventListener("click", function () { setDrawerOpen(false); });
    if (backdrop) backdrop.addEventListener("click", function () { setDrawerOpen(false); });
    if (cancelBtn) cancelBtn.addEventListener("click", cancelRequest);
    if (clearPrompt) clearPrompt.addEventListener("click", function () { if (composer) composer.value = ""; });
    if (clearBtn) clearBtn.addEventListener("click", function () {
      chatMessages = [];
      lastRawResponse = "";
      syncResponseTools();
      ensureMessagesEmptyState();
    });
    if (copyBtn) copyBtn.addEventListener("click", function () {
      if (!lastRawResponse) return;
      navigator.clipboard.writeText(cleanupText(lastRawResponse, true));
    });
    if (retryBtn) retryBtn.addEventListener("click", function () {
      if (!lastRequestMeta || inFlight) return;
      sendAction(lastRequestMeta.action === "ask" ? "ask_quick" : lastRequestMeta.action);
    });
    if (followUpBtn) followUpBtn.addEventListener("click", function () {
      if (!composer) return;
      var tail = cleanupText(lastRawResponse, true).slice(0, 1200);
      composer.value = "Follow-up:\n\n" + tail + "\n\nMy question: ";
      composer.focus();
    });
    if (insertBtn) insertBtn.addEventListener("click", function () {
      var tool = $("signTool");
      if (!tool) return;
      var oneLine = cleanupText(lastRawResponse, true).split("\n")[0].replace(/^[-*•]\s*/, "").trim();
      if (!oneLine) return;
      tool.value = oneLine.slice(0, 240);
      tool.focus();
    });
    if (composer) {
      composer.addEventListener("keydown", function (e) {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          sendAction("ask_quick");
        }
      });
    }

    document.addEventListener("click", function (e) {
      var actionBtn = e.target.closest("[data-ram-ai-action]");
      if (actionBtn) {
        e.preventDefault();
        setDrawerOpen(true);
        sendAction(actionBtn.getAttribute("data-ram-ai-action"));
      }

      var fieldBtn = e.target.closest("[data-ram-ai-field]");
      if (fieldBtn) {
        e.preventDefault();
        setDrawerOpen(true);
        var field = fieldBtn.getAttribute("data-ram-ai-field");
        var select = $("ramAiFieldSelect");
        if (select) select.value = field;
        sendAction("explain_selected");
      }

      var copyMsg = e.target.closest("[data-copy-mid]");
      if (copyMsg) {
        var mid = copyMsg.getAttribute("data-copy-mid");
        var msg = chatMessages.find(function (m) { return m.id === mid; });
        if (msg && msg.text) navigator.clipboard.writeText(cleanupText(msg.text, true));
      }
    });

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && drawerOpen) {
        setDrawerOpen(false);
      }
    });

    document.addEventListener("visibilitychange", function () {
      if (!ramAiRequestActive) {
        stopRamAiStatusPolling("hidden_idle");
        return;
      }
      if (document.visibilityState === "hidden") {
        stopRamAiStatusPolling("hidden_active");
        return;
      }
      touchAiActivity();
      startStatusLoop("visibility_visible");
    });

    loadModels();
    window.__ramAiHelperReady = true;
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bindUi);
  } else {
    bindUi();
  }
})();
