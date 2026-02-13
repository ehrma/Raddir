# Raddir Security Model

This document describes exactly what Raddir encrypts, what the server can and cannot see, and how the end-to-end encryption works. No vague claims — just facts.

## Encryption Layers

Raddir uses **two layers** of encryption for voice and text:

### Layer 1: Transport Encryption (always on)

- **Voice**: DTLS-SRTP (standard WebRTC transport encryption)
- **Signaling**: WSS (WebSocket over TLS) when configured with HTTPS
- Protects against network eavesdroppers between client and server

### Layer 2: End-to-End Encryption (always on)

- **Voice**: AES-256-GCM applied to each Opus frame via Insertable Streams API
- **Text chat**: AES-256-GCM applied to message content before sending
- Protects against the **server itself** — it cannot decrypt content

## What the Server CANNOT Do

- **Listen to voice audio** — Opus frames are encrypted before reaching the SFU
- **Read text messages** — server stores only ciphertext
- **Perform content analysis** — no speech recognition, no keyword detection
- **Record decryptable audio** — even if packets are captured, they are AES-256-GCM encrypted
- **Recover encryption keys** — keys are exchanged directly between clients; the server only relays opaque blobs

## What the Server CAN See

- **Connection metadata**: who is connected, from which IP, at what time
- **Channel membership**: who is in which channel
- **User state**: muted/deafened status, nickname, role assignments
- **RTP packet metadata**: packet sizes, timing, sequence numbers (needed for SFU routing)
- **Signaling messages**: join/leave events, transport negotiation parameters

> This is the same trust model as Signal: the server handles routing and metadata, but content is cryptographically inaccessible.

## How E2EE Works

### Key Exchange

1. When a client joins a channel, it generates an ephemeral **ECDH P-256 keypair**
2. The client announces its ECDH public key to other channel members via the server
3. The server relays these announcements as **opaque blobs** — it does not parse or store them
4. The channel's **key holder** (first member or admin) generates a random AES-256 channel key
5. The key holder encrypts the channel key to each member's ECDH public key and sends it via the server
6. Each member decrypts the channel key using their ECDH private key

### Voice Encryption

1. Client captures microphone audio via `getUserMedia`
2. Browser encodes audio to Opus
3. **Insertable Streams** intercepts the encoded frame before RTP packetization
4. Frame is encrypted with **AES-256-GCM** using the channel key
5. IV = frame counter (incrementing) + sender ID (prevents IV reuse across senders)
6. Encrypted frame is packetized into RTP and sent via DTLS-SRTP to the SFU
7. SFU forwards the encrypted RTP packets to other channel members (it cannot decrypt them)
8. Receiving client's Insertable Streams decrypts the frame
9. Browser decodes Opus and plays audio

### Text Chat Encryption

1. Client encrypts message content with AES-256-GCM using the channel key
2. Ciphertext + IV + key epoch are sent to the server
3. Server stores the ciphertext (it cannot read it) and relays to channel members
4. Receiving clients decrypt using their copy of the channel key

### Key Ratcheting (Forward Secrecy)

- **Member leaves**: A new channel key is generated and distributed to remaining members. The departing member cannot decrypt future audio.
- **Member joins**: The existing channel key is shared with the new member. They cannot decrypt audio from before they joined.
- **Periodic ratchet**: Optional HKDF-based key chain for long-lived channels.

### Identity Verification

- Each client has a long-lived **Ed25519 identity keypair** stored locally
- A **safety number** (fingerprint) is derived from both parties' public keys
- Users can compare safety numbers out-of-band (e.g., in person, via secure channel)
- The UI shows a lock icon and verification status per user
- This protects against man-in-the-middle attacks on the key exchange

## Cryptographic Primitives

| Purpose | Algorithm | Standard |
|---|---|---|
| Frame encryption | AES-256-GCM | NIST SP 800-38D |
| Key exchange | ECDH P-256 | NIST FIPS 186-4 |
| Key derivation | HKDF-SHA-256 | RFC 5869 |
| Identity keys | Ed25519 | RFC 8032 |
| All crypto | Web Crypto API | W3C (hardware-accelerated) |

