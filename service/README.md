# URL Shortener

## Overview

This is a lightweight URL shortener built with Node.js and Express. It maps long URLs to short, sharable codes while supporting custom aliases, automatic expiration, and JSON disk persistence. The service is designed to stay cloud-agnostic and easy to run locally or on any host that can execute Node.js.

## Feature Highlights

- Custom short codes with validation and collision handling.
- Automatic expiration (default 7 days) with periodic cleanup to maintain fast lookups.
- In-memory caching (`Map`) for O(1) redirects backed by a `urls.json` data file.
- Health endpoint exposing URL counts and configuration.
- JSON persistence with debounce to reduce disk churn.
- Configurable via environment variables.

## Architecture

- **Application Layer**: `Express` handles routing (`/shorten`, `/:code`, `/health`) and JSON parsing.
- **Domain Logic**:
  - `normalizeUrl` cleans user input and enforces `http/https`.
  - `generateShortCode` derives base62 identifiers from URL hashes with collision retries.
  - `createEntry` stores `{ longUrl, createdAt, expiresAt }` and updates persistence.
- **Persistence Layer**:
  - `urls.json` stores entries; on startup the service hydrates active URLs and recalculates missing expirations.
  - Debounced writes (`scheduleSave`) batch changes every 500 ms to avoid excessive I/O.
- **Caching & Cleanup**:
  - `urlMap`: short code → metadata, `reverseMap`: long URL → code.
  - `purgeExpired` removes stale entries on every request and via an interval (default 10 minutes).
- **Configuration**:
  - `.env` (handled by `dotenv`) supplies `PORT`, `BASE_URL`, `URL_TTL_DAYS`, and `CLEANUP_INTERVAL_MS`.

### Request Flow

1. Client submits `POST /shorten` with a long URL (and optional `customCode`, `ttlDays`).
2. Service validates and normalizes the URL, reusing existing mappings when possible.
3. A short code is created or reused, persisted to `urls.json`, and returned.
4. Clients resolve the short link via `GET /:code`; expired or missing codes return `404`.

## Technology & Packages

- Node.js 20+
- `express`: routing and server framework.
- `dotenv`: environment variable loading.
- Built-in `crypto`, `fs` modules for hashing and persistence.

## Getting Started

```bash
npm install
cp .env.example .env   # create if needed
npm start
```

### Environment Variables

| Variable              | Default                    | Description                                      |
| --------------------- | -------------------------- | ------------------------------------------------ |
| `PORT`                | `3000`                     | Port the Express server listens on.              |
| `BASE_URL`            | `http://localhost:${PORT}` | Base URL returned in API responses.              |
| `URL_TTL_DAYS`        | `7`                        | Default time-to-live in days for shortened URLs. |
| `CLEANUP_INTERVAL_MS` | `600000`                   | Interval for background expiration cleanup.      |

## NPM Scripts

| Script              | Description                                                                             |
| ------------------- | --------------------------------------------------------------------------------------- |
| `npm start`         | Runs the server (`node server.js`).                                                     |
| `npm run load-test` | Executes the built-in Node load test (`scripts/load-test.js`) and prints latency stats. |

## API Reference

### Shorten a URL

```bash
curl -X POST http://localhost:3000/shorten \
  -H "Content-Type: application/json" \
  -d '{"url":"https://example.com/docs","customCode":"docs123","ttlDays":3}'
```

Response:

```json
{
  "shortUrl": "http://localhost:3000/docs123",
  "longUrl": "https://example.com/docs",
  "createdAt": "2025-11-12T07:15:23.214Z",
  "expiresAt": "2025-11-15T07:15:23.214Z"
}
```

### Redirect via Short Code

```bash
curl -i http://localhost:3000/docs123
```

Returns `301` redirect when the code exists and is active.

### Service Health

```bash
curl http://localhost:3000/health
```

Response:

```json
{
  "ok": true,
  "total": 42,
  "ttlDays": 7
}
```

## Data Storage

- `urls.json` (created automatically) persists all active mappings.
- Each entry is stored as:
  ```json
  {
    "code": "ab12cd",
    "longUrl": "https://example.com",
    "createdAt": "2025-11-12T07:10:00.000Z",
    "expiresAt": "2025-11-19T07:10:00.000Z"
  }
  ```
- Entries expire after `expiresAt`; expired records are purged from memory and persisted state.

## Load Testing

### Built-in Script

```bash
PORT=4000 node server.js &
npm run load-test
```

Sample output:

```json
{
  "target": "http://localhost:4000/shorten",
  "requested": 100,
  "completed": 100,
  "successes": 100,
  "failures": 0,
  "concurrency": 10,
  "durationMs": 96.62,
  "rps": 1034.99,
  "latencyMs": {
    "avg": 7.12,
    "p50": 3.1,
    "p90": 12.91,
    "p99": 38.56,
    "max": 60.62
  }
}
```

### Autocannon (100 requests)

```bash
PORT=4000 node server.js &
npx autocannon -c 10 -a 100 \
  -m POST -H 'Content-Type=application/json' \
  -b '{"url":"https://example.com/loadtest"}' \
  http://localhost:4000/shorten
```

Report:
| Metric | Value |
| --- | --- |
| Total requests | 100 in 1.02 s |
| Latency (avg / p50 / p97.5 / max) | 3.89 ms / 1 ms / 32 ms / 36 ms |
| Throughput | 39.8 kB/s |
| Req/sec | 100 |

> Stop the background server when finished: `lsof -ti :4000 | xargs kill -9`.

## Next Steps & Improvements

- Swap `urls.json` for a database (PostgreSQL, DynamoDB, etc.) to support horizontal scaling.
- Introduce metrics collection and distributed caching (Redis) for high-volume traffic.
- Add authentication and user management for multi-tenant usage.
- Implement duplicates consolidation and analytics (click counts, referrers).
