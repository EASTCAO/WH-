const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const ROOT = process.env.UPLOAD_ROOT || "C:/Users/admin/Desktop/新建文件夹 (2)";
const VARS_PATH = process.env.ZEABUR_VARS_JSON || path.join(process.env.TEMP || process.env.TMP || ".", "zeabur-vars.json");
const PERIOD_ID = "2026-05";
const DRY_RUN = process.argv.includes("--dry-run");

const photographers = [
  "周旭欣", "曹东", "曹玉", "程思盈", "程维跃", "陈梦轲", "陈思", "陈洋", "樊瑾怡", "付国俊",
  "郭海英", "郭卢彤", "何丽源", "何雨涵", "胡敏雯", "胡长浪", "李冬梅", "李梦涵", "刘朝洋", "刘格",
  "刘家其", "刘欣悦", "罗暄", "卢圣林", "吕书悦", "吕文祎", "阮静", "沈磊", "孙焱林", "谭金林",
  "汤诗槐", "涂萱", "王斐雯", "王思琪", "王羽", "王玉婷", "王子一", "魏钰涵", "於佳莹", "吴语琳",
  "夏驰", "向纯希", "向芷琪", "夏姝敏", "杨丽", "鄢军", "曾雪萍", "张阳洋", "张玉洁", "周逸雪", "周梓君"
];

const moduleFolders = [
  { folder: "图片（AI）", moduleName: "图片（AI）", moduleId: "image-ai", kind: "image", nested: true },
  { folder: "图片（实拍）", moduleName: "图片（实拍）", moduleId: "image-real", kind: "image", nested: true },
  { folder: "图片助理", moduleName: "图片助理", moduleId: "image-assistant", kind: "image", nested: false },
  { folder: "视频（卖点）", moduleName: "视频（卖点）", moduleId: "video-selling", kind: "video", nested: false },
  { folder: "视频（质量）", moduleName: "视频（质量）", moduleId: "video-quality", kind: "video", nested: false },
  { folder: "简易视频", moduleName: "简易视频", moduleId: "simple-video", kind: "video", nested: false },
  { folder: "ai视频组", moduleName: "AI视频", moduleId: "ai-video", kind: "video", nested: false },
  { folder: "视频助理", moduleName: "视频助理", moduleId: "video-assistant", kind: "video", nested: false }
];

const imageExt = new Set([".jpg", ".jpeg", ".png", ".webp"]);
const videoExt = new Set([".mp4", ".mov", ".avi", ".mkv"]);
const mediaExt = new Set([...imageExt, ".gif", ...videoExt]);

function normalizeName(value) {
  return String(value || "").trim();
}

