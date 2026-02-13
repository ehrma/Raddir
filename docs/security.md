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
- **Video & screen share**: same AES-256-GCM Insertable Streams pipeline as voice; VP8/VP9 frames encrypted before reaching the SFU
- **Text chat**: AES-256-GCM applied to message content before sending
- Protects against the **server itself** — it cannot decrypt content

## What the Server CANNOT Do

- **Listen to voice audio** — Opus frames are encrypted before reaching the SFU
- **View video or screen shares** — VP8/VP9 frames are encrypted before reaching the SFU
- **Read text messages** — server stores only ciphertext
- **Perform content analysis** — no speech recognition, no keyword detection, no image analysis
- **Record decryptable audio or video** — even if packets are captured, they are AES-256-GCM encrypted
- **Recover encryption keys** — keys are exchanged directly between clients; the server only relays opaque blobs

## What the Server CAN See

- **Connection metadata**: who is connected, from which IP, at what time
- **Channel membership**: who is in which channel
- **User state**: muted/deafened status, nickname, role assignments
- **User avatars and server icons**: uploaded as plaintext images (intentionally public — see below)
- **Server name, description, and configuration**: server-side metadata
- **Roles and permissions**: server-side authorization data
- **RTP packet metadata**: packet sizes, timing, sequence numbers (needed for SFU routing)
- **Signaling messages**: join/leave events, transport negotiation parameters

> This is the same trust model as Signal: the server handles routing and metadata, but content is cryptographically inaccessible.

## Intentionally Unencrypted Data

The following data is **not** end-to-end encrypted by design:

| Data | Why it's not E2EE | Risk |
|---|---|---|
| User avatars | Intentionally public — visible to all server members | None (cosmetic) |
| Server icon / name / description | Server-side metadata managed by admins | None (cosmetic) |
| Roles and permissions | Server-side authorization — the server must evaluate permissions to enforce access control | None (authorization metadata) |
| Nicknames | Displayed to all members; server needs them for routing and member lists | None (public identity) |

These are analogous to a Discord server icon or a TeamSpeak server name — they are metadata that the server must know to function. Encrypting them would provide no security benefit since they are shown to all members anyway.

**E2EE protects _content_ (voice audio, video, screen share, and text messages). Metadata and cosmetic data are not content.**

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
5. **1 byte** of the Opus frame header (TOC byte) is left unencrypted so the RTP stack can parse the frame
6. A random **12-byte IV** is generated per frame (via `crypto.getRandomValues`)
7. Encrypted frame layout: `[1-byte header | 12-byte IV | AES-256-GCM ciphertext + 16-byte auth tag]`
8. Encrypted frame is packetized into RTP and sent via DTLS-SRTP to the SFU
9. SFU forwards the encrypted RTP packets to other channel members (it cannot decrypt them)
10. Receiving client's Insertable Streams decrypts the frame using the same channel key
11. Browser decodes Opus and plays audio

### Video & Screen Share Encryption

1. Client captures webcam or screen via `getUserMedia` / desktop capture API
2. Browser encodes video to VP8 or VP9
3. **Simulcast**: the browser produces multiple quality layers per producer:
   - **Webcam**: 3 layers — quarter resolution (rid `q`, 150 kbps), half resolution (rid `h`, ~525 kbps), full resolution (rid `f`, up to 1.5 Mbps)
   - **Screen share**: 2 layers — half resolution (rid `q`, ~625 kbps), full resolution (rid `f`, up to 2.5 Mbps)
4. **All simulcast layers go through a single `RTCRtpSender`** — the Insertable Streams transform encrypts every frame regardless of which layer it belongs to
5. **10 bytes** of the VP8/VP9 frame header (payload descriptor + keyframe indicator) are left unencrypted so the SFU can detect keyframes and select which layer to forward
6. A random **12-byte IV** is generated per frame
7. Encrypted frame layout: `[10-byte header | 12-byte IV | AES-256-GCM ciphertext + 16-byte auth tag]`
8. SFU selects which simulcast layer to forward to each consumer based on the unencrypted header bytes and the consumer's preferred layer setting
9. Receiving client's Insertable Streams decrypts the frame using the channel key (with `mediaKind: "video"` to match the 10-byte header)
10. Browser decodes VP8/VP9 and renders video

**What the 10 unencrypted header bytes reveal:** Only the VP8/VP9 payload descriptor — whether a frame is a keyframe, the picture ID, and temporal layer index. This is structural metadata needed for SFU routing. The actual pixel data is always encrypted.

### Text Chat Encryption

