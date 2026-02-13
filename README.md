# Raddir

**A modern, self-hostable, privacy-first voice platform for groups that take communication seriously.**

Raddir is a TeamSpeak-inspired voice communication platform with true end-to-end encryption. The server **cannot** read your voice or text content — only metadata (who, when, where) is visible. All dependencies are open source (MIT/ISC/Apache 2.0).

## Features

### Voice
- **Low-latency voice channels** — Opus codec (48kHz, 128kbps, stereo, FEC, DTX), mediasoup SFU routing
- **Push-to-talk & voice activation** — Configurable PTT keybind or VAD with adjustable threshold
- **Per-user volume control** — 0–200% per user, plus a master output volume slider
- **Mic test mode** — Real-time level meter with VAD threshold visualization to dial in sensitivity
- **Audio processing** — Toggleable noise suppression, echo cancellation, and auto gain control
- **Audio device selection** — Choose input/output devices from settings
- **Mute & deafen** — Mute stops transmission; deafen mutes all incoming audio
- **Speaking indicators** — Green ring on avatars for yourself and other users

### Security & Privacy
- **End-to-end encrypted voice** — AES-256-GCM via Insertable Streams; server is cryptographically blind
- **End-to-end encrypted text chat** — Messages encrypted client-side before transmission
- **Persistent identity keys** — Ed25519 (with ECDSA P-256 browser fallback), device-bound keypair
- **User verification** — Signal-style safety numbers and fingerprints; verified users show a badge
- **Identity export/import** — Backup your identity as a passphrase-encrypted file (PBKDF2 + AES-256-GCM)
- **ECDH P-256 key exchange** — Per-channel shared secrets derived via HKDF
- **Built-in TLS** — Server always runs HTTPS/WSS; self-signed cert auto-generated, Let's Encrypt supported
- **Scoped certificate trust** — Electron only trusts self-signed certs for the specific server you connect to, not globally
- **No telemetry** — Zero tracking, no analytics, no phone-home
- **No accounts required** — Connect with just a nickname; identity stays on your device

### Server & Administration
- **Self-hosting first** — Single binary, works fully offline / LAN, no cloud dependency
- **TLS out of the box** — Self-signed (default), Let's Encrypt (automatic ACME), or custom certificates
- **Optional server password** — Protect your server with `RADDIR_PASSWORD`; leave empty for open access
- **Admin token authentication** — Set `RADDIR_ADMIN_TOKEN` and provide it on connect to get admin privileges; all mutating REST API routes require it
- **Invite system** — Admins generate invite codes that encode the server address into a shareable blob. Recipients paste the code on the connect screen to auto-add the server. The server password is **never** included — instead, a permanent per-user session credential is issued on redemption
- **Session credentials** — Invited users authenticate with a personal credential tied to their public key, not the server password. Credentials can be revoked server-side
- **Encrypted credential storage** — Passwords, admin tokens, and session credentials are encrypted at rest using Electron's OS-level `safeStorage` API (DPAPI on Windows, Keychain on macOS, libsecret on Linux). Falls back to plaintext in browser mode
- **Role-based permissions** — Admin, Member, Guest roles with granular permission control
- **Channel permission overrides** — Per-channel permission tweaks per role
- **Effective permissions viewer** — See computed permissions for any user
- **Admin panel** — Manage channels, users (kick/ban), invite codes, roles, and overrides
- **Ban system** — Ban users by identity; persisted across reconnects

### Client
- **Electron desktop app** — Native window, clean frameless UI
- **Appearance settings** — Dark, light, or system theme (follows OS preference)
- **Server browser** — Save multiple servers with name, address, password, and admin token
- **Paste invite** — Paste an invite code to auto-add a server and receive a session credential
- **Smart server URLs** — Type `your-server:4000` instead of `wss://your-server:4000/ws`
- **Channel tree** — Hierarchical channels with inline user avatars and speaking rings
- **User verification UI** — Click any user to verify via safety number; verified badge in channel tree and user list
- **Your identity card** — Click yourself to see your fingerprint with a copy button
- **E2EE text chat** — Per-channel encrypted chat with in-memory message history across channel switches
- **Settings panel** — Audio, keybinds, appearance, and identity tabs
- **Identity management** — View fingerprint, export/import encrypted identity backup, manage verified users
- **Join/leave sounds** — Audio cues when users enter or leave channels
- **Reconnect overlay** — Automatic reconnection handling with visual feedback
- **Kick/ban notifications** — Toast notifications when kicked or banned

