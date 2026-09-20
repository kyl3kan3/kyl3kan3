import { NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth-session";

export async function POST(request: Request) {
  const origin = new URL(request.url).origin;
  if (request.headers.get("origin") !== origin) return new Response("Invalid origin", { status: 403 });
  const response = NextResponse.redirect(new URL("/login", origin), { status: 303, headers: { "cache-control": "no-store" } });
  response.cookies.set(SESSION_COOKIE, "", {
    httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict", path: "/", maxAge: 0,
  });
  return response;
}
