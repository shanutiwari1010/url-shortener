#!/usr/bin/env node

/**
 * Simple load test runner.
 *
 * Usage:
 *   node scripts/load-test.js --url=http://localhost:3000 --requests=200 --concurrency=20
 *
 * You can also override values with environment variables:
 *   LOAD_TEST_URL, LOAD_TEST_REQUESTS, LOAD_TEST_CONCURRENCY, LOAD_TEST_TIMEOUT
 */

const http = require('http');
const https = require('https');
const { performance } = require('perf_hooks');

const defaults = {
  url: process.env.LOAD_TEST_URL || 'http://localhost:3000',
  requests: Number(process.env.LOAD_TEST_REQUESTS || 200),
  concurrency: Number(process.env.LOAD_TEST_CONCURRENCY || 20),
  timeout: Number(process.env.LOAD_TEST_TIMEOUT || 10_000),
};

const parsedArgs = parseArgs(process.argv.slice(2));
const targetUrl = parsedArgs.url || defaults.url;
const totalRequests = clampPositiveInteger(parsedArgs.requests, defaults.requests);
const concurrency = clampPositiveInteger(parsedArgs.concurrency, defaults.concurrency);
const timeout = clampPositiveInteger(parsedArgs.timeout, defaults.timeout);

if (totalRequests < concurrency) {
  console.warn(
    `Adjusting concurrency from ${concurrency} down to ${totalRequests} because total requests is smaller.`,
  );
}

const effectiveConcurrency = Math.min(concurrency, totalRequests);

(async () => {
  console.log('🚀 Starting load test');
  console.log(`• Target:        ${targetUrl}`);
  console.log(`• Requests:      ${totalRequests}`);
  console.log(`• Concurrency:   ${effectiveConcurrency}`);
  console.log(`• Timeout:       ${timeout} ms\n`);

  const stats = await runLoadTest({
    url: targetUrl,
    totalRequests,
    concurrency: effectiveConcurrency,
    timeout,
  });

  printSummary(stats);
  process.exit(stats.failed > 0 ? 1 : 0);
})().catch((error) => {
  console.error('Load test failed with an unexpected error:', error);
  process.exit(1);
});

function parseArgs(args) {
  return args.reduce((acc, arg) => {
    const normalized = arg.replace(/^--?/, '');
    const [key, rawValue] = normalized.split('=');

    if (!key) {
      return acc;
    }

    const value = rawValue ?? 'true';
    acc[key.toLowerCase()] = value;
    return acc;
  }, {});
}

function clampPositiveInteger(value, fallback) {
  if (value === undefined || value === null) return fallback;
  const asNumber = Number(value);
  if (!Number.isFinite(asNumber) || asNumber <= 0) return fallback;
  return Math.floor(asNumber);
}

async function runLoadTest({ url, totalRequests, concurrency, timeout }) {
  let dispatched = 0;
  let succeeded = 0;
  let failed = 0;
  const latencies = [];

  const testStart = performance.now();

  async function worker() {
    while (true) {
      const current = dispatched++;
      if (current >= totalRequests) {
        break;
      }

      const requestStart = performance.now();
      try {
        const statusCode = await makeRequest(url, timeout);
        const elapsed = performance.now() - requestStart;

        latencies.push(elapsed);

        if (statusCode >= 200 && statusCode < 400) {
          succeeded += 1;
        } else {
          failed += 1;
        }
      } catch (error) {
        failed += 1;
        if (process.env.DEBUG_LOAD_TEST === '1') {
          console.error(`Request ${current + 1} failed:`, error.message);
        }
      }
    }
  }

  const workers = Array.from({ length: concurrency }, () => worker());
  await Promise.all(workers);

  const totalDuration = performance.now() - testStart;
  return {
    url,
    totalRequests,
    concurrency,
    timeout,
    succeeded,
    failed,
    latencies,
    totalDuration,
  };
}

function makeRequest(targetUrl, timeout) {
  return new Promise((resolve, reject) => {
    const url = new URL(targetUrl);
    const transport = url.protocol === 'https:' ? https : http;

    const options = {
      method: 'GET',
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: `${url.pathname}${url.search}`,
      headers: {
        'User-Agent': 'url-shortener-load-test',
      },
    };

    const request = transport.request(options, (response) => {
      response.on('data', () => {});
      response.on('end', () => resolve(response.statusCode ?? 0));
    });

    request.on('error', reject);
    request.setTimeout(timeout, () => {
      request.destroy(new Error(`Request timed out after ${timeout} ms`));
    });

    request.end();
  });
}

function printSummary({
  url,
  totalRequests,
  concurrency,
  timeout,
  succeeded,
  failed,
  latencies,
  totalDuration,
}) {
  console.log('📊 Results');
  console.log(`• Target:           ${url}`);
  console.log(`• Requests:         ${totalRequests}`);
  console.log(`• Concurrency:      ${concurrency}`);
  console.log(`• Timeout:          ${timeout} ms`);
  console.log(`• Successful:       ${succeeded}`);
  console.log(`• Failed:           ${failed}`);

  const durationSeconds = totalDuration / 1_000;
  console.log(`• Total duration:   ${formatNumber(totalDuration)} ms`);
  console.log(
    `• Throughput:       ${formatNumber(totalRequests / Math.max(durationSeconds, 1e-6))} req/s`,
  );

  if (latencies.length) {
    const sorted = [...latencies].sort((a, b) => a - b);
    console.log(`• Latency (avg):    ${formatNumber(mean(sorted))} ms`);
    console.log(`• Latency (min):    ${formatNumber(sorted[0])} ms`);
    console.log(`• Latency (p50):    ${formatNumber(percentile(sorted, 50))} ms`);
    console.log(`• Latency (p95):    ${formatNumber(percentile(sorted, 95))} ms`);
    console.log(`• Latency (p99):    ${formatNumber(percentile(sorted, 99))} ms`);
    console.log(`• Latency (max):    ${formatNumber(sorted[sorted.length - 1])} ms`);
  } else {
    console.log('• Latency:          no successful requests recorded');
  }
}

function formatNumber(value) {
  return Number(value).toFixed(2);
}

function mean(values) {
  if (!values.length) return 0;
  return values.reduce((acc, current) => acc + current, 0) / values.length;
}

function percentile(sortedValues, percentileRank) {
  if (!sortedValues.length) return 0;
  const index = Math.min(
    sortedValues.length - 1,
    Math.ceil((percentileRank / 100) * sortedValues.length) - 1,
  );
  return sortedValues[index];
}

