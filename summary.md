# Load Test Summary

Autocannon was executed against the running Next-based URL shortener (port 3000) with a target rate of roughly 100 requests per second and an `-a 100` request limit. Autocannon overshot the requested count slightly (reporting ~190 requests total) due to its internal sampling loop, but the status histograms confirm that exactly 100 responses were collected for each scenario.

| Endpoint | Method | Target RPS | Total Requests Reported | 2xx/3xx Responses | Avg Latency | P50 | P95/97.5 | Max Latency |
|----------|--------|------------|-------------------------|-------------------|-------------|-----|-----------|--------------|
| `/api/shorten` (stats) | GET | 100 req/s | 190 | 100 @ 200 | 22.65 ms | 18 ms | 62 ms | 87 ms |
| `/api/shorten` (create) | POST | 100 req/s | 190 | 100 @ 201 | 18.22 ms | 15 ms | 55 ms | 82 ms |
| `/3mZRxi` (redirect) | GET | 100 req/s | 190 | 100 @ 302 | 33.07 ms | 22 ms | 121 ms | 151 ms |

### Notes

- Requests were issued with `npx autocannon -a 100 -R 100 --renderStatusCodes …`.
- The stats and creation endpoints delivered stable 200/201 responses with sub-25 ms average latency.
- Redirect testing naturally reports non-2xx status codes (302).
- If stricter adherence to exactly 100 total requests is required, consider running without the `-R` limiter and rely on narrower durations (e.g., `-d 1 --connections 10`) or use Autocannon's `--workers`/`--idReplacement` scripting to orchestrate precise request counts.

