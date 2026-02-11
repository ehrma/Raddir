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
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

> **Note**: The reverse proxy only handles HTTP/WebSocket (signaling). WebRTC UDP traffic goes directly to the server — it cannot be proxied through nginx.

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
