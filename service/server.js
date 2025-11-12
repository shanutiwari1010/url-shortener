const express = require("express");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const dotenv = require("dotenv");

dotenv.config();

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
const DATA_FILE = "./urls.json";
const URL_TTL_DAYS = Number.parseInt(process.env.URL_TTL_DAYS ?? "", 10) || 7;
const CLEANUP_INTERVAL_MS =
  Number.parseInt(process.env.CLEANUP_INTERVAL_MS ?? "", 10) || 1000 * 60 * 10;

// In-memory cache (fast O(1) lookups)
const urlMap = new Map(); // code -> { longUrl, createdAt, expiresAt }
const reverseMap = new Map(); // longUrl -> code

const now = () => new Date();

let saveTimeout;
function scheduleSave() {
  clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => {
    const arr = Array.from(urlMap.entries()).map(
      ([code, { longUrl, createdAt, expiresAt }]) => ({
        code,
        longUrl,
        createdAt,
        expiresAt,
      })
    );
    fs.writeFile(DATA_FILE, JSON.stringify(arr, null, 2), (err) => {
      if (err) console.error("❌ Error saving data:", err);
    });
  }, 500);
}

function purgeExpired() {
  let purged = 0;
  const nowTs = now().getTime();
  for (const [code, entry] of urlMap.entries()) {
    if (entry.expiresAt && new Date(entry.expiresAt).getTime() <= nowTs) {
      urlMap.delete(code);
      reverseMap.delete(entry.longUrl);
      purged += 1;
    }
  }
  if (purged) {
    console.log(`🧹 Purged ${purged} expired entries`);
    scheduleSave();
  }
}

function loadFromFile() {
  if (!fs.existsSync(DATA_FILE)) return;
  try {
    const raw = fs.readFileSync(DATA_FILE, "utf-8");
    const parsed = JSON.parse(raw);
    let loaded = 0;
    for (const entry of parsed) {
      const createdAt = entry.createdAt || now().toISOString();
      const createdTime = new Date(createdAt).getTime();
      if (Number.isNaN(createdTime)) {
        return;
      }
      const expiresAt =
        entry.expiresAt ||
        new Date(
          createdTime + URL_TTL_DAYS * 24 * 60 * 60 * 1000
        ).toISOString();
      if (new Date(expiresAt).getTime() > now().getTime()) {
        urlMap.set(entry.code, {
          longUrl: entry.longUrl,
          createdAt,
          expiresAt,
        });
        reverseMap.set(entry.longUrl, entry.code);
        loaded += 1;
      }
    }
    console.log(`✅ Loaded ${loaded} active URLs from JSON`);
  } catch (err) {
    console.error("⚠️ Failed to load URLs:", err.message);
  }
}

loadFromFile();
purgeExpired();
setInterval(purgeExpired, CLEANUP_INTERVAL_MS).unref();

const ALPHABET =
  "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
function base62Encode(num) {
  if (num === 0) return "0";
  let s = "";
  while (num > 0) {
    s = ALPHABET[num % 62] + s;
    num = Math.floor(num / 62);
  }
  return s;
}

function generateShortCode(url) {
  const hash = crypto.createHash("sha256").update(url).digest("hex");
  const num = Number.parseInt(hash.slice(0, 8), 16);
  return base62Encode(num).slice(0, 6);
}

function createEntry(code, longUrl, ttlDays = URL_TTL_DAYS) {
  const nowDate = now();
  const createdAt = nowDate.toISOString();
  const expiresAt = new Date(
    nowDate.getTime() + ttlDays * 24 * 60 * 60 * 1000
  ).toISOString();
  urlMap.set(code, { longUrl, createdAt, expiresAt });
  reverseMap.set(longUrl, code);
  scheduleSave();
  return { code, longUrl, createdAt, expiresAt };
}

function isValidCustomCode(code) {
  return /^[a-zA-Z0-9_-]{3,32}$/.test(code);
}

function normalizeUrl(u) {
  try {
    const url = new URL(u);
    if (!["http:", "https:"].includes(url.protocol)) return null;
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

app.post("/shorten", (req, res) => {
  purgeExpired();
  const { url, customCode, ttlDays } = req.body ?? {};
  if (!url) return res.status(400).json({ error: "URL required" });

  const normalized = normalizeUrl(url);
  if (!normalized) return res.status(400).json({ error: "Invalid URL" });

  if (customCode) {
    if (!isValidCustomCode(customCode)) {
      return res.status(400).json({
        error:
          "Custom code must be 3-32 characters (letters, numbers, '_' or '-')",
      });
    }
    const existing = urlMap.get(customCode);
    if (existing) {
      const expired =
        existing.expiresAt && new Date(existing.expiresAt) <= now();
      if (!expired) {
        return res
          .status(409)
          .json({ error: "Custom code already in use", code: customCode });
      }
      urlMap.delete(customCode);
      reverseMap.delete(existing.longUrl);
    }
  }

  const existingCode = reverseMap.get(normalized);
  if (existingCode) {
    const entry = urlMap.get(existingCode);
    if (entry) {
      return res.json({
        shortUrl: `${BASE_URL}/${existingCode}`,
        longUrl: entry.longUrl,
        createdAt: entry.createdAt,
        expiresAt: entry.expiresAt,
      });
    }
  }

  const ttlValue = Number(ttlDays);
  const ttl = Number.isFinite(ttlValue)
    ? Math.max(1, Math.min(365, ttlValue))
    : URL_TTL_DAYS;

  let code = customCode || generateShortCode(`${normalized}:${Date.now()}`);
  while (urlMap.has(code)) {
    code = generateShortCode(`${normalized}:${crypto.randomUUID()}`);
  }

  const entry = createEntry(code, normalized, ttl);

  console.log(`🪄 Shortened: ${normalized} → ${code}`);
  res.json({
    shortUrl: `${BASE_URL}/${code}`,
    longUrl: normalized,
    createdAt: entry.createdAt,
    expiresAt: entry.expiresAt,
  });
});

app.get("/:code", (req, res) => {
  purgeExpired();
  const code = req.params.code.trim();
  const entry = urlMap.get(code);

  if (!entry) {
    return res.status(404).send("Not found");
  }

  console.log(`➡️ Redirect: ${code} → ${entry.longUrl}`);
  return res.redirect(301, entry.longUrl);
});

// --- Health endpoint ---
app.get("/health", (req, res) => {
  purgeExpired();
  res.json({ ok: true, total: urlMap.size, ttlDays: URL_TTL_DAYS });
});

// --- Start Server ---
app.listen(PORT, () => {
  console.log(`🚀 URL Shortener running at ${BASE_URL}`);
});
