import { isAppAccessAuthorized, appAccessFailure, isManagerDashboardAuthorized, managerDashboardAccessFailure } from "./manager-auth";

function authorizedHeader(request: Request, authorize: (request: Request) => boolean) {
  const authorization = request.headers.get("authorization");
  if (!authorization || !/^(Bearer|Basic)\s+\S+/i.test(authorization)) return false;
  // Validate the header independently. A valid cookie must not make a bogus header
  // bypass the origin check.
  return authorize(new Request(request.url, { headers: { authorization } }));
}

/** Cookie-authenticated mutations must come from this app, not another origin. */
export function managerRequestFailure(request: Request): Response | null {
  if (!isManagerDashboardAuthorized(request)) return managerDashboardAccessFailure();
  if (!["GET", "HEAD", "OPTIONS"].includes(request.method)) {
    if (!authorizedHeader(request, isManagerDashboardAuthorized) && request.headers.get("origin") !== new URL(request.url).origin) {
      return Response.json({ ok: false, error: "Same-origin request required" }, { status: 403 });
    }
  }
  return null;
}

export function hasStrongProductionAccess() {
  return [process.env.MANAGER_DASHBOARD_PASSWORD, process.env.APP_ACCESS_PASSWORD]
    .every((value) => (value?.trim().length ?? 0) >= 16);
}

export function appMutationFailure(request: Request): Response | null {
  if (!isAppAccessAuthorized(request)) return appAccessFailure();
  if (!authorizedHeader(request, isAppAccessAuthorized) && request.headers.get("origin") !== new URL(request.url).origin) {
    return Response.json({ ok: false, error: "Same-origin request required" }, { status: 403 });
  }
  return null;
}
