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

/** Verify Supabase webhook signature header (x-supabase-signature: v1,<hex>) */
function verifySupabaseSignature(req: Request, rawBody: string): boolean {
  const header = req.headers.get("x-supabase-signature") || req.headers.get("x-webhook-signature");
  if (!header) return false;
  const [version, signature] = header.split(",", 2);
  if (version?.trim() !== "v1" || !signature) return false;

  const secret = process.env.AUTH_WEBHOOK_SECRET!;
  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");

  // constant-time compare
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

/** Back-compat: allow either our simple shared-secret headers OR the signature. */
async function isAuthorized(req: Request, rawBody: string): Promise<boolean> {
  // Signature check
  if (verifySupabaseSignature(req, rawBody)) return true;

  // Fallback to simple header checks (useful for local tests)
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
  if (!apiKey || !from || !to?.length) return;

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
  // IMPORTANT: read raw body first (for signature)
  const raw = await req.text();
  if (!(await isAuthorized(req, raw))) return new NextResponse("Unauthorized", { status: 401 });

  // Parse after auth
  let payload: any;
  try {
    payload = JSON.parse(raw);
  } catch {
    return new NextResponse("Bad JSON", { status: 400 });
  }

  // Supabase Auth "User Created" payloads usually include user info at one of these paths
  const user =
    payload?.record || payload?.user || payload?.new || payload?.payload || payload;
  const id: string | undefined = user?.id;
  const email: string | undefined = user?.email;
  if (!id || !email) return NextResponse.json({ ok: true });

  // Upsert unapproved profile
  await service
    .from("profiles")
    .upsert({ id, email, role: "user", approved: false }, { onConflict: "id" });

  // One-time nonces for approve/deny
  if (ADMIN_EMAILS.length) {
    const expires = new Date(Date.now() + 1000 * 60 * 60); // 1h
    const nonceApprove = crypto.randomUUID();
    const nonceDeny = crypto.randomUUID();

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
