import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { processQueuedJevAssessments } from "@/lib/jev-assessments";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

function isAuthorized(request: Request) {
  const secrets = [process.env.JEV_JOB_SECRET, process.env.CRON_SECRET]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value));
  if (secrets.length === 0) return process.env.NODE_ENV !== "production";
  const authorization = request.headers.get("authorization") ?? "";
  const bearer = authorization.replace(/^Bearer\s+/i, "").trim();
  const headerSecret = request.headers.get("x-jev-job-secret")?.trim() ?? "";
  return secrets.some(
    (secret) => safeEqual(secret, bearer) || safeEqual(secret, headerSecret),
  );
}

async function run(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  try {
    const result = await processQueuedJevAssessments(10);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Unable to process Jev assessments",
      },
      { status: 500 },
    );
  }
}

export const GET = run;
export const POST = run;
