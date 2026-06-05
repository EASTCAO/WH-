const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const childProcess = require("child_process");
const sharp = require("sharp");

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
    createdAt: source.createdAt || new Date().toISOString()
  };
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
  db.votingOpen = Boolean(current.votingOpen);
  db.resultsPublished = Boolean(current.resultsPublished);
  db.periods.sort((a, b) => b.id.localeCompare(a.id));
  return current;
}

function currentEntries(db) {
  return (db.entries || []).filter(entry => (entry.periodId || db.currentPeriodId) === db.currentPeriodId);
}

function currentBallots(db) {
  return (db.ballots || []).filter(ballot => (ballot.periodId || db.currentPeriodId) === db.currentPeriodId);
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

function collectJson(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", chunk => {
      body += chunk;
      if (body.length > MAX_UPLOAD_BYTES) {
        reject(new Error(`上传内容太大，单次限制约 ${MAX_UPLOAD_MB}MB`));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
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

function parseSkuAndTitle(folderName) {
  const clean = normalizeName(folderName);
  const match = clean.match(/^([A-Za-z0-9][A-Za-z0-9_]{1,40})(?:[\s_-]+(.+))?$/);
  if (!match) return { sku: clean || "未识别SKU", title: clean || "未命名作品" };
  return {
    sku: match[1],
    title: match[2] ? match[2].replace(/^[-_\s]+/, "") : clean
  };
}

function isExcludedUploadPath(relativePath) {
  return relativePath
    .split(/[\\/]+/)
    .some(part => EXCLUDED_UPLOAD_KEYWORDS.some(keyword => part.includes(keyword)));
}

function knownPhotographerName(values, photographers) {
  const list = Array.isArray(photographers) ? photographers.filter(Boolean) : [];
  const exact = list.find(name => values.some(value => normalizeName(value) === name));
  if (exact) return exact;
  const text = values.map(value => normalizeName(value)).join(" ");
  return list.find(name => text.includes(name)) || "";
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
  return {
    id: entry.id,
    moduleId: entry.moduleId || entry.board,
    moduleName: entry.moduleName || entry.board,
    moduleKind: entry.moduleKind || "image",
    photographer: entry.photographer,
    sku: entry.sku,
    title: entry.title,
    sequence: entry.sequence || 0,
    mediaCount: media.length,
    imageCount: media.filter(item => item.kind === "image").length,
    videoCount: media.filter(item => item.kind === "video").length,
    media,
    createdAt: entry.createdAt
  };
}

function voterMedia(entry) {
  const media = entry.media || (entry.images || []).map(src => ({ src, kind: "image" }));
  return media.map(item => ({
    src: item.src,
    kind: item.kind
  }));
}

function voterEntry(entry) {
  const media = voterMedia(entry);
  return {
    id: entry.id,
    moduleId: entry.moduleId || entry.board,
    moduleName: entry.moduleName || entry.board,
    moduleKind: entry.moduleKind || "image",
    sku: entry.sku,
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

async function createOptimizedMedia(sourcePath, ext, mediaKind) {
  if (mediaKind === "image") {
    const browserReadyTypes = new Set([".jpg", ".jpeg", ".jfif", ".png", ".webp", ".gif", ".avif"]);
    const fileSize = fs.statSync(sourcePath).size;
    if (browserReadyTypes.has(ext) && fileSize <= IMAGE_OPTIMIZE_MIN_BYTES) {
      return sourcePath;
    }

    const targetPath = sourcePath.slice(0, -ext.length) + ".webp";
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
    const targetPath = sourcePath.slice(0, -ext.length) + ".mp4";
    await runTool(FFMPEG_PATH, [
      "-y",
      "-i", sourcePath,
      "-map_metadata", "-1",
      "-c:v", "libx264",
      "-preset", VIDEO_PRESET,
      "-crf", "20",
      "-c:a", "aac",
      "-b:a", "160k",
      "-movflags", "+faststart",
      targetPath
    ]);
    return targetPath;
  }

  return sourcePath;
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

  fs.readFile(filePath, (error, data) => {
    if (error) {
      sendText(res, 404, "Not found");
      return;
    }
    res.writeHead(200, { "Content-Type": contentTypeFor(filePath) });
    res.end(data);
  });
}

async function handleUpload(req, res) {
  const payload = await collectJson(req);
  const files = Array.isArray(payload.files) ? payload.files : [];
  const fallbackModuleName = MODULE_BY_NAME.has(payload.moduleName) ? payload.moduleName : MODULES[0].name;
  const dbSnapshot = readDb();
  const periodId = dbSnapshot.currentPeriodId;
  const photographers = dbSnapshot.photographers || [];
  const grouped = new Map();

  if (files.length > MAX_FILES_PER_UPLOAD) {
    return sendJson(res, 400, { error: `单次最多上传 ${MAX_FILES_PER_UPLOAD} 个文件` });
  }

  for (const file of files) {
    const relativePath = normalizeName(file.relativePath || file.name);
    const ext = path.extname(relativePath).toLowerCase();
    if (!MEDIA_TYPES.has(ext) || !file.data) continue;
    if (isExcludedUploadPath(relativePath)) continue;

    const info = parseUploadPath(relativePath, fallbackModuleName);
    const knownPhotographer = knownPhotographerName([info.photographer, info.workFolder, info.sku, info.title, relativePath], photographers);
    if (knownPhotographer) info.photographer = knownPhotographer;
    if (!knownPhotographer && !photographers.includes(info.photographer)) info.photographer = "未识别摄影师";
    const expectedKind = MODULE_BY_NAME.get(info.moduleName)?.kind;
    const mediaKind = IMAGE_TYPES.has(ext) ? "image" : VIDEO_TYPES.has(ext) ? "video" : "file";
    if (!MODULE_BY_NAME.has(info.moduleName)) continue;
    if (expectedKind && expectedKind !== mediaKind) continue;

    const key = `${periodId}|${info.moduleName}|${info.photographer}|${info.sku}|${info.title}`;
    if (!grouped.has(key)) grouped.set(key, { ...info, files: [] });
    grouped.get(key).files.push({ ...file, relativePath, ext, mediaKind });
  }

  let mediaTotal = 0;
  const uploadNonce = crypto.randomBytes(6).toString("hex");
  const processedGroups = [];

  for (const group of grouped.values()) {
    const id = hash(`${periodId}|${group.moduleName}|${group.photographer}|${group.sku}|${group.title}`);
    const entryDir = path.join(UPLOAD_DIR, id);
    fs.mkdirSync(entryDir, { recursive: true });
    const media = [];

    for (const [index, file] of group.files.entries()) {
      const buffer = Buffer.from(String(file.data).split(",").pop(), "base64");
      const serial = String(mediaTotal + index + 1).padStart(3, "0");
      const filename = `${safeSegment(group.sku)}_${uploadNonce}_${serial}${file.ext}`;
      const originalFilename = `original_${filename}`;
      const originalDiskPath = path.join(entryDir, originalFilename);
      fs.writeFileSync(originalDiskPath, buffer);

      let displayDiskPath = originalDiskPath;
      try {
        displayDiskPath = await createOptimizedMedia(originalDiskPath, file.ext, file.mediaKind);
      } catch (error) {
        console.warn(`Optimize failed for ${originalFilename}: ${error.message}`);
      }

      const displayFilename = path.basename(displayDiskPath);
      media.push({
        src: `/data/uploads/${id}/${displayFilename}`,
        originalSrc: `/data/uploads/${id}/${originalFilename}`,
        kind: file.mediaKind,
        name: file.name || path.basename(file.relativePath),
        optimized: displayDiskPath !== originalDiskPath
      });
      mediaTotal += 1;
    }

    processedGroups.push({ ...group, id, periodId, media });
  }

  await withDbWriteLock(async () => {
    const db = readDb();
    for (const group of processedGroups) {
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

  sendJson(res, 200, { ok: true, entries: grouped.size, media: mediaTotal });
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

  if (!entry) return sendJson(res, 404, { error: "作品不存在" });
  if (db.votingOpen && !isAdminPayload(payload)) {
    return sendJson(res, 403, { error: "投票开始后只有管理员可以删除作品" });
  }

  db.entries = db.entries.filter(item => item.id !== entryId);
  db.ballots = db.ballots
    .map(ballot => ({ ...ballot, entryIds: ballot.entryIds.filter(id => id !== entryId) }))
    .filter(ballot => ballot.entryIds.length > 0);
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
  if (Object.prototype.hasOwnProperty.call(payload, "votingOpen")) period.votingOpen = Boolean(payload.votingOpen);
  if (Object.prototype.hasOwnProperty.call(payload, "resultsPublished")) period.resultsPublished = Boolean(payload.resultsPublished);
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
      period = createPeriod(id);
      db.periods.push(period);
    }
    db.currentPeriodId = period.id;
  } else if (action === "switch") {
    const periodId = normalizeName(payload.periodId);
    if (!db.periods.some(period => period.id === periodId)) {
      return sendJson(res, 404, { error: "璇勪紭鏈堜唤涓嶅瓨鍦?" });
    }
    db.currentPeriodId = periodId;
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
      optimization: {
        images: true,
        videos: HAS_FFMPEG,
        imageMode: "小图直接展示，大图生成WebP展示版，保留原图",
        videoMode: HAS_FFMPEG ? "MP4展示版，保留原视频" : "未启用：未检测到 ffmpeg"
      }
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/photographers") {
    if (!canViewAdmin(url)) return sendJson(res, 403, { error: "管理员口令不正确" });
    sendJson(res, 200, { photographers: db.photographers || [] });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/entries") {
    const view = canViewAdmin(url) ? publicEntry : voterEntry;
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
    const view = adminView ? publicEntry : publishedEntry;
    const results = currentEntries(db).map(entry => ({ ...view(entry), votes: counts[entry.id] || 0 }));
    sendJson(res, 200, { results });
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

  if (req.method === "POST" && url.pathname === "/api/upload") {
    handleUpload(req, res).catch(error => sendJson(res, 400, { error: error.message }));
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
