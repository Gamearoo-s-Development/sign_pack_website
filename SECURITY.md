# Security Policy

## Supported versions

Security fixes are applied to the latest deployed version of the Signpack Maker website.

## Reporting a vulnerability

**Please do not open public GitHub issues for security vulnerabilities.**

Report security issues privately by emailing the maintainers (use your project contact address). Include:

- Description of the issue
- Steps to reproduce
- Impact assessment (if known)

We will acknowledge receipt and work on a fix as soon as possible.

## Scope

Reports related to the open-source **website** in this repository are in scope. The desktop app source is not yet public; still report serious issues if you discover them through normal use.

## Safe disclosure

Do not access, modify, or delete other users' data. Do not perform denial-of-service attacks against production systems.

## Ram AI helper

- `RAM_AI_API_KEY` and `RAM_AI_BASE_URL` must live only in server environment variables (or gitignored `config.local.js`). Never commit `.env`.
- The browser must only call same-origin routes under `/api/ram-ai/*`. Do not call Ram AI hosts directly from frontend code.
- Templates and static assets must not include API keys or upstream URLs with credentials. The editor receives a boolean `ramAiEnabled` flag only.
- `/api/ram-ai/models`, `/api/ram-ai/helper`, `/api/ram-ai/status`, and `/api/ram-ai/cancel` require an authenticated session, apply rate limits, sanitize payloads, and return generic error messages (no upstream bodies or secrets).
- The server calls Ram AI `POST /api/ask`, `GET /status`, `GET /v1/models` (optional), and `POST /task/stop` with Bearer / `x-api-key` from env only.
- Do not expose `RAM_AI_API_KEY`, `RAM_AI_BASE_URL`, or upstream model ids to the browser. The UI may only show display names from `GET /api/ram-ai/models`; `POST /api/ram-ai/helper` validates `model` against the server allowlist before forwarding.
