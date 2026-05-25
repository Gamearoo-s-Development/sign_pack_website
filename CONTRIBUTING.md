# Contributing to Signpack Maker

Thank you for helping improve Signpack Maker.

## What you can contribute

- **Website** — UI, documentation, accessibility, and bug fixes in this repository
- **Issues** — bug reports, feature ideas, and doc corrections
- **Desktop app** — source is not public yet; app-related feedback is still welcome via issues

## Before you start

1. Read [README.md](README.md) for local setup (`cp .env.example .env`, never commit secrets).
2. Keep changes focused — avoid unrelated refactors.
3. Do not commit `.env`, `config.local.js`, `users/`, or `uploads/`.

## Running locally

```bash
npm install
cp .env.example .env
# Edit .env with your MongoDB URI and other values
node .
```

Visit `http://localhost:8090`.

## Pull requests

1. Describe what changed and why.
2. Confirm you did not include secrets or user data.
3. For UI changes, note which pages you tested (`/`, `/app/`, `/login`).

## Issues

Use GitHub Issues. Include steps to reproduce for bugs and your environment (browser/OS) when relevant.

## Code of conduct

Be respectful and constructive in issues and pull requests.
