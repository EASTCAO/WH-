const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

const ROOT = process.env.UPLOAD_ROOT || "C:/Users/admin/Desktop/新建文件夹 (2)";
const BASE_URL = process.env.BASE_URL || "https://whsj-photo-review.zeabur.app";
const DRY_RUN = process.argv.includes("--dry-run");
const START_MODULE = process.env.START_MODULE || "";
const ONLY_WORK = process.env.ONLY_WORK || "";
const CONCURRENCY = Number(process.env.UPLOAD_CONCURRENCY || 4);
const BATCH_SIZE = Number(process.env.UPLOAD_BATCH_SIZE || 100);
const IMAGE_MIN_BYTES = Number(process.env.IMAGE_MIN_MB || 3) * 1024 * 1024;
const IMAGE_MAX_DIMENSION = Number(process.env.IMAGE_MAX_DIMENSION || 2400);
const IMAGE_QUALITY = Number(process.env.IMAGE_QUALITY || 88);

const photographers = [
  "周旭欣", "曹东", "曹玉", "程思盈", "程维跃", "陈梦轲", "陈思", "陈洋", "樊瑾怡", "付国俊",
  "郭海英", "郭卢彤", "何丽源", "何雨涵", "胡敏雯", "胡长浪", "李冬梅", "李梦涵", "刘朝洋", "刘格",
  "刘家其", "刘欣悦", "罗暄", "卢圣林", "吕书悦", "吕文祎", "阮静", "沈磊", "孙焱林", "谭金林",
  "汤诗槐", "涂萱", "王斐雯", "王思琪", "王羽", "王玉婷", "王子一", "魏钰涵", "於佳莹", "吴语琳",
  "夏驰", "向纯希", "向芷琪", "夏姝敏", "杨丽", "鄢军", "曾雪萍", "张阳洋", "张玉洁", "周逸雪", "周梓君"
];

const moduleFolders = [
  { folder: "图片（AI）", moduleName: "图片（AI）", kind: "image", nested: true },
  { folder: "图片（实拍）", moduleName: "图片（实拍）", kind: "image", nested: true },
  { folder: "图片助理", moduleName: "图片助理", kind: "image", nested: false },
  { folder: "视频（卖点）", moduleName: "视频（卖点）", kind: "video", nested: false },
  { folder: "视频（质量）", moduleName: "视频（质量）", kind: "video", nested: false },
  { folder: "简易视频", moduleName: "简易视频", kind: "video", nested: false },
  { folder: "ai视频组", moduleName: "AI视频", kind: "video", nested: false },
  { folder: "视频助理", moduleName: "视频助理", kind: "video", nested: false }
];

const imageExt = new Set([".jpg", ".jpeg", ".png", ".webp"]);
const videoExt = new Set([".mp4", ".mov", ".avi", ".mkv"]);
const mediaExt = new Set([...imageExt, ".gif", ...videoExt]);

function listFiles(dir) {
  const output = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) output.push(...listFiles(fullPath));
    else if (mediaExt.has(path.extname(entry.name).toLowerCase())) output.push(fullPath);
  }
  return output;
}

function contentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".mp4": "video/mp4",
    ".mov": "video/quicktime",
    ".avi": "video/x-msvideo",
    ".mkv": "video/x-matroska"
  }[ext] || "application/octet-stream";
}

