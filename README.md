# Signpack Maker

Create and manage custom **signpacks** for Minecraft's **Traffic Control Mod** — via the web editor or the portable Windows desktop app.

- **Live site:** [https://signs.gamearoo.dev](https://signs.gamearoo.dev)
- **GitHub:** [https://github.com/Gamearoo-s-Development/sign_pack_website](https://github.com/Gamearoo-s-Development/sign_pack_website)

## What's open source

| Component | Status |
|-----------|--------|
| Website (this repo) | Open source |
| Desktop app | Source release planned later; download portable ZIP from `/app` |

## Requirements

- Node.js 18+
- MongoDB (connection URI required)

## Local setup

1. Clone the repository and install dependencies:

   ```bash
   npm install
   ```

2. Copy the example environment file and fill in your local values:

   ```bash
   cp .env.example .env
   ```

   **Never commit `.env`** — it may contain secrets.

3. Alternatively (or in addition), for existing deployments you can use a gitignored `config.local.js` with the same shape as the legacy `config.js`:

   ```javascript
   module.exports = {
     dburl: "mongodb://...",
     domain: "http://localhost:8090",
     email: { host: "...", port: 587, user: "...", pass: "...", from: '"Name" <no-reply@example.com>' },
     supportEmail: "support@yourdomain.com",
     discord: { clientId: "...", clientSecret: "..." }
   };
   ```

   **Migration:** rename your old `config.js` to `config.local.js`, or move values into `.env`.

4. Start the server:

   ```bash
   node .
   ```

   The app listens on port **8090** by default.

### Docker

```bash
docker compose up
```

You can add `env_file: .env` to `docker-compose.yml` if you use a local `.env` file.

## Environment variables

See [`.env.example`](.env.example) for all supported variables. Production can set these on the host instead of using a `.env` file.

| Variable | Purpose |
|----------|---------|
| `MONGODB_URI` | MongoDB connection string |
| `APP_DOMAIN` | Public site URL (OAuth callbacks, email links) |
| `SMTP_*` | Outbound mail (host, user, pass) for login OTP and password reset |
| `SMTP_FROM` | Send-as / From address (e.g. `"Signpack Maker" <no-reply@yourdomain.com>`) |
| `SUPPORT_EMAIL` | Support address shown in transactional emails |
| `DISCORD_*` | Discord OAuth (optional) |
| `RAM_AI_ENABLED` | Optional Ram AI helper in `/signpack` editor (`true` / `false`, default off) |
| `RAM_AI_BASE_URL` | Ram AI API base (default `https://ai.rambot.xyz`) |
| `RAM_AI_API_KEY` | Personal API key (`ramai_…`) — server only, never exposed to the browser |
| `RAM_AI_MODEL` | Optional server-only override for `/api/ask` (omit to use Ram AI default; not user-selectable) |
| `RAM_AI_TIMEOUT_MS` | Upstream stream timeout in ms (default `180000`, min `180000`) |
| `RAM_AI_STATUS_POLL_MS` | Editor queue poll interval hint (default `3000`, clamped 2–5s in UI) |
| `RAM_AI_RATE_LIMIT_MAX` | Max helper requests per window per session (default `20`) |
| `RAM_AI_RATE_LIMIT_WINDOW_MS` | Rate limit window in ms (default `60000`) |

Transactional emails (HTML + plain text) cover: login OTP, password reset, password changed, account deleted, and Discord signup welcome.

### Account settings and profile pictures

Logged-in users can open **Account Settings** (`/account`) from the editor header menu or sidebar. Profile pictures are stored on disk under `uploads/avatars/` (gitignored — never commit uploaded files). Each file uses a hashed name derived from the account email; uploads are validated (PNG/JPG/JPEG/WEBP only, max 5 MB, no SVG) and resized to a square WebP with Sharp. Existing users without an avatar see initials in the UI. Password reset and account deletion continue to use `/forgot-password` and `/account/delete`.

## Traffic Control signpack format

Signpacks target the **[Traffic Control](https://github.com/CSX8600/trafficcontrol)** mod. The authoritative field reference is the official wiki:

**[Making a Custom Sign Pack](https://github.com/CSX8600/trafficcontrol/wiki/Making-a-Custom-Sign-Pack)**

This repository summarizes that format for contributors and editor users in [`docs/SIGNPACK_GUIDE.md`](docs/SIGNPACK_GUIDE.md). The web editor at `/signpack` includes an in-app **Signpack Guide**, contextual tooltips, and non-blocking validation tips aligned with the wiki.

### Optional Ram AI helper

Ram AI Helper is an **optional** in-editor assistant (see [`docs/RAM_AI_HELPER.md`](docs/RAM_AI_HELPER.md) and [/help/ram-ai.html](public/help/ram-ai.html)).

**Enable (server `.env` only — never commit secrets):**

```env
RAM_AI_ENABLED=true
RAM_AI_BASE_URL=https://ai.rambot.xyz
RAM_AI_API_KEY=replace-me
RAM_AI_TIMEOUT_MS=180000
RAM_AI_STATUS_POLL_MS=3000
```

- `RAM_AI_API_KEY` stays on the server; the browser never receives it.
- The frontend calls only `POST /api/ram-ai/helper`, `GET /api/ram-ai/status`, and `POST /api/ram-ai/cancel` (authenticated, rate-limited).
- The server proxies to Ram AI [`/api/ask`](https://ai.rambot.xyz/docs) (streaming), `/status`, and `/task/stop`.
- No model selector, API key field, or direct browser calls to Ram AI.
- Queue/busy status is shown while waiting; cancel applies to the current session’s in-flight request.
- Upload, save, and export are unchanged when Ram AI is off or unreachable.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Bug reports and documentation improvements are welcome.

## Security

See [SECURITY.md](SECURITY.md) for how to report vulnerabilities.

## License

MIT — see [LICENSE](LICENSE).
