// app/api/auth/webhook/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";

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

  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from, to, subject, html }),
  }).catch((e) => console.error("Resend error:", e));
}

export async function POST(req: Request) {
  if (!secretOk(req)) return new NextResponse("Unauthorized", { status: 401 });

  const payload = await req.json();
  const user = payload?.record || payload?.user || payload?.new || payload;
  const id: string | undefined = user?.id;
  const email: string | undefined = user?.email;
  if (!id || !email) return NextResponse.json({ ok: true });

  // Upsert profile (approved = false by default)
  await service
    .from("profiles")
    .upsert({ id, email, role: "user", approved: false }, { onConflict: "id" });

  // Create one-time approval nonces
  if (ADMIN_EMAILS.length) {
    const nonceApprove = crypto.randomUUID();
    const nonceDeny = crypto.randomUUID();
    const expires = new Date(Date.now() + 1000 * 60 * 60); // 1 hour

    await service.from("admin_action_nonce").insert([
      { user_id: id, nonce: nonceApprove, action: "approve", expires_at: expires },
      { user_id: id, nonce: nonceDeny, action: "deny", expires_at: expires },
    ]);

    const approveUrl = `${APP_URL}/api/admin/approve?nonce=${encodeURIComponent(nonceApprove)}`;
    const denyUrl = `${APP_URL}/api/admin/approve?nonce=${encodeURIComponent(nonceDeny)}`;

    await sendEmail(
      ADMIN_EMAILS,
      "New user signup awaiting approval",
      `<p>New signup: <b>${email}</b></p>
       <p><a href="${approveUrl}">Approve</a> | <a href="${denyUrl}">Deny</a></p>`
    );
  }

  return NextResponse.json({ ok: true });
}