function cleanBaseName(name) {
  return path.parse(name).name
    .replace(/^[\s①②③④⑤⑥⑦⑧⑨⑩＋+一二三四五六七八九十0-9、.：:-]+/u, "")
    .trim();
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

function workTitle(sku, photographer) {
  return `${sku} ${photographer}`;
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
    if (START_MODULE && item.moduleName !== START_MODULE) continue;
    const moduleDir = path.join(ROOT, item.folder);
    if (!fs.existsSync(moduleDir)) continue;

    if (item.kind === "video") {
      for (const filePath of listFiles(moduleDir).filter(file => videoExt.has(path.extname(file).toLowerCase()))) {
        const base = path.basename(filePath);
        const sku = extractSku(base);
        const photographer = extractPhotographer(base);
        groups.push({
          moduleName: item.moduleName,
          sku,
          photographer,
          title: workTitle(sku, photographer),
          workName: path.parse(base).name,
          files: [filePath]
        });
      }
      continue;
    }

    for (const workDir of collectWorkDirs(moduleDir, item.nested)) {
      const files = listFiles(workDir).filter(file => imageExt.has(path.extname(file).toLowerCase()));
      if (!files.length) continue;
      const base = path.basename(workDir);
      const sku = extractSku(base);
      const photographer = extractPhotographer(base);
      groups.push({
        moduleName: item.moduleName,
        sku,
        photographer,
        title: workTitle(sku, photographer),
        workName: base,
        files
      });
    }
  }
  return groups;
}

function validateGroups(groups) {
  const errors = [];
  const ownerModule = new Map();
  for (const group of groups) {
    if (group.photographer === "未识别摄影师") errors.push(`未识别摄影师：${group.moduleName} / ${group.workName}`);
    const key = `${group.moduleName}|${group.photographer}`;
    if (ownerModule.has(key)) {
      errors.push(`同一摄影师同一模块多套作品：${key} / ${ownerModule.get(key)} / ${group.workName}`);
    } else {
      ownerModule.set(key, group.workName);
    }
  }
  return errors;
}

function summarize(groups) {
  const map = new Map();
  for (const group of groups) {
    const stats = map.get(group.moduleName) || { works: 0, files: 0, bytes: 0, sample: [] };
    stats.works += 1;
    stats.files += group.files.length;
    stats.bytes += group.files.reduce((sum, file) => sum + fs.statSync(file).size, 0);
    if (stats.sample.length < 5) stats.sample.push(`${group.sku} ${group.photographer}`);
    map.set(group.moduleName, stats);
  }
  return [...map.entries()].map(([moduleName, stats]) => ({
    moduleName,
    works: stats.works,
    files: stats.files,
    mb: Number((stats.bytes / 1024 / 1024).toFixed(1)),
    sample: stats.sample
  }));
}

function normalizedRelativePath(group, filePath) {
  const safeFile = path.basename(filePath);
  return `${group.moduleName}/${group.photographer}/${group.title}/${safeFile}`;
}

async function prepareFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const stat = fs.statSync(filePath);
  if (!imageExt.has(ext) || stat.size < IMAGE_MIN_BYTES) {
    return {
      buffer: fs.readFileSync(filePath),
      name: path.basename(filePath),
      type: contentType(filePath),
      originalSize: stat.size,
      uploadedSize: stat.size
    };
  }

  try {
    const image = sharp(filePath).rotate();
    const metadata = await image.metadata();
    const longest = Math.max(metadata.width || 0, metadata.height || 0);
    const resize = longest > IMAGE_MAX_DIMENSION
      ? { width: metadata.width >= metadata.height ? IMAGE_MAX_DIMENSION : undefined, height: metadata.height > metadata.width ? IMAGE_MAX_DIMENSION : undefined, fit: "inside", withoutEnlargement: true }
      : {};
    const buffer = await image.resize(resize).webp({ quality: IMAGE_QUALITY, effort: 4 }).toBuffer();
    if (buffer.length >= stat.size) {
      return {
        buffer: fs.readFileSync(filePath),
        name: path.basename(filePath),
        type: contentType(filePath),
        originalSize: stat.size,
        uploadedSize: stat.size
      };
    }
    return {
      buffer,
      name: path.basename(filePath).replace(/\.[^.]+$/, ".webp"),
      type: "image/webp",
      originalSize: stat.size,
      uploadedSize: buffer.length
    };
  } catch {
    return {
      buffer: fs.readFileSync(filePath),
      name: path.basename(filePath),
      type: contentType(filePath),
      originalSize: stat.size,
      uploadedSize: stat.size
    };
  }
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = { error: text };
  }
  if (!response.ok) throw new Error(body.error || `请求失败：${response.status}`);
  return body;
}

