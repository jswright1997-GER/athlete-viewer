// middleware.ts
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";

function bypass(pathname: string) {
  return (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    pathname.startsWith("/icons") ||
    pathname.startsWith("/assets") ||
    pathname.startsWith("/public") ||
    pathname.startsWith("/api/") ||               // <— allow ALL API routes
    pathname === "/login" ||
    pathname === "/signup" ||
    pathname === "/confirmed" ||
    pathname === "/reset" ||
    pathname === "/pending"
  );
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Don’t guard public paths & API routes
  if (bypass(pathname)) return NextResponse.next();

  // For protected app pages, check user via cookies
  const res = NextResponse.next();

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return req.cookies.getAll().map(({ name, value }) => ({ name, value }));
        },
        setAll(cookiesToSet: { name: string; value: string; options?: CookieOptions }[]) {
          for (const { name, value, options } of cookiesToSet) {
            res.cookies.set(name, value, options);
          }
        },
      },
    }
  );

  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  return res;
}

// Run middleware on all routes except files
export const config = {
  matcher: ["/((?!.*\\..*).*)"],
};
