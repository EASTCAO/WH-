const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const childProcess = require("child_process");
const https = require("https");
const { PassThrough } = require("stream");
const sharp = require("sharp");
const archiver = require("archiver");
const lazystream = require("lazystream");

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(ROOT, "data");
const UPLOAD_DIR = path.join(DATA_DIR, "uploads");
const DB_PATH = path.join(DATA_DIR, "db.json");
const SEED_PHOTOGRAPHERS_PATH = path.join(ROOT, "data", "photographers.json");
const PORT = process.env.PORT || 3000;
const ADMIN_CODE = String(process.env.ADMIN_CODE || "").trim();
const MAX_UPLOAD_MB = Number(process.env.MAX_UPLOAD_MB || 512);
const MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024;
const MAX_FILES_PER_UPLOAD = Number(process.env.MAX_FILES_PER_UPLOAD || 200);
const IMAGE_WEBP_EFFORT = Number(process.env.IMAGE_WEBP_EFFORT || 2);
const IMAGE_OPTIMIZE_MIN_BYTES = Number(process.env.IMAGE_OPTIMIZE_MIN_MB || 4) * 1024 * 1024;
const IMAGE_MAX_DIMENSION = Number(process.env.IMAGE_MAX_DIMENSION || 2200);
const VIDEO_PRESET = process.env.VIDEO_PRESET || "veryfast";
const VIDEO_DISPLAY_WIDTH = Number(process.env.VIDEO_DISPLAY_WIDTH || 1600);
const VIDEO_DISPLAY_HEIGHT = Number(process.env.VIDEO_DISPLAY_HEIGHT || 900);
const VIDEO_DISPLAY_BITRATE = process.env.VIDEO_DISPLAY_BITRATE || "2200k";
const VIDEO_DISPLAY_BUFSIZE = process.env.VIDEO_DISPLAY_BUFSIZE || "4400k";
const VIDEO_DISPLAY_AUDIO_BITRATE = process.env.VIDEO_DISPLAY_AUDIO_BITRATE || "128k";
const OPTIMIZE_CONCURRENCY = Math.max(1, Number(process.env.OPTIMIZE_CONCURRENCY || 2));
const STORAGE_ENDPOINT = normalizeName(process.env.STORAGE_ENDPOINT);
const STORAGE_BUCKET = normalizeName(process.env.STORAGE_BUCKET);
const STORAGE_REGION = normalizeName(process.env.STORAGE_REGION || "auto");
const STORAGE_ACCESS_KEY_ID = normalizeName(process.env.STORAGE_ACCESS_KEY_ID);
const STORAGE_SECRET_ACCESS_KEY = normalizeName(process.env.STORAGE_SECRET_ACCESS_KEY);
const STORAGE_PUBLIC_BASE_URL = normalizeName(process.env.STORAGE_PUBLIC_BASE_URL);
const STORAGE_PREFIX = normalizeName(process.env.STORAGE_PREFIX || "photo-review");
const STORAGE_ADDRESSING_STYLE = normalizeName(process.env.STORAGE_ADDRESSING_STYLE || "path").toLowerCase();

if (!ADMIN_CODE && process.env.NODE_ENV === "production") {
  console.error("ADMIN_CODE is required in production.");
  process.exit(1);
}

if (!ADMIN_CODE) {
  console.warn("ADMIN_CODE is not set. Admin actions are disabled until ADMIN_CODE is configured.");
}

const MODULES = [
  { id: "image-ai", name: "图片（AI）", kind: "image", voteLimit: 3 },
  { id: "image-real", name: "图片（实拍）", kind: "image", voteLimit: 3 },
  { id: "image-assistant", name: "图片助理", kind: "image", voteLimit: 2 },
  { id: "video-selling", name: "视频（卖点）", kind: "video", voteLimit: 1 },
  { id: "video-quality", name: "视频（质量）", kind: "video", voteLimit: 1 },
  { id: "simple-video", name: "简易视频", kind: "video", voteLimit: 1 },
  { id: "ai-video", name: "AI视频", kind: "video", voteLimit: 1 },
  { id: "video-assistant", name: "视频助理", kind: "video", voteLimit: 1 }
];

const MODULE_NAMES = new Set(MODULES.map(module => module.name));
const MODULE_BY_NAME = new Map(MODULES.map(module => [module.name, module]));
const RESULT_LIMIT_BY_MODULE = {
  "图片（AI）": 3,
  "图片（实拍）": 3,
  "图片助理": 2,
  "视频（卖点）": 2,
  "视频（质量）": 2,
  "简易视频": 3,
  "视频助理": 2,
  "AI视频": 1
};
const MEDIA_TYPES = new Set([
  ".jpg", ".jpeg", ".jfif", ".png", ".webp", ".gif", ".bmp", ".tif", ".tiff", ".avif", ".heic", ".heif",
  ".mp4", ".mov", ".m4v", ".webm"
]);
const IMAGE_TYPES = new Set([".jpg", ".jpeg", ".jfif", ".png", ".webp", ".gif", ".bmp", ".tif", ".tiff", ".avif", ".heic", ".heif"]);
const VIDEO_TYPES = new Set([".mp4", ".mov", ".m4v", ".webm"]);
const EXCLUDED_UPLOAD_KEYWORDS = ["备选", "备用"];
const FFMPEG_PATH = resolveFfmpegPath();
const HAS_FFMPEG = Boolean(FFMPEG_PATH);

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

function resolveFfmpegPath() {
  try {
    const ffmpegPath = require("ffmpeg-static");
    if (ffmpegPath && fs.existsSync(ffmpegPath)) return ffmpegPath;
  } catch {}

  try {
    childProcess.execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
    return "ffmpeg";
  } catch {
    return "";
  }
}

function emptyDb() {
  const period = createPeriod(currentPeriodId());
  return {
    entries: [],
    ballots: [],
    tiebreakers: [],
    tiebreakerBallots: [],
    photographers: seedPhotographers(),
    periods: [period],
    currentPeriodId: period.id,
    nextSequence: 1,
    votingOpen: false,
    resultsPublished: false
  };
}

function seedPhotographers() {
  if (!fs.existsSync(SEED_PHOTOGRAPHERS_PATH)) return [];
  try {
    const names = JSON.parse(fs.readFileSync(SEED_PHOTOGRAPHERS_PATH, "utf8"));
    if (!Array.isArray(names)) return [];
    return [...new Set(names.map(normalizeName).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, "zh-CN"));
  } catch {
    return [];
  }
}

function currentPeriodId(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function periodName(id) {
  const [year, month] = String(id).split("-");
  return `${year}年${Number(month)}月评优`;
}

function createPeriod(id, source = {}) {
  return {
    id,
    name: source.name || periodName(id),
    votingOpen: Boolean(source.votingOpen),
    resultsPublished: Boolean(source.resultsPublished),
    moduleVoters: normalizeModuleVoters(source.moduleVoters),
    createdAt: source.createdAt || new Date().toISOString()
  };
}

function normalizeModuleVoters(source) {
  const result = {};
  if (!source || typeof source !== "object") return result;
  for (const module of MODULES) {
    const raw = source[module.name];
    if (!Array.isArray(raw)) continue;
    const names = [...new Set(raw.map(normalizeName).filter(Boolean))];
    if (names.length) result[module.name] = names;
  }
  return result;
}

function nextPeriodId(id) {
  const [year, month] = String(id || currentPeriodId()).split("-").map(Number);
  const date = new Date(year, month, 1);
  return currentPeriodId(date);
}

function ensurePeriods(db) {
  const defaultId = db.currentPeriodId || currentPeriodId();
  db.periods = Array.isArray(db.periods) && db.periods.length ? db.periods : [
    createPeriod(defaultId, { votingOpen: db.votingOpen, resultsPublished: db.resultsPublished })
  ];
  db.currentPeriodId ||= db.periods[0].id;
  let current = db.periods.find(period => period.id === db.currentPeriodId);
  if (!current) {
    current = createPeriod(db.currentPeriodId, { votingOpen: db.votingOpen, resultsPublished: db.resultsPublished });
    db.periods.push(current);
  }
  for (const entry of db.entries || []) entry.periodId ||= db.currentPeriodId;
  for (const ballot of db.ballots || []) ballot.periodId ||= db.currentPeriodId;
  for (const period of db.periods) period.moduleVoters = normalizeModuleVoters(period.moduleVoters);
  db.votingOpen = Boolean(current.votingOpen);
  db.resultsPublished = Boolean(current.resultsPublished);
  db.periods.sort((a, b) => b.id.localeCompare(a.id));
  return current;
}

function currentEntries(db) {
  return (db.entries || []).filter(entry => (entry.periodId || db.currentPeriodId) === db.currentPeriodId);
}

function hasUploaderModuleEntry(db, uploaderName, moduleName, allowedEntryId = "") {
  if (!uploaderName || !moduleName) return false;
  return currentEntries(db).some(entry =>
    entry.photographer === uploaderName &&
    entry.moduleName === moduleName &&
    (!allowedEntryId || entry.id !== allowedEntryId)
  );
}

function assertUploaderCanCreateModuleEntry(db, uploaderName, moduleName, allowedEntryId = "") {
  if (hasUploaderModuleEntry(db, uploaderName, moduleName, allowedEntryId)) {
    throw new Error(`${moduleName} 已经上传过作品，如需重新上传，请先删除之前上传的作品`);
  }
}

function assertPhotographerUploadOpen(db, uploaderName, adminUpload) {
  if (uploaderName && !adminUpload && db.votingOpen) {
    throw new Error("投票已开始，摄影师不能再上传作品。如需补传，请联系管理员后台处理。");
  }
}

function currentBallots(db) {
  return (db.ballots || []).filter(ballot => (ballot.periodId || db.currentPeriodId) === db.currentPeriodId);
}

function hasAnyCurrentBallot(db) {
  return currentBallots(db).some(ballot => Array.isArray(ballot.entryIds) && ballot.entryIds.length > 0);
}

function currentPeriod(db) {
  return db.periods.find(period => period.id === db.currentPeriodId) || ensurePeriods(db);
}

function readDb() {
  if (!fs.existsSync(DB_PATH)) return emptyDb();
  try {
    const db = JSON.parse(fs.readFileSync(DB_PATH, "utf8"));
    db.entries ||= [];
    db.ballots ||= [];
    db.tiebreakers ||= [];
    db.tiebreakerBallots ||= [];
    db.photographers ||= [];
    db.nextSequence ||= db.entries.length + 1;
    ensurePeriods(db);
    return db;
  } catch {
    return emptyDb();
  }
}

function writeDb(db) {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), "utf8");
}

let dbWriteQueue = Promise.resolve();

function withDbWriteLock(task) {
  const run = dbWriteQueue.then(task, task);
  dbWriteQueue = run.catch(() => {});
  return run;
}

function sendJson(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(text)
  });
  res.end(text);
}

function sendText(res, status, text) {
  res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(text);
}

function sendRedirect(res, location) {
  res.writeHead(302, {
    "Location": location,
    "Cache-Control": "no-store"
  });
  res.end();
}

function collectRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", chunk => {
      size += chunk.length;
      if (size > MAX_UPLOAD_BYTES) {
        reject(new Error(`上传内容太大，单次限制约 ${MAX_UPLOAD_MB}MB`));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

async function collectJson(req) {
  const body = await collectRawBody(req);
  return body.length ? JSON.parse(body.toString("utf8")) : {};
}

function parsePartHeaders(text) {
  const headers = {};
  for (const line of text.split("\r\n")) {
    const index = line.indexOf(":");
    if (index < 0) continue;
    headers[line.slice(0, index).trim().toLowerCase()] = line.slice(index + 1).trim();
  }
  return headers;
}

function parseContentDisposition(value) {
  const result = {};
  for (const part of String(value || "").split(";")) {
    const [rawKey, ...rawValue] = part.trim().split("=");
    if (!rawValue.length) continue;
    const key = rawKey.trim().toLowerCase();
    let value = rawValue.join("=").trim();
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    result[key] = value.replace(/\\"/g, '"');
  }
  return result;
}

async function collectMultipart(req) {
  const contentType = String(req.headers["content-type"] || "");
  const match = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  if (!match) throw new Error("上传格式不正确：缺少 boundary");
  const boundary = Buffer.from(`--${match[1] || match[2]}`);
  const body = await collectRawBody(req);
  const fields = {};
  const files = [];
  let cursor = body.indexOf(boundary);

  while (cursor >= 0) {
    cursor += boundary.length;
    if (body.slice(cursor, cursor + 2).toString() === "--") break;
    if (body.slice(cursor, cursor + 2).toString() === "\r\n") cursor += 2;
    const next = body.indexOf(boundary, cursor);
    if (next < 0) break;
    let part = body.slice(cursor, next);
    if (part.slice(-2).toString() === "\r\n") part = part.slice(0, -2);
    const headerEnd = part.indexOf(Buffer.from("\r\n\r\n"));
    if (headerEnd >= 0) {
      const headers = parsePartHeaders(part.slice(0, headerEnd).toString("utf8"));
      const data = part.slice(headerEnd + 4);
      const disposition = parseContentDisposition(headers["content-disposition"]);
      if (disposition.name) {
        if (Object.prototype.hasOwnProperty.call(disposition, "filename")) {
          const relativePath = disposition.filename || "upload";
          files.push({
            name: path.basename(relativePath),
            relativePath,
            type: headers["content-type"] || "",
            buffer: data
          });
        } else {
          fields[disposition.name] = data.toString("utf8");
        }
      }
    }
    cursor = next;
  }

  return { fields, files };
}

function normalizeName(value) {
  return String(value || "").trim();
}

function safeSegment(value) {
  return normalizeName(value).replace(/[<>:"/\\|?*\x00-\x1F]/g, "_").slice(0, 80) || "未命名";
}

function isInside(baseDir, filePath) {
  const relative = path.relative(baseDir, filePath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function removeEntryFiles(entryId) {
  const target = path.resolve(UPLOAD_DIR, entryId);
  if (isInside(UPLOAD_DIR, target)) {
    fs.rmSync(target, { recursive: true, force: true });
  }
}

function hash(input) {
  return crypto.createHash("sha1").update(input).digest("hex").slice(0, 16);
}

function hmac(key, value, encoding) {
  return crypto.createHmac("sha256", key).update(value, "utf8").digest(encoding);
}

function uploadOwnerToken(file) {
  const secret = ADMIN_CODE || "local-upload-owner";
  return hmac(secret, [
    normalizeName(file.entryId),
    normalizeName(file.moduleName),
    normalizeName(file.photographer),
    normalizeName(file.uploadedBy),
    normalizeName(file.objectKey)
  ].join("|"), "hex").slice(0, 24);
}

function sha256Hex(value) {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

function s3Date(date = new Date()) {
  const iso = date.toISOString().replace(/[:-]|\.\d{3}/g, "");
  return { amzDate: iso, dateStamp: iso.slice(0, 8) };
}

function s3SigningKey(dateStamp) {
  const kDate = hmac(`AWS4${STORAGE_SECRET_ACCESS_KEY}`, dateStamp);
  const kRegion = hmac(kDate, STORAGE_REGION);
  const kService = hmac(kRegion, "s3");
  return hmac(kService, "aws4_request");
}

function encodeS3PathSegment(value) {
  return encodeURIComponent(value).replace(/[!'()*]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

function encodeS3Key(value) {
  return String(value || "").split("/").map(encodeS3PathSegment).join("/");
}

function createStorageObjectKey(periodId, entryId, filename) {
  return [STORAGE_PREFIX, periodId, entryId, filename]
    .map(part => String(part || "").replace(/^\/+|\/+$/g, ""))
    .filter(Boolean)
    .join("/");
}

function publicStorageUrl(key) {
  return `${STORAGE_PUBLIC_BASE_URL.replace(/\/+$/, "")}/${encodeS3Key(key)}`;
}

function storageRequestTarget(key) {
  const endpoint = new URL(STORAGE_ENDPOINT);
  if (STORAGE_ADDRESSING_STYLE === "virtual") {
    return {
      host: `${STORAGE_BUCKET}.${endpoint.host}`,
      canonicalUri: `/${encodeS3Key(key)}`,
      origin: `${endpoint.protocol}//${STORAGE_BUCKET}.${endpoint.host}`
    };
  }
  return {
    host: endpoint.host,
    canonicalUri: `/${encodeS3PathSegment(STORAGE_BUCKET)}/${encodeS3Key(key)}`,
    origin: endpoint.origin
  };
}

function isStoragePublicUrl(value) {
  if (!storageConfigured()) return false;
  try {
    const url = new URL(value);
    const base = new URL(STORAGE_PUBLIC_BASE_URL);
    return url.protocol === base.protocol && url.host === base.host;
  } catch {
    return false;
  }
}

function proxiedMediaUrl(value) {
  if (!isStoragePublicUrl(value)) return value;
  return `/api/media-proxy?url=${encodeURIComponent(value)}`;
}

function createPresignedPutUrl(key, contentType, cacheControl) {
  const target = storageRequestTarget(key);
  const host = target.host;
  const canonicalUri = target.canonicalUri;
  const { amzDate, dateStamp } = s3Date();
  const credentialScope = `${dateStamp}/${STORAGE_REGION}/s3/aws4_request`;
  const credential = `${STORAGE_ACCESS_KEY_ID}/${credentialScope}`;
  // 若带 cacheControl，则把它纳入签名头（R2 才会存为对象元数据并在 GET 时返回）
  const signedHeaderNames = cacheControl ? ["cache-control", "host"] : ["host"];
  const params = new URLSearchParams({
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": credential,
    "X-Amz-Date": amzDate,
    "X-Amz-Expires": "900",
    "X-Amz-SignedHeaders": signedHeaderNames.join(";")
  });
  const canonicalQuery = [...params.entries()]
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .sort()
    .join("&");
  const canonicalHeaders = (cacheControl ? `cache-control:${cacheControl}\n` : "") + `host:${host}\n`;
  const canonicalRequest = [
    "PUT",
    canonicalUri,
    canonicalQuery,
    canonicalHeaders,
    signedHeaderNames.join(";"),
    "UNSIGNED-PAYLOAD"
  ].join("\n");
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest)
  ].join("\n");
  const signature = hmac(s3SigningKey(dateStamp), stringToSign, "hex");
  params.set("X-Amz-Signature", signature);
  const url = new URL(`${target.origin}${canonicalUri}`);
  url.search = params.toString();
  return { url: url.toString(), contentType, cacheControl };
}

async function putStorageObject(key, diskPath, contentType) {
  if (!storageConfigured()) throw new Error("对象存储未配置");
  const cacheControl = "public, max-age=31536000, immutable";
  const signed = createPresignedPutUrl(key, contentType, cacheControl);
  const url = new URL(signed.url);
  const stat = fs.statSync(diskPath);
  await new Promise((resolve, reject) => {
    const request = https.request(url, {
      method: "PUT",
      headers: {
        "Content-Type": signed.contentType,
        "Cache-Control": cacheControl,
        "Content-Length": stat.size
      }
    }, response => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", chunk => body += chunk);
      response.on("end", () => {
        if (response.statusCode >= 200 && response.statusCode < 300) {
          resolve();
          return;
        }
        reject(new Error(`对象存储上传展示版失败：${response.statusCode} ${body.slice(0, 200)}`));
      });
    });
    request.on("error", reject);
    fs.createReadStream(diskPath).on("error", reject).pipe(request);
  });
  return publicStorageUrl(key);
}

function handleMediaProxy(req, res, url) {
  const target = normalizeName(url.searchParams.get("url"));
  if (!isStoragePublicUrl(target)) {
    sendText(res, 403, "Forbidden");
    return;
  }

  const targetUrl = new URL(target);
  const headers = {};
  if (req.headers.range) headers.Range = req.headers.range;
  const request = https.request(targetUrl, { method: "GET", headers }, upstream => {
    const contentType = upstream.headers["content-type"] || contentTypeFor(targetUrl.pathname);
    if (upstream.statusCode < 200 || upstream.statusCode >= 300) {
      res.writeHead(upstream.statusCode || 502, { "Content-Type": "text/plain; charset=utf-8" });
      upstream.pipe(res);
      return;
    }
    if (!String(contentType).startsWith("image/") && !String(contentType).startsWith("video/")) {
      upstream.resume();
      sendText(res, 415, "Unsupported media type");
      return;
    }
    const responseHeaders = {
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=86400"
    };
    for (const name of ["content-length", "content-range", "accept-ranges"]) {
      if (upstream.headers[name]) responseHeaders[name.replace(/(^|-)([a-z])/g, text => text.toUpperCase())] = upstream.headers[name];
    }
    if (!responseHeaders["Accept-Ranges"]) responseHeaders["Accept-Ranges"] = "bytes";
    res.writeHead(upstream.statusCode || 200, responseHeaders);
    upstream.pipe(res);
  });
  request.setTimeout(30000, () => request.destroy(new Error("media proxy timeout")));
  request.on("error", () => sendRedirect(res, target));
  req.on("close", () => request.destroy());
  request.end();
}

function parseSkuAndTitle(folderName) {
  const clean = normalizeName(folderName);
  const match = clean.match(/^([A-Za-z0-9][A-Za-z0-9_]{1,40})(?:[\s_-]+(.+))?$/);
  if (!match) return { sku: clean || "未识别SKU", title: clean || "未命名作品" };
  return {
    sku: match[1],
    title: match[2] ? match[2].replace(/^[-_\s]+/, "") : clean
  };
}

function skuCandidatesFromText(value) {
  const text = normalizeName(value);
  const matches = text.match(/[A-Za-z][A-Za-z0-9_]{1,40}\d[A-Za-z0-9_]*/g) || [];
  return matches
    .map(item => item.replace(/^[_-]+|[_-]+$/g, ""))
    .filter(Boolean);
}

function bestSkuCandidate(values, photographers = []) {
  const photographerSet = new Set((photographers || []).map(normalizeName).filter(Boolean));
  const moduleSet = new Set(MODULES.map(module => module.name));
  const candidates = [];

  for (const value of values) {
    const normalized = normalizeName(value);
    if (!normalized || photographerSet.has(normalized) || moduleSet.has(normalized)) continue;
    for (const candidate of skuCandidatesFromText(normalized)) {
      if (photographerSet.has(candidate) || moduleSet.has(candidate)) continue;
      candidates.push(candidate);
    }
  }

  if (!candidates.length) return "";
  return candidates
    .sort((a, b) => {
      const meaningfulA = a.length >= 4 ? 1 : 0;
      const meaningfulB = b.length >= 4 ? 1 : 0;
      return meaningfulB - meaningfulA || b.length - a.length;
    })[0];
}

function refineUploadSku(info, relativePath, photographers = []) {
  const names = [
    info.sku,
    info.title,
    info.workFolder
  ];
  const sku = bestSkuCandidate(names, photographers);
  if (!sku || sku === info.sku) return info;
  info.sku = sku;
  info.title = sku;
  return info;
}

function displaySkuForEntry(entry) {
  return bestSkuCandidate([
    entry.sku,
    entry.title
  ]) || entry.sku;
}

function isExcludedUploadPath(relativePath) {
  return relativePath
    .split(/[\\/]+/)
    .some(part => EXCLUDED_UPLOAD_KEYWORDS.some(keyword => part.includes(keyword)));
}

function storageConfigured() {
  return Boolean(STORAGE_ENDPOINT && STORAGE_BUCKET && STORAGE_ACCESS_KEY_ID && STORAGE_SECRET_ACCESS_KEY && STORAGE_PUBLIC_BASE_URL);
}

function normalizeUploadFile(file, fallbackModuleName, photographers, periodId, requireData) {
  const relativePath = normalizeName(file.relativePath || file.name);
  const ext = path.extname(relativePath).toLowerCase();
  if (!MEDIA_TYPES.has(ext) || (requireData && !file.data && !file.buffer)) return null;
  if (isExcludedUploadPath(relativePath)) return null;

  const info = refineUploadSku(parseUploadPath(relativePath, fallbackModuleName), relativePath, photographers);
  const knownPhotographer = knownPhotographerName([info.photographer, info.workFolder, info.sku, info.title, relativePath], photographers);
  if (knownPhotographer) info.photographer = knownPhotographer;
  if (!knownPhotographer && !photographers.includes(info.photographer)) info.photographer = "鏈瘑鍒憚褰卞笀";

  const expectedKind = MODULE_BY_NAME.get(info.moduleName)?.kind;
  const mediaKind = IMAGE_TYPES.has(ext) ? "image" : VIDEO_TYPES.has(ext) ? "video" : "file";
  if (!MODULE_BY_NAME.has(info.moduleName)) return null;
  if (expectedKind && expectedKind !== mediaKind) return null;

  const entryId = hash(`${periodId}|${info.moduleName}|${info.photographer}|${info.sku}|${info.title}`);
  return { ...file, ...info, entryId, relativePath, ext, mediaKind };
}

function resolveUploadOwnership(files, fallbackModuleName, uploaderName, isAdminUpload, photographers, periodId) {
  if (!uploaderName && !isAdminUpload) {
    throw new Error("请先登录摄影师姓名上传本人作品，或使用管理员后台代传。");
  }

  const owners = new Set();
  const modules = new Set();
  const media = [];

  for (const file of files) {
    const normalized = normalizeUploadFile(file, fallbackModuleName, photographers, periodId, false);
    if (!normalized) continue;
    const knownPhotographer = knownPhotographerNames([
      normalized.photographer,
      normalized.workFolder,
      normalized.sku,
      normalized.title,
      normalized.relativePath
    ], photographers);
    const uploadedBy = applyUploadOwner(normalized, uploaderName, knownPhotographer, photographers);
    owners.add(normalized.photographer);
    modules.add(normalized.moduleName);
    media.push({
      relativePath: normalized.relativePath,
      moduleName: normalized.moduleName,
      photographer: normalized.photographer,
      uploadedBy
    });
  }

  if (!media.length) throw new Error("文件夹里没有可识别的图片或视频");

  return {
    owners: [...owners],
    modules: [...modules],
    media,
    uploadedBy: uploaderName ? "photographer" : "admin"
  };
}

function resolveUploaderName(value, photographers) {
  const uploaderName = normalizeName(value);
  if (!uploaderName) return "";
  if (!photographers.includes(uploaderName)) {
    throw new Error("姓名不在摄影师名单中，请联系管理员添加");
  }
  return uploaderName;
}

function knownPhotographerName(values, photographers) {
  return knownPhotographerNames(values, photographers)[0] || "";
}

function knownPhotographerNames(values, photographers) {
  const list = Array.isArray(photographers) ? photographers.filter(Boolean) : [];
  const normalizedValues = values.map(value => normalizeName(value)).filter(Boolean);
  const exact = list.filter(name => normalizedValues.some(value => value === name));
  if (exact.length) return exact;
  const text = values.map(value => normalizeName(value)).join(" ");
  return list
    .map(name => ({ name, index: text.indexOf(name) }))
    .filter(item => item.index >= 0)
    .sort((a, b) => a.index - b.index || b.name.length - a.name.length)
    .map(item => item.name);
}

function applyUploadOwner(info, uploaderName, knownPhotographer, photographers) {
  const detectedNames = Array.isArray(knownPhotographer)
    ? knownPhotographer.filter(Boolean)
    : knownPhotographer ? [knownPhotographer] : [];
  if (uploaderName) {
    const otherName = detectedNames.find(name => name !== uploaderName);
    if (otherName) {
      throw new Error(`当前登录为「${uploaderName}」，但文件夹识别为「${otherName}」。摄影师端只能上传自己的作品，请登录「${otherName}」上传，或让管理员后台代传。`);
    }
    info.photographer = uploaderName;
    return "photographer";
  }
  if (detectedNames[0]) info.photographer = detectedNames[0];
  else if (!photographers.includes(info.photographer)) info.photographer = "未识别摄影师";
  return "admin";
}

function parseFolderInfo(folderName) {
  const clean = normalizeName(folderName);
  const parts = clean.split("-").map(part => part.trim()).filter(Boolean);

  if (parts.length >= 3 && /^[A-Za-z]\d+$/i.test(parts[0])) {
    return {
      photographer: parts[1],
      sku: parts[2],
      title: parts.slice(3).join("-") || clean
    };
  }

  return {
    photographer: "未识别摄影师",
    ...parseSkuAndTitle(clean)
  };
}

function parseUploadPath(relativePath, fallbackModuleName) {
  const parts = relativePath.split(/[\\/]+/).filter(Boolean);
  const module = MODULE_BY_NAME.get(fallbackModuleName) || MODULES[0];
  const moduleIndex = parts.findIndex(part => MODULE_NAMES.has(part));
  const start = moduleIndex >= 0 ? moduleIndex + 1 : 0;
  const remaining = parts.slice(start);
  const fileName = remaining[remaining.length - 1] || path.basename(relativePath);
  let photographer = "未识别摄影师";
  let workFolder = path.basename(fileName, path.extname(fileName));
  let sku = workFolder;
  let title = workFolder;

  if (remaining.length === 2) {
    workFolder = remaining[0];
    const parsed = parseFolderInfo(workFolder);
    photographer = parsed.photographer;
    sku = parsed.sku;
    title = parsed.title;
  } else if (remaining.length >= 3) {
    photographer = remaining[0];
    workFolder = remaining[1];
    const parsed = parseSkuAndTitle(workFolder);
    sku = parsed.sku;
    title = parsed.title;
  } else {
    const parsed = parseSkuAndTitle(workFolder);
    sku = parsed.sku;
    title = parsed.title;
  }

  return { moduleId: module.id, moduleName: module.name, moduleKind: module.kind, photographer, sku, title, workFolder };
}

function publicEntry(entry) {
  const media = entry.media || (entry.images || []).map(src => ({ src, kind: "image" }));
  const viewMedia = media.map(item => ({
    ...item,
    src: item.src,
    fallbackSrc: isStoragePublicUrl(item.src) ? proxiedMediaUrl(item.src) : ""
  }));
  const displaySku = displaySkuForEntry(entry);
  return {
    id: entry.id,
    moduleId: entry.moduleId || entry.board,
    moduleName: entry.moduleName || entry.board,
    moduleKind: entry.moduleKind || "image",
    photographer: entry.photographer,
    sku: displaySku,
    title: entry.title,
    sequence: entry.sequence || 0,
    mediaCount: viewMedia.length,
    imageCount: viewMedia.filter(item => item.kind === "image").length,
    videoCount: viewMedia.filter(item => item.kind === "video").length,
    media: viewMedia,
    createdAt: entry.createdAt
  };
}

function voterMedia(entry) {
  const media = entry.media || (entry.images || []).map(src => ({ src, kind: "image" }));
  return media.map(item => ({
    src: item.src,
    fallbackSrc: isStoragePublicUrl(item.src) ? proxiedMediaUrl(item.src) : "",
    kind: item.kind,
    processing: Boolean(item.processing),
    error: normalizeName(item.error)
  }));
}

function voterEntry(entry, viewerName = "") {
  const media = voterMedia(entry);
  const displaySku = displaySkuForEntry(entry);
  return {
    id: entry.id,
    moduleId: entry.moduleId || entry.board,
    moduleName: entry.moduleName || entry.board,
    moduleKind: entry.moduleKind || "image",
    sku: displaySku,
    isOwn: Boolean(viewerName && entry.photographer === viewerName),
    sequence: entry.sequence || 0,
    mediaCount: media.length,
    imageCount: media.filter(item => item.kind === "image").length,
    videoCount: media.filter(item => item.kind === "video").length,
    media,
    createdAt: entry.createdAt
  };
}

function publishedEntry(entry) {
  const item = voterEntry(entry);
  item.photographer = entry.photographer;
  return item;
}

function csvCell(value) {
  const text = String(value ?? "");
  return `"${text.replace(/"/g, '""')}"`;
}

function csvRows(rows) {
  return "\ufeff" + rows.map(row => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

function archiveName(value) {
  return safeSegment(value).replace(/\s+/g, "_");
}

function mediaArchiveName(entry, media, index) {
  const source = mediaSourceForArchive(media) || media.name || "";
  const ext = path.extname(new URL(source, "http://localhost").pathname) || (media.kind === "video" ? ".mp4" : ".jpg");
  const rawName = media.name || `${media.kind || "media"}_${index + 1}`;
  const base = archiveName(path.basename(rawName, path.extname(rawName)));
  return `${String(index + 1).padStart(3, "0")}_${base}${ext}`;
}

function mediaSourceForArchive(media) {
  if (media.kind === "video" && media.optimized && media.src) return media.src;
  return media.originalSrc || media.src;
}

function voteCountsFor(db) {
  const counts = {};
  for (const ballot of currentBallots(db)) {
    for (const entryId of ballot.entryIds || []) counts[entryId] = (counts[entryId] || 0) + 1;
  }
  return counts;
}

function moduleVoteTotals(db) {
  const totals = {};
  for (const ballot of currentBallots(db)) {
    totals[ballot.moduleName] = (totals[ballot.moduleName] || 0) + (ballot.entryIds || []).length;
  }
  return totals;
}

function currentTiebreakers(db) {
  return (db.tiebreakers || []).filter(item => (item.periodId || db.currentPeriodId) === db.currentPeriodId);
}

function currentTiebreakerBallots(db) {
  return (db.tiebreakerBallots || []).filter(item => (item.periodId || db.currentPeriodId) === db.currentPeriodId);
}

function tiebreakerCountsFor(db) {
  const counts = {};
  for (const ballot of currentTiebreakerBallots(db)) {
    counts[ballot.entryId] = (counts[ballot.entryId] || 0) + 1;
  }
  return counts;
}

function resultLimitForModule(moduleName) {
  return RESULT_LIMIT_BY_MODULE[moduleName] || 3;
}

function isAwardTieGroup(db, moduleName, entryIds) {
  const wanted = new Set(entryIds);
  const voteCounts = voteCountsFor(db);
  const tiebreakerCounts = tiebreakerCountsFor(db);
  const ranked = currentEntries(db)
    .filter(entry => entry.moduleName === moduleName)
    .map(entry => ({
      entry,
      votes: voteCounts[entry.id] || 0,
      tiebreakerVotes: tiebreakerCounts[entry.id] || 0
    }))
    .sort((a, b) => b.votes - a.votes || b.tiebreakerVotes - a.tiebreakerVotes || (a.entry.sequence || 0) - (b.entry.sequence || 0));

  const tiedRanks = ranked
    .map((row, index) => ({ ...row, rank: index + 1 }))
    .filter(row => wanted.has(row.entry.id));

  return tiedRanks.length >= 2 && tiedRanks.some(row => row.rank <= resultLimitForModule(moduleName));
}

function archiveEntryFolder(entry) {
  return [
    String(entry.sequence || 0).padStart(3, "0"),
    archiveName(entry.sku || "SKU"),
    archiveName(entry.photographer || "未识别")
  ].join("_");
}

function appendRemoteFile(archive, src, targetPath) {
  archive.append(new lazystream.Readable(() => {
    const stream = new PassThrough();
    const requestUrl = new URL(src);
    https.get(requestUrl, response => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        response.resume();
        https.get(new URL(response.headers.location, requestUrl), redirected => {
          if (redirected.statusCode !== 200) {
            stream.destroy(new Error(`下载失败 ${redirected.statusCode}: ${src}`));
            redirected.resume();
            return;
          }
          redirected.pipe(stream);
        }).on("error", error => stream.destroy(error));
        return;
      }
      if (response.statusCode !== 200) {
        stream.destroy(new Error(`下载失败 ${response.statusCode}: ${src}`));
        response.resume();
        return;
      }
      response.pipe(stream);
    }).on("error", error => stream.destroy(error));
    return stream;
  }), { name: targetPath });
}

function appendLocalFile(archive, src, targetPath) {
  const localPath = path.normalize(path.join(UPLOAD_DIR, decodeURIComponent(src.slice("/data/uploads/".length))));
  if (isInside(UPLOAD_DIR, localPath) && fs.existsSync(localPath)) {
    archive.file(localPath, { name: targetPath });
  }
}

function appendMediaToArchive(archive, entry, media, index) {
  const src = mediaSourceForArchive(media);
  if (!src) return;
  const targetPath = [
    "作品文件",
    archiveName(entry.moduleName || "未分类"),
    archiveEntryFolder(entry),
    mediaArchiveName(entry, media, index)
  ].join("/");

  if (/^https?:\/\//i.test(src)) {
    appendRemoteFile(archive, src, targetPath);
  } else if (src.startsWith("/data/uploads/")) {
    appendLocalFile(archive, src, targetPath);
  }
}

function buildArchiveCsvFiles(db) {
  const entries = currentEntries(db).sort((a, b) => (a.sequence || 0) - (b.sequence || 0));
  const ballots = currentBallots(db).sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0));
  const counts = voteCountsFor(db);
  const tiebreakerCounts = tiebreakerCountsFor(db);
  const moduleTotals = moduleVoteTotals(db);
  const byId = new Map(entries.map(entry => [entry.id, entry]));

  const entryRows = [["模块", "作品序号", "SKU", "摄影师", "文件数量", "上传时间"]];
  for (const entry of entries) {
    entryRows.push([
      entry.moduleName,
      entry.sequence || "",
      entry.sku || "",
      entry.photographer || "",
      (entry.media || []).length,
      entry.createdAt || ""
    ]);
  }

  const ballotRows = [["投票人", "模块", "选择作品序号", "选择SKU", "作品摄影师", "提交时间"]];
  for (const ballot of ballots) {
    for (const entryId of ballot.entryIds || []) {
      const entry = byId.get(entryId);
      ballotRows.push([
        ballot.voter || "",
        ballot.moduleName || "",
        entry?.sequence || "",
        entry?.sku || "",
        entry?.photographer || "",
        ballot.createdAt || ""
      ]);
    }
  }

  const resultRows = [["模块", "排名", "作品序号", "SKU", "摄影师", "票数", "加赛票数", "占比"]];
  for (const module of MODULES) {
    const ranked = entries
      .filter(entry => entry.moduleName === module.name)
      .map(entry => ({ entry, votes: counts[entry.id] || 0, tiebreakerVotes: tiebreakerCounts[entry.id] || 0 }))
      .sort((a, b) => b.votes - a.votes || b.tiebreakerVotes - a.tiebreakerVotes || (a.entry.sequence || 0) - (b.entry.sequence || 0));
    ranked.forEach((item, index) => {
      const total = moduleTotals[module.name] || 0;
      resultRows.push([
        module.name,
        index + 1,
        item.entry.sequence || "",
        item.entry.sku || "",
        item.entry.photographer || "",
        item.votes,
        item.tiebreakerVotes,
        total ? `${Math.round((item.votes / total) * 1000) / 10}%` : "0%"
      ]);
    });
  }

  return {
    "作品清单.csv": csvRows(entryRows),
    "投票记录.csv": csvRows(ballotRows),
    "最终排名.csv": csvRows(resultRows)
  };
}

function handleAdminArchive(req, res, url) {
  if (!canViewAdmin(url)) return sendJson(res, 403, { error: "管理员口令不正确" });

  const db = readDb();
  const period = currentPeriod(db);
  const entries = currentEntries(db).sort((a, b) => (a.sequence || 0) - (b.sequence || 0));
  const archive = archiver("zip", { zlib: { level: 1 } });
  const filename = `${period.id || "photo-review"}-archive.zip`;

  archive.on("error", error => {
    console.warn(`Archive failed: ${error.message}`);
    if (!res.headersSent) sendJson(res, 500, { error: "生成归档失败" });
    else res.destroy(error);
  });

  res.writeHead(200, {
    "Content-Type": "application/zip",
    "Content-Disposition": `attachment; filename="${filename}"`,
    "Cache-Control": "no-store"
  });
  archive.pipe(res);

  archive.append([
    `评优月份：${period.name || period.id}`,
    `作品数量：${entries.length}`,
    `投票状态：${db.votingOpen ? "已开始" : "未开始"}`,
    `结果状态：${db.resultsPublished ? "已公布" : "未公布"}`,
    "",
    "压缩包内容：",
    "1. 作品文件：按模块 / 作品序号_SKU_摄影师 存放图片或视频。",
    "2. 作品清单.csv：当前月份全部作品。",
    "3. 投票记录.csv：每位摄影师的投票记录。",
    "4. 最终排名.csv：每个模块的票数和占比。"
  ].join("\r\n"), { name: "归档说明.txt" });

  for (const [name, content] of Object.entries(buildArchiveCsvFiles(db))) {
    archive.append(content, { name });
  }

  for (const entry of entries) {
    (entry.media || []).forEach((media, index) => appendMediaToArchive(archive, entry, media, index));
  }

  archive.finalize();
}

function canViewAdmin(url) {
  return Boolean(ADMIN_CODE) && normalizeName(url.searchParams.get("adminCode")) === ADMIN_CODE;
}

function isAdminPayload(payload) {
  return Boolean(ADMIN_CODE) && normalizeName(payload.adminCode) === ADMIN_CODE;
}

function contentTypeFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".jfif": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".bmp": "image/bmp",
    ".tif": "image/tiff",
    ".tiff": "image/tiff",
    ".avif": "image/avif",
    ".heic": "image/heic",
    ".heif": "image/heif",
    ".mp4": "video/mp4",
    ".mov": "video/quicktime",
    ".m4v": "video/x-m4v",
    ".webm": "video/webm"
  }[ext] || "application/octet-stream";
}

function runTool(command, args) {
  return new Promise((resolve, reject) => {
    childProcess.execFile(command, args, { windowsHide: true }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr || stdout || error.message));
        return;
      }
      resolve();
    });
  });
}

