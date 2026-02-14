# Release Cheat Sheet

This project is **local-build first**, with **on-demand GitHub Actions releases** when you decide `main` is ready.

## Release model

- Develop on feature branches.
- Merge ready changes into `main`.
- Trigger release workflows manually from `main` when needed.
- Client and server are released independently.

Version sources:
- Client default version: `packages/client/package.json` (`version`)
- Server default version: `packages/server/package.json` (`version`)

## One-time setup

```bash
gh auth login
```

## Fast commands (recommended)

From repo root:

```bash
# Client
pnpm release:client:build        # Build/test workflow only (no published GitHub release)
pnpm release:client              # Publish GitHub release
pnpm release:client:draft        # Publish draft GitHub release

# Server
pnpm release:server:build        # Build Docker image in CI only (no push)
pnpm release:server              # Push server image + latest tag
pnpm release:server:nolatest     # Push server image without latest
```

## Advanced command options

Use the dispatcher directly when you need custom version/ref:

```bash
# Client
node scripts/dispatch-release.mjs client --publish --version 0.1.4 --ref main
node scripts/dispatch-release.mjs client --publish --draft --version 0.1.4

# Server
node scripts/dispatch-release.mjs server --publish --version 0.1.2 --latest
node scripts/dispatch-release.mjs server --publish --version 0.1.2
```

Supported flags:
- `--publish` publish artifacts/image
- `--draft` (client only) create draft GitHub Release
- `--latest` (server only) also push `:latest`
- `--version <x.y.z>` override package.json version
- `--ref <branch>` run workflow from a different ref (default: `main`)

## What each workflow does

### Client (`.github/workflows/electron-release.yml`)

- Builds Windows/macOS/Linux Electron artifacts.
- If `publish=true`, creates/updates GitHub Release using tag `client-v<version>`.
- If `publish=false`, only CI build + artifact upload.

### Server (`.github/workflows/docker-server.yml`)

- Builds Docker image from `Dockerfile.server`.
- If `publish=true`, pushes `zahli/raddir-server:<version>` (and optionally `:latest`).
- If `publish=false`, build runs but image is not pushed.

## Typical release routine

1. Merge to `main`.
2. Bump `packages/client/package.json` and/or `packages/server/package.json` version.
3. Trigger desired command(s):
   - `pnpm release:client`
   - `pnpm release:server`
4. Verify run in GitHub Actions and smoke test artifacts.

## Notes

- You can still use tag-based releases (`client-v*` / `server-v*`), but manual dispatch is now fully supported.
- Client/server versions are intentionally independent.
