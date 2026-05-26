# Ram AI Helper

Optional assistant in the **Signpack Maker** web editor (`/signpack`) for Traffic Control signpacks. It is **not required** for normal use.

Official Ram AI API docs: [ai.rambot.xyz/docs](https://ai.rambot.xyz/docs)

## Enable on the server

Copy from [`.env.example`](../.env.example) into your gitignored `.env`:

```env
RAM_AI_ENABLED=true
RAM_AI_BASE_URL=https://ai.rambot.xyz
RAM_AI_API_KEY=replace-me
RAM_AI_TIMEOUT_MS=180000
RAM_AI_STATUS_POLL_MS=5000
RAM_AI_STATUS_CACHE_MS=5000
RAM_AI_STATUS_RATE_LIMIT_MAX=45
```

Model selection (display names in UI; upstream ids resolved server-side):

```env
RAM_AI_DEFAULT_MODEL=Ram AI Code Agent 1.0 - fast
# RAM_AI_ALLOWED_MODELS=Ram AI Code Agent 1.0 - fast,Ram AI Code Agent 1.0,Ram AI Chat
```

Other optional server settings:

```env
# RAM_AI_MODEL=ram-ai-7b
RAM_AI_RATE_LIMIT_MAX=20
RAM_AI_RATE_LIMIT_WINDOW_MS=60000
RAM_AI_DEBUG=false
```

Restart the Node app after changing env vars.

## Security model

| Rule | Detail |
|------|--------|
| API key | `RAM_AI_API_KEY` lives only in server env / `.env` — **never** in EJS, HTML, or browser JS |
| Browser calls | Same-origin `GET /api/ram-ai/models`, `POST /api/ram-ai/helper`, `GET /api/ram-ai/status`, `POST /api/ram-ai/cancel` |
| Auth | Logged-in session required for all `/api/ram-ai/*` routes |
| Model | Dropdown shows display names from `GET /api/ram-ai/models` only; backend validates against allowlist before calling Ram AI |
| API key | Never sent to the browser |
| Prompt size | Custom prompts capped (2000 chars); context is sanitized |
| Secrets | Do not paste passwords or API keys into the helper |

The server proxies to Ram AI `POST /api/ask` (streaming), `GET /status`, and `POST /task/stop`.

## Editor features

- **What can Ram AI help with?** — use-case list in the panel
- **Quick actions** — review pack, tooltip/note ideas, textlines, color convert, README, explain field
- **Custom prompt** — optional context checkboxes (pack name, sign meta, textlines, JSON preview)
- **AI Model** — dropdown (default: Ram AI Code Agent 1.0 - fast); options from server allowlist / Ram AI status
- **Status** — Queue position, requests ahead, generating vs queued; live updates while a request runs; cancel in-flight request
- **Response tools** — copy, clear, follow-up, insert into tooltip (with confirm; does not auto-save)

## Public docs

- In-editor panel on `/signpack` when `RAM_AI_ENABLED=true`
- Marketing page: [/help/ram-ai.html](../public/help/ram-ai.html)

## Traffic Control format

Ram AI is instructed to follow the official signpack wiki. See also [`docs/SIGNPACK_GUIDE.md`](SIGNPACK_GUIDE.md).