const optimizeQueue = [];
let optimizeActive = 0;

function optimizeQueueState() {
  return {
    pending: optimizeQueue.length,
    active: optimizeActive,
    concurrency: OPTIMIZE_CONCURRENCY
  };
}

function queueMediaOptimization(job) {
  optimizeQueue.push(job);
  processOptimizeQueue();
}

function processOptimizeQueue() {
  while (optimizeActive < OPTIMIZE_CONCURRENCY && optimizeQueue.length) {
    const job = optimizeQueue.shift();
    optimizeActive += 1;
    optimizeMediaJob(job)
      .catch(error => {
        console.warn(`Background optimize failed for ${job.originalFilename}: ${error.message}`);
      })
      .finally(() => {
        optimizeActive -= 1;
        processOptimizeQueue();
      });
  }
}

async function optimizeMediaJob(job) {
  if (job.storage === "object" && job.mediaKind === "image") {
    await optimizeObjectImageJob(job);
    return;
  }
  if (job.storage === "object") {
    await optimizeObjectMediaJob(job);
    return;
  }
  if (!job.originalDiskPath) {
    await markMediaOptimized(job.entryId, job.mediaId, null, "缺少原视频文件路径");
    return;
  }

  let displayDiskPath = job.originalDiskPath;
  try {
    displayDiskPath = await createOptimizedMedia(job.originalDiskPath, job.ext, job.mediaKind);
  } catch (error) {
    await markMediaOptimized(job.entryId, job.mediaId, null, error.message);
    throw error;
  }

  const optimized = displayDiskPath !== job.originalDiskPath;
  const displayFilename = path.basename(displayDiskPath);
  await markMediaOptimized(job.entryId, job.mediaId, `/data/uploads/${job.entryId}/${displayFilename}`, "");
  console.log(`Background optimize finished: ${job.originalFilename}${optimized ? " -> " + displayFilename : ""}`);
}

