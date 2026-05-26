/**
 * Client-safe Ram AI queue position (no prompts, keys, or private task payloads).
 */

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
  return typeof uid === "string" ? uid.slice(0, 128) : null;
}

function findTaskIdForUser(sanitized, userTag) {
  const tasks = sanitized._tasks || [];
  for (let i = 0; i < tasks.length; i++) {
    const t = tasks[i];
    if (extractTaskUserId(t) === userTag) {
      return extractTaskId(t);
    }
  }
  if (sanitized.active_task_id && sanitized.busy) {
    const active = tasks.find((t) => extractTaskId(t) === sanitized.active_task_id);
    if (active && extractTaskUserId(active) === userTag) {
      return sanitized.active_task_id;
    }
  }
  return null;
}

/** Ordered task ids: active first, then queue. */
function buildOrderedTaskIds(sanitized) {
  const order = [];
  const seen = new Set();
  const activeId = sanitized.active_task_id;

  if (activeId && sanitized.busy) {
    order.push(activeId);
    seen.add(activeId);
  }

  const tasks = sanitized._tasks || [];
  for (let i = 0; i < tasks.length; i++) {
    const id = extractTaskId(tasks[i]);
    if (id && !seen.has(id)) {
      order.push(id);
      seen.add(id);
    }
  }

  const activeList = sanitized.active_tasks || [];
  for (let i = 0; i < activeList.length; i++) {
    const entry = activeList[i];
    const id = typeof entry === "string" ? entry.slice(0, 128) : extractTaskId(entry);
    if (id && !seen.has(id)) {
      if (order.length && order[0] !== id) {
        order.unshift(id);
      } else if (!order.length) {
        order.push(id);
      }
      seen.add(id);
    }
  }

  return order;
}

/**
 * Resolve queue position for the current helper request.
 * @param {object} sanitized - output of sanitizeRamAiStatus
 * @param {{ inFlight?: boolean, userTaskId?: string|null, userTag?: string|null, receivedText?: boolean }} options
 */
function buildClientQueueInfo(sanitized, options) {
  const inFlight = !!options.inFlight;
  const userTag = options.userTag || null;
  const receivedText = !!options.receivedText;

  if (!sanitized || sanitized.online === false) {
    return {
      state: "offline",
      busy: false,
      queued: false,
      generating: false,
      active: false,
      queuePosition: null,
      requestsAhead: null,
      positionKnown: false,
      tasksWaiting: 0,
      queueLength: 0,
    };
  }

  const busy = !!sanitized.busy;
  const order = buildOrderedTaskIds(sanitized);
  const tasksWaiting =
    typeof sanitized.tasks_waiting === "number" ? sanitized.tasks_waiting : order.length;

  let userId = options.userTaskId || null;
  if (!userId && userTag) {
    userId = findTaskIdForUser(sanitized, userTag);
  }

  let queuePosition = null;
  let requestsAhead = null;
  let positionKnown = false;
  let queued = false;
  let generating = false;
  let active = false;

  if (inFlight && receivedText) {
    generating = true;
    active = true;
    queued = false;
    positionKnown = true;
    queuePosition = 1;
    requestsAhead = 0;
  } else if (inFlight && userId) {
    const idx = order.indexOf(userId);
    if (idx >= 0) {
      positionKnown = true;
      queuePosition = idx + 1;
      requestsAhead = Math.max(0, idx);
      const isActiveNow = idx === 0 && sanitized.active_task_id === userId && busy;
      if (isActiveNow) {
        generating = true;
        active = true;
        queued = false;
        requestsAhead = 0;
      } else {
        queued = true;
      }
    } else if (busy) {
      queued = tasksWaiting > 0;
      if (tasksWaiting > 0) {
        requestsAhead = tasksWaiting;
      } else {
        generating = true;
        active = true;
      }
    } else {
      generating = true;
    }
  } else if (inFlight) {
    const tasks = sanitized._tasks || [];
    let tagIdx = -1;
    for (let i = 0; i < tasks.length; i++) {
      if (extractTaskUserId(tasks[i]) === userTag) {
        tagIdx = i;
        break;
      }
    }
    if (tagIdx >= 0) {
      const offset = sanitized.active_task_id && busy ? 1 : 0;
      positionKnown = true;
      queuePosition = tagIdx + 1 + offset;
      requestsAhead = tagIdx + offset;
      queued = requestsAhead > 0 || (busy && sanitized.active_task_id);
    } else if (busy && tasksWaiting > 0) {
      queued = true;
      requestsAhead = tasksWaiting;
    } else if (busy) {
      generating = true;
      active = true;
    } else {
      generating = true;
    }
  }

  let state = "available";
  if (!inFlight) {
    state = busy ? "busy" : "available";
  } else if (generating) {
    state = "generating";
  } else if (queued) {
    state = "queued";
  } else if (inFlight) {
    state = "connecting";
  }

  return {
    state,
    busy: busy || inFlight,
    queued,
    generating,
    active,
    queuePosition,
    requestsAhead,
    positionKnown,
    tasksWaiting,
    queueLength: order.length,
  };
}

function buildPublicQueuePayload(sanitized, enabled, inFlight, opts) {
  const options = opts || {};
  const info = buildClientQueueInfo(sanitized, {
    inFlight,
    userTaskId: options.userTaskId || null,
    userTag: options.userTag || null,
    receivedText: !!options.receivedText,
  });
  return {
    enabled: !!enabled,
    state: info.state,
    busy: info.busy,
    queued: info.queued,
    generating: info.generating,
    active: info.active,
    queuePosition: info.positionKnown ? info.queuePosition : null,
    requestsAhead:
      info.requestsAhead != null && info.requestsAhead >= 0 ? info.requestsAhead : null,
    positionKnown: info.positionKnown,
    tasksWaiting: info.tasksWaiting,
    queueLength: info.queueLength,
  };
}

module.exports = {
  buildClientQueueInfo,
  buildPublicQueuePayload,
  buildOrderedTaskIds,
  findTaskIdForUser,
  extractTaskId,
  extractTaskUserId,
};
