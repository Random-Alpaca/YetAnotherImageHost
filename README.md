# Image Hoster

Self-hosted image hosting on an Oracle Always-Free ARM VM. Nginx serves public
images directly off disk; private images are authorized by an Express app and
streamed by Nginx via `X-Accel-Redirect` (the app never touches the bytes).
Access is **username/password accounts, admin-approved**: anyone can request an
account, but an admin has to approve it before the login works. An `admin`
bootstraps the first account from the CLI.

## Pieces

- **Login page** — username + password to reach the protected portal.
- **Signup page** — request an account; it lands in the admin approval queue.
- **Portal** — everyone logged in can view and upload images, organize them into
  folders, toggle visibility, and delete; you can modify your own images, and
  `admin` can modify anyone's.
- **Folder sharing** — each folder is visible to *everyone signed in*, *admins
  only*, or *specific people*, and can additionally be published as a **public
  album**: a link-only page anyone can open without an account, optionally
  accepting photos from visitors.
- **Account page** — change your own password.
- **Admin page** — approve/reject account requests, revoke and delete accounts.
- **Public images** — served directly by Nginx at a public URL, no login needed.

Logged-out visitors can reach exactly two things: the login/signup pages and
public albums they hold the link to.

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

| Method | Path                          | Auth         | Purpose                                              |
|--------|-------------------------------|--------------|------------------------------------------------------|
| POST   | `/api/login`                  | no           | Username+password login → session cookie             |
| GET    | `/api/me`                     | yes          | Current username + role                              |
| POST   | `/api/logout`                 | yes          | Destroy session                                      |
| POST   | `/api/me/password`            | yes          | Change own password                                  |
| POST   | `/api/users`                  | yes¹         | Create an account (¹admin role requires admin)       |
| POST   | `/api/users/signup`           | no           | Request an account (queued for admin approval)       |
| GET    | `/api/users/requests`         | admin        | Pending account requests                             |
| POST   | `/api/users/requests/:id/approve` | admin    | Approve a request → creates the account              |
| DELETE | `/api/users/requests/:id`     | admin        | Reject a request                                     |
| GET    | `/api/users/names`            | yes          | id + username of active accounts (share picker)      |
| GET    | `/api/users`                  | admin        | List accounts                                        |
| POST   | `/api/users/:id/revoke`       | admin        | Revoke an account (kills its live sessions)          |
| DELETE | `/api/users/:id`              | admin        | Delete an account                                    |
| POST   | `/api/upload`                 | yes          | Upload image(s) (`visibility`, `folder_id`/`folder_name`) |
| GET    | `/api/images/list`            | yes          | List images (`?folder=<id>\|none` to filter)         |
| PATCH  | `/api/images/:id`             | owner/admin  | Set an image's folder                                |
| PATCH  | `/api/images/:id/visibility`  | owner/admin  | Toggle public/private (moves the file)               |
| POST   | `/api/images/bulk`            | owner/admin² | Bulk `delete` or `move` (²checked per image)         |
| DELETE | `/api/images/:id`             | owner/admin  | Delete an image                                      |
| GET    | `/api/folders`                | yes          | List folders (with recursive image counts)           |
| POST   | `/api/folders`                | yes          | Create a folder                                      |
| PATCH  | `/api/folders/:id`            | owner/admin  | Sharing: `access`, `is_public`, `public_upload`, `shared_with` |
| DELETE | `/api/folders/:id`            | owner/admin  | Delete a folder (reparents its contents up one level)|
| GET    | `/api/albums/:slug`           | no           | A published album's name + images                    |
| POST   | `/api/albums/:slug/upload`    | no³          | Visitor upload (³only if `public_upload` is on)      |
| GET    | `/i/private/:id`              | yes          | Authorized private image (X-Accel-Redirect)          |
| GET    | `/i/public/<year>/<id>.<ext>` | no           | Public image (served by Nginx directly)              |
| GET    | `/api/health`                 | no           | Liveness                                             |

## Local development

Two processes: the Express API and the Vite dev server.

```bash
# 1) API
cd server
cp .env.example .env        # set COOKIE_SECRET; point STORAGE_*/DB_PATH at local dirs
npm install
npm run dev                 # http://127.0.0.1:3000

# 2) bootstrap the first admin account (generated password printed once)
npm run create-user -- --username me --role admin
#    forgot it later? reset (keeps role, logs that account out everywhere):
#    npm run create-user -- --reset --username me

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
server/   Express API (login, accounts, upload, private authorization) + create-user CLI
web/      React + Vite + Tailwind SPA (login / portal / account / admin)
deploy/   nginx.conf, systemd unit, DEPLOY.md
```

## Security model

- Private root is outside any public location; only the `internal;` block reads it.
- Passwords are hashed with scrypt (per-credential random salt), so a DB leak
  exposes no usable credentials. Session tokens are high-entropy random values,
  stored only as their SHA-256 hash.
- Uploads validated by magic bytes (not extension), size-capped, stored under
  opaque ids in `YYYY/` subdirs. HEIC/HEIF is transcoded to JPEG on upload.
- Sessions are server-side rows (instantly revocable — revoking an account drops
  its live sessions), behind signed `httpOnly`/`Secure`/`SameSite=Lax` cookies.
- Image and folder mutations are owner-or-admin; listing/revoking accounts is
  `admin`-only, and only `admin` sessions can create other admins.
- Folder access is checked against **every ancestor**, so a permissive subfolder
  can't be a side door into a restricted parent. Private image bytes are gated
  by the same check (`canViewImage`), not just by having any session.
- Signup requests store only a scrypt hash, and `POST /api/users/signup` answers
  identically whether or not the username was free, so it can't enumerate users.
- A public album's slug is 12 random bytes. Turning sharing off deletes the slug,
  which permanently invalidates the old link — re-enabling issues a new one.
  Visitor uploads are stored `private` so their bytes only ever leave through
  the app's authorization.

Run the access-control self-check with `cd server && node scripts/check-access.js`.
```
