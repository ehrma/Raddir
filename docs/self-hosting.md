# Self-Hosting Raddir

Raddir is designed to be self-hosted. No cloud dependency, no forced accounts, works fully offline on LAN.

## Option 1: Docker Compose (recommended)

```bash
git clone https://github.com/your-org/raddir.git
cd raddir
cp .env.example .env

# Edit .env — set RADDIR_ANNOUNCED_IP to your public/LAN IP
docker compose up -d
```

That's it. Server is running on port 4000.

### Updating

```bash
docker compose pull
docker compose up -d
```

### Data

All data is stored in a Docker volume (`raddir-data`). The SQLite database lives at `/data/raddir.db` inside the container.

To back up:
```bash
docker cp raddir:/data/raddir.db ./backup-raddir.db
```

## Option 2: Bare Metal

### Prerequisites

- Node.js ≥ 20
- pnpm ≥ 9
- Build tools for native modules: `python3`, `make`, `g++` (Linux) or Visual Studio Build Tools (Windows)

### Install

```bash
git clone https://github.com/your-org/raddir.git
cd raddir
pnpm install
pnpm build
```

### Run

```bash
# Set environment variables (or create .env from .env.example)
export RADDIR_ANNOUNCED_IP=192.168.1.100
export RADDIR_DB_PATH=./data/raddir.db

node packages/server/dist/index.js
```

### Systemd Service (Linux)

```ini
[Unit]
Description=Raddir Voice Server
After=network.target

[Service]
Type=simple
User=raddir
WorkingDirectory=/opt/raddir
ExecStart=/usr/bin/node packages/server/dist/index.js
Restart=always
RestartSec=5
Environment=RADDIR_HOST=0.0.0.0
Environment=RADDIR_PORT=4000
Environment=RADDIR_DB_PATH=/var/lib/raddir/raddir.db
Environment=RADDIR_ANNOUNCED_IP=YOUR_IP_HERE
Environment=RADDIR_RTC_MIN_PORT=40000
Environment=RADDIR_RTC_MAX_PORT=49999

[Install]
WantedBy=multi-user.target
```

## Network Configuration

### Required Ports

| Port | Protocol | Direction | Purpose |
|---|---|---|---|
| 4000 | TCP | Inbound | HTTP API + WebSocket signaling |
| 40000-49999 | UDP | Inbound | WebRTC media (voice) |

### LAN Only

If running on a local network, set `RADDIR_ANNOUNCED_IP` to your machine's LAN IP (e.g., `192.168.1.100`). No port forwarding needed.

### Internet-Facing

1. Set `RADDIR_ANNOUNCED_IP` to your public IP or domain
2. Forward TCP 4000 and UDP 40000-49999 on your router
3. Consider placing Fastify behind a reverse proxy (nginx/Caddy) with TLS for WSS

### Reverse Proxy (nginx)

```nginx
server {
    listen 443 ssl;
    server_name raddir.example.com;

    ssl_certificate /etc/letsencrypt/live/raddir.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/raddir.example.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $remote_addr;
    }
}
```

> **Note**: The reverse proxy only handles HTTP/WebSocket (signaling). WebRTC UDP traffic goes directly to the server — it cannot be proxied through nginx.

> **Important**: When behind a reverse proxy, set `RADDIR_TRUST_PROXY=true` so that rate limiting uses the client's real IP from the `X-Forwarded-For` header instead of the proxy's IP. **Never enable this if the server is directly reachable** — attackers can spoof the header to bypass rate limits.

## Security Hardening

### Rate Limiting

The server applies IP-based sliding-window rate limiting to:

- **WebSocket auth**: 10 attempts per 60 seconds per IP
- **Public invite endpoints** (validate, redeem, decode): 20 requests per 60 seconds per IP

Rate-limited requests receive a `429 Too Many Requests` (HTTP) or an auth failure with a descriptive message (WebSocket).

### CORS Policy

The server restricts CORS to:

- `null` / `file://` / `app://` origins (Electron)
- `http://localhost` / `https://localhost` (development)

All other origins are rejected. This prevents browser-based CSRF attacks against the API.

### Admin Token

The `RADDIR_ADMIN_TOKEN` grants **ephemeral** admin privileges for the duration of a WebSocket session. It is **not** persisted as a database role — when the session disconnects, admin privileges are gone. This limits the blast radius of a leaked token.

- All mutating REST API routes (`/api/servers/:id/invites`, etc.) require the admin token in the `Authorization: Bearer <token>` header.
- If no token is set and `RADDIR_OPEN_ADMIN=false` (default), the admin API is locked.
- If no token is set and `RADDIR_OPEN_ADMIN=true`, the admin API is open to all (only for development/testing).

### Invite System

- **Invite blob v2** contains the server address (routing hint) and a random token
- The server stores the canonical address in its database — the blob address is **not trusted** for authorization
- Redeem creates an **unbound** credential (no public key attached). The credential is bound to the user's identity on first WebSocket auth
- Once bound, the credential only works with the matching public key — stolen public keys alone are useless
- Invite uses are enforced atomically to prevent race conditions exceeding `maxUses`

### Proxy Trust (`RADDIR_TRUST_PROXY`)

| Value | Behavior |
|---|---|
| `false` (default) | Rate limiting uses `req.socket.remoteAddress` (direct TCP connection IP) |
| `true` | Rate limiting uses the first IP from `X-Forwarded-For` header |

**Only set to `true` if the server is behind a trusted reverse proxy** (nginx, Caddy, etc.) that overwrites `X-Forwarded-For`. If the server is directly reachable, an attacker can forge this header to bypass rate limits.

### WebSocket Message Limits

The WebSocket server enforces a **64 KB** maximum message size (`maxPayload`). Messages exceeding this limit are rejected and the connection is closed. This prevents memory exhaustion from oversized payloads.

## System Requirements

| Users | CPU | RAM | Bandwidth | Disk |
|---|---|---|---|---|
| 1–25 | 1 core | 256 MB | 5 Mbps | 50 MB |
| 25–100 | 2 cores | 512 MB | 20 Mbps | 100 MB |
| 100–500 | 4 cores | 1 GB | 100 Mbps | 500 MB |

Disk usage depends on chat message retention. Voice is never stored.

## Troubleshooting

### "No audio" / "Cannot connect"

- Verify `RADDIR_ANNOUNCED_IP` is set to the correct IP clients can reach
- Verify UDP ports 40000-49999 are open and forwarded
- Check firewall rules: `sudo ufw allow 40000:49999/udp`

### "Database locked"

- Ensure only one Raddir instance is running per database file
- WAL mode is enabled by default for concurrent read performance

### High CPU usage

- Each mediasoup worker uses one CPU core. Reduce `RADDIR_MEDIA_WORKERS` if needed
- Audio-only SFU is very lightweight — high CPU usually indicates too many workers for the hardware
