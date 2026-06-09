# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A photo/video review-and-voting board ("作品评优系统") for a photography team. Photographers upload monthly work into named modules, the team votes, and an admin publishes ranked results. The entire app is a **single dependency-light Node.js HTTP server** (`server.js`, ~1900 lines, no Express/framework — raw `http` module) plus a vanilla JS frontend in `public/`. UI text is in Chinese.

## Commands

```bash
npm start                 # run server (node server.js), serves on PORT or 3000
npm run reset-data        # wipe entries/ballots/periods/uploads, KEEP photographer roster
npm run reset-all         # same but also clear photographers (CLEAR_PHOTOGRAPHERS=1)
```

There is **no build step, no linter, and no test suite.** Verify changes by running the server and exercising the relevant endpoint manually. To run the server locally with admin access: set `ADMIN_CODE` first (e.g. `ADMIN_CODE=secret npm start`), then open `http://localhost:3000/`.

The `scripts/restore-*.js`, `scripts/register-restored-*.js`, and `scripts/upload-*.js` files are **one-off data-recovery/migration scripts** (e.g. restoring May data from R2), not part of the normal workflow. They are excluded from deploy via `.zeaburignore`.

## Architecture

### Single-file server, three concerns
`server.js` interleaves three things: (1) a hand-rolled router (`handleApi` → individual `handle*` functions, dispatched at the bottom of the file by exact `method + pathname` match), (2) a JSON file "database", and (3) a media-processing pipeline. There are no modules/imports between files — everything is top-level functions in one file.

### Data model — JSON file as database
All state lives in **one JSON file** at `DATA_DIR/db.json` (default `./data/db.json`, set `DATA_DIR=/data` in production for a persistent volume). There is no SQL/ORM. Key shape:

- `entries[]` — uploaded works. Each has `media[]` (array of `{id, src, kind, originalSrc, optimized, processing, error}`), plus `moduleId/moduleName/moduleKind`, `photographer`, `sku`, `title`, `sequence`, `periodId`.
- `ballots[]` / `tiebreakerBallots[]` — votes, scoped by `periodId` and voter name.
- `tiebreakers[]` — runoff rounds, each with `status: "open" | "closed"`.
- `photographers[]` — the login roster (sorted, deduped).
- `periods[]` + `currentPeriodId` — monthly buckets (`id` is `"YYYY-MM"`). Each period carries its own `votingOpen` / `resultsPublished` flags; top-level `votingOpen`/`resultsPublished` are mirrors of the **current** period, synced by `ensurePeriods()`.

**All writes must go through `withDbWriteLock(task)`** — it serializes read-modify-write cycles via a promise chain to prevent races (e.g. concurrent votes). Reading is `readDb()`, writing is `writeDb()`. `ensurePeriods(db)` is the migration/normalization shim run on read; it backfills missing `periodId` on legacy entries and reconciles period flags. When changing the schema, update `emptyDb()`, `ensurePeriods()`, AND the matching object in `scripts/reset-data.js` (it builds its own db literal independently).

### Backward-compat fields
Several reads tolerate legacy shapes: `entry.media` falls back to `entry.images[]`, `moduleId` falls back to `entry.board`. Preserve these fallbacks (`publicEntry`, `voterEntry`) when touching entry serialization — old data in the wild relies on them.

### Modules are a fixed hardcoded list
The 8 review categories live in the `MODULES` array near the top of `server.js` (`image-ai`, `image-real`, `video-selling`, etc.), each with a `voteLimit` (max votes a user can cast in that module). `MODULE_NAMES` / `MODULE_BY_NAME` are derived lookups. These names are matched against uploaded folder paths.

### Period lifecycle / state machine
A period flows: collecting → `votingOpen: true` (admin "开始投票") → `resultsPublished: true` (admin "公布结果"). Voters only see media while voting is open; photographer identities on results are revealed only after publish (`publishedEntry` adds `photographer`). Tiebreakers are a separate sub-round for tied ranks.

