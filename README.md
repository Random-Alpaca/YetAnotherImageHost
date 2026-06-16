# Image Hoster

Self-hosted image hosting on an Oracle Always-Free ARM VM. Nginx serves public
images directly off disk; private images are authorized by an Express app and
streamed by Nginx via `X-Accel-Redirect` (the app never touches the bytes).
Access is **password-based with no open registration**: an admin issues
revocable access passwords; anyone holding one can log in.

## Pieces

- **Login page** — enter a single access password to reach the protected portal.
- **Portal** — everyone logged in can view and upload images; only `admin` can delete.
- **Admin page** — issue new passwords (user or admin role) and revoke old ones.
- **Public images** — served directly by Nginx at a public URL, no login needed.

## Architecture

```
Internet ─443─▶ Nginx ┬─ /              → React SPA build (web/dist)
                      ├─ /i/public/*    → /srv/images/public      (direct, cached)
                      ├─ /i/private/*   → Express (authorize) → X-Accel-Redirect
                      │                    → internal: /srv/images/private
                      ├─ /api/*         → Express (login, upload, admin)
                      └─ /internal/*    → internal-only (private root)

Express (127.0.0.1:3000) ── SQLite /srv/app/data.db
```

The private directory has **no public Nginx location**. Bytes only leave it
when the app authorizes a request and returns an `X-Accel-Redirect` into the
`internal;` block.

## API

| Method | Path                              | Auth   | Purpose                                    |
|--------|-----------------------------------|--------|--------------------------------------------|
| POST   | `/api/login`                      | no     | Password-only login → session cookie       |
| GET    | `/api/me`                         | yes    | Current role                               |
| POST   | `/api/logout`                     | yes    | Destroy session                            |
| POST   | `/api/upload`                     | yes    | Upload image (`visibility=public\|private`) |
| GET    | `/api/images/list`                | yes    | List all images (whole gallery)            |
| DELETE | `/api/images/:id`                 | admin  | Delete an image                            |
| POST   | `/api/admin/passwords`            | admin  | Issue a password (returns plaintext once)  |
| GET    | `/api/admin/passwords`            | admin  | List passwords + status                    |
| POST   | `/api/admin/passwords/:id/revoke` | admin  | Revoke a password (kills live sessions)    |
| GET    | `/i/private/:id`                  | yes    | Authorized private image (X-Accel-Redirect)|
| GET    | `/i/public/<year>/<id>.<ext>`     | no     | Public image (served by Nginx directly)    |
| GET    | `/api/health`                     | no     | Liveness                                   |

## Local development

Two processes: the Express API and the Vite dev server.

```bash
# 1) API
cd server
cp .env.example .env        # set COOKIE_SECRET; point STORAGE_*/DB_PATH at local dirs
npm install
npm run dev                 # http://127.0.0.1:3000

# 2) bootstrap the first admin password (printed once)
npm run issue-password -- --role admin --label "me"

# 3) web (separate terminal)
cd ../web
npm install
npm run dev                 # http://127.0.0.1:5173, proxies /api + /i to :3000
```

Recommended `server/.env` for local work:
```
STORAGE_PUBLIC=./data/public
STORAGE_PRIVATE=./data/private
DB_PATH=./data/data.db
COOKIE_SECURE=false
DEV_DIRECT_SERVE=true        # app serves image bytes itself (no Nginx needed)
```

> `X-Accel-Redirect` and the public `location` only do anything behind Nginx.
> `DEV_DIRECT_SERVE=true` makes the app serve image bytes directly so the full
> app works locally without Nginx. **Keep it false/unset in production.**

## Deployment

See [deploy/DEPLOY.md](deploy/DEPLOY.md) for the full Oracle ARM walkthrough
(dual firewall, Node arm64, systemd, Nginx + SPA build, certbot).

**CI/CD:** [`.github/workflows/ci-cd.yml`](.github/workflows/ci-cd.yml) builds the
web app and validates the server on every push/PR, then deploys to the VM over
SSH on a green push to `main`. Required secrets and the one server prerequisite
(passwordless sudo for the deploy user) are in the
[Automated deploys](deploy/DEPLOY.md#automated-deploys-github-actions) section.

## Project layout

```
server/   Express API (login, upload, admin, private authorization) + issue-password CLI
web/      React + Vite + Tailwind SPA (login / portal / admin)
deploy/   nginx.conf, systemd unit, DEPLOY.md
```

## Security model

- Private root is outside any public location; only the `internal;` block reads it.
- Passwords are high-entropy random tokens (not user-chosen) — only their SHA-256
  hash is stored, so a DB leak exposes no usable credentials.
- Uploads validated by magic bytes (not extension), size-capped, stored under
  opaque ids in `YYYY/` subdirs.
- Sessions are server-side rows (instantly revocable — revoking a password drops
  its live sessions), behind signed `httpOnly`/`Secure`/`SameSite=Lax` cookies.
- Only `admin`-role sessions can delete images or manage passwords.
```
