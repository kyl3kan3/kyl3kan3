import { NextResponse } from "next/server";
import { createSession, loginRole, safeReturnPath, SESSION_COOKIE, SESSION_SECONDS } from "@/lib/auth-session";

export async function POST(request: Request) {
  const origin = new URL(request.url).origin;
  if (request.headers.get("origin") !== origin) return new Response("Invalid origin", { status: 403 });
  if (Number(request.headers.get("content-length") ?? 0) > 8192) return new Response("Request too large", { status: 413 });
  let form: FormData;
  try { form = await request.formData(); }
  catch { return new Response("Invalid form", { status: 400 }); }
  const username = form.get("username");
  const password = form.get("password");
  const next = safeReturnPath(form.get("next"));
  const role = typeof username === "string" && typeof password === "string"
    ? loginRole(username.trim(), password) : null;
  if (!role) {
    const url = new URL("/login", origin);
    url.searchParams.set("error", "1");
    url.searchParams.set("next", next);
    return NextResponse.redirect(url, { status: 303, headers: { "cache-control": "no-store" } });
  }
  const response = NextResponse.redirect(new URL(next, origin), { status: 303, headers: { "cache-control": "no-store" } });
  response.cookies.set(SESSION_COOKIE, createSession(role), {
    httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict",
    path: "/", maxAge: SESSION_SECONDS,
  });
  return response;
}