### Two upload paths (local vs. object storage)
1. **Local (default):** browser POSTs multipart to `/api/upload`; files are written under `DATA_DIR/uploads/<entryId>/`, then optimized display versions generated on disk.
2. **Direct-to-S3 (optional, R2):** if `STORAGE_*` env vars are set (`storageConfigured()`), the browser asks `/api/storage/sign` for a **presigned PUT URL** (AWS SigV4 hand-implemented with `crypto` in `createPresignedPutUrl`), uploads directly to the bucket, then calls `/api/storage/complete` to register the entry. Display optimization for these runs as a background job that downloads, transcodes, re-uploads, and patches `media.src`.

Folder-path parsing (`parseUploadPath` / `parseFolderInfo` / `parseSkuAndTitle`) infers `photographer`/`sku`/`title` from the uploaded directory structure relative to the matched module-name folder. Paths containing `EXCLUDED_UPLOAD_KEYWORDS` ("备选"/"备用") are skipped.

### Media optimization pipeline
Images → `sharp` (resize to `IMAGE_MAX_DIMENSION`, WebP). Videos → bundled `ffmpeg-static` (H.264, scaled, faststart). Originals are kept as `originalSrc`; a smaller `_display.webp`/`_display.mp4` becomes the served `src`. Work is funneled through an in-process queue (`optimizeQueue`, concurrency `OPTIMIZE_CONCURRENCY`, default 1) so large batches don't exhaust memory/CPU. `media.processing` flags in-flight items; the frontend polls and shows a processing state. Admin can re-trigger via `/api/admin/optimize-images` and `/api/admin/optimize-videos`. If `ffmpeg-static` is unavailable (`HAS_FFMPEG` false), videos are served as-is.

### Auth model (deliberately weak)
- **Admin:** a single shared secret `ADMIN_CODE` env var, checked per-request via `adminCode` in query string or JSON body (`isAdmin*` helpers). No sessions/cookies. If `ADMIN_CODE` is unset, admin actions are disabled (and the server refuses to start in `NODE_ENV=production`).
- **Voters:** name-only login against the photographer roster — **no password by design** (documented limitation in `README-上线.md`). Don't add real auth without checking with the user; it's an intentional trade-off for an internal trusted LAN tool.

### Frontend (`public/`)
`app.js` (~1700 lines) is one big vanilla-JS module: module-level mutable state (`entries`, `systemInfo`, `loggedInName`, selection sets), a `loadData()` fetch fan-out against the `/api/*` endpoints, and a monolithic `render()`. No framework, no bundler — edit and reload. `style.css` is large (~4600 lines) and hand-written with a light/dark theme (`THEME_KEY` in localStorage). Logged-in voter name persists in `localStorage["photoReviewVoter"]`.

### Archive export
`/api/admin/archive` streams a ZIP (`archiver` + `lazystream`) of all entries plus generated CSV ranking files, pulling media either from local disk or remote storage URLs on the fly.

## Conventions

- `normalizeName()` (trim + String coerce) is applied to nearly all external string input — use it for new fields too.
- All API responses go through `sendJson` / `sendText`; errors are surfaced as `{ error: message }` with a 4xx status (handlers are wrapped in `.catch` at dispatch).
- Filesystem safety: `safeSegment()` sanitizes path components and `isInside()` guards against path traversal before any delete/write under `DATA_DIR`. Use them when adding file operations.
- **Never commit `data/db.json`, `data/uploads/`, or restore artifacts** — they're git-ignored; production data lives only on the Zeabur persistent volume.

## Deploy

Targets **Zeabur** (Node ≥20). Production needs `ADMIN_CODE` and `DATA_DIR=/data` (mounted persistent volume `photo-review-data`). Optional R2 direct-upload needs the `STORAGE_*` vars + bucket CORS allowing `PUT`. Full deploy + env-var reference is in `README-上线.md`.
