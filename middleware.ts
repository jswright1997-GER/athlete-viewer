// middleware.ts
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const BYPASS_ALL = process.env.ADMIN_BYPASS === "1";
const BYPASS_TOKEN = process.env.ADMIN_BYPASS_TOKEN || "";

export async function middleware(req: NextRequest) {
  if (BYPASS_ALL) return NextResponse.next();

  const url = req.nextUrl;
  const hasCookie = req.cookies.get("admin_bypass")?.value === BYPASS_TOKEN;
  const tokenFromQuery = url.searchParams.get("admin");

  if (BYPASS_TOKEN && tokenFromQuery === BYPASS_TOKEN) {
    const res = NextResponse.redirect(new URL(url.pathname, req.url));
    res.cookies.set("admin_bypass", BYPASS_TOKEN, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
    });
    return res;
  }
  if (BYPASS_TOKEN && hasCookie) return NextResponse.next();

  const res = NextResponse.next();
  const supabase = createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      get: (name) => req.cookies.get(name)?.value,
      set: (name, value, options) => res.cookies.set({ name, value, ...options }),
      remove: (name, options) => res.cookies.set({ name, value: "", ...options }),
    },
  });

  const {
    data: { session },
  } = await supabase.auth.getSession();

  const isAuthRoute = url.pathname.startsWith("/login") || url.pathname.startsWith("/auth");

  if (!session && !isAuthRoute) {
    const redirect = url.clone();
    redirect.pathname = "/login";
    redirect.searchParams.set("redirectedFrom", url.pathname);
    return NextResponse.redirect(redirect);
  }

  if (session && url.pathname.startsWith("/login")) {
    return NextResponse.redirect(new URL("/", req.url));
  }

  return res;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|icons|.*\\.(?:png|jpg|jpeg|svg|gif|webp)$).*)",
  ],
};
