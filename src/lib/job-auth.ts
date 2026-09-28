import { timingSafeEqual } from "node:crypto";

export function isScheduledJobAuthorized(request: Request) {
  const supplied = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() ?? "";
  const expected = process.env.CRON_SECRET?.trim() ?? "";
  if (!expected) return process.env.NODE_ENV !== "production";
  const left = Buffer.from(supplied), right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}
