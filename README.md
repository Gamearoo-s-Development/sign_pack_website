# Signpack Maker

Create and manage custom **signpacks** for Minecraft's **Traffic Control Mod** — via the web editor or the portable Windows desktop app.

- **Live site:** [https://signs.gamearoo.dev](https://signs.gamearoo.dev)
- **GitHub:** [https://github.com/Gamea/signpack](https://github.com/Gamea/signpack)

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
     email: { host: "...", port: 587, user: "...", pass: "..." },
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
| `SMTP_*` | Outbound mail for login OTP and password reset |
| `DISCORD_*` | Discord OAuth (optional) |

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Bug reports and documentation improvements are welcome.

## Security

See [SECURITY.md](SECURITY.md) for how to report vulnerabilities.

## License

MIT — see [LICENSE](LICENSE).