No third-party crypto libraries are used. All operations run in the browser's native Web Crypto API, which leverages hardware acceleration (AES-NI on x86, ARMv8 crypto extensions).

## Server-Side Security Measures

Beyond E2EE, the server implements several hardening measures:

### Rate Limiting

- **WebSocket auth**: 10 attempts per 60 seconds per IP — prevents brute-force password/credential attacks
- **Public invite endpoints**: 20 requests per 60 seconds per IP — prevents invite enumeration and DoS
- Rate limiting uses `req.socket.remoteAddress` by default. Set `RADDIR_TRUST_PROXY=true` **only** when behind a reverse proxy that sets `X-Forwarded-For`

### CORS

Origins are restricted to Electron (`null`, `file://`, `app://`) and `localhost` dev servers. All other origins are rejected.

### Admin Privileges

Admin token grants **ephemeral** privileges for the WebSocket session only — not persisted as a database role. When the session ends, admin access is gone. This limits the impact of a leaked token.

### Invite System Hardening

- **Invite blob v2** contains the server address as a **routing hint** only — the server returns its canonical address from the database, never trusting the blob
- **No publicKey at redeem time** — the `/api/invites/redeem` endpoint creates an **unbound** credential (no identity attached). This means invites work for users who don't yet have a keypair
- **Identity binding on first WS auth** — when the client connects via WebSocket with a credential and publicKey, the server binds the credential to that publicKey. Subsequent connections must present the same publicKey, preventing credential theft
- **Stolen public keys are harmless** — without the credential secret, knowing someone's public key cannot be used to impersonate them
- Invite use counts are enforced with an **atomic** SQL UPDATE to prevent race conditions exceeding `maxUses`
- `createdBy` metadata is set server-side, not accepted from the request body

### E2EE Relay Isolation

Targeted E2EE relay messages (key exchange, verification) require `target.serverId === sender.serverId`. This prevents cross-server spam via the relay mechanism.

### WebSocket Limits

- **Max message size**: 64 KB — oversized messages are rejected and the connection is closed
- **Chat relay**: server uses the sender's tracked `channelId`, ignoring any `channelId` in the message — prevents cross-channel injection

### Identity Uniqueness

A partial UNIQUE index on `users.public_key` (where not NULL) prevents duplicate identity rows that could break key exchange or impersonation.

## What Raddir Does NOT Do

- **No telemetry**: The server sends no data to any external service
- **No content scanning**: No automated moderation, no AI analysis
- **No global accounts**: No central identity server that could be compromised
- **No key escrow**: Encryption keys exist only on client devices
- **No backdoors**: The E2EE design makes server-side content access architecturally impossible

## Threat Model

| Threat | Mitigated? | How |
|---|---|---|
| Network eavesdropper | ✅ | DTLS-SRTP + WSS |
| Compromised server | ✅ | E2EE — server cannot decrypt content |
| Man-in-the-middle | ✅ | Identity verification via safety numbers |
| Compromised client device | ❌ | Out of scope — if your device is compromised, all bets are off |
| Traffic analysis | ⚠️ Partial | Server sees packet timing/size; mitigating this requires onion routing (out of scope) |
| Key compromise (past) | ✅ | Forward secrecy via key ratcheting on member leave |
| Key compromise (future) | ✅ | New keys on member join; periodic ratchet |

## Comparison

| Feature | Raddir | TeamSpeak | Discord |
|---|---|---|---|
| Transport encryption | ✅ DTLS-SRTP | ✅ | ✅ |
| E2E voice encryption | ✅ AES-256-GCM | ❌ | ❌ |
| E2E text encryption | ✅ AES-256-GCM | ❌ | ❌ |
| Server can hear audio | ❌ No | ✅ Yes | ✅ Yes |
| Telemetry | ❌ None | ⚠️ Some | ✅ Extensive |
| Self-hostable | ✅ | ✅ | ❌ |
| Open source | ✅ | ❌ | ❌ |
