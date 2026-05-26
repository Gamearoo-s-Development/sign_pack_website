/**
 * Short-lived cache for Ram AI GET /status (avoids hammering upstream).
 */

let cache = {
  fetchedAt: 0,
  data: null,
};

function getCacheTtlMs(ramAiConfig) {
  const ttl = Number(ramAiConfig && ramAiConfig.statusCacheTtlMs);
  if (!ttl || ttl < 1000) return 3000;
  return Math.min(Math.max(ttl, 2000), 10000);
}

/**
 * @param {object} ramAiConfig
 * @param {(config: object) => Promise<object>} fetchFn - e.g. fetchRamAiStatus
 */
async function getCachedRamAiStatus(ramAiConfig, fetchFn) {
  const ttl = getCacheTtlMs(ramAiConfig);
  const now = Date.now();
  if (cache.data && now - cache.fetchedAt < ttl) {
    return cache.data;
  }
  const fresh = await fetchFn(ramAiConfig);
  cache = { fetchedAt: now, data: fresh };
  return fresh;
}

function invalidateRamAiStatusCache() {
  cache.fetchedAt = 0;
  cache.data = null;
}

module.exports = {
  getCachedRamAiStatus,
  invalidateRamAiStatusCache,
  getCacheTtlMs,
};
