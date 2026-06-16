# Deploying the Image Hoster to an Oracle Always-Free ARM (Ampere A1) VM

Target: Ubuntu 22.04/24.04 on `aarch64`. All commands assume you SSH in as
`ubuntu` and use `sudo`.

> **Two firewalls.** Oracle Cloud blocks traffic at the **VCN security list**
> *and* the instance runs its own iptables/`firewalld`. You must open ports in
> **both** or HTTPS will silently hang. Don't skip step 2.

---

## 1. Base packages + Node (ARM build)

```bash
sudo apt update && sudo apt -y upgrade

# Node 20 LTS — NodeSource ships native arm64 binaries.
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt -y install nodejs nginx git build-essential

node --version    # expect v20.x, arch arm64
```

`better-sqlite3` has prebuilt arm64 binaries for Node 20; `build-essential` is
the fallback in case it has to compile.

## 2. Open the firewall — BOTH layers

**a) Oracle VCN security list** (web console):
VCN → your subnet → Security List → add **Ingress** rules:
- Source `0.0.0.0/0`, TCP, dest port **80**
- Source `0.0.0.0/0`, TCP, dest port **443**

**b) The instance firewall.** Oracle's Ubuntu images ship an nftables ruleset
that is **managed by iptables-nft** — `sudo nft list ruleset` shows
`table ip filter ... managed by iptables-nft, do not touch!`. Manage it with the
`iptables` command (it writes through to that same ruleset); do **not** hand-edit
it with raw `nft` or `/etc/nftables.conf`.

The `INPUT` chain ends in a catch-all `reject`, so the new ACCEPTs must be
inserted *before* that reject — appending after it does nothing:

```bash
# Position of the catch-all REJECT in the INPUT chain
REJ=$(sudo iptables -L INPUT --line-numbers -n | awk '/REJECT/{print $1; exit}')

# Insert the web ports just above it
sudo iptables -I INPUT "$REJ" -p tcp --dport 80  -j ACCEPT
sudo iptables -I INPUT "$REJ" -p tcp --dport 443 -j ACCEPT

# Verify — both ACCEPTs must appear ABOVE the REJECT line
sudo iptables -L INPUT --line-numbers -n

# Persist across reboots (install if missing: apt install iptables-persistent)
sudo netfilter-persistent save
```

Verify from your laptop: `nc -vz YOUR_VM_IP 443`.

(SSH on 22 is already allowed; leave it.)

## 3. Create the service user and directories

```bash
sudo useradd --system --create-home --shell /usr/sbin/nologin imagehoster

sudo mkdir -p /srv/app/server /srv/images/public /srv/images/private

# App + DB owned by the service user.
sudo chown -R imagehoster:imagehoster /srv/app

# Storage: owned by the service user (it writes uploads). Nginx (www-data) only
# needs to READ. Give group read + execute so the internal location can stream.
sudo chown -R imagehoster:www-data /srv/images
sudo chmod -R 750 /srv/images
```

> The private dir is never mapped to a public Nginx location, so even with read
> access www-data can only reach it through the `internal;` block.

## 4. Deploy the app code

From your laptop (in this repo):

```bash
rsync -av --exclude node_modules --exclude .env \
  server/ ubuntu@YOUR_VM_IP:/tmp/server/
```

On the VM:

```bash
sudo rsync -av /tmp/server/ /srv/app/server/
cd /srv/app/server
sudo -u imagehoster npm ci --omit=dev   # or: npm install --omit=dev
```

## 5. Configure environment

```bash
sudo -u imagehoster cp /srv/app/server/.env.example /srv/app/server/.env
sudo -u imagehoster nano /srv/app/server/.env
sudo chmod 600 /srv/app/server/.env   # holds COOKIE_SECRET — owner-only
```

> The file is owned by `imagehoster`, so edit it with `sudo -u imagehoster nano
> …` (or `sudo nano …`) — your login user can't write it directly.

Set at minimum:
- `COOKIE_SECRET` — generate: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
- `STORAGE_PUBLIC=/srv/images/public`
- `STORAGE_PRIVATE=/srv/images/private`
- `DB_PATH=/srv/app/data.db`
- `COOKIE_SECURE=true`

## 6. Install the systemd service

```bash
sudo cp /srv/app/server/../../deploy/image-hoster.service /etc/systemd/system/
# (or scp deploy/image-hoster.service over)
sudo systemctl daemon-reload
sudo systemctl enable --now image-hoster
sudo systemctl status image-hoster        # should be active (running)
curl -s http://127.0.0.1:3000/api/health  # {"ok":true}
```

## 7. Build and deploy the web app

