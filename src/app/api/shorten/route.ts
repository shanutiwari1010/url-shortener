import { NextResponse } from "next/server";
import {
  UrlStoreError,
  getStats,
  shortenUrl,
  type ShortenRequest,
} from "@/lib/url-shortener";

const FALLBACK_BASE_URL =
  process.env.BASE_URL ?? process.env.NEXT_PUBLIC_BASE_URL ?? "";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function computeBaseUrl(request: Request) {
  const origin = request.headers.get("origin");
  if (origin) {
    return origin;
  }
  if (FALLBACK_BASE_URL) {
    return FALLBACK_BASE_URL;
  }
  if (typeof process.env.VERCEL_URL === "string") {
    return `https://${process.env.VERCEL_URL}`;
  }
  return "http://localhost:3000";
}

export async function POST(request: Request) {
  let payload: ShortenRequest;
  try {
    payload = (await request.json()) as ShortenRequest;
  } catch {
    return NextResponse.json(
      { error: "Request body must be valid JSON" },
      { status: 400 },
    );
  }

  try {
    const entry = shortenUrl(payload);
    const baseUrl = computeBaseUrl(request).replace(/\/+$/, "");
    const shortUrl = `${baseUrl}/${entry.code}`;
    return NextResponse.json(
      {
        shortUrl,
        code: entry.code,
        longUrl: entry.longUrl,
        createdAt: entry.createdAt,
        expiresAt: entry.expiresAt,
      },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof UrlStoreError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("❌ Unexpected error handling /api/shorten:", error);
    return NextResponse.json(
      { error: "Unexpected error while shortening URL" },
      { status: 500 },
    );
  }
}

export function GET() {
  return NextResponse.json(getStats());
}