1. Client encrypts message content with AES-256-GCM using the channel key
2. Ciphertext + IV + key epoch are sent to the server
3. Server stores the ciphertext (it cannot read it) and relays to channel members
4. Receiving clients decrypt using their copy of the channel key

### Key Ratcheting (Forward Secrecy)

- **Member leaves**: A new channel key is generated and distributed to remaining members. The departing member cannot decrypt future audio.
- **Member joins**: The existing channel key is shared with the new member. They cannot decrypt audio from before they joined.
- **Periodic ratchet**: Optional HKDF-based key chain for long-lived channels.

### Identity Keys & Signing

- Each client has a long-lived **ECDSA P-256 identity keypair** stored in the Electron main process via `safeStorage` (never in `localStorage`)
- **All E2EE control messages** (`public-key-announce`, `encrypted-channel-key`, `key-ratchet`) are **mandatorily signed** with the sender's identity key
- Signatures include **channel context** (`channelId` + `serverId`) to prevent replay/misroute across channels or servers
- Unsigned, context-mismatched, or invalid-signature messages are **hard-rejected**

### TOFU Identity Pinning

- On first contact with a peer on a given server, the peer's identity public key is **pinned** (Trust On First Use)
- Pinned keys are persisted per server in the Electron app data directory (`userData/identity-pins/<serverId>.json`)
- On subsequent sessions, if a peer's identity key **changes**, all E2EE messages from that peer are **hard-rejected** (possible MITM)
- This prevents a malicious server from substituting identity keys after initial contact

### Identity Verification

- A **safety number** (fingerprint) is derived from both parties' identity public keys
- Users can compare safety numbers out-of-band (e.g., in person, via secure channel)
- The UI shows a lock icon and verification status per user

### E2EE Enforcement for Voice and Video

- Audio **will not transmit or receive** until the E2EE channel key is established
- If the key is not established within 10 seconds, audio setup **aborts** — no unencrypted fallback
- Late-arriving producers are also rejected if no E2EE key is active
- Video (webcam and screen share) **will not produce** unless `e2eeActive` is true in the voice store — checked before `getUserMedia` is even called
- If the E2EE key is null at frame time, the encrypt transform **drops the frame** (never enqueued) — a second failsafe independent of the gating check
- If encryption fails for any reason, the frame is **silently dropped** — never sent unencrypted
- On the receiving side, if the key is null or decryption fails, the frame is **silently dropped** — never rendered
- Frames too short to contain a valid ciphertext (< header + IV length) are also dropped

### Server-Side Video Producer Limits

- The server enforces configurable limits on concurrent webcam and screen share producers per channel
- Defaults: **5 webcams**, **1 screen share** per channel (configurable 0–50 and 0–10 via admin panel)
- When the limit is reached, the server rejects the `produce` request with a `PRODUCER_LIMIT` error
- The client handles the rejection by stopping the camera/capture track and reverting UI state
- Setting a limit to 0 effectively disables that media type server-wide

### Key-Holder Election

- The key holder is elected deterministically by `min(SHA-256(identityPublicKey))` across channel members
- This is not gameable by the server (it cannot influence identity key hashes)

## Cryptographic Primitives

| Purpose | Algorithm | Standard |
|---|---|---|
| Frame encryption | AES-256-GCM | NIST SP 800-38D |
| Key exchange | ECDH P-256 | NIST FIPS 186-4 |
| Key derivation | HKDF-SHA-256 | RFC 5869 |
| Identity keys | ECDSA P-256 + SHA-256 | NIST FIPS 186-4 |
| Identity key storage | Electron safeStorage (OS keychain) | Platform-specific |
| TOFU pinning | Per-server persistent pin store | SSH-style TOFU |
| All crypto | Web Crypto API + Node.js crypto | W3C / OpenSSL |

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
| Compromised server (passive) | ✅ | E2EE — server cannot decrypt content |
| Compromised server (active MITM, after first contact) | ✅ | TOFU pinning — identity key substitution is detected and rejected |
| Compromised server (active MITM, first contact) | ⚠️ **Accepted risk** | See "Known Limitations" below |
| Man-in-the-middle (after verification) | ✅ | Identity verification via safety numbers |
| Compromised client device | ❌ | Out of scope — if your device is compromised, all bets are off |
| Traffic analysis | ⚠️ Partial | Server sees packet timing/size; mitigating this requires onion routing (out of scope) |
| Key compromise (past) | ✅ | Forward secrecy via key ratcheting on member leave |
| Key compromise (future) | ✅ | New keys on member join; periodic ratchet |
| E2EE not engaging silently | ✅ | Voice TX/RX blocked until E2EE key established; no unencrypted fallback |

## Known Limitations & Accepted Risks

