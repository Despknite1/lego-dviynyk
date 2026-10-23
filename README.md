# LEGO-Двійник

Upload a photo → find similar official LEGO minifigures (Brickset/BrickLink data) and generate your own 3D minifigure from official LDraw parts (Gemini-assisted spec, three.js viewer).

## Run locally
```bash
cp .env.example .env        # fill GEMINI_API_KEY (never commit .env)
npm install
set -a; . ./.env; set +a; npm start   # http://localhost:8787
```

## Security design
- **Secrets** only from environment variables; `.env` is git-ignored. The Gemini key stays server-side.
- **Accounts** (off unless `ACCOUNTS_ENABLED=true` + PII keys + DB): bcrypt (cost 12) password hashes; sessions = random 256-bit token in an `httpOnly`, `Secure`, `SameSite=Lax` `__Host-` cookie, stored server-side only as an HMAC hash; CSRF double-submit token + Origin check; per-IP and per-account rate limits; lockout 15 min after 5 failed logins; generic errors (no account enumeration).
- **Password reset**: 6-digit code to the primary or backup email (SMS = stub), valid 10 min, single use, max 5 attempts, stored as HMAC hash; all sessions revoked on reset.
- **PII at rest**: emails/phone encrypted with AES-256-GCM (`PII_ENC_KEY`); lookups via keyed HMAC blind index (`PII_INDEX_KEY`).
- **Uploads**: JPEG/PNG/WebP only by magic bytes, 8 MB cap, SVG/HTML/PHP/PDF polyglots rejected, every image re-encoded with sharp (EXIF/GPS stripped, appended payloads dropped), pixel-bomb limit, per-IP rate limit. Uploads are never written to a served directory (optional `store()` uses random UUID names in `data/uploads`, mode 600).
- **Headers**: helmet (CSP, HSTS in production, nosniff, frame-ancestors self, no `x-powered-by`).
- **Logs**: pino JSON with request ids; cookies, auth headers, passwords, codes, emails and images are redacted; auth events logged by user id only.

## Tests
```bash
ACCOUNTS_ENABLED=true PII_ENC_KEY=$(openssl rand -hex 32) PII_INDEX_KEY=$(openssl rand -hex 32) MAIL_PROVIDER=console PORT=8799 node server.js > /tmp/srv.out &
TEST_CODE_FILE=/tmp/srv.out node tests/security.test.js http://localhost:8799
```

## Deploy on Render from GitHub
1. Push this repo to GitHub. 2. Render → New → Blueprint → pick the repo (uses `render.yaml` + `Dockerfile`).
3. Set secret env vars in the Render dashboard (`GEMINI_API_KEY`, and for accounts `PII_ENC_KEY`, `PII_INDEX_KEY`, `DATABASE_URL`, mail settings), then set `ACCOUNTS_ENABLED=true`.

**Back up `PII_ENC_KEY` and `PII_INDEX_KEY`** — losing them makes stored emails unreadable and logins impossible.

## Credits
LDraw parts library © LDraw.org contributors, CC BY 4.0. LEGO® is a trademark of the LEGO Group, which does not sponsor or endorse this site.
