import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export class UrlStoreError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "UrlStoreError";
    this.status = status;
  }
}

const DATA_FILE = path.join(process.cwd(), "service", "urls.json");
const DEFAULT_TTL_DAYS =
  Number.parseInt(process.env.URL_TTL_DAYS ?? "", 10) || 7;
const MIN_TTL_DAYS = 1;
const MAX_TTL_DAYS = 365;
const CLEANUP_INTERVAL_MS =
  Number.parseInt(process.env.CLEANUP_INTERVAL_MS ?? "", 10) || 1000 * 60 * 10;

type UrlRecord = {
  code: string;
  longUrl: string;
  createdAt: string;
  expiresAt: string;
};

const urlMap = new Map<string, UrlRecord>();
const reverseMap = new Map<string, string>();

let saveTimer: NodeJS.Timeout | undefined;

const alphabet =
  "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

const now = () => new Date();

function ensureDataFileDir() {
  const dir = path.dirname(DATA_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function scheduleSave() {
  if (saveTimer) {
    clearTimeout(saveTimer);
  }
  saveTimer = setTimeout(() => {
    ensureDataFileDir();
    const payload = JSON.stringify(Array.from(urlMap.values()), null, 2);
    fs.writeFile(DATA_FILE, payload, (err) => {
      if (err) {
        console.error("❌ Failed to persist urls.json:", err);
      }
    });
  }, 400);
}

function base62Encode(num: number) {
  if (Number.isNaN(num) || num < 0) {
    throw new UrlStoreError("Failed to generate a code", 500);
  }
  if (num === 0) return "0";
  let encoded = "";
  let current = num;
  while (current > 0) {
    encoded = alphabet[current % alphabet.length] + encoded;
    current = Math.floor(current / alphabet.length);
  }
  return encoded;
}

function generateShortCode(input: string) {
  const hash = crypto.createHash("sha256").update(input).digest("hex");
  const num = Number.parseInt(hash.slice(0, 10), 16);
  return base62Encode(num).slice(0, 6);
}

function isValidCustomCode(code: unknown): code is string {
  return typeof code === "string" && /^[a-zA-Z0-9_-]{3,32}$/.test(code.trim());
}

function sanitizeCodeInput(code: unknown): string {
  let value: string | undefined;

  if (Array.isArray(code)) {
    value = code[0];
  } else if (typeof code === "string") {
    value = code;
  }

  if (!value || !value.trim()) {
    throw new UrlStoreError("Short code required", 400);
  }

  const trimmed = value.trim();
  if (!/^[a-zA-Z0-9_-]{3,32}$/.test(trimmed)) {
    throw new UrlStoreError("Invalid short code format", 400);
  }

  return trimmed;
}

function normalizeUrl(rawUrl: unknown) {
  if (typeof rawUrl !== "string" || !rawUrl.trim()) {
    throw new UrlStoreError("URL required", 400);
  }
  const trimmed = rawUrl.trim();
  const ensuredProtocol =
    trimmed.startsWith("http://") || trimmed.startsWith("https://")
      ? trimmed
      : `https://${trimmed}`;
  try {
    const parsed = new URL(ensuredProtocol);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      throw new UrlStoreError("Only http and https URLs are supported", 400);
    }
    parsed.hash = "";
    return parsed.toString();
  } catch {
    throw new UrlStoreError("Invalid URL", 400);
  }
}

function clampTtl(ttlDays: unknown) {
  if (ttlDays === undefined || ttlDays === null || ttlDays === "") {
    return DEFAULT_TTL_DAYS;
  }
  const parsed = Number(ttlDays);
  if (!Number.isFinite(parsed)) {
    throw new UrlStoreError("TTL must be a number of days", 400);
  }
  return Math.min(Math.max(Math.floor(parsed), MIN_TTL_DAYS), MAX_TTL_DAYS);
}

function purgeExpired() {
  const nowTs = now().getTime();
  let purged = 0;
  for (const [code, entry] of urlMap.entries()) {
    const expiresTs = new Date(entry.expiresAt).getTime();
    if (Number.isNaN(expiresTs) || expiresTs <= nowTs) {
      urlMap.delete(code);
      reverseMap.delete(entry.longUrl);
      purged += 1;
    }
  }
  if (purged > 0) {
    scheduleSave();
  }
}

function loadFromDisk() {
  if (!fs.existsSync(DATA_FILE)) {
    return;
  }
  try {
    const raw = fs.readFileSync(DATA_FILE, "utf-8");
    const parsed = JSON.parse(raw) as UrlRecord[];
    let loaded = 0;
    for (const entry of parsed) {
      if (!entry.code || !entry.longUrl) continue;
      const createdAt = entry.createdAt ?? now().toISOString();
      const createdTime = new Date(createdAt).getTime();
      if (Number.isNaN(createdTime)) continue;
      const expiresAt =
        entry.expiresAt ??
        new Date(
          createdTime + DEFAULT_TTL_DAYS * 24 * 60 * 60 * 1000
        ).toISOString();
      const expiresTime = new Date(expiresAt).getTime();
      if (!Number.isNaN(expiresTime) && expiresTime > now().getTime()) {
        const record: UrlRecord = {
          code: entry.code,
          longUrl: entry.longUrl,
          createdAt,
          expiresAt,
        };
        urlMap.set(record.code, record);
        reverseMap.set(record.longUrl, record.code);
        loaded += 1;
      }
    }
    if (loaded > 0) {
      console.log(`✅ Loaded ${loaded} active URLs from ${DATA_FILE}`);
    }
  } catch (error) {
    console.error("⚠️ Failed to read urls.json:", error);
  }
}

loadFromDisk();
purgeExpired();

if (typeof setInterval === "function") {
  const cleanupTimer = setInterval(() => {
    try {
      purgeExpired();
    } catch (error) {
      console.error("⚠️ Failed to purge URLs:", error);
    }
  }, CLEANUP_INTERVAL_MS);
  if (cleanupTimer.unref) {
    cleanupTimer.unref();
  }
}

export type ShortenRequest = {
  url: unknown;
  customCode?: unknown;
  ttlDays?: unknown;
};

export type ShortenResult = UrlRecord;

export function shortenUrl({
  url,
  customCode,
  ttlDays,
}: ShortenRequest): ShortenResult {
  purgeExpired();
  const normalizedUrl = normalizeUrl(url);
  const ttl = clampTtl(ttlDays);

  let desiredCode: string | undefined;
  if (customCode !== undefined && customCode !== null && customCode !== "") {
    if (!isValidCustomCode(customCode)) {
      throw new UrlStoreError(
        "Custom code must be 3-32 characters (letters, numbers, '_' or '-')",
        400
      );
    }
    desiredCode = String(customCode).trim();
    const existing = urlMap.get(desiredCode);
    if (existing) {
      const expired =
        existing.expiresAt &&
        new Date(existing.expiresAt).getTime() <= now().getTime();
      if (!expired) {
        throw new UrlStoreError("Custom code already in use", 409);
      }
      urlMap.delete(desiredCode);
      reverseMap.delete(existing.longUrl);
    }
  }

  const existingCode = reverseMap.get(normalizedUrl);
  if (existingCode) {
    const entry = urlMap.get(existingCode);
    if (entry) {
      return entry;
    }
  }

  let code = desiredCode ?? generateShortCode(`${normalizedUrl}:${Date.now()}`);
  while (urlMap.has(code)) {
    code = generateShortCode(`${normalizedUrl}:${crypto.randomUUID()}`);
  }

  const createdAt = now().toISOString();
  const expiresAt = new Date(
    now().getTime() + ttl * 24 * 60 * 60 * 1000
  ).toISOString();
  const record: UrlRecord = {
    code,
    longUrl: normalizedUrl,
    createdAt,
    expiresAt,
  };
  urlMap.set(code, record);
  reverseMap.set(normalizedUrl, code);
  scheduleSave();
  return record;
}

export function getStats() {
  purgeExpired();
  return {
    total: urlMap.size,
    defaultTtlDays: DEFAULT_TTL_DAYS,
  };
}

export function listRecent(limit = 10) {
  purgeExpired();
  return Array.from(urlMap.values())
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .slice(0, limit);
}

export function findByCode(code: unknown): UrlRecord | null {
  purgeExpired();
  const normalized = sanitizeCodeInput(code);
  return urlMap.get(normalized) ?? null;
}
