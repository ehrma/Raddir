# Raddir

**A modern, self-hostable, privacy-first voice platform for groups that take communication seriously.**

Raddir is a TeamSpeak-inspired voice communication platform with true end-to-end encryption. The server **cannot** read your voice or text content — only metadata (who, when, where) is visible.

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
- **Persistent Ed25519 identity** — Device-bound keypair with safety number verification
- **ECDH P-256 key exchange** — Per-channel shared secrets derived via HKDF
- **No telemetry** — Zero tracking, no analytics, no phone-home
- **No accounts required** — Connect with just a nickname; identity stays on your device

### Server & Administration
- **Self-hosting first** — Single binary, works fully offline / LAN, no cloud dependency
- **Optional server password** — Protect your server with `RADDIR_PASSWORD`; leave empty for open access
- **Admin token authentication** — Set `RADDIR_ADMIN_TOKEN` and provide it on connect to get admin privileges
- **Role-based permissions** — Admin, Member, Guest roles with granular permission control
- **Channel permission overrides** — Per-channel permission tweaks per role
- **Effective permissions viewer** — See computed permissions for any user
- **Admin panel** — Manage channels, users (kick/ban), invite tokens, roles, and overrides
- **Ban system** — Ban users by identity; persisted across reconnects
- **Invite system** — Generate invite tokens via REST API

### Client
- **Electron desktop app** — Native window with system theme support (dark/light/auto)
- **Server browser** — Save multiple servers with name, address, password, and admin token
- **Smart server URLs** — Type `localhost:4000` instead of `ws://localhost:4000/ws`
- **Channel tree** — Hierarchical channels with inline user avatars and speaking rings
- **E2EE text chat** — Per-channel encrypted chat with in-memory message history across channel switches
- **Settings panel** — Audio, keybinds, and identity tabs; accessible before connecting
- **Join/leave sounds** — Audio cues when users enter or leave channels
- **Reconnect overlay** — Automatic reconnection handling with visual feedback
- **Kick/ban notifications** — Toast notifications when kicked or banned

### Infrastructure
- **Channel tree model** — Persistent server → channel hierarchy, TeamSpeak-style
- **SQLite database** — Zero-config persistence via better-sqlite3
- **mediasoup SFU** — Scales to hundreds of users with configurable worker count
- **Docker support** — `docker compose up -d` for production deployment
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
```

The server starts on `http://localhost:4000` with WebSocket signaling at `ws://localhost:4000/ws`.

### Client (Desktop App)

```bash
# Start the client dev server (Vite + React + Electron)
pnpm --filter @raddir/client dev
```

The client opens at `http://localhost:5173`. In Electron mode it launches a native window.

**Features:**
- Connect to any Raddir server by URL
- Channel tree with join/leave, user counts
- Voice: mute, deafen, push-to-talk, voice activation detection
- Per-user volume control (0–200%)
- E2EE text chat with encryption indicators
- Settings: audio devices, keybinds, identity management
- Admin panel: channel CRUD, kick/ban, invite generation
- Join/leave sounds, speaking indicators
- Persistent Ed25519 identity with safety numbers

### Docker (recommended for production)

```bash
docker compose up -d
```

Or build and run manually:

```bash
docker build -t raddir .
docker run -d \
  --name raddir \
  --network host \
  -v raddir-data:/data \
  -e RADDIR_ANNOUNCED_IP=your.public.ip \
  raddir
```

## Configuration

Configuration is loaded in order: **environment variables** → **config file** → **defaults**.

| Variable | Default | Description |
|---|---|---|
| `RADDIR_HOST` | `0.0.0.0` | Listen address |
| `RADDIR_PORT` | `4000` | HTTP/WebSocket port |
| `RADDIR_RTC_MIN_PORT` | `40000` | WebRTC UDP port range start |
| `RADDIR_RTC_MAX_PORT` | `49999` | WebRTC UDP port range end |
| `RADDIR_ANNOUNCED_IP` | *(empty)* | Public IP for WebRTC (required for remote access) |
| `RADDIR_DB_PATH` | `./data/raddir.db` | SQLite database path |
| `RADDIR_PASSWORD` | *(empty)* | Server password (leave empty for open access) |
| `RADDIR_ADMIN_TOKEN` | *(empty)* | Admin authentication token |
| `RADDIR_LOG_LEVEL` | `info` | Log level (debug, info, warn, error) |
| `RADDIR_MEDIA_WORKERS` | *(CPU count)* | Number of mediasoup workers |
| `RADDIR_CONFIG_PATH` | `./raddir.config.json` | Path to optional JSON config file |

### Firewall / Port Forwarding

| Port | Protocol | Purpose |
|---|---|---|
| `4000` | TCP | HTTP API + WebSocket signaling |
| `40000-49999` | UDP | WebRTC media (voice) |

For Docker Compose, the default range is narrowed to `40000-40100` for practicality. Adjust `RADDIR_RTC_MIN_PORT` / `RADDIR_RTC_MAX_PORT` as needed.

## Architecture

```
packages/
├── shared/    # Protocol types, permission enums, crypto types
├── server/    # Node.js backend: Fastify + mediasoup SFU + SQLite
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
| Telemetry | — | — | ❌ None sent |

> The server sees *metadata* (who connects, when, to which channel). It **cannot** see or hear *content*. This is the same trust model as Signal.

## System Requirements

| Users | CPU | RAM | Bandwidth |
|---|---|---|---|
| 1–25 | 1 core | 256 MB | 5 Mbps |
| 25–100 | 2 cores | 512 MB | 20 Mbps |
| 100–500 | 4 cores | 1 GB | 100 Mbps |

These are estimates for audio-only SFU routing with Opus at ~64 kbps per stream.

## License

TBD
