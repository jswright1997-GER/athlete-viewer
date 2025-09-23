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
  const header =
    req.headers.get("x-supabase-signature") || req.headers.get("x-webhook-signature");
  if (!header) return false;

  const [version, signature] = header.split(",", 2);
  if ((version || "").trim() !== "v1" || !signature) return false;

  const secret = process.env.AUTH_WEBHOOK_SECRET!;
  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");

  try {
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    return false;
  }
}

/** Back-compat: allow either Supabase signature or a simple shared-secret header */
function isAuthorizedFallback(req: Request): boolean {
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

type UserMeta = {
  first_name?: string;
  last_name?: string;
  role_requested?: "athlete" | "coach" | string;
};

type UserLike = {
  id?: string;
  email?: string;
  user_metadata?: UserMeta;
  record?: UserLike;
  user?: UserLike;
  new?: UserLike;
  payload?: UserLike;
};

export async function POST(req: Request) {
  // Read raw body first (needed for signature verification)
  const raw = await req.text();

  const authorized = verifySupabaseSignature(req, raw) || isAuthorizedFallback(req);
  if (!authorized) return new NextResponse("Unauthorized", { status: 401 });

  // Parse JSON
  let payload: UserLike;
  try {
    payload = JSON.parse(raw) as UserLike;
  } catch {
    return new NextResponse("Bad JSON", { status: 400 });
  }

  // Supabase payload usually nests user at one of these keys
  const u = payload.record || payload.user || payload.new || payload.payload || payload;
  const id = u?.id;
  const email = u?.email;
  const meta: UserMeta = {
    first_name: (u?.user_metadata?.first_name || "").toString().slice(0, 120),
    last_name: (u?.user_metadata?.last_name || "").toString().slice(0, 120),
    role_requested: (u?.user_metadata?.role_requested || "").toString().toLowerCase(),
  };

  const role_requested =
    meta.role_requested === "coach" ? "coach" : meta.role_requested === "athlete" ? "athlete" : null;

  if (!id || !email) {
    // Nothing to do; acknowledge so Supabase doesn't retry
    return NextResponse.json({ ok: true });
  }

  // --- Preserve existing role/approved; create if missing ---
  const { data: existing, error: readErr } = await service
    .from("profiles")
    .select("id, approved, role")
    .eq("id", id)
    .single();

  if (readErr && (readErr as any).code !== "PGRST116") {
    // PGRST116 = no rows found
    console.error("profiles read error:", readErr);
    return new NextResponse("Profile read error", { status: 500 });
  }

  if (!existing) {
    // First time we see this user -> create an unapproved 'user' profile
    const insertPayload: Record<string, unknown> = {
      id,
      email,
      role: "user",
      approved: false,
    };
    if (meta.first_name) insertPayload.first_name = meta.first_name;
    if (meta.last_name) insertPayload.last_name = meta.last_name;
    if (role_requested) insertPayload.role_requested = role_requested;

    const { error: insErr } = await service.from("profiles").insert(insertPayload);
    if (insErr) {
      console.error("profiles insert error:", insErr);
      return new NextResponse("Profile insert error", { status: 500 });
    }
  } else {
    // Profile exists -> only update metadata; DO NOT touch approved/role
    const updatePayload: Record<string, unknown> = {
      email,
    };
    if (meta.first_name) updatePayload.first_name = meta.first_name;
    if (meta.last_name) updatePayload.last_name = meta.last_name;
    if (role_requested) updatePayload.role_requested = role_requested;

    const { error: updErr } = await service
      .from("profiles")
      .update(updatePayload)
      .eq("id", id);

    if (updErr) {
      console.error("profiles update error:", updErr);
      return new NextResponse("Profile update error", { status: 500 });
    }
  }

  // --- One-time approve/deny links to admins ---
  if (ADMIN_EMAILS.length) {
    const expires = new Date(Date.now() + 1000 * 60 * 60); // 1 hour
    const nonceApprove = crypto.randomUUID();
    const nonceDeny = crypto.randomUUID();

    const { error: nonceErr } = await service.from("admin_action_nonce").insert([
      { user_id: id, nonce: nonceApprove, action: "approve", expires_at: expires },
      { user_id: id, nonce: nonceDeny, action: "deny", expires_at: expires },
    ]);

    if (nonceErr) {
      console.error("nonce insert error:", nonceErr);
      // continue anyway; not fatal for profile creation
    }

    const approveUrl = `${APP_URL}/api/admin/approve?nonce=${encodeURIComponent(nonceApprove)}`;
    const denyUrl = `${APP_URL}/api/admin/approve?nonce=${encodeURIComponent(nonceDeny)}`;

    const first = meta.first_name ? meta.first_name : "";
    const last = meta.last_name ? meta.last_name : "";
    const nameLine = (first || last) ? `<p>Name: <b>${first} ${last}</b></p>` : "";
    const roleLine = role_requested ? `<p>Role requested: <b>${role_requested}</b></p>` : "";

    await sendEmail(
      ADMIN_EMAILS,
      "New user signup awaiting approval",
      `<p>New signup: <b>${email}</b></p>
       ${nameLine}
       ${roleLine}
       <p><a href="${approveUrl}">Approve</a> | <a href="${denyUrl}">Deny</a></p>`
    );
  }

  return NextResponse.json({ ok: true });
}
