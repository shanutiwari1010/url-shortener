# Service Load Test Summary

Tests executed with `npx autocannon -a 100 -R 100 --renderStatusCodes` against the standalone Express API (listening on `http://localhost:4000`). For the creation flow, `--idReplacement` populated unique URLs (`https://example.com/service-loadtest-{{id}}`) to ensure every request carried a distinct payload. Autocannon internally reported ~190 requests per run while the status histogram confirmed 100 completed responses at the target 100 req/s.

| Endpoint | Method | Target RPS | Total Requests Reported | Status Mix | Avg Latency | P50 | P95/97.5 | Max Latency |
|----------|--------|------------|-------------------------|------------|-------------|-----|-----------|--------------|
| `/shorten` | POST | 100 req/s | 190 | 100 @ 200 | 9.36 ms | 7 ms | 28 ms | 32 ms |
| `/3mZRxi` | GET | 100 req/s | 190 | 100 @ 301 | 4.22 ms | 2 ms | 13 ms | 14 ms |

## Observations

- The POST handler responds with HTTP 200 rather than 201, but handled 100 unique create requests comfortably under 10 ms on average.
- Redirect throughput remained consistent, returning the expected 301 for each request with sub-5 ms average latency.
- `/health` currently resolves through the `/:code` route first, yielding a 404. If a dedicated health probe is required, the route order should place `/health` before the parameterized matcher.

