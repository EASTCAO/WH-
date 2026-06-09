const fs = require("fs");
const path = require("path");

const DB_PATH = process.env.RESTORE_DB || path.join(process.cwd(), "data", "restore-2026-05-db.json");
const BASE_URL = process.env.BASE_URL || "https://whsj-photo-review.zeabur.app";
const CHUNK_SIZE = Number(process.env.REGISTER_CHUNK_SIZE || 80);

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

function toCompleteFiles(db) {
  const files = [];
  for (const entry of db.entries || []) {
    for (const media of entry.media || []) {
      files.push({
        id: media.id,
        publicUrl: media.src,
        entryId: entry.id,
        periodId: entry.periodId,
        moduleId: entry.moduleId,
        moduleName: entry.moduleName,
        moduleKind: entry.moduleKind,
        photographer: entry.photographer,
        sku: entry.sku,
        title: entry.title,
        kind: media.kind,
        name: media.name
      });
    }
  }
  return files;
}

async function main() {
  const db = JSON.parse(fs.readFileSync(DB_PATH, "utf8"));
  const files = toCompleteFiles(db);
  let done = 0;
  for (let index = 0; index < files.length; index += CHUNK_SIZE) {
    const chunk = files.slice(index, index + CHUNK_SIZE);
    const result = await fetchJson(`${BASE_URL}/api/storage/complete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ files: chunk })
    });
    done += result.media || 0;
    console.log(`登记 ${Math.min(index + CHUNK_SIZE, files.length)}/${files.length}，本批 ${result.media || 0}，累计 ${done}`);
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