async function runLimited(items, limit, worker) {
  const queue = items.map((item, index) => ({ item, index }));
  const workers = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    while (queue.length) {
      const next = queue.shift();
      await worker(next.item, next.index);
    }
  });
  await Promise.all(workers);
}

async function uploadBatch(batch, batchNo, batchTotal) {
  const prepared = [];
  let savedBytes = 0;
  for (const item of batch) {
    const file = await prepareFile(item.filePath);
    savedBytes += Math.max(0, file.originalSize - file.uploadedSize);
    const relativePath = normalizedRelativePath(item.group, item.filePath).replace(/\.[^.]+$/, path.extname(file.name));
    prepared.push({ ...item, ...file, relativePath });
  }

  const signFiles = prepared.map(file => ({
    name: file.name,
    relativePath: file.relativePath,
    type: file.type,
    size: file.uploadedSize
  }));
  const signed = await fetchJson(`${BASE_URL}/api/storage/sign`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ moduleName: batch[0].group.moduleName, files: signFiles })
  });
  const signedFiles = signed.files || [];
  const completed = [];
  let done = 0;
  await runLimited(signedFiles, CONCURRENCY, async (signedFile, index) => {
    const source = prepared[index];
    const response = await fetch(signedFile.uploadUrl, {
      method: signedFile.method || "PUT",
      headers: signedFile.contentType ? { "Content-Type": signedFile.contentType } : {},
      body: source.buffer
    });
    if (!response.ok) throw new Error(`R2上传失败：${response.status} ${signedFile.relativePath}`);
    completed.push(signedFile);
    done += 1;
    process.stdout.write(`\r第 ${batchNo}/${batchTotal} 批上传 ${done}/${signedFiles.length}`);
  });
  process.stdout.write("\n");
  const result = await fetchJson(`${BASE_URL}/api/storage/complete`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ files: completed })
  });
  return { ...result, savedBytes };
}

async function uploadGroup(group, groupNo, groupTotal) {
  const batch = group.files.map(filePath => ({ group, filePath }));
  const result = await uploadBatch(batch, groupNo, groupTotal);
  console.log(`完成作品 ${groupNo}/${groupTotal}：${group.moduleName} / ${group.sku} ${group.photographer}，${result.media || 0} 个媒体`);
  return result;
}

async function main() {
  const groups = collectGroups();
  console.log("解析清单：");
  console.log(JSON.stringify(summarize(groups), null, 2));
  const errors = validateGroups(groups);
  if (errors.length) {
    console.error("上传前校验失败：");
    for (const error of errors) console.error(`- ${error}`);
    process.exit(1);
  }
    if (DRY_RUN) return;

  const existingData = await fetchJson(`${BASE_URL}/api/entries?adminCode=${encodeURIComponent(process.env.ADMIN_CODE || "")}`);
  const existingKeys = new Set((existingData.entries || []).map(entry => `${entry.moduleName}|${entry.sku}|${entry.photographer}`));
  const pendingGroups = groups.filter(group => {
    if (ONLY_WORK && !`${group.moduleName} ${group.sku} ${group.photographer}`.includes(ONLY_WORK)) return false;
    return !existingKeys.has(`${group.moduleName}|${group.sku}|${group.photographer}`);
  });
  console.log(`待上传作品：${pendingGroups.length}/${groups.length}`);

  let media = 0;
  let savedBytes = 0;
  for (const [index, group] of pendingGroups.entries()) {
    const result = await uploadGroup(group, index + 1, pendingGroups.length);
    media += result.media || 0;
    savedBytes += result.savedBytes || 0;
    console.log(`累计写入 ${media} 个媒体，压缩减少 ${(savedBytes / 1024 / 1024).toFixed(1)}MB`);
  }
  console.log(`全部上传完成：${groups.length} 套作品，${media} 个媒体。`);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