async function optimizeObjectMediaJob(job) {
  if (job.mediaKind !== "video" || !HAS_FFMPEG || !storageConfigured()) {
    await markMediaOptimized(job.entryId, job.mediaId, null, "");
    return;
  }

  const tempDir = path.join(UPLOAD_DIR, "_tmp", job.entryId);
  fs.mkdirSync(tempDir, { recursive: true });
  const inputPath = path.join(tempDir, `${job.mediaId}${job.ext || ".mp4"}`);
  const displayPath = path.join(tempDir, `${job.mediaId}_display.mp4`);
  try {
    await downloadRemoteFile(job.originalSrc, inputPath);
    await createOptimizedMedia(inputPath, job.ext || ".mp4", "video", displayPath);
    const displayKey = createStorageObjectKey(job.periodId, job.entryId, `${path.basename(job.mediaId)}_display.mp4`);
    const displayUrl = await putStorageObject(displayKey, displayPath, "video/mp4");
    await markMediaOptimized(job.entryId, job.mediaId, displayUrl, "");
    console.log(`Background video display finished: ${job.originalFilename} -> ${displayKey}`);
  } catch (error) {
    await markMediaOptimized(job.entryId, job.mediaId, null, error.message);
    throw error;
  } finally {
    fs.rm(inputPath, { force: true }, () => {});
    fs.rm(displayPath, { force: true }, () => {});
  }
}

async function optimizeObjectImageJob(job) {
  if (job.mediaKind !== "image" || !storageConfigured()) {
    await markMediaOptimized(job.entryId, job.mediaId, null, "");
    return;
  }

  const tempDir = path.join(UPLOAD_DIR, "_tmp", job.entryId);
  fs.mkdirSync(tempDir, { recursive: true });
  const inputPath = path.join(tempDir, `${job.mediaId}${job.ext || ".jpg"}`);
  const displayPath = path.join(tempDir, `${job.mediaId}_display.webp`);
  try {
    await downloadRemoteFile(job.originalSrc, inputPath);
    await sharp(inputPath)
      .rotate()
      .resize({
        width: IMAGE_MAX_DIMENSION,
        height: IMAGE_MAX_DIMENSION,
        fit: "inside",
        withoutEnlargement: true
      })
      .webp({ quality: 88, effort: IMAGE_WEBP_EFFORT })
      .toFile(displayPath);
    const displayKey = createStorageObjectKey(job.periodId, job.entryId, `${path.basename(job.mediaId)}_display.webp`);
    const displayUrl = await putStorageObject(displayKey, displayPath, "image/webp");
    await markMediaOptimized(job.entryId, job.mediaId, displayUrl, "");
    console.log(`Background image display finished: ${job.originalFilename} -> ${displayKey}`);
  } catch (error) {
    await markMediaOptimized(job.entryId, job.mediaId, null, error.message);
    throw error;
  } finally {
    fs.rm(inputPath, { force: true }, () => {});
    fs.rm(displayPath, { force: true }, () => {});
  }
}

async function markMediaOptimized(entryId, mediaId, displaySrc, errorMessage) {
  await withDbWriteLock(async () => {
    const db = readDb();
    const entry = (db.entries || []).find(item => item.id === entryId);
    const media = entry?.media?.find(item => item.id === mediaId);
    if (!media) return;
    if (displaySrc) {
      media.src = displaySrc;
      media.optimized = displaySrc !== media.originalSrc;
    }
    media.processing = false;
    if (errorMessage) media.error = errorMessage;
    else delete media.error;
    writeDb(db);
  });
}

