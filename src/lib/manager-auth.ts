import { timingSafeEqual } from "node:crypto";
import { sessionRole } from "./auth-session";

function configuredPassword() {
  return process.env.MANAGER_DASHBOARD_PASSWORD?.trim() ?? "";
}

function configuredAppPassword() {
  return process.env.APP_ACCESS_PASSWORD?.trim() ?? "";
}

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

function basicCredentials(authorization: string) {
  const encoded = authorization.match(/^Basic\s+(.+)$/i)?.[1];
  if (!encoded) return null;
  try {
    const decoded = Buffer.from(encoded, "base64").toString("utf8");
    const separator = decoded.indexOf(":");
    if (separator < 0) return null;
    return {
      username: decoded.slice(0, separator),
      password: decoded.slice(separator + 1),
    };
  } catch {
    return null;
  }
}

export function isManagerDashboardAuthorized(request: Request) {
  if (sessionRole(request) === "manager") return true;
  const password = configuredPassword();
  if (!password) return process.env.NODE_ENV !== "production";

  const authorization = request.headers.get("authorization")?.trim() ?? "";
  const bearer = authorization.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (bearer && safeEqual(bearer, password)) return true;

  const credentials = basicCredentials(authorization);
  const expectedUsername =
    process.env.MANAGER_DASHBOARD_USERNAME?.trim() || "manager";
  return Boolean(
    credentials &&
      safeEqual(credentials.username, expectedUsername) &&
      safeEqual(credentials.password, password),
  );
}

export function managerDashboardAccessFailure() {
  if (!configuredPassword()) {
    return new Response("Manager dashboard credentials are not configured.", {
      status: 503,
      headers: { "cache-control": "no-store" },
    });
  }
  return new Response("Manager authentication required.", {
    status: 401,
    headers: {
      "cache-control": "no-store",
    },
  });
}

export function isAppAccessAuthorized(request: Request) {
  if (sessionRole(request)) return true;
  const password = configuredAppPassword();
  if (!password) return process.env.NODE_ENV !== "production";

  const authorization = request.headers.get("authorization")?.trim() ?? "";
  const bearer = authorization.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (bearer && safeEqual(bearer, password)) return true;

  const credentials = basicCredentials(authorization);
  const expectedUsername = process.env.APP_ACCESS_USERNAME?.trim() || "operator";
  if (
    credentials &&
    safeEqual(credentials.username, expectedUsername) &&
    safeEqual(credentials.password, password)
  ) {
    return true;
  }

  const managerPassword = configuredPassword();
  if (!managerPassword) return false;
  if (bearer && safeEqual(bearer, managerPassword)) return true;
  const managerUsername =
    process.env.MANAGER_DASHBOARD_USERNAME?.trim() || "manager";
  return Boolean(
    credentials &&
      safeEqual(credentials.username, managerUsername) &&
      safeEqual(credentials.password, managerPassword),
  );
}

export function appAccessFailure() {
  if (!configuredAppPassword()) {
    return new Response("Helpdesk access credentials are not configured.", {
      status: 503,
      headers: { "cache-control": "no-store" },
    });
  }
  return new Response("Helpdesk authentication required.", {
    status: 401,
    headers: {
      "cache-control": "no-store",
    },
  });
}