### Infrastructure
- **Channel tree model** — Persistent server → channel hierarchy, TeamSpeak-style
- **SQLite database** — Zero-config persistence via better-sqlite3
- **mediasoup SFU** — Scales to hundreds of users with configurable worker count
- **Docker ready** — Multi-stage Dockerfile, Docker Hub image, Portainer-compatible
- **Electron builds** — NSIS installer + portable exe (Windows), DMG (macOS), AppImage + deb (Linux)
- **pnpm monorepo** — Shared types between server and client

## Quick Start

### Prerequisites

- Node.js ≥ 20
- pnpm ≥ 9

### Development

```bash
# Install dependencies
pnpm install

# Build shared types
pnpm build:shared

# Start the server (dev mode with hot reload)
pnpm dev:server

# Start the client (Electron + Vite + React)
pnpm dev:client
```

The server starts on `https://localhost:4000` with WebSocket signaling at `wss://localhost:4000/ws`. A self-signed TLS certificate is auto-generated on first start.

### Browser-Only Client (no Electron)

```bash
pnpm --filter @raddir/client dev:browser
```

Opens at `http://localhost:5173`.

## Deployment

### Docker (recommended)

The server image is available on Docker Hub:

```bash
docker pull zahli/raddir-server:latest
```

Or build locally:

```bash
docker build -f Dockerfile.server -t raddir-server .
```

#### Docker Compose / Portainer Stack

```yaml
services:
  raddir:
    image: zahli/raddir-server:latest
    container_name: raddir
    restart: unless-stopped
    ports:
      - "4000:4000"
      - "40000-40100:40000-40100/udp"
    environment:
      - RADDIR_HOST=0.0.0.0
      - RADDIR_PORT=4000
      - RADDIR_DB_PATH=/app/data/raddir.db
      - RADDIR_RTC_MIN_PORT=40000
      - RADDIR_RTC_MAX_PORT=40100
      - RADDIR_ANNOUNCED_IP=       # Set to your server's public IP
      - RADDIR_ADMIN_TOKEN=        # Optional
      - RADDIR_PASSWORD=           # Optional
      - RADDIR_TLS_MODE=selfsigned
      - RADDIR_LOG_LEVEL=info
    volumes:
      - raddir-data:/app/data

volumes:
  raddir-data:
    driver: local
```

For Let's Encrypt, set `RADDIR_TLS_MODE=letsencrypt`, `RADDIR_TLS_DOMAIN`, `RADDIR_TLS_EMAIL`, and expose port 80.

### Electron Desktop Builds

```bash
# Windows (NSIS installer + portable exe)
pnpm electron:build:win

# macOS (DMG, x64 + arm64)
pnpm electron:build:mac

# Linux (AppImage + deb)
pnpm electron:build:linux
```

Output goes to `packages/client/release/`.

> **Note:** You can only build for your current OS natively. For cross-platform builds, use CI (e.g., GitHub Actions).

## Configuration

Configuration is loaded in order: **environment variables** → **config file** → **defaults**.

### Server

| Variable | Default | Description |
|---|---|---|
| `RADDIR_HOST` | `0.0.0.0` | Listen address |
| `RADDIR_PORT` | `4000` | HTTPS/WSS port |
| `RADDIR_RTC_MIN_PORT` | `40000` | WebRTC UDP port range start |
| `RADDIR_RTC_MAX_PORT` | `49999` | WebRTC UDP port range end |
| `RADDIR_ANNOUNCED_IP` | *(empty)* | Public IP for WebRTC (required for remote access) |
| `RADDIR_DB_PATH` | `./data/raddir.db` | SQLite database path |
| `RADDIR_MEDIA_WORKERS` | *(CPU count)* | Number of mediasoup workers |
| `RADDIR_CONFIG_PATH` | `./raddir.config.json` | Path to optional JSON config file |

### Security

