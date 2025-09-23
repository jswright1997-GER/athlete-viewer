// app/api/auth/webhook/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

const service = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const APP_URL = process.env.APP_URL || "http://localhost:3000";

function secretOk(req: Request) {
  const want = process.env.AUTH_WEBHOOK_SECRET!;
  const x = req.headers.get("x-auth-secret");
  const auth = req.headers.get("authorization"); // Bearer <secret>
  if (x && x === want) return true;
  if (auth && /^Bearer\s+/i.test(auth) && auth.replace(/^Bearer\s+/i, "") === want) return true;
  return false;
}

// --- simple Resend HTTP helper (no SDK) ---
async function sendEmail(to: string[], subject: string, html: string) {
  const apiKey = process.env.RESEND_API_KEY!;
  const from = process.env.RESEND_FROM!;
  if (!apiKey || !from) return;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from, to, subject, html }),
  });

  if (!res.ok) {
    const msg = await res.text().catch(() => res.statusText);
    console.error("Resend error:", res.status, msg);
  }
}

export async function POST(req: Request) {
  if (!secretOk(req)) return new NextResponse("Unauthorized", { status: 401 });

  const payload = await req.json();
  const user = payload?.record || payload?.user || payload?.new || payload;
  const id: string | undefined = user?.id;
  const email: string | undefined = user?.email;
  if (!id || !email) return NextResponse.json({ ok: true });

  await service
    .from("profiles")
    .upsert({ id, email, role: "user", approved: false }, { onConflict: "id" });

  if (ADMIN_EMAILS.length && process.env.RESEND_API_KEY && process.env.RESEND_FROM) {
    const token = process.env.ADMIN_ACTION_TOKEN!;
    const approveUrl = `${APP_URL}/api/admin/approve?user_id=${encodeURIComponent(id)}&token=${encodeURIComponent(token)}&action=approve`;
    const denyUrl = `${APP_URL}/api/admin/approve?user_id=${encodeURIComponent(id)}&token=${encodeURIComponent(token)}&action=deny`;

    await sendEmail(
      ADMIN_EMAILS,
      "New user signup awaiting approval",
      `<p>New signup: <b>${email}</b></p>
       <p><a href="${approveUrl}">Approve</a> | <a href="${denyUrl}">Deny</a></p>`
    );
  }

  return NextResponse.json({ ok: true });
}
