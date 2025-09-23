// middleware.ts
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { createMiddlewareClient } from "@supabase/auth-helpers-nextjs";

export async function middleware(req: NextRequest) {
  // Paths that should always be reachable without auth/approval
  const publicPrefixes = [
    "/login",
	"/signup",
    "/pending",
	"/confirmed",
    "/admin-results",
    "/api/auth/webhook",
    "/api/admin/approve",
	"/api/auth/signup",
    "/favicon.ico",
    "/icons",
    "/robots.txt",
    "/sitemap.xml",
    "/_next",          // Next.js assets
    "/static",         // if you use /static
  ];

  const { pathname } = req.nextUrl;
  if (publicPrefixes.some((p) => pathname === p || pathname.startsWith(p + "/"))) {
    return NextResponse.next();
  }

  const res = NextResponse.next();
  const supabase = createMiddlewareClient({ req, res });

  // 1) Is there a session?
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    // Preserve where they were going
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  // 2) Gate on approval
  const { data: profile, error } = await supabase
    .from("profiles")
    .select("approved")
    .eq("id", session.user.id)
    .single();

  if (error || !profile?.approved) {
    // Always allow the pending page itself
    if (pathname !== "/pending" && !pathname.startsWith("/pending/")) {
      const url = req.nextUrl.clone();
      url.pathname = "/pending";
      return NextResponse.redirect(url);
    }
  }

  return res;
}

// Match all app routes except assets and APIs (we listed the API routes we allow above)
export const config = {
  matcher: ["/((?!.*\\.|_next).*)"],
};