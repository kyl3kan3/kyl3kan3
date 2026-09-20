import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = process.env.NODE_ENV === "production"
  ? "__Host-helpdesk-session" : "helpdesk-session";
export const SESSION_SECONDS = 8 * 60 * 60;
type Role = "operator" | "manager";

function secret(role: Role) {
  return (role === "manager" ? process.env.MANAGER_DASHBOARD_PASSWORD
    : process.env.APP_ACCESS_PASSWORD)?.trim() ?? "";
}

export function loginRole(username: string, password: string): Role | null {
  for (const role of ["manager", "operator"] as const) {
    const expectedUser = (role === "manager" ? process.env.MANAGER_DASHBOARD_USERNAME
      : process.env.APP_ACCESS_USERNAME)?.trim() || role;
    const expected = secret(role);
    const given = Buffer.from(password);
    const actual = Buffer.from(expected);
    if (expected && username === expectedUser && given.length === actual.length
      && timingSafeEqual(given, actual)) return role;
  }
  return null;
}

export function createSession(role: Role, now = Date.now()) {
  const key = secret(role);
  if (!key) throw new Error("Access credentials are not configured.");
  const payload = `v1.${role}.${Math.floor(now / 1000) + SESSION_SECONDS}.${randomBytes(24).toString("base64url")}`;
  const signature = createHmac("sha256", key).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

export function sessionRole(request: Request, now = Date.now()): Role | null {
  const token = request.headers.get("cookie")?.split(";")
    .map((part) => part.trim()).find((part) => part.startsWith(`${SESSION_COOKIE}=`))
    ?.slice(SESSION_COOKIE.length + 1);
  if (!token || token.length > 256) return null;
  const [version, role, expires, nonce, signature, extra] = token.split(".");
  if (version !== "v1" || (role !== "manager" && role !== "operator") || extra !== undefined
    || !/^\d+$/.test(expires ?? "") || !/^[\w-]{32}$/.test(nonce ?? "")
    || !/^[\w-]{43}$/.test(signature ?? "")) return null;
  const expiry = Number(expires);
  const seconds = Math.floor(now / 1000);
  if (expiry <= seconds || expiry > seconds + SESSION_SECONDS || !secret(role)) return null;
  const expected = createHmac("sha256", secret(role))
    .update(`${version}.${role}.${expires}.${nonce}`).digest("base64url");
  return timingSafeEqual(Buffer.from(expected), Buffer.from(signature)) ? role : null;
}

export function safeReturnPath(value: unknown) {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")
    || /[\\\x00-\x20]/.test(value)) return "/";
  const url = new URL(value, "https://helpdesk.invalid");
  if (url.origin !== "https://helpdesk.invalid" || url.pathname.startsWith("/api/")
    || url.pathname === "/login") return "/";
  return `${url.pathname}${url.search}`;
}
