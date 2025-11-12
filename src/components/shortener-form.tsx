"use client";

import { useEffect, useMemo, useState, useTransition } from "react";

type ShortResponse = {
  shortUrl: string;
  code: string;
  longUrl: string;
  createdAt: string;
  expiresAt: string;
};

type HistoryItem = ShortResponse & { savedAt: string };

const TTL_OPTIONS = [
  { label: "1 day", value: 1 },
  { label: "7 days", value: 7 },
  { label: "30 days", value: 30 },
  { label: "90 days", value: 90 },
  { label: "1 year", value: 365 },
];

const HISTORY_KEY = "tiny-link-history";

function formatDate(input: string) {
  return new Date(input).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export default function ShortenerForm() {
  const [url, setUrl] = useState("");
  const [alias, setAlias] = useState("");
  const [ttl, setTtl] = useState<number>(7);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ShortResponse | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [isPending, startTransition] = useTransition();
  const canSubmit = useMemo(
    () => url.trim().length > 0 && !isPending,
    [url, isPending]
  );

  useEffect(() => {
    try {
      const stored = localStorage.getItem(HISTORY_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as HistoryItem[];
        setHistory(parsed);
      }
    } catch (err) {
      console.warn("Failed to read history from localStorage:", err);
    }
  }, []);

  useEffect(() => {
    try {
      if (history.length) {
        localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
      } else {
        localStorage.removeItem(HISTORY_KEY);
      }
    } catch (err) {
      console.warn("Failed to persist history to localStorage:", err);
    }
  }, [history]);

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSubmit) return;

    startTransition(async () => {
      setError(null);
      try {
        const response = await fetch("/api/shorten", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            url,
            customCode: alias || undefined,
            ttlDays: ttl,
          }),
        });
        const payload = (await response.json()) as
          | { error: string }
          | ShortResponse;
        if (!response.ok) {
          throw new Error(
            "error" in payload ? payload.error : "Unable to shorten URL"
          );
        }
        if ("shortUrl" in payload) {
          setResult(payload);
          setHistory((previous) => [
            { ...payload, savedAt: new Date().toISOString() },
            ...previous
              .filter((item) => item.code !== payload.code)
              .slice(0, 9),
          ]);
        }
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Unexpected error occurred";
        setError(message);
      }
    });
  };

  const handleCopy = async (link: string) => {
    try {
      await navigator.clipboard.writeText(link);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Copy failed. Please copy the link manually."
      );
    }
  };

  const handlePrefill = (item: HistoryItem) => {
    setUrl(item.longUrl);
    setAlias(item.code);
  };

  return (
    <div className="flex w-full max-w-4xl flex-col gap-8 rounded-3xl border border-slate-800/60 bg-slate-900/60 p-6 shadow-2xl shadow-blue-500/10 backdrop-blur sm:p-8 lg:gap-10 lg:p-10">
      <header className="flex flex-col gap-3">
        <span className="inline-flex w-fit items-center gap-2 rounded-full border border-slate-700/80 bg-slate-800/70 px-3 py-1 text-xs font-medium uppercase tracking-widest text-slate-300/80">
          TinyLink
        </span>
        <h1 className="text-3xl font-semibold tracking-tight text-slate-50 sm:text-4xl md:text-5xl">
          Shorten links with style
        </h1>
        <p className="max-w-full text-sm text-slate-300/90 sm:text-base md:max-w-xl md:text-lg">
          Make your URLs memorable, pick a custom alias, and decide when links
          expire. Share confidently with our privacy-friendly shortener.
        </p>
      </header>

      <form
        onSubmit={handleSubmit}
        className="grid gap-5 rounded-2xl border border-slate-800 bg-slate-950/30 p-5 sm:p-6 md:grid-cols-[1fr_minmax(0,220px)] md:gap-8"
      >
        <div className="flex w-full flex-col gap-2 md:col-span-2">
          <label
            htmlFor="long-url"
            className="text-sm font-medium text-slate-200/90"
          >
            Destination URL
          </label>
          <input
            id="long-url"
            placeholder="https://example.com/very/long/link"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            className="rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 text-base text-slate-100 shadow-inner shadow-slate-950 placeholder:text-slate-500 focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-500/40"
            autoComplete="off"
            required
          />
        </div>

        <div className="flex flex-col gap-2">
          <label
            htmlFor="alias"
            className="text-sm font-medium text-slate-200/90"
          >
            Custom alias <span className="text-slate-500">(optional)</span>
          </label>
          <div className="relative">
            <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-xs text-slate-500 sm:pl-4 sm:text-sm">
              tiny.link/
            </div>
            <input
              id="alias"
              placeholder="my-launch"
              value={alias}
              onChange={(event) => setAlias(event.target.value)}
              className="w-full rounded-xl border border-slate-700 bg-slate-900 py-3 pl-24 pr-4 text-base text-slate-100 shadow-inner shadow-slate-950 placeholder:text-slate-600 focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-500/40 sm:pl-[92px]"
              autoComplete="off"
            />
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <label
            htmlFor="ttl"
            className="text-sm font-medium text-slate-200/90"
          >
            Expiration
          </label>
          <select
            id="ttl"
            value={ttl}
            onChange={(event) => setTtl(Number(event.target.value))}
            className="rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 text-base text-slate-100 shadow-inner shadow-slate-950 focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-500/40"
          >
            {TTL_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between md:col-span-2">
          <div className="text-sm text-slate-400">
            Aliases support letters, numbers, underscores, and hyphens.
          </div>
          <button
            type="submit"
            className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-6 py-3 text-base font-semibold text-slate-900 shadow-sm transition hover:bg-slate-100 hover:text-slate-950 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-200 disabled:cursor-not-allowed disabled:border-slate-600 disabled:bg-slate-700 disabled:text-slate-400 sm:w-auto sm:min-w-[160px] md:min-w-[180px]"
            disabled={!canSubmit}
          >
            {isPending ? (
              <span className="flex items-center gap-2 text-slate-100">
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-900 border-t-transparent" />
                Shortening...
              </span>
            ) : (
              "Generate short link"
            )}
          </button>
        </div>
      </form>

      {error ? (
        <div className="rounded-2xl border border-rose-500/60 bg-rose-500/10 p-5 text-sm text-rose-200">
          {error}
        </div>
      ) : null}

      {result ? (
        <section className="flex w-full flex-col gap-4 rounded-2xl border border-slate-800 bg-slate-950/30 p-6">
          <h2 className="text-xl font-semibold text-slate-50">
            Your shortened link is ready
          </h2>
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-3">
              <span className="truncate text-base font-medium text-sky-300">
                {result.shortUrl}
              </span>
              <button
                type="button"
                onClick={() => handleCopy(result.shortUrl)}
                className="inline-flex items-center gap-2 rounded-lg border border-sky-500/80 bg-slate-950/70 px-3 py-2 text-sm font-medium text-sky-200 transition hover:border-sky-300 hover:text-sky-100"
              >
                Copy link
              </button>
            </div>
            <dl className="grid gap-3 text-sm text-slate-300 sm:grid-cols-2 lg:grid-cols-3">
              <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-3">
                <dt className="text-xs uppercase tracking-wide text-slate-400">
                  Destination
                </dt>
                <dd className="truncate text-slate-200">{result.longUrl}</dd>
              </div>
              <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-3">
                <dt className="text-xs uppercase tracking-wide text-slate-400">
                  Created
                </dt>
                <dd>{formatDate(result.createdAt)}</dd>
              </div>
              <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-3">
                <dt className="text-xs uppercase tracking-wide text-slate-400">
                  Expires
                </dt>
                <dd>{formatDate(result.expiresAt)}</dd>
              </div>
            </dl>
          </div>
        </section>
      ) : null}

      <section className="flex flex-col gap-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-lg font-semibold text-slate-50">Recent links</h2>
          {history.length ? (
            <button
              type="button"
              onClick={() => setHistory([])}
              className="text-sm text-slate-400 underline decoration-slate-600/80 decoration-dotted underline-offset-4 transition hover:text-slate-200 hover:decoration-slate-200"
            >
              Clear
            </button>
          ) : null}
        </div>
        {history.length ? (
          <ul className="grid gap-3">
            {history.map((item) => (
              <li
                key={`${item.code}-${item.savedAt}`}
                className="flex flex-col gap-3 rounded-2xl border border-slate-800 bg-slate-950/30 p-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="flex flex-col gap-1">
                  <span className="text-sm font-medium text-sky-200">
                    {item.shortUrl}
                  </span>
                  <span
                    className="max-w-[240px] truncate text-xs text-slate-400 sm:max-w-[320px] md:max-w-[420px]"
                    title={item.longUrl}
                  >
                    {item.longUrl}
                  </span>
                  <span className="text-xs text-slate-500">
                    Expires {formatDate(item.expiresAt)}
                  </span>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => handleCopy(item.shortUrl)}
                    className="rounded-lg border border-sky-500/70 px-3 py-2 text-xs font-medium text-sky-200 transition hover:border-sky-300 hover:text-sky-100"
                  >
                    Copy
                  </button>
                  <button
                    type="button"
                    onClick={() => handlePrefill(item)}
                    className="rounded-lg border border-slate-700 px-3 py-2 text-xs font-medium text-slate-300 transition hover:border-slate-500 hover:text-slate-100"
                  >
                    Use again
                  </button>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded-2xl border border-dashed border-slate-800 bg-slate-950/20 p-6 text-sm text-slate-400">
            Generate a short link to populate your personal history. Links stay
            locally on this device.
          </p>
        )}
      </section>
    </div>
  );
}