async function createOptimizedMedia(sourcePath, ext, mediaKind, targetOverride = "") {
  if (mediaKind === "image") {
    const browserReadyTypes = new Set([".jpg", ".jpeg", ".jfif", ".png", ".webp", ".gif", ".avif"]);
    const fileSize = fs.statSync(sourcePath).size;
    if (browserReadyTypes.has(ext) && fileSize <= IMAGE_OPTIMIZE_MIN_BYTES) {
      return sourcePath;
    }

    const targetPath = targetOverride || sourcePath.slice(0, -ext.length) + "_display.webp";
    await sharp(sourcePath)
      .rotate()
      .resize({
        width: IMAGE_MAX_DIMENSION,
        height: IMAGE_MAX_DIMENSION,
        fit: "inside",
        withoutEnlargement: true
      })
      .webp({ quality: 88, effort: IMAGE_WEBP_EFFORT })
      .toFile(targetPath);
    return targetPath;
  }

  if (mediaKind === "video" && HAS_FFMPEG) {
    const targetPath = targetOverride || sourcePath.slice(0, -ext.length) + "_display.mp4";
    await runTool(FFMPEG_PATH, [
      "-y",
      "-i", sourcePath,
      "-map_metadata", "-1",
      "-c:v", "libx264",
      "-preset", VIDEO_PRESET,
      "-vf", `scale='min(${VIDEO_DISPLAY_WIDTH},iw)':'min(${VIDEO_DISPLAY_HEIGHT},ih)':force_original_aspect_ratio=decrease`,
      "-b:v", VIDEO_DISPLAY_BITRATE,
      "-maxrate", VIDEO_DISPLAY_BITRATE,
      "-bufsize", VIDEO_DISPLAY_BUFSIZE,
      "-profile:v", "main",
      "-pix_fmt", "yuv420p",
      "-c:a", "aac",
      "-b:a", VIDEO_DISPLAY_AUDIO_BITRATE,
      "-movflags", "+faststart",
      targetPath
    ]);
    return targetPath;
  }

  return sourcePath;
}

function downloadRemoteFile(src, targetPath) {
  return new Promise((resolve, reject) => {
    const requestUrl = new URL(src);
    const file = fs.createWriteStream(targetPath);
    const request = https.get(requestUrl, response => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        response.resume();
        file.close(() => {
          fs.rm(targetPath, { force: true }, () => {});
          downloadRemoteFile(new URL(response.headers.location, requestUrl).toString(), targetPath).then(resolve, reject);
        });
        return;
      }
      if (response.statusCode !== 200) {
        response.resume();
        file.close(() => fs.rm(targetPath, { force: true }, () => {}));
        reject(new Error(`下载原视频失败：${response.statusCode}`));
        return;
      }
      response.pipe(file);
    });
    request.on("error", error => {
      file.close(() => fs.rm(targetPath, { force: true }, () => {}));
      reject(error);
    });
    file.on("finish", () => file.close(resolve));
    file.on("error", error => {
      request.destroy();
      file.close(() => fs.rm(targetPath, { force: true }, () => {}));
      reject(error);
    });
  });
}

function handleStatic(req, res) {
  const urlPath = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
  const isUpload = urlPath.startsWith("/data/uploads/");
  let filePath = urlPath === "/" ? path.join(PUBLIC_DIR, "index.html") : path.join(PUBLIC_DIR, urlPath.slice(1));
  if (isUpload) {
    filePath = path.join(UPLOAD_DIR, urlPath.slice("/data/uploads/".length));
  }
  filePath = path.normalize(filePath);

  if (!isInside(PUBLIC_DIR, filePath) && !isInside(UPLOAD_DIR, filePath)) {
    sendText(res, 403, "Forbidden");
    return;
  }

  fs.stat(filePath, (error, stat) => {
    if (error || !stat.isFile()) {
      sendText(res, 404, "Not found");
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const headers = { "Content-Type": contentTypeFor(filePath) };
    if (!isUpload && [".html", ".js", ".css"].includes(ext)) {
      headers["Cache-Control"] = "no-cache, no-store, must-revalidate";
    } else if (isUpload) {
      // Uploaded media is content-addressed (unique filename per upload), safe to cache hard.
      headers["Cache-Control"] = "public, max-age=31536000, immutable";
    }

    const total = stat.size;
    // Advertise range support so browsers can seek/stream video instead of buffering the whole file.
    headers["Accept-Ranges"] = "bytes";

    const rangeHeader = req.headers.range;
    let start = 0;
    let end = total - 1;
    let status = 200;

    if (rangeHeader) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
      if (!match || (match[1] === "" && match[2] === "")) {
        res.writeHead(416, { "Content-Range": `bytes */${total}` });
        res.end();
        return;
      }
      if (match[1] === "") {
        // Suffix range: last N bytes.
        const suffix = Number(match[2]);
        start = suffix >= total ? 0 : total - suffix;
        end = total - 1;
      } else {
        start = Number(match[1]);
        end = match[2] === "" ? total - 1 : Math.min(Number(match[2]), total - 1);
      }
      if (start > end || start >= total) {
        res.writeHead(416, { "Content-Range": `bytes */${total}` });
        res.end();
        return;
      }
      status = 206;
      headers["Content-Range"] = `bytes ${start}-${end}/${total}`;
    }

    headers["Content-Length"] = end - start + 1;
    res.writeHead(status, headers);

    if (req.method === "HEAD") {
      res.end();
      return;
    }

    const stream = fs.createReadStream(filePath, { start, end });
    stream.on("error", () => res.destroy());
    res.on("close", () => stream.destroy());
    stream.pipe(res);
  });
}

async function handleUpload(req, res) {
  const contentType = String(req.headers["content-type"] || "");
  const payload = contentType.includes("multipart/form-data")
    ? await collectMultipart(req)
    : await collectJson(req);
  const fields = payload.fields || payload;
  const files = Array.isArray(payload.files) ? payload.files : [];
  const fallbackModuleName = MODULE_BY_NAME.has(fields.moduleName) ? fields.moduleName : MODULES[0].name;
  const uploadSessionId = normalizeName(fields.uploadSessionId);
  const dbSnapshot = readDb();
  const periodId = dbSnapshot.currentPeriodId;
  const photographers = dbSnapshot.photographers || [];
  const uploaderName = resolveUploaderName(fields.uploaderName, photographers);
  const adminUpload = !uploaderName && isAdminPayload(fields);
  if (!uploaderName && !adminUpload) {
    throw new Error("请先登录摄影师姓名上传本人作品，或使用管理员后台代传。");
  }
  assertPhotographerUploadOpen(dbSnapshot, uploaderName, adminUpload);
  const grouped = new Map();

  if (files.length > MAX_FILES_PER_UPLOAD) {
    return sendJson(res, 400, { error: `单次最多上传 ${MAX_FILES_PER_UPLOAD} 个文件` });
  }

  for (const file of files) {
    const relativePath = normalizeName(file.relativePath || file.name);
    const ext = path.extname(relativePath).toLowerCase();
    if (!MEDIA_TYPES.has(ext) || (!file.data && !file.buffer)) continue;
    if (isExcludedUploadPath(relativePath)) continue;

    const info = refineUploadSku(parseUploadPath(relativePath, fallbackModuleName), relativePath, photographers);
    const knownPhotographer = knownPhotographerNames([info.photographer, info.workFolder, info.sku, info.title, relativePath], photographers);
    const uploadedBy = applyUploadOwner(info, uploaderName, knownPhotographer, photographers);
    const expectedKind = MODULE_BY_NAME.get(info.moduleName)?.kind;
    const mediaKind = IMAGE_TYPES.has(ext) ? "image" : VIDEO_TYPES.has(ext) ? "video" : "file";
    if (!MODULE_BY_NAME.has(info.moduleName)) continue;
    if (expectedKind && expectedKind !== mediaKind) continue;

    const entryId = uploadSessionId
      ? hash(`${periodId}|${info.moduleName}|${info.photographer}|${uploadSessionId}`)
      : hash(`${periodId}|${info.moduleName}|${info.photographer}|${info.sku}|${info.title}`);
    if (uploaderName) assertUploaderCanCreateModuleEntry(dbSnapshot, uploaderName, info.moduleName, entryId);
    const key = `${periodId}|${info.moduleName}|${info.photographer}|${entryId}`;
    if (!grouped.has(key)) grouped.set(key, { ...info, uploadedBy, files: [] });
    grouped.get(key).files.push({ ...file, relativePath, ext, mediaKind });
  }

  let mediaTotal = 0;
  const uploadNonce = crypto.randomBytes(6).toString("hex");
  const processedGroups = [];
  const optimizeJobs = [];

  for (const group of grouped.values()) {
    const id = uploadSessionId
      ? hash(`${periodId}|${group.moduleName}|${group.photographer}|${uploadSessionId}`)
      : hash(`${periodId}|${group.moduleName}|${group.photographer}|${group.sku}|${group.title}`);
    const entryDir = path.join(UPLOAD_DIR, id);
    fs.mkdirSync(entryDir, { recursive: true });
    const media = [];

    for (const [index, file] of group.files.entries()) {
      const buffer = file.buffer || Buffer.from(String(file.data).split(",").pop(), "base64");
      const serial = String(mediaTotal + index + 1).padStart(3, "0");
      const filename = `${safeSegment(group.sku)}_${uploadNonce}_${serial}${file.ext}`;
      const originalFilename = `original_${filename}`;
      const originalDiskPath = path.join(entryDir, originalFilename);
      fs.writeFileSync(originalDiskPath, buffer);
      const mediaId = hash(`${id}|${originalFilename}`);
      media.push({
        id: mediaId,
        src: `/data/uploads/${id}/${originalFilename}`,
        originalSrc: `/data/uploads/${id}/${originalFilename}`,
        kind: file.mediaKind,
        name: file.name || path.basename(file.relativePath),
        optimized: file.mediaKind === "video",
        processing: file.mediaKind !== "video"
      });
      if (file.mediaKind !== "video") {
        optimizeJobs.push({
          entryId: id,
          mediaId,
          originalDiskPath,
          originalFilename,
          ext: file.ext,
          mediaKind: file.mediaKind
        });
      }
      mediaTotal += 1;
    }

    processedGroups.push({ ...group, id, periodId, media });
  }

  await saveEntryMediaGroups(processedGroups);

  for (const job of optimizeJobs) queueMediaOptimization(job);

  sendJson(res, 200, { ok: true, entries: grouped.size, media: mediaTotal });
}

async function handleUploadPreviewOwner(req, res) {
  const payload = await collectJson(req);
  const fallbackModuleName = MODULE_BY_NAME.has(payload.moduleName) ? payload.moduleName : MODULES[0].name;
  const files = Array.isArray(payload.files) ? payload.files : [];
  const dbSnapshot = readDb();
  const photographers = dbSnapshot.photographers || [];
  const uploaderName = resolveUploaderName(payload.uploaderName, photographers);
  const adminUpload = !uploaderName && isAdminPayload(payload);
  assertPhotographerUploadOpen(dbSnapshot, uploaderName, adminUpload);
  const preview = resolveUploadOwnership(files, fallbackModuleName, uploaderName, adminUpload, photographers, dbSnapshot.currentPeriodId);
  sendJson(res, 200, { ok: true, ...preview });
}