function safeSegment(value) {
  return normalizeName(value).replace(/[<>:"/\\|?*\x00-\x1F]/g, "_").slice(0, 80) || "未命名";
}

function hash(input) {
  return crypto.createHash("sha1").update(input).digest("hex").slice(0, 16);
}

function hmac(key, value, encoding) {
  return crypto.createHmac("sha256", key).update(value, "utf8").digest(encoding);
}

function sha256Hex(value) {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

function s3Date(date = new Date()) {
  const iso = date.toISOString().replace(/[:-]|\.\d{3}/g, "");
  return { amzDate: iso, dateStamp: iso.slice(0, 8) };
}

function encodeS3PathSegment(value) {
  return encodeURIComponent(String(value)).replace(/[!'()*]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

function encodeS3Key(value) {
  return String(value || "").split("/").map(encodeS3PathSegment).join("/");
}

function readVars() {
  let text = fs.readFileSync(VARS_PATH, "utf8");
  if (text.includes("\u0000")) text = fs.readFileSync(VARS_PATH, "utf16le");
  text = text.replace(/^\uFEFF/, "");
  const data = JSON.parse(text);
  const vars = {};
  for (const item of data.variables || []) vars[item.key] = item.value;
  return vars;
}

function signingKey(secret, dateStamp, region) {
  const kDate = hmac(`AWS4${secret}`, dateStamp);
  const kRegion = crypto.createHmac("sha256", kDate).update(region, "utf8").digest();
  const kService = crypto.createHmac("sha256", kRegion).update("s3", "utf8").digest();
  return crypto.createHmac("sha256", kService).update("aws4_request", "utf8").digest();
}

function signedListUrl(vars, continuationToken = "") {
  const endpoint = new URL(vars.STORAGE_ENDPOINT);
  const host = endpoint.host;
  const region = vars.STORAGE_REGION || "auto";
  const { amzDate, dateStamp } = s3Date();
  const credentialScope = `${dateStamp}/${region}/s3/aws4_request`;
  const canonicalUri = `/${encodeS3PathSegment(vars.STORAGE_BUCKET)}`;
  const params = new URLSearchParams({
    "list-type": "2",
    prefix: `${vars.STORAGE_PREFIX || "photo-review"}/${PERIOD_ID}/`,
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": `${vars.STORAGE_ACCESS_KEY_ID}/${credentialScope}`,
    "X-Amz-Date": amzDate,
    "X-Amz-Expires": "900",
    "X-Amz-SignedHeaders": "host"
  });
  if (continuationToken) params.set("continuation-token", continuationToken);
  const canonicalQuery = [...params.entries()]
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .sort()
    .join("&");
  const canonicalRequest = ["GET", canonicalUri, canonicalQuery, `host:${host}\n`, "host", "UNSIGNED-PAYLOAD"].join("\n");
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, credentialScope, sha256Hex(canonicalRequest)].join("\n");
  const signature = hmac(signingKey(vars.STORAGE_SECRET_ACCESS_KEY, dateStamp, region), stringToSign, "hex");
  params.set("X-Amz-Signature", signature);
  const url = new URL(`${endpoint.origin}${canonicalUri}`);
  url.search = params.toString();
  return url.toString();
}

function decodeXml(text, tag) {
  const match = text.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
  return match ? match[1].replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">") : "";
}

async function listR2Keys(vars) {
  const keys = [];
  let token = "";
  do {
    const response = await fetch(signedListUrl(vars, token));
    const text = await response.text();
    if (!response.ok) throw new Error(`R2列表读取失败：${response.status} ${text.slice(0, 200)}`);
    const contents = [...text.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)];
    for (const item of contents) {
      const key = decodeXml(item[1], "Key");
      if (key) keys.push(key);
    }
    const truncated = decodeXml(text, "IsTruncated") === "true";
    token = truncated ? decodeXml(text, "NextContinuationToken") : "";
  } while (token);
  return keys;
}

function listFiles(dir) {
  const output = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) output.push(...listFiles(fullPath));
    else if (mediaExt.has(path.extname(entry.name).toLowerCase())) output.push(fullPath);
  }
  return output;
}

function cleanBaseName(name) {
  return path.parse(name).name.replace(/^[\s①②③④⑤⑥⑦⑧⑨⑩＋+一二三四五六七八九十0-9、.：:-]+/u, "").trim();
}

function extractSku(baseName) {
  const match = baseName.match(/[A-Za-z]{1,8}\d{2,8}/);
  return match ? match[0].toUpperCase() : cleanBaseName(baseName).split(/\s+/)[0] || "UNKNOWN";
}

function extractPhotographer(baseName) {
  const clean = cleanBaseName(baseName);
  const outsideParentheses = clean.replace(/[（(].*?[）)]/g, " ");
  return photographers.find(name => outsideParentheses.includes(name))
    || photographers.find(name => clean.includes(name))
    || "未识别摄影师";
}

function collectWorkDirs(moduleDir, nested) {
  if (!nested) {
    return fs.readdirSync(moduleDir, { withFileTypes: true })
      .filter(item => item.isDirectory())
      .map(item => path.join(moduleDir, item.name));
  }
  const dirs = [];
  for (const first of fs.readdirSync(moduleDir, { withFileTypes: true }).filter(item => item.isDirectory())) {
    const firstPath = path.join(moduleDir, first.name);
    const children = fs.readdirSync(firstPath, { withFileTypes: true }).filter(item => item.isDirectory());
    if (children.length) dirs.push(...children.map(item => path.join(firstPath, item.name)));
    else dirs.push(firstPath);
  }
  return dirs;
}

function collectGroups() {
  const groups = [];
  for (const item of moduleFolders) {
    const moduleDir = path.join(ROOT, item.folder);
    if (!fs.existsSync(moduleDir)) continue;
    if (item.kind === "video") {
      for (const filePath of listFiles(moduleDir).filter(file => videoExt.has(path.extname(file).toLowerCase()))) {
        const base = path.basename(filePath);
        const sku = extractSku(base);
        const photographer = extractPhotographer(base);
        const title = photographer;
        const entryId = hash(`${PERIOD_ID}|${item.moduleName}|${photographer}|${sku}|${title}`);
        groups.push({ ...item, sku, photographer, title, entryId, fileCount: 1 });
      }
    } else {
      for (const workDir of collectWorkDirs(moduleDir, item.nested)) {
        const files = listFiles(workDir).filter(file => imageExt.has(path.extname(file).toLowerCase()));
        if (!files.length) continue;
        const base = path.basename(workDir);
        const sku = extractSku(base);
        const photographer = extractPhotographer(base);
        const title = photographer;
        const entryId = hash(`${PERIOD_ID}|${item.moduleName}|${photographer}|${sku}|${title}`);
        groups.push({ ...item, sku, photographer, title, entryId, fileCount: files.length });
      }
    }
  }
  return groups;
}

function publicUrl(vars, key) {
  return `${vars.STORAGE_PUBLIC_BASE_URL.replace(/\/+$/, "")}/${encodeS3Key(key)}`;
}

function mediaKindFromKey(key) {
  const ext = path.extname(key).toLowerCase();
  return videoExt.has(ext) ? "video" : "image";
}

function buildDb(groups, keys, vars) {
  const byEntry = new Map();
  for (const key of keys) {
    const match = key.match(new RegExp(`^${vars.STORAGE_PREFIX || "photo-review"}/${PERIOD_ID}/([^/]+)/`));
    if (!match) continue;
    if (!byEntry.has(match[1])) byEntry.set(match[1], []);
    byEntry.get(match[1]).push(key);
  }

  const entries = [];
  const missing = [];
  let sequence = 1;
  for (const group of groups) {
    const groupKeys = (byEntry.get(group.entryId) || []).sort();
    if (groupKeys.length < group.fileCount) {
      missing.push(`${group.moduleName} / ${group.sku} ${group.photographer}: R2 ${groupKeys.length}/${group.fileCount}`);
    }
    const selectedKeys = groupKeys.slice(-group.fileCount);
    const media = selectedKeys.map(key => ({
      id: hash(`${group.entryId}|${key}`),
      src: publicUrl(vars, key),
      originalSrc: publicUrl(vars, key),
      kind: mediaKindFromKey(key),
      name: path.basename(key),
      optimized: false,
      processing: false,
      storage: "object"
    }));
    entries.push({
      id: group.entryId,
      periodId: PERIOD_ID,
      moduleId: group.moduleId,
      moduleName: group.moduleName,
      moduleKind: group.kind,
      photographer: group.photographer,
      sku: group.sku,
      title: group.title,
      sequence: sequence++,
      media,
      createdAt: new Date().toISOString()
    });
  }

  return {
    db: {
      entries,
      ballots: [],
      photographers,
      periods: [
        { id: "2026-06", name: "2026年6月评优", votingOpen: false, resultsPublished: false, createdAt: new Date().toISOString() },
        { id: PERIOD_ID, name: "2026年5月评优", votingOpen: false, resultsPublished: false, createdAt: new Date().toISOString() }
      ],
      currentPeriodId: PERIOD_ID,
      nextSequence: entries.length + 1,
      votingOpen: false,
      resultsPublished: false
    },
    missing
  };
}

async function main() {
  const vars = readVars();
  const groups = collectGroups();
  const keys = await listR2Keys(vars);
  const { db, missing } = buildDb(groups, keys, vars);
  const summary = {};
  for (const entry of db.entries) {
    const item = summary[entry.moduleName] || { works: 0, media: 0 };
    item.works += 1;
    item.media += entry.media.length;
    summary[entry.moduleName] = item;
  }
  console.log(JSON.stringify({ r2Keys: keys.length, entries: db.entries.length, summary, missing }, null, 2));
  if (missing.length) process.exit(1);
  if (!DRY_RUN) fs.writeFileSync(path.join(process.cwd(), "data", "restore-2026-05-db.json"), JSON.stringify(db, null, 2));
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