Build the React SPA (on your laptop is fine — it's static output) and copy the
`dist/` to where Nginx serves it (`/srv/app/web`, matching `root` in nginx.conf):

```bash
# on your laptop, in this repo:
cd web && npm install && npm run build      # -> web/dist/
rsync -av dist/ ubuntu@YOUR_VM_IP:/tmp/web/
```

On the VM:

```bash
sudo mkdir -p /srv/app/web
sudo rsync -av --delete /tmp/web/ /srv/app/web/
sudo chown -R imagehoster:www-data /srv/app/web
```

(The frontend talks to the API at same-origin `/api` and `/i`, so no build-time
config is needed.)

## 8. Configure Nginx

```bash
sudo cp deploy/nginx.conf /etc/nginx/sites-available/image-hoster
sudo sed -i 's/IMAGE_HOST_DOMAIN/img.jxue.ca/' /etc/nginx/sites-available/image-hoster
sudo ln -sf /etc/nginx/sites-available/image-hoster /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
```

## 9. DNS + TLS

Point an `A` record (e.g. `img.jxue.ca`) at the VM's public IP. Then:

```bash
sudo apt -y install certbot python3-certbot-nginx
sudo certbot --nginx -d img.jxue.ca
```

Certbot rewrites the server block to listen on 443 and sets up auto-renewal.

## 10. Create your first (admin) password

The admin web page needs an admin session, which you can't have until an admin
password exists — so bootstrap the first one from the CLI:

```bash
cd /srv/app/server
sudo -u imagehoster npm run issue-password -- --role admin --label "me"
```

It prints the password **once**. Open `https://img.jxue.ca/`, paste it into the
login page, and from the Admin page issue any further passwords (user or admin).

## 11. Smoke test the full flow

```bash
# Log in with the admin password from step 9 -> session cookie
curl -X POST https://img.jxue.ca/api/login \
  -H 'Content-Type: application/json' \
  -d '{"password":"PASTE_PASSWORD"}' -c cookies.txt
# -> {"role":"admin"}

# Upload a private image
curl -X POST https://img.jxue.ca/api/upload \
  -b cookies.txt -F "file=@/path/to/photo.jpg" -F "visibility=private"
# -> {"id":"...","visibility":"private","url":"/i/private/<id>"}

# Authorized fetch streams via X-Accel-Redirect:
curl -b cookies.txt https://img.jxue.ca/i/private/<id> -o out.jpg   # 200

# Without the cookie -> 401, and the real path is never exposed.
curl https://img.jxue.ca/i/private/<id> -i                          # 401
```

---

## Updating later

API:
```bash
rsync -av --exclude node_modules --exclude .env server/ ubuntu@YOUR_VM_IP:/tmp/server/
sudo rsync -av --exclude .env /tmp/server/ /srv/app/server/
cd /srv/app/server && sudo -u imagehoster npm ci --omit=dev
sudo systemctl restart image-hoster
```

Web (static — no service restart):
```bash
cd web && npm run build && rsync -av dist/ ubuntu@YOUR_VM_IP:/tmp/web/
sudo rsync -av --delete /tmp/web/ /srv/app/web/
```

---

## Automated deploys (GitHub Actions)

`.github/workflows/ci-cd.yml` runs CI (build web + validate server) on every
push/PR and, on a green push to `main`, deploys to this VM over SSH: rsync the
code + web build straight into `/srv/app`, `npm ci`, restart, health-check.

**The deploy connects AS the service user `imagehoster`** — the same user that
owns `/srv/app` and runs the app. This is the key design choice: because the
user writing the files is the user that owns and runs them, there is **no
cross-user ownership to reconcile** — no `chown`, no `sudo` for any file
operation, ever. Root is used only to restart the service.

### Repository secrets

Set these under **Settings → Secrets and variables → Actions**:

| Secret             | Value                                                            |
|--------------------|-----------------------------------------------------------------|
| `SSH_PRIVATE_KEY`  | The deploy private key whose public half is in **`imagehoster`'s** `authorized_keys` (see below). Full PEM, header/footer and all. |
| `SSH_HOST`         | VM public IP or domain (e.g. `img.jxue.ca`).                    |
| `SSH_USER`         | **`imagehoster`** — the service user, *not* `ubuntu`.          |
| `SSH_KNOWN_HOSTS`  | *Recommended.* Output of `ssh-keyscan YOUR_VM_IP`. Pins the host key; without it the job falls back to trust-on-first-use. |

### Server prerequisite — let the deploy key log in as `imagehoster`

`imagehoster` is created as a no-login system account, so give it a shell and
authorize the deploy key:

```bash
# 1. Give the service account a login shell so SSH can connect.
sudo usermod -s /bin/bash imagehoster

# 2. Authorize the deploy key (the PUBLIC half of SSH_PRIVATE_KEY).
sudo install -d -m 700 -o imagehoster -g imagehoster /home/imagehoster/.ssh
echo 'ssh-ed25519 AAAA...your-deploy-public-key... deploy' \
  | sudo tee -a /home/imagehoster/.ssh/authorized_keys >/dev/null
sudo chown imagehoster:imagehoster /home/imagehoster/.ssh/authorized_keys
sudo chmod 600 /home/imagehoster/.ssh/authorized_keys

# 3. Let ONLY the restart run as root, without a password.
sudo tee /etc/sudoers.d/image-hoster-deploy >/dev/null <<'EOF'
imagehoster ALL=(root) NOPASSWD: /usr/bin/systemctl restart image-hoster
EOF
sudo chmod 440 /etc/sudoers.d/image-hoster-deploy
sudo visudo -c
```

That's the whole prerequisite. It assumes `/srv/app` is owned by `imagehoster`
(provisioning step 3: `sudo chown -R imagehoster:imagehoster /srv/app`); nginx
(`www-data`) still serves `/srv/app/web` fine since the `755` dirs are
world-readable. If past runs left root-owned files there, reset once:

```bash
sudo chown -R imagehoster:imagehoster /srv/app
```

> Adjust `imagehoster` / paths (`which npm systemctl`) if your setup differs.
> Want to keep the system account locked down? Instead of a full shell you can
> prefix the `authorized_keys` line with a forced command, or use
> `usermod -s /bin/bash` now and harden later — key-only SSH for a deploy
> account is a standard, low-risk pattern.

### First run

Create the GitHub repo, add the remote, and push `main`:

```bash
git remote add origin git@github.com:<you>/image-hoster.git
git push -u origin main
```

CI runs immediately; the deploy job runs once secrets are set and the push is on
`main`. Watch it under the repo's **Actions** tab.

## Backups

Everything that matters is two paths:
- `/srv/app/data.db` (+ `-wal`/`-shm`) — the metadata DB
- `/srv/images/` — the actual files

A nightly `tar`/`rsync` of those to object storage is enough.