### 🚨 TOFU First-Contact MITM

Identity pinning uses **Trust On First Use (TOFU)**, the same model as SSH. On first contact with a peer, whatever identity key is seen first gets pinned. A malicious signaling server (or active attacker controlling signaling) can still MITM the **very first time** two peers meet by presenting attacker keys first, which then get pinned.

This is **inherent to TOFU** and cannot be fixed without adding a trust anchor. Possible future mitigations:

1. **Out-of-band verification (safety number / QR scan)** — users confirm each other's identity fingerprints before trusting the pin. This is the Signal/WhatsApp approach.
2. **Server-signed identity directory** — trust the server as a CA that vouches for identity keys. Weaker (trusts server) but easier UX.
3. **Pre-shared / published identity fingerprints** — users exchange fingerprints via a trusted channel before first contact.

Until one of these is implemented, E2EE protects against **passive observers** and **post-first-contact active attackers**, but not against an active MITM during the very first key exchange between two peers.

### ✅ ~~Signaling Flood / DoS~~ (Fixed)

~~WebSocket message size is capped at 64 KB, but an authenticated client could flood messages at high frequency.~~

**Fixed:** Per-connection post-auth rate limiting is now enforced in the signaling handler. Messages are categorized and limited per second:

| Category | Message types | Limit |
|---|---|---|
| chat | `chat-message` | 5/sec |
| e2ee | `e2ee` | 10/sec |
| speaking | `speaking` | 20/sec |
| media | `create-transport`, `connect-transport`, `produce`, `consume`, `resume-consumer`, `set-preferred-layers` | 5/sec |
| general | everything else | 30/sec |

Exceeding the limit returns a `RATE_LIMITED` error and drops the message. Counters are per-WebSocket connection and garbage-collected on disconnect.

### ⚠️ Identity Pinning Keyed by Server-Assigned userId (High)

TOFU pins are stored as `(serverId, userId) → identityPublicKey`. The `userId` is assigned by the server. If the server can remap user identities (malicious or buggy) or if `userId` values aren't stable across sessions, pinning can be undermined — the server could assign a victim's `userId` to an attacker.

**Possible fixes:**
- Pin by a stable identifier that's not server-mutable (e.g., the peer's long-term identity key fingerprint after first contact)
- Or cryptographically bind `userId` to the identity public key at registration time
- At minimum, explicitly state in the threat model: "server assigns stable `userId` per identity/publicKey" (currently enforced by the partial UNIQUE index on `users.public_key`)

### ⚠️ Safety Number Entropy Is Low (Medium)

The current safety number is 12 digits derived from 5 bytes (~40 bits of entropy). This is adequate for casual visual verification but significantly weaker than Signal-style safety numbers (~220 bits).

**Needed fix:** Derive a longer number with more entropy (e.g., 80–128 bits worth of digits or words).

### ✅ ~~Member List Field Name Mismatch~~ (Fixed)

~~`useAudio.ts` used `u.id` instead of `u.userId`, breaking key-holder election.~~

**Fixed:** Changed to `u.userId` to match the server's `SessionInfo` shape. Key-holder election now works correctly with the actual member list.

### ⚠️ Self-Signed Certificate Trust via IPC (Check Your Stance)

Electron's `certificate-error` handler allows TLS bypass for a host set via the `trust-server-host` IPC call. This is intentional for self-hosted servers with self-signed certs, but it's an attack surface if:
- The renderer can be tricked into trusting a hostile host (phishing)
- The app ever loads arbitrary remote content

**Hardening recommendations:**
- Never load arbitrary remote content in the renderer (only the bundled app)
- Only invoke `trust-server-host` as part of an explicit "trust this server" UI flow with user confirmation
- Ideally, store and pin the **certificate fingerprint**, not just the hostname

## Comparison

| Feature | Raddir | TeamSpeak | Discord |
|---|---|---|---|
| Transport encryption | ✅ DTLS-SRTP | ✅ | ✅ |
| E2E voice encryption | ✅ AES-256-GCM | ❌ | ❌ |
| E2E video encryption | ✅ AES-256-GCM | ❌ | ❌ |
| E2E text encryption | ✅ AES-256-GCM | ❌ | ❌ |
| Server can hear audio | ❌ No | ✅ Yes | ✅ Yes |
| Server can see video | ❌ No | ✅ Yes | ✅ Yes |
| Simulcast (adaptive quality) | ✅ 3-layer | ❌ | ✅ |
| Telemetry | ❌ None | ⚠️ Some | ✅ Extensive |
| Self-hostable | ✅ | ✅ | ❌ |
| Open source | ✅ | ❌ | ❌ |
