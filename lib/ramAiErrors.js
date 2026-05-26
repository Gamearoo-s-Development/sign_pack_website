/**
 * Client-safe Ram AI error messages (never include API keys or upstream bodies).
 */

const PUBLIC_ERRORS = {
  DISABLED:
    "Ram AI helper is disabled on this server. The editor works normally without it.",
  UNAUTHORIZED: "Sign in to use the Ram AI helper.",
  RATE_LIMIT: "Too many Ram AI requests. Please wait a minute and try again.",
  BAD_ACTION: "Invalid request.",
  TIMEOUT:
    "Ram AI is still taking too long. You can try again or cancel. The editor still works normally.",
  UPSTREAM: "Ram AI is unavailable right now. Try again later.",
  SLOW: "Ram AI is still working. Please wait, or cancel and try again.",
  AUTH: "Ram AI could not authenticate. Ask the site administrator to check server configuration.",
  EMPTY: "Ram AI returned an empty response.",
  PARSE_FAIL:
    "Ram AI responded, but the app could not read the response format. Check server logs.",
  NETWORK: "Could not reach Ram AI. Try again later.",
};

function publicError(code, fallback) {
  return PUBLIC_ERRORS[code] || fallback || PUBLIC_ERRORS.UPSTREAM;
}

function mapUpstreamFailure(err) {
  if (!err) return { code: "UPSTREAM", message: publicError("UPSTREAM") };
  if (err.code === "TIMEOUT" || err.code === "ECONNABORTED" || /timeout/i.test(String(err.message || ""))) {
    return { code: "TIMEOUT", message: publicError("TIMEOUT") };
  }
  if (err.code === "AUTH") {
    return { code: "AUTH", message: publicError("AUTH") };
  }
  if (err.code === "EMPTY" || err.code === "PARSE_FAIL") {
    return {
      code: err.code,
      message: publicError(err.code === "PARSE_FAIL" ? "PARSE_FAIL" : "SLOW"),
    };
  }
  if (err.code === "NETWORK") {
    return { code: "NETWORK", message: publicError("NETWORK") };
  }
  return { code: err.code || "UPSTREAM", message: publicError("UPSTREAM") };
}

module.exports = { publicError, mapUpstreamFailure, PUBLIC_ERRORS };