async function handleStorageSign(req, res) {
  if (!storageConfigured()) return sendJson(res, 400, { error: "对象存储未配置，继续使用本地上传" });
  const payload = await collectJson(req);
  const fallbackModuleName = MODULE_BY_NAME.has(payload.moduleName) ? payload.moduleName : MODULES[0].name;
  const files = Array.isArray(payload.files) ? payload.files : [];
  const uploadSessionId = normalizeName(payload.uploadSessionId);
  const dbSnapshot = readDb();
  const periodId = dbSnapshot.currentPeriodId;
  const photographers = dbSnapshot.photographers || [];
  const uploaderName = resolveUploaderName(payload.uploaderName, photographers);
  const adminUpload = !uploaderName && isAdminPayload(payload);
  if (!uploaderName && !adminUpload) {
    throw new Error("请先登录摄影师姓名上传本人作品，或使用管理员后台代传。");
  }
  assertPhotographerUploadOpen(dbSnapshot, uploaderName, adminUpload);
  const uploadNonce = crypto.randomBytes(6).toString("hex");
  const signed = [];

  if (files.length > MAX_FILES_PER_UPLOAD) {
    return sendJson(res, 400, { error: `单次最多上传 ${MAX_FILES_PER_UPLOAD} 个文件` });
  }

  for (const [index, file] of files.entries()) {
    const normalized = normalizeUploadFile(file, fallbackModuleName, photographers, periodId, false);
    if (!normalized) continue;
    const knownPhotographer = knownPhotographerNames([normalized.photographer, normalized.workFolder, normalized.sku, normalized.title, normalized.relativePath], photographers);
    let uploadedBy = "admin";
    if (uploaderName) {
      uploadedBy = applyUploadOwner(normalized, uploaderName, knownPhotographer, photographers);
    } else {
      uploadedBy = applyUploadOwner(normalized, "", knownPhotographer, photographers);
    }
    normalized.entryId = uploadSessionId
      ? hash(`${periodId}|${normalized.moduleName}|${normalized.photographer}|${uploadSessionId}`)
      : hash(`${periodId}|${normalized.moduleName}|${normalized.photographer}|${normalized.sku}|${normalized.title}`);
    if (uploaderName) assertUploaderCanCreateModuleEntry(dbSnapshot, uploaderName, normalized.moduleName, normalized.entryId);
    const serial = String(index + 1).padStart(3, "0");
    const filename = `${safeSegment(normalized.sku)}_${uploadNonce}_${serial}${normalized.ext}`;
    const objectKey = createStorageObjectKey(periodId, normalized.entryId, filename);
    const publicUrl = publicStorageUrl(objectKey);
    const signedUrl = createPresignedPutUrl(objectKey, normalizeName(file.type) || contentTypeFor(filename));
    const signedFile = {
      id: hash(`${normalized.entryId}|${objectKey}`),
      uploadUrl: signedUrl.url,
      method: "PUT",
      contentType: signedUrl.contentType,
      publicUrl,
      objectKey,
      entryId: normalized.entryId,
      periodId,
      moduleId: normalized.moduleId,
      moduleName: normalized.moduleName,
      moduleKind: normalized.moduleKind,
      photographer: normalized.photographer,
      sku: normalized.sku,
      title: normalized.title,
      relativePath: normalized.relativePath,
      kind: normalized.mediaKind,
      uploadedBy,
      name: file.name || path.basename(normalized.relativePath),
      optimizedForUpload: Boolean(file.optimizedForUpload),
      originalName: normalizeName(file.originalName),
      originalSize: Number(file.originalSize || 0)
    };
    signedFile.ownerToken = uploadOwnerToken(signedFile);
    signed.push(signedFile);
  }

  sendJson(res, 200, { ok: true, storage: "s3", files: signed });
}

async function handleStorageComplete(req, res) {
  const payload = await collectJson(req);
  const uploaded = Array.isArray(payload.files) ? payload.files : [];
  const grouped = new Map();
  const optimizeJobs = [];
  let mediaTotal = 0;
  const dbSnapshot = readDb();
  const seenUploaderModules = new Set();

  if (uploaded.some(file => file.uploadedBy === "photographer")) {
    assertPhotographerUploadOpen(dbSnapshot, "摄影师", false);
  }

  for (const file of uploaded) {
    if (!file.entryId || !file.publicUrl || !file.moduleName) continue;
    if (file.ownerToken !== uploadOwnerToken(file)) {
      throw new Error("上传归属校验失败，请重新上传");
    }
    const ownerModuleKey = `${file.photographer}|${file.moduleName}`;
    if (file.uploadedBy === "photographer" && file.photographer && file.moduleName && !seenUploaderModules.has(ownerModuleKey)) {
      assertUploaderCanCreateModuleEntry(dbSnapshot, file.photographer, file.moduleName, file.entryId);
      seenUploaderModules.add(ownerModuleKey);
    }
    const key = `${file.periodId}|${file.moduleName}|${file.photographer}|${file.entryId}`;
    if (!grouped.has(key)) {
      grouped.set(key, {
        id: file.entryId,
        periodId: file.periodId || readDb().currentPeriodId,
        moduleId: file.moduleId,
        moduleName: file.moduleName,
        moduleKind: file.moduleKind,
        photographer: file.photographer,
        sku: file.sku,
        title: file.title,
        media: []
      });
    }
    const mediaId = file.id || hash(`${file.entryId}|${file.publicUrl}`);
    const videoDirectUpload = file.kind === "video";
    const alreadyOptimizedVideo = videoDirectUpload && file.optimizedForUpload;
    grouped.get(key).media.push({
      id: mediaId,
      src: file.publicUrl,
      originalSrc: file.publicUrl,
      kind: file.kind,
      name: file.name || path.basename(file.objectKey || file.publicUrl),
      optimized: Boolean(videoDirectUpload || alreadyOptimizedVideo),
      processing: false,
      storage: "object"
    });
    mediaTotal += 1;
  }

  const groups = [...grouped.values()];
  await saveEntryMediaGroups(groups);
  for (const job of optimizeJobs) queueMediaOptimization(job);
  sendJson(res, 200, { ok: true, entries: groups.length, media: mediaTotal });
}

async function handleAdminRestoreDb(req, res) {
  const payload = await collectJson(req);
  if (!isAdminPayload(payload)) return sendJson(res, 403, { error: "管理员口令不正确" });
  const source = payload.db && typeof payload.db === "object" ? payload.db : null;
  if (!source) return sendJson(res, 400, { error: "缺少恢复数据" });

  const db = emptyDb();
  db.entries = Array.isArray(source.entries) ? source.entries : [];
  db.ballots = Array.isArray(source.ballots) ? source.ballots : [];
  db.tiebreakers = Array.isArray(source.tiebreakers) ? source.tiebreakers : [];
  db.tiebreakerBallots = Array.isArray(source.tiebreakerBallots) ? source.tiebreakerBallots : [];
  db.photographers = Array.isArray(source.photographers) ? [...new Set(source.photographers.map(normalizeName).filter(Boolean))] : [];
  db.periods = Array.isArray(source.periods) && source.periods.length ? source.periods.map(period => createPeriod(period.id, period)) : [];
  db.currentPeriodId = normalizeName(source.currentPeriodId) || db.periods[0]?.id || currentPeriodId();
  db.nextSequence = Number(source.nextSequence) || db.entries.length + 1;

  if (!db.periods.some(period => period.id === db.currentPeriodId)) {
    db.periods.push(createPeriod(db.currentPeriodId, {
      votingOpen: source.votingOpen,
      resultsPublished: source.resultsPublished
    }));
  }
  const period = db.periods.find(item => item.id === db.currentPeriodId);
  period.votingOpen = Boolean(source.votingOpen);
  period.resultsPublished = Boolean(source.resultsPublished);
  ensurePeriods(db);
  writeDb(db);
  sendJson(res, 200, {
    ok: true,
    entries: currentEntries(db).length,
    media: currentEntries(db).reduce((total, entry) => total + (entry.media || []).length, 0),
    currentPeriodId: db.currentPeriodId,
    votingOpen: db.votingOpen,
    resultsPublished: db.resultsPublished
  });
}

async function handleVideoOptimize(req, res) {
  const payload = await collectJson(req);
  if (!isAdminPayload(payload)) return sendJson(res, 403, { error: "管理员口令不正确" });
  if (!HAS_FFMPEG) return sendJson(res, 400, { error: "服务器未启用 ffmpeg，无法生成视频展示版" });

  const force = Boolean(payload.force);
  const db = readDb();
  // force 时遍历所有期(重转历史视频),否则只处理当前期
  const targetEntries = force ? (db.entries || []) : currentEntries(db);
  let queued = 0;
  for (const entry of targetEntries) {
    for (const media of entry.media || []) {
      if (media.kind !== "video") continue;
      if (!force && media.optimized && media.src && media.src !== media.originalSrc) continue;
      if (!force && media.processing) continue;
      media.processing = true;
      queued += 1;
      queueMediaOptimization({
        entryId: entry.id,
        mediaId: media.id,
        originalSrc: media.originalSrc || media.src,
        originalFilename: media.name || `${entry.sku || entry.id}.mp4`,
        objectKey: "",
        periodId: entry.periodId || db.currentPeriodId,
        mediaKind: "video",
        ext: path.extname(media.name || media.originalSrc || media.src || ".mp4").toLowerCase() || ".mp4",
        storage: /^https?:\/\//i.test(media.originalSrc || media.src || "") ? "object" : "local",
        originalDiskPath: media.originalSrc?.startsWith("/data/uploads/")
          ? path.join(UPLOAD_DIR, decodeURIComponent(media.originalSrc.slice("/data/uploads/".length)))
          : ""
      });
    }
  }
  writeDb(db);
  sendJson(res, 200, { ok: true, force, queued, queue: optimizeQueueState() });
}

async function handleMigrateMediaUrls(req, res) {
  const payload = await collectJson(req);
  if (!isAdminPayload(payload)) return sendJson(res, 403, { error: "管理员口令不正确" });
  const from = normalizeName(payload.from).replace(/\/+$/, "");
  const to = normalizeName(payload.to).replace(/\/+$/, "");
  if (!from || !to) return sendJson(res, 400, { error: "缺少 from 或 to 基础 URL" });
  if (!/^https?:\/\//i.test(from) || !/^https?:\/\//i.test(to)) {
    return sendJson(res, 400, { error: "from/to 必须是完整的 http(s) URL" });
  }

  let entriesTouched = 0;
  let urlsReplaced = 0;
  const dryRun = Boolean(payload.dryRun);

  await withDbWriteLock(async () => {
    const db = readDb();
    for (const entry of db.entries || []) {
      let entryChanged = false;
      for (const media of entry.media || []) {
        for (const field of ["src", "originalSrc"]) {
          const value = media[field];
          if (typeof value === "string" && value.startsWith(from + "/")) {
            if (!dryRun) media[field] = to + value.slice(from.length);
            urlsReplaced += 1;
            entryChanged = true;
          }
        }
      }
      if (entryChanged) entriesTouched += 1;
    }
    if (!dryRun) writeDb(db);
  });

  sendJson(res, 200, { ok: true, dryRun, from, to, entriesTouched, urlsReplaced });
}

