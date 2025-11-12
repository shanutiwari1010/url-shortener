import { NextRequest, NextResponse } from "next/server";
import { UrlStoreError, findByCode } from "@/lib/url-shortener";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteParams = {
  params: Promise<{
    code: string;
  }>;
};

async function extractCode(request: NextRequest, context: RouteParams) {
  try {
    const params = await context?.params;
    const fromParams = params?.code;
    if (typeof fromParams === "string" && fromParams.trim().length > 0) {
      return fromParams;
    }
  } catch {
    // ignore and fall back to path parsing
  }
  const pathname = request.nextUrl.pathname.replace(/^\/+/, "");
  return pathname;
}

export async function GET(request: NextRequest, context: RouteParams) {
  try {
    const code = await extractCode(request, context);
    if (!code) {
      return NextResponse.json(
        { error: "Short code required" },
        { status: 400 }
      );
    }

    const record = findByCode(code);

    if (!record) {
      return NextResponse.json(
        { error: "Short code not found" },
        {
          status: 404,
        }
      );
    }

    return NextResponse.redirect(record.longUrl, {
      status: 302,
    });
  } catch (error) {
    if (error instanceof UrlStoreError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status }
      );
    }
    console.error("❌ Failed to resolve short code:", error);
    return NextResponse.json(
      { error: "Unexpected error resolving short code" },
      { status: 500 }
    );
  }
}
