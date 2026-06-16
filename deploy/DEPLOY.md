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

**b) The instance firewall.** Oracle Ubuntu images ship with iptables rules:

```bash
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
sudo netfilter-persistent save
```

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
```

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
push/PR and, on a green push to `main`, deploys to this VM over SSH — the same
stage-to-`/tmp` → sudo-rsync → `npm ci` → restart flow as above, plus a health
check that fails the run if the app doesn't come back up.

### Repository secrets

Set these under **Settings → Secrets and variables → Actions**:

| Secret             | Value                                                            |
|--------------------|-----------------------------------------------------------------|
| `SSH_PRIVATE_KEY`  | The private key whose public half is in the VM user's `authorized_keys`. Include the full PEM, header/footer lines and all. |
| `SSH_HOST`         | VM public IP or domain (e.g. `img.jxue.ca`).                    |
| `SSH_USER`         | Login user (e.g. `ubuntu`).                                     |
| `SSH_KNOWN_HOSTS`  | *Recommended.* Output of `ssh-keyscan YOUR_VM_IP`. Pins the host key; without it the job falls back to trust-on-first-use. |

### Server prerequisite — passwordless sudo for the deploy user

The workflow's SSH user must run a few commands via `sudo` without a TTY
prompt. Add a scoped sudoers drop-in on the VM:

```bash
sudo tee /etc/sudoers.d/image-hoster-deploy >/dev/null <<'EOF'
ubuntu ALL=(root)        NOPASSWD: /usr/bin/rsync, /usr/bin/chown, /usr/bin/systemctl restart image-hoster
ubuntu ALL=(imagehoster) NOPASSWD: /usr/bin/npm
EOF
sudo chmod 440 /etc/sudoers.d/image-hoster-deploy
sudo visudo -c   # validate
```

(Adjust the `ubuntu` username and binary paths — `which rsync npm systemctl` —
if your image differs.)

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
