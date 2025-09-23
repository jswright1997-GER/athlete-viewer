// app/api/auth/set/route.ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/auth-helpers-nextjs";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const cookieStore = cookies();

  // minimal cookie adapter for auth-helpers
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value;
        },
        set(name: string, value: string, options: any) {
          cookieStore.set({ name, value, ...options });
        },
        remove(name: string, options: any) {
          cookieStore.set({ name, value: "", ...options, maxAge: 0 });
        },
      },
    }
  );

  const { session } = await req.json(); // { event, session } also OK
  if (!session) return NextResponse.json({ ok: false, error: "No session" }, { status: 400 });

  // This writes the sb-* auth cookies so middleware/server can see the session
  const { error } = await supabase.auth.setSession(session);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 401 });

  return NextResponse.json({ ok: true });
}
