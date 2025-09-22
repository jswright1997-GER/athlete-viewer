// middleware.ts
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const BYPASS_ALL = process.env.ADMIN_BYPASS === "1";
const BYPASS_TOKEN = process.env.ADMIN_BYPASS_TOKEN || "";

export async function middleware(req: NextRequest) {
  // 1) Global bypass (for maintenance etc.)
  if (BYPASS_ALL) return NextResponse.next();

  const url = req.nextUrl;

  // 2) Admin bypass token via query -> set cookie and redirect to clean URL
  const tokenFromQuery = url.searchParams.get("admin");
  if (BYPASS_TOKEN && tokenFromQuery === BYPASS_TOKEN) {
    const res = NextResponse.redirect(new URL(url.pathname, req.url));
    res.cookies.set("admin_bypass", BYPASS_TOKEN, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      // secure is recommended in production; uncomment if you want to enforce:
      // secure: process.env.NODE_ENV === "production",
    });
    return res;
  }

  // 3) If bypass cookie present, skip auth checks
  const hasBypassCookie = req.cookies.get("admin_bypass")?.value === BYPASS_TOKEN;
  if (BYPASS_TOKEN && hasBypassCookie) return NextResponse.next();

  // 4) Create a response we can mutate (for Supabase to write cookies)
  const res = NextResponse.next();

  // 5) Supabase server client (use getAll/setAll for the current API)
  const supabase = createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        // Convert NextRequest cookies to the shape Supabase expects
        return req.cookies.getAll().map(({ name, value }) => ({ name, value }));
      },
      setAll(cookies) {
        // Apply all cookie mutations to the response
        cookies.forEach(({ name, value, options }) => {
          res.cookies.set({ name, value, ...options });
        });
      },
    },
  });

  // 6) Check session
  const {
    data: { session },
  } = await supabase.auth.getSession();

  const isAuthRoute =
    url.pathname.startsWith("/login") || url.pathname.startsWith("/auth");

  // 7) Redirect unauthenticated users to /login (preserve source)
  if (!session && !isAuthRoute) {
    const redirect = url.clone();
    redirect.pathname = "/login";
    redirect.searchParams.set("redirectedFrom", url.pathname);
    return NextResponse.redirect(redirect);
    // Note: return the redirect, not `res`
  }

  // 8) If already authed and on /login, send to home
  if (session && url.pathname.startsWith("/login")) {
    return NextResponse.redirect(new URL("/", req.url));
  }

  // 9) Otherwise continue with the (possibly mutated) response
  return res;
}

// Match everything except Next.js internals, static assets, and your public images/icons
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|icons|.*\\.(?:png|jpg|jpeg|svg|gif|webp)$).*)",
  ],
};
