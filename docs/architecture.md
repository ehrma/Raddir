# Raddir Architecture

## Overview

```
┌─────────────────────────────────────────────────┐
│                  Raddir Server                   │
│                                                  │
│  ┌──────────┐  ┌──────────────┐  ┌───────────┐  │
│  │ Fastify   │  │  WebSocket   │  │ mediasoup │  │
│  │ HTTP API  │  │  Signaling   │  │ SFU       │  │
│  │ :4000     │  │  /ws         │  │ Workers   │  │
│  └──────────┘  └──────────────┘  └───────────┘  │
│        │              │                │         │
│  ┌──────────┐  ┌──────────────┐  ┌───────────┐  │
│  │ SQLite   │  │  Permission  │  │  Channel   │  │
│  │ Database │  │  Engine      │  │  Routers   │  │
│  └──────────┘  └──────────────┘  └───────────┘  │
└─────────────────────────────────────────────────┘
         ▲                ▲               ▲
         │     WSS        │    WebRTC     │
         │   (signaling)  │   (voice)     │
┌────────┴────────────────┴───────────────┴────────┐
│                 Electron Client                   │
│                                                   │
│  ┌──────────┐  ┌──────────────┐  ┌────────────┐  │
│  │ React UI │  │  mediasoup   │  │  E2EE      │  │
│  │          │  │  client      │  │  Engine    │  │
│  └──────────┘  └──────────────┘  └────────────┘  │
│        │              │                │          │
│  ┌──────────┐  ┌──────────────┐  ┌────────────┐  │
│  │ Zustand  │  │  Audio       │  │  Web       │  │
│  │ Stores   │  │  Engine      │  │  Worker    │  │
│  └──────────┘  └──────────────┘  └────────────┘  │
└───────────────────────────────────────────────────┘
```

## Server Components

### Fastify HTTP API

REST endpoints for server/channel management, health checks, and invite tokens. Runs on port 4000 alongside the WebSocket server.

### WebSocket Signaling

JSON-based signaling protocol over WebSocket at `/ws`. Handles:
- Authentication (token or public key)
- Server/channel join/leave
- mediasoup transport negotiation (create, connect, produce, consume)
- E2EE key exchange relay (opaque — server cannot read)
- Chat message relay (ciphertext — server cannot read)
- User state updates (mute, deafen)
- Admin actions (kick, move)

### mediasoup SFU

Selective Forwarding Unit for voice routing:
- **Worker pool**: One worker per CPU core, round-robin assignment
- **Router per channel**: Each voice channel gets its own mediasoup Router
- **WebRTC transports**: One send + one recv transport per connected user
- **Producers**: One per user (microphone audio)
- **Consumers**: One per remote user in the channel

The SFU forwards encrypted Opus packets without decoding them.

### SQLite Database

Single-file database (WAL mode) storing:
- Servers, channels (tree structure), users
- Roles, permissions, channel overrides
- Invite tokens
- Chat messages (ciphertext only)

### Permission Engine

Computes effective permissions by:
1. Merging server-level role permissions (priority-ordered)
2. Walking the channel tree and applying overrides
3. Resolving `inherit` values to `deny`

## Client Components (planned)

### Electron Shell

Main process handles:
- Window management
- Global hotkey capture (push-to-talk)
- System tray integration
- Auto-update

### React UI

- Channel tree with drag-and-drop
- User list with volume controls
- Voice controls (mute, deafen, PTT indicator)
- Settings (audio devices, keybinds, identity)
- Text chat (encrypted)

### mediasoup-client

WebRTC client library that:
- Creates Device with server's RTP capabilities
- Manages send/recv transports
- Produces audio (microphone)
- Consumes audio (remote users)

### E2EE Engine

Runs in a Web Worker:
- ECDH key exchange on channel join
- AES-256-GCM frame encryption/decryption via Insertable Streams
- Key ratcheting on member join/leave
- Identity verification (safety numbers)

### Audio Engine

Client-side audio processing:
- Per-user GainNode for volume control
- Voice Activity Detection (VAD) for voice activation mode
- Audio device enumeration and hot-switching

## Data Flow

### Voice (with E2EE)

```
Mic → getUserMedia → Opus encode
    → Insertable Streams: AES-256-GCM encrypt (Web Worker)
    → DTLS-SRTP → mediasoup SFU → DTLS-SRTP
    → Insertable Streams: AES-256-GCM decrypt (Web Worker)
    → Opus decode → GainNode (per-user volume) → AudioContext → Speaker
```

### Signaling

```
Client                          Server
  │                               │
  │──── auth (token/pubkey) ─────>│
  │<─── auth-result ──────────────│
  │<─── joined-server ────────────│
  │                               │
  │──── join-channel ────────────>│
  │<─── joined-channel ───────────│
  │                               │
  │──── create-transport (send) ─>│
  │<─── transport-created ────────│
  │──── connect-transport ───────>│
  │──── produce ─────────────────>│
  │<─── produced ─────────────────│
  │                               │
  │──── create-transport (recv) ─>│
  │<─── transport-created ────────│
  │──── connect-transport ───────>│
  │<─── new-producer ─────────────│
  │──── consume ─────────────────>│
  │<─── consume-result ───────────│
  │──── resume-consumer ─────────>│
  │                               │
  │──── e2ee (key exchange) ─────>│  ← server relays opaque blob
  │<─── e2ee (key exchange) ──────│
  │                               │
  │──── chat (ciphertext) ───────>│  ← server relays ciphertext
  │<─── chat (ciphertext) ────────│
```

## Technology Stack

| Component | Technology |
|---|---|
| Server runtime | Node.js 22+ |
| Language | TypeScript (strict) |
| SFU | mediasoup |
| HTTP framework | Fastify |
| WebSocket | ws |
| Database | SQLite (better-sqlite3) |
| Desktop client | Electron |
| UI framework | React |
| State management | Zustand |
| Styling | TailwindCSS + shadcn/ui |
| Audio codec | Opus (via WebRTC) |
| E2EE | Web Crypto API (AES-256-GCM, ECDH, HKDF) |
| Monorepo | pnpm workspaces |