async function handleImageOptimize(req, res) {
  const payload = await collectJson(req);
  if (!isAdminPayload(payload)) return sendJson(res, 403, { error: "管理员口令不正确" });

  const force = Boolean(payload.force);
  const db = readDb();
  const targetEntries = force ? (db.entries || []) : currentEntries(db);
  let queued = 0;
  for (const entry of targetEntries) {
    for (const media of entry.media || []) {
      if (media.kind !== "image") continue;
      if (!force && media.optimized && media.src && media.src !== media.originalSrc) continue;
      if (!force && media.processing) continue;
      const source = media.originalSrc || media.src || "";
      if (!/^https?:\/\//i.test(source)) continue;
      media.processing = true;
      queued += 1;
      queueMediaOptimization({
        entryId: entry.id,
        mediaId: media.id,
        originalSrc: source,
        originalFilename: media.name || `${entry.sku || entry.id}.jpg`,
        periodId: entry.periodId || db.currentPeriodId,
        mediaKind: "image",
        ext: path.extname(media.name || source || ".jpg").toLowerCase() || ".jpg",
        storage: "object"
      });
    }
  }
  writeDb(db);
  sendJson(res, 200, { ok: true, force, queued, queue: optimizeQueueState() });
}

async function saveEntryMediaGroups(groups) {
  await withDbWriteLock(async () => {
    const db = readDb();
    for (const group of groups) {
      const existing = db.entries.find(entry => entry.id === group.id);
      const entry = existing || {
        id: group.id,
        periodId: group.periodId,
        moduleId: group.moduleId,
        moduleName: group.moduleName,
        moduleKind: group.moduleKind,
        photographer: group.photographer,
        sku: group.sku,
        title: group.title,
        sequence: db.nextSequence++,
        media: [],
        createdAt: new Date().toISOString()
      };

      entry.media ||= [];
      entry.media.push(...group.media);
      if (!existing) db.entries.push(entry);
    }
    db.entries.sort((a, b) => (a.sequence || 0) - (b.sequence || 0));
    writeDb(db);
  });
}

async function handleVote(req, res) {
  const payload = await collectJson(req);
  const voter = normalizeName(payload.voter);
  const moduleName = normalizeName(payload.moduleName);
  const module = MODULE_BY_NAME.get(moduleName);
  const entryIds = Array.isArray(payload.entryIds) ? payload.entryIds.map(String) : [];
  const db = readDb();

  if (!db.votingOpen) return sendJson(res, 400, { error: "管理员还没有开始投票" });
  if (!voter) return sendJson(res, 400, { error: "请输入投票人姓名" });
  if (!(db.photographers || []).includes(voter)) return sendJson(res, 403, { error: "姓名不在摄影师名单中，请联系管理员添加" });
  if (!module) return sendJson(res, 400, { error: "模块不存在" });
  if (isVotingFullyCompleted(db)) return sendJson(res, 400, { error: "投票已完成，不能修改投票结果" });
  if (entryIds.length === 0 || entryIds.length > module.voteLimit) {
    return sendJson(res, 400, { error: `${module.name} 需要选择 1 到 ${module.voteLimit} 个作品` });
  }
  if (new Set(entryIds).size !== entryIds.length) return sendJson(res, 400, { error: "不能重复投同一个作品" });

    const periodEntries = currentEntries(db);
    const entries = entryIds.map(id => periodEntries.find(entry => entry.id === id));
  if (entries.some(entry => !entry || entry.moduleName !== module.name)) return sendJson(res, 400, { error: "投票作品无效" });
  if (entries.some(entry => entry.photographer === voter)) return sendJson(res, 400, { error: "不能投自己的作品" });

  db.ballots = db.ballots.filter(ballot => !(ballot.voter === voter && ballot.moduleName === module.name && (ballot.periodId || db.currentPeriodId) === db.currentPeriodId));
  db.ballots.push({ periodId: db.currentPeriodId, voter, moduleName: module.name, entryIds, createdAt: new Date().toISOString() });
  writeDb(db);
  sendJson(res, 200, { ok: true });
}

async function handleTiebreakerUpdate(req, res) {
  const payload = await collectJson(req);
  if (!isAdminPayload(payload)) return sendJson(res, 403, { error: "管理员口令不正确" });

  const db = readDb();
  db.tiebreakers ||= [];
  db.tiebreakerBallots ||= [];
  const action = normalizeName(payload.action);

  if (action === "create") {
    const requestedModuleName = normalizeName(payload.moduleName);
    const entryIds = Array.isArray(payload.entryIds) ? [...new Set(payload.entryIds.map(String))] : [];
    const periodEntries = currentEntries(db);
    const tieEntries = entryIds.map(id => periodEntries.find(entry => entry.id === id));
    if (entryIds.length < 2) return sendJson(res, 400, { error: "至少选择 2 个并列作品" });
    if (tieEntries.some(entry => !entry)) return sendJson(res, 400, { error: "加赛作品无效" });
    const moduleName = MODULE_BY_NAME.has(requestedModuleName) ? requestedModuleName : tieEntries[0].moduleName;
    if (tieEntries.some(entry => entry.moduleName !== moduleName)) return sendJson(res, 400, { error: "加赛作品必须属于同一个模块" });
    if (!isAwardTieGroup(db, moduleName, entryIds)) {
      return sendJson(res, 400, { error: "只有影响获奖名次的平票作品才需要重投" });
    }

    const sortedIds = [...entryIds].sort();
    const signature = sortedIds.join("|");
    const duplicate = currentTiebreakers(db).some(item =>
      item.status === "open" &&
      item.moduleName === moduleName &&
      [...(item.entryIds || [])].sort().join("|") === signature
    );
    if (duplicate) return sendJson(res, 400, { error: "这组并列作品已经在加赛中" });
    const id = hash(`${db.currentPeriodId}|${moduleName}|${sortedIds.join("|")}|${Date.now()}`);
    db.tiebreakers.push({
      id,
      periodId: db.currentPeriodId,
      moduleName,
      entryIds: sortedIds,
      status: "open",
      createdAt: new Date().toISOString()
    });
    writeDb(db);
    sendJson(res, 200, { ok: true, tiebreakerId: id });
    return;
  }

  if (action === "close") {
    const id = normalizeName(payload.tiebreakerId);
    const item = db.tiebreakers.find(tiebreaker => tiebreaker.id === id && (tiebreaker.periodId || db.currentPeriodId) === db.currentPeriodId);
    if (!item) return sendJson(res, 404, { error: "加赛不存在" });
    item.status = "closed";
    item.closedAt = new Date().toISOString();
    writeDb(db);
    sendJson(res, 200, { ok: true });
    return;
  }

  sendJson(res, 400, { error: "未知加赛操作" });
}

async function handleTiebreakerVote(req, res) {
  const payload = await collectJson(req);
  const voter = normalizeName(payload.voter);
  const tiebreakerId = normalizeName(payload.tiebreakerId);
  const entryId = normalizeName(payload.entryId);
  const db = readDb();

  if (!voter) return sendJson(res, 400, { error: "请输入投票人姓名" });
  if (!(db.photographers || []).includes(voter)) return sendJson(res, 403, { error: "姓名不在摄影师名单中，请联系管理员添加" });

  const tiebreaker = currentTiebreakers(db).find(item => item.id === tiebreakerId);
  if (!tiebreaker || tiebreaker.status !== "open") return sendJson(res, 404, { error: "当前没有可投的加赛" });
  if (!tiebreaker.entryIds.includes(entryId)) return sendJson(res, 400, { error: "加赛作品无效" });

  const entry = currentEntries(db).find(item => item.id === entryId);
  if (!entry) return sendJson(res, 400, { error: "加赛作品不存在" });
  const tiedEntries = currentEntries(db).filter(item => tiebreaker.entryIds.includes(item.id));
  if (tiedEntries.some(item => item.photographer === voter)) {
    return sendJson(res, 400, { error: "你有作品在这组并列加赛中，不能参与本组加赛投票" });
  }

  db.tiebreakerBallots ||= [];
  db.tiebreakerBallots = db.tiebreakerBallots.filter(ballot =>
    !(
      ballot.voter === voter &&
      ballot.tiebreakerId === tiebreakerId &&
      (ballot.periodId || db.currentPeriodId) === db.currentPeriodId
    )
  );
  db.tiebreakerBallots.push({
    periodId: db.currentPeriodId,
    tiebreakerId,
    voter,
    entryId,
    createdAt: new Date().toISOString()
  });
  writeDb(db);
  sendJson(res, 200, { ok: true });
}

async function handlePhotographerLogin(req, res) {
  const payload = await collectJson(req);
  const name = normalizeName(payload.name);
  const db = readDb();
  if (!name) return sendJson(res, 400, { error: "请输入自己的姓名" });
  if (!(db.photographers || []).includes(name)) {
    return sendJson(res, 403, { error: "姓名不在摄影师名单中，请联系管理员添加" });
  }
  sendJson(res, 200, { ok: true, name });
}

async function handleDeleteEntry(req, res) {
  const payload = await collectJson(req);
  const entryId = normalizeName(payload.entryId);
  const db = readDb();
  const entry = db.entries.find(item => item.id === entryId);
  const adminRequest = isAdminPayload(payload);
  const voterName = normalizeName(payload.voterName);

  if (!entry) return sendJson(res, 404, { error: "作品不存在" });
  if (db.votingOpen && !adminRequest) {
    return sendJson(res, 403, { error: "投票开始后只有管理员可以删除作品" });
  }
  if (!adminRequest) {
    if (!voterName) return sendJson(res, 403, { error: "请先登录自己的姓名后再删除" });
    if (!(db.photographers || []).includes(voterName)) {
      return sendJson(res, 403, { error: "姓名不在摄影师名单中，请联系管理员添加" });
    }
    if (entry.photographer !== voterName) {
      return sendJson(res, 403, { error: "只能删除自己上传的作品" });
    }
  }

  db.entries = db.entries.filter(item => item.id !== entryId);
  db.ballots = db.ballots
    .map(ballot => ({ ...ballot, entryIds: ballot.entryIds.filter(id => id !== entryId) }))
    .filter(ballot => ballot.entryIds.length > 0);
  db.tiebreakers = (db.tiebreakers || [])
    .map(item => ({ ...item, entryIds: (item.entryIds || []).filter(id => id !== entryId) }))
    .filter(item => item.entryIds.length > 1);
  db.tiebreakerBallots = (db.tiebreakerBallots || []).filter(ballot => ballot.entryId !== entryId);
  writeDb(db);
  removeEntryFiles(entryId);
  sendJson(res, 200, { ok: true });
}

async function handleClearPeriod(req, res) {
  const payload = await collectJson(req);
  if (!isAdminPayload(payload)) return sendJson(res, 403, { error: "管理员口令不正确" });

  const db = readDb();
  const periodId = db.currentPeriodId;
  const removedEntries = currentEntries(db);
  const removedIds = new Set(removedEntries.map(entry => entry.id));

  db.entries = (db.entries || []).filter(entry => (entry.periodId || periodId) !== periodId);
  db.ballots = (db.ballots || []).filter(ballot => (ballot.periodId || periodId) !== periodId);
  db.tiebreakers = (db.tiebreakers || []).filter(item => (item.periodId || periodId) !== periodId);
  db.tiebreakerBallots = (db.tiebreakerBallots || []).filter(ballot => (ballot.periodId || periodId) !== periodId);
  const period = currentPeriod(db);
  period.votingOpen = false;
  period.resultsPublished = false;
  db.votingOpen = false;
  db.resultsPublished = false;
  db.nextSequence = (db.entries || []).reduce((max, entry) => Math.max(max, entry.sequence || 0), 0) + 1;
  writeDb(db);

  for (const entryId of removedIds) removeEntryFiles(entryId);
  sendJson(res, 200, { ok: true, entries: removedEntries.length });
}

async function handleStatusUpdate(req, res) {
  const payload = await collectJson(req);
  if (!isAdminPayload(payload)) return sendJson(res, 403, { error: "管理员口令不正确" });
  const db = readDb();
  const period = currentPeriod(db);
  if (Object.prototype.hasOwnProperty.call(payload, "votingOpen")) {
    period.votingOpen = Boolean(payload.votingOpen);
    if (period.votingOpen) period.resultsPublished = false;
  }
  if (Object.prototype.hasOwnProperty.call(payload, "resultsPublished")) {
    const nextPublished = Boolean(payload.resultsPublished);
    if (nextPublished && period.votingOpen) {
      return sendJson(res, 400, { error: "Voting is still open. Close voting before publishing results." });
    }
    if (nextPublished && !hasAnyCurrentBallot(db)) {
      return sendJson(res, 400, { error: "还没有投票记录，不能公布结果" });
    }
    period.resultsPublished = nextPublished;
  }
  db.votingOpen = Boolean(period.votingOpen);
  db.resultsPublished = Boolean(period.resultsPublished);
  writeDb(db);
  sendJson(res, 200, { ok: true, votingOpen: db.votingOpen, resultsPublished: db.resultsPublished });
}

async function handlePeriodUpdate(req, res) {
  const payload = await collectJson(req);
  if (!isAdminPayload(payload)) return sendJson(res, 403, { error: "绠＄悊鍛樺彛浠や笉姝ｇ‘" });

  const db = readDb();
  const action = normalizeName(payload.action);

  if (action === "createNext") {
    const id = nextPeriodId(db.currentPeriodId);
    let period = db.periods.find(item => item.id === id);
    if (!period) {
      const previous = db.periods.find(item => item.id === db.currentPeriodId);
      period = createPeriod(id, { moduleVoters: previous && previous.moduleVoters });
      db.periods.push(period);
    }
    db.currentPeriodId = period.id;
  } else if (action === "switch") {
    const periodId = normalizeName(payload.periodId);
    if (!db.periods.some(period => period.id === periodId)) {
      return sendJson(res, 404, { error: "璇勪紭鏈堜唤涓嶅瓨鍦?" });
    }
    db.currentPeriodId = periodId;
  } else if (action === "delete") {
    const periodId = normalizeName(payload.periodId);
    if (!db.periods.some(period => period.id === periodId)) {
      return sendJson(res, 404, { error: "评优月份不存在" });
    }
    if (db.periods.length <= 1) {
      return sendJson(res, 400, { error: "至少需要保留一个评优月份" });
    }
    const removedEntries = (db.entries || []).filter(entry => (entry.periodId || db.currentPeriodId) === periodId);
    const removedIds = new Set(removedEntries.map(entry => entry.id));
    db.entries = (db.entries || []).filter(entry => (entry.periodId || db.currentPeriodId) !== periodId);
    db.ballots = (db.ballots || []).filter(ballot => (ballot.periodId || db.currentPeriodId) !== periodId);
    db.tiebreakers = (db.tiebreakers || []).filter(item => (item.periodId || db.currentPeriodId) !== periodId);
    db.tiebreakerBallots = (db.tiebreakerBallots || []).filter(ballot => (ballot.periodId || db.currentPeriodId) !== periodId);
    db.periods = db.periods.filter(period => period.id !== periodId);
    if (db.currentPeriodId === periodId) {
      db.periods.sort((a, b) => b.id.localeCompare(a.id));
      db.currentPeriodId = db.periods[0].id;
    }
    db.nextSequence = (db.entries || []).reduce((max, entry) => Math.max(max, entry.sequence || 0), 0) + 1;
    for (const entryId of removedIds) removeEntryFiles(entryId);
  } else {
    return sendJson(res, 400, { error: "鏈煡鐨勬湀浠芥搷浣?" });
  }

  const period = currentPeriod(db);
  db.votingOpen = Boolean(period.votingOpen);
  db.resultsPublished = Boolean(period.resultsPublished);
  db.periods.sort((a, b) => b.id.localeCompare(a.id));
  writeDb(db);
  sendJson(res, 200, {
    ok: true,
    periods: db.periods,
    currentPeriodId: db.currentPeriodId,
    currentPeriodName: period.name,
    votingOpen: db.votingOpen,
    resultsPublished: db.resultsPublished
  });
}

async function handlePhotographerUpdate(req, res) {
  const payload = await collectJson(req);
  if (!isAdminPayload(payload)) return sendJson(res, 403, { error: "管理员口令不正确" });

  const name = normalizeName(payload.name);
  const action = normalizeName(payload.action);
  const db = readDb();
  db.photographers ||= [];

  if (!name) return sendJson(res, 400, { error: "请输入摄影师姓名" });

  if (action === "delete") {
    db.photographers = db.photographers.filter(item => item !== name);
  } else {
    if (!db.photographers.includes(name)) db.photographers.push(name);
    db.photographers.sort((a, b) => a.localeCompare(b, "zh-CN"));
  }

  writeDb(db);
  sendJson(res, 200, { ok: true, photographers: db.photographers });
}

function votingStatusFor(db) {
  const period = currentPeriod(db);
  const moduleVoters = period.moduleVoters || {};
  const votedByModule = {};
  for (const ballot of currentBallots(db)) {
    (votedByModule[ballot.moduleName] ||= new Set()).add(ballot.voter);
  }
  let allDone = true;
  const modules = MODULES.map(module => {
    const expected = Array.isArray(moduleVoters[module.name]) ? moduleVoters[module.name] : [];
    const votedSet = votedByModule[module.name] || new Set();
    const voted = expected.filter(name => votedSet.has(name));
    const notVoted = expected.filter(name => !votedSet.has(name));
    const extra = [...votedSet].filter(name => !expected.includes(name));
    if (notVoted.length) allDone = false;
    return {
      id: module.id,
      name: module.name,
      voteLimit: module.voteLimit,
      expected,
      voted,
      notVoted,
      extra
    };
  });
  const hasAnyExpected = modules.some(item => item.expected.length);
  return { modules, allDone: hasAnyExpected && allDone, hasAnyExpected };
}

function isVotingFullyCompleted(db) {
  const status = votingStatusFor(db);
  return Boolean(db.votingOpen && status.hasAnyExpected && status.allDone);
}

async function handleModuleVotersUpdate(req, res) {
  const payload = await collectJson(req);
  if (!isAdminPayload(payload)) return sendJson(res, 403, { error: "管理员口令不正确" });

  const moduleName = normalizeName(payload.moduleName);
  if (!MODULE_BY_NAME.has(moduleName)) return sendJson(res, 400, { error: "模块不存在" });
  const voters = Array.isArray(payload.voters)
    ? [...new Set(payload.voters.map(normalizeName).filter(Boolean))]
    : [];

  const db = readDb();
  const period = currentPeriod(db);
  period.moduleVoters ||= {};
  const roster = new Set(db.photographers || []);
  const filtered = voters.filter(name => roster.has(name));
  if (filtered.length) period.moduleVoters[moduleName] = filtered;
  else delete period.moduleVoters[moduleName];

  writeDb(db);
  sendJson(res, 200, { ok: true, moduleVoters: period.moduleVoters, status: votingStatusFor(db) });
}

function handleApi(req, res) {
  const url = new URL(req.url, "http://localhost");
  const db = readDb();

  if (req.method === "GET" && url.pathname === "/api/modules") {
    const counts = {};
    for (const entry of currentEntries(db)) counts[entry.moduleName] = (counts[entry.moduleName] || 0) + 1;
    sendJson(res, 200, { modules: MODULES.map(module => ({ ...module, entryCount: counts[module.name] || 0 })) });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/system") {
    const db = readDb();
    const period = currentPeriod(db);
    sendJson(res, 200, {
      votingOpen: db.votingOpen,
      resultsPublished: db.resultsPublished,
      periods: db.periods,
      currentPeriodId: db.currentPeriodId,
      currentPeriodName: period.name,
      adminReady: Boolean(ADMIN_CODE),
      dataDir: DATA_DIR,
      uploadLimitMB: MAX_UPLOAD_MB,
      maxFilesPerUpload: MAX_FILES_PER_UPLOAD,
      optimizeQueue: optimizeQueueState(),
      storage: {
        directUpload: storageConfigured(),
        provider: storageConfigured() ? "s3" : "local",
        addressingStyle: storageConfigured() ? STORAGE_ADDRESSING_STYLE : "local"
      },
      optimization: {
        images: true,
        videos: HAS_FFMPEG,
        imageMode: "小图直接展示，大图生成WebP展示版，保留原图",
        videoMode: "原视频直传对象存储，上传后不经过 Zeabur 转码",
        videoDisplay: {
          width: VIDEO_DISPLAY_WIDTH,
          height: VIDEO_DISPLAY_HEIGHT,
          bitrate: VIDEO_DISPLAY_BITRATE,
          audioBitrate: VIDEO_DISPLAY_AUDIO_BITRATE
        }
      }
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/media-proxy") {
    handleMediaProxy(req, res, url);
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/photographers") {
    if (!canViewAdmin(url)) return sendJson(res, 403, { error: "管理员口令不正确" });
    sendJson(res, 200, { photographers: db.photographers || [] });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/entries") {
    const viewerName = normalizeName(url.searchParams.get("voterName"));
    const view = canViewAdmin(url) ? publicEntry : entry => voterEntry(entry, viewerName);
    const entries = currentEntries(db).map(view).sort((a, b) => a.sequence - b.sequence);
    sendJson(res, 200, { modules: MODULES, entries });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/results") {
    const adminView = canViewAdmin(url);
    if (!adminView && !db.resultsPublished) {
      sendJson(res, 200, { results: [], hidden: true });
      return;
    }
    const counts = {};
    for (const ballot of currentBallots(db)) {
      for (const entryId of ballot.entryIds) counts[entryId] = (counts[entryId] || 0) + 1;
    }
    const tiebreakerCounts = tiebreakerCountsFor(db);
    const view = adminView ? publicEntry : publishedEntry;
    const results = currentEntries(db).map(entry => ({
      ...view(entry),
      votes: counts[entry.id] || 0,
      tiebreakerVotes: tiebreakerCounts[entry.id] || 0
    }));
    sendJson(res, 200, { results });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/tiebreakers") {
    const viewerName = normalizeName(url.searchParams.get("voterName"));
    const adminView = canViewAdmin(url);
    if (!adminView && !db.resultsPublished) {
      sendJson(res, 200, { tiebreakers: [] });
      return;
    }
    const periodEntries = currentEntries(db);
    const voteCounts = voteCountsFor(db);
    const counts = tiebreakerCountsFor(db);
    const myVotes = new Map(
      currentTiebreakerBallots(db)
        .filter(ballot => viewerName && ballot.voter === viewerName)
        .map(ballot => [ballot.tiebreakerId, ballot.entryId])
    );
    const tiebreakers = currentTiebreakers(db).map(item => ({
      ...item,
      entries: item.entryIds
        .map(id => periodEntries.find(entry => entry.id === id))
        .filter(Boolean)
        .map(entry => ({
          ...(adminView ? publicEntry(entry) : voterEntry(entry, viewerName)),
          votes: voteCounts[entry.id] || 0,
          tiebreakerVotes: counts[entry.id] || 0
        })),
      myEntryId: myVotes.get(item.id) || ""
    }));
    sendJson(res, 200, { tiebreakers });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/ballots") {
    const voter = normalizeName(url.searchParams.get("voter"));
    const periodBallots = currentBallots(db);
    const ballots = canViewAdmin(url) && !voter
      ? periodBallots
      : periodBallots.filter(ballot => ballot.voter === voter);
    sendJson(res, 200, { ballots });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/admin/voting-status") {
    if (!canViewAdmin(url)) {
      sendJson(res, 403, { error: "管理员口令不正确" });
      return;
    }
    const period = currentPeriod(db);
    sendJson(res, 200, { status: votingStatusFor(db), moduleVoters: period.moduleVoters || {} });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/admin/archive") {
    handleAdminArchive(req, res, url);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/upload") {
    handleUpload(req, res).catch(error => sendJson(res, 400, { error: error.message }));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/upload/preview-owner") {
    handleUploadPreviewOwner(req, res).catch(error => sendJson(res, 400, { error: error.message }));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/storage/sign") {
    handleStorageSign(req, res).catch(error => sendJson(res, 400, { error: error.message }));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/storage/complete") {
    handleStorageComplete(req, res).catch(error => sendJson(res, 400, { error: error.message }));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/admin/restore-db") {
    handleAdminRestoreDb(req, res).catch(error => sendJson(res, 400, { error: error.message }));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/admin/optimize-videos") {
    handleVideoOptimize(req, res).catch(error => sendJson(res, 400, { error: error.message }));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/admin/optimize-images") {
    handleImageOptimize(req, res).catch(error => sendJson(res, 400, { error: error.message }));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/admin/migrate-media-urls") {
    handleMigrateMediaUrls(req, res).catch(error => sendJson(res, 400, { error: error.message }));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/login") {
    handlePhotographerLogin(req, res).catch(error => sendJson(res, 400, { error: error.message }));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/vote") {
    handleVote(req, res).catch(error => sendJson(res, 400, { error: error.message }));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/tiebreakers") {
    handleTiebreakerUpdate(req, res).catch(error => sendJson(res, 400, { error: error.message }));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/tiebreaker-vote") {
    handleTiebreakerVote(req, res).catch(error => sendJson(res, 400, { error: error.message }));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/delete-entry") {
    handleDeleteEntry(req, res).catch(error => sendJson(res, 400, { error: error.message }));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/clear-period") {
    handleClearPeriod(req, res).catch(error => sendJson(res, 400, { error: error.message }));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/status") {
    handleStatusUpdate(req, res).catch(error => sendJson(res, 400, { error: error.message }));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/photographers") {
    handlePhotographerUpdate(req, res).catch(error => sendJson(res, 400, { error: error.message }));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/admin/module-voters") {
    handleModuleVotersUpdate(req, res).catch(error => sendJson(res, 400, { error: error.message }));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/periods") {
    handlePeriodUpdate(req, res).catch(error => sendJson(res, 400, { error: error.message }));
    return;
  }

  sendJson(res, 404, { error: "Not found" });
}

http.createServer((req, res) => {
  if (req.url.startsWith("/api/")) {
    handleApi(req, res);
  } else {
    handleStatic(req, res);
  }
}).listen(PORT, () => {
  console.log(`Photo review board running at http://localhost:${PORT}`);
});
