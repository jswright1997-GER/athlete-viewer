// app/api/auth/set/route.ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/auth-helpers-nextjs";

export const runtime = "nodejs";

// Minimal options shape compatible with Next cookies().set(...)
type SupaCookieOptions = {
  path?: string;
  domain?: string;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: "lax" | "strict" | "none";
  maxAge?: number;
  expires?: Date;
};

type SessionPayload = {
  event?: string;
  // Supabase session object (we don’t need to type every field here)
  session: Record<string, unknown>;
};

export async function POST(req: Request) {
  const cookieStore = cookies();

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value;
        },
        set(name: string, value: string, options?: SupaCookieOptions) {
          cookieStore.set({ name, value, ...(options ?? {}) });
        },
        remove(name: string, options?: SupaCookieOptions) {
          cookieStore.set({ name, value: "", ...(options ?? {}), maxAge: 0 });
        },
      },
    }
  );

  let body: SessionPayload | null = null;
  try {
    body = (await req.json()) as SessionPayload;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  if (!body?.session) {
    return NextResponse.json({ ok: false, error: "No session" }, { status: 400 });
  }

  const { error } = await supabase.auth.setSession(body.session);
  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 401 });
  }

  return NextResponse.json({ ok: true });
}
