const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const dataDir = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(root, "data");
const uploadDir = path.join(dataDir, "uploads");
const dbPath = path.join(dataDir, "db.json");
const seedPhotographersPath = path.join(root, "data", "photographers.json");
const clearPhotographers = process.env.CLEAR_PHOTOGRAPHERS === "1" || process.argv.includes("--clear-photographers");

function currentPeriodId(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function periodName(id) {
  const [year, month] = String(id).split("-");
  return `${year}年${Number(month)}月评优`;
}

function isInside(baseDir, filePath) {
  const relative = path.relative(baseDir, filePath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function existingPhotographers() {
  if (clearPhotographers || !fs.existsSync(dbPath)) return [];
  try {
    const db = JSON.parse(fs.readFileSync(dbPath, "utf8"));
    return Array.isArray(db.photographers) ? db.photographers : [];
  } catch {
    return [];
  }
}

function seedPhotographers() {
  if (!fs.existsSync(seedPhotographersPath)) return [];
  try {
    const names = JSON.parse(fs.readFileSync(seedPhotographersPath, "utf8"));
    if (!Array.isArray(names)) return [];
    return [...new Set(names.map(name => String(name || "").trim()).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, "zh-CN"));
  } catch {
    return [];
  }
}

if (dataDir === path.parse(dataDir).root) {
  throw new Error(`Refuse to reset root data directory: ${dataDir}`);
}

if (!isInside(dataDir, uploadDir)) {
  throw new Error(`Upload directory is outside data directory: ${uploadDir}`);
}

const periodId = currentPeriodId();
const db = {
  entries: [],
  ballots: [],
  photographers: existingPhotographers().length ? existingPhotographers() : seedPhotographers(),
  periods: [
    {
      id: periodId,
      name: periodName(periodId),
      votingOpen: false,
      resultsPublished: false,
      createdAt: new Date().toISOString()
    }
  ],
  currentPeriodId: periodId,
  nextSequence: 1,
  votingOpen: false,
  resultsPublished: false
};

fs.mkdirSync(dataDir, { recursive: true });
fs.rmSync(uploadDir, { recursive: true, force: true });
fs.mkdirSync(uploadDir, { recursive: true });
fs.writeFileSync(dbPath, JSON.stringify(db, null, 2), "utf8");

console.log(`Reset data at ${dataDir}`);