| Variable | Default | Description |
|---|---|---|
| `RADDIR_PASSWORD` | *(empty)* | Server password (leave empty for open access) |
| `RADDIR_ADMIN_TOKEN` | *(empty)* | Admin authentication token |

### TLS

The server **always** runs HTTPS/WSS. Three modes are available:

| Variable | Default | Description |
|---|---|---|
| `RADDIR_TLS_MODE` | `selfsigned` | TLS mode: `selfsigned`, `letsencrypt`, or `custom` |
| `RADDIR_TLS_DOMAIN` | *(empty)* | Domain name (required for `letsencrypt`) |
| `RADDIR_TLS_EMAIL` | *(empty)* | Contact email (required for `letsencrypt`) |
| `RADDIR_TLS_CERT` | *(empty)* | Path to PEM cert file (required for `custom`) |
| `RADDIR_TLS_KEY` | *(empty)* | Path to PEM key file (required for `custom`) |

**Self-signed** (default): Auto-generates an RSA-2048 certificate on first start, valid 10 years, persisted in the data directory. The Electron client accepts self-signed certs only for the specific server host you connect to (scoped trust, not global).

**Let's Encrypt**: Obtains a free certificate via ACME HTTP-01 challenge. Requires a domain pointing to the server and port 80 open (temporarily, during cert issuance). Certificates auto-renew every 12 hours if expiring within 30 days — hot-swapped without restart.

**Custom**: Bring your own PEM certificate and key files (e.g., from a reverse proxy or corporate CA).

### Logging

| Variable | Default | Description |
|---|---|---|
| `RADDIR_LOG_LEVEL` | `info` | Log level: `debug`, `info`, `warn`, `error` |

### Firewall / Port Forwarding

| Port | Protocol | Purpose |
|---|---|---|
| `4000` | TCP | HTTPS API + WSS signaling |
| `80` | TCP | ACME challenge (Let's Encrypt only, temporary) |
| `40000-49999` | UDP | WebRTC media (voice) |

For Docker Compose, the default UDP range is narrowed to `40000-40100` for practicality. Adjust `RADDIR_RTC_MIN_PORT` / `RADDIR_RTC_MAX_PORT` as needed.

## Architecture

```
packages/
├── shared/    # Protocol types, permission enums, crypto types
├── server/    # Node.js backend: Fastify (HTTPS) + mediasoup SFU + SQLite
└── client/    # Electron + React + Vite desktop app
```

### Voice Pipeline

```
Mic → Opus encode → [E2EE: AES-256-GCM encrypt] → DTLS-SRTP → mediasoup SFU → DTLS-SRTP → [E2EE: AES-256-GCM decrypt] → Opus decode → Speaker
```

### Security Model

| What | Transport Encrypted? | E2E Encrypted? | Server can read? |
|---|---|---|---|
| Voice audio | ✅ DTLS-SRTP | ✅ AES-256-GCM | ❌ **No** |
| Text chat | ✅ WSS (TLS) | ✅ AES-256-GCM | ❌ **No** |
| Signaling / metadata | ✅ WSS (TLS) | — | ✅ Yes (routing) |
| Identity keys | ✅ WSS (TLS) | — | ✅ Public keys only |
| Telemetry | — | — | ❌ None sent |

> The server sees *metadata* (who connects, when, to which channel). It **cannot** see or hear *content*. This is the same trust model as Signal.

### User Verification

Users can verify each other using **safety numbers** (12-digit numeric codes derived from SHA-256 of both public keys) and **fingerprints** (hex digest of a single public key). Verified users display a green shield badge in the channel tree and user list. Verification state is persisted locally.

### Identity Backup

Your cryptographic identity can be exported as a passphrase-encrypted JSON file (PBKDF2 key derivation + AES-256-GCM). This allows restoring your identity on a new device or after a reinstall. The salt and IV are stored in cleartext in the file — this is standard and safe, as they are not secrets; only the passphrase protects the key material.

## System Requirements

| Users | CPU | RAM | Bandwidth |
|---|---|---|---|
| 1–25 | 1 core | 256 MB | 5 Mbps |
| 25–100 | 2 cores | 512 MB | 20 Mbps |
| 100–500 | 4 cores | 1 GB | 100 Mbps |

These are estimates for audio-only SFU routing with Opus at ~64 kbps per stream.

## License

TBD
