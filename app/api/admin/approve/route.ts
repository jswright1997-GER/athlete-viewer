// app/api/admin/approve/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

const service = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// optional notify helper
async function sendEmail(to: string, subject: string, html: string) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM;
  if (!apiKey || !from) return;
  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to, subject, html }),
  }).catch((e) => console.error("Resend send error:", e));
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const nonce = url.searchParams.get("nonce");
  if (!nonce) return new NextResponse("Bad request", { status: 400 });

  // Lookup nonce
  const { data: record, error } = await service
    .from("admin_action_nonce")
    .select("user_id, action, expires_at, used")
    .eq("nonce", nonce)
    .single();

  if (error || !record) return new NextResponse("Invalid or expired link", { status: 400 });
  if (record.used) return new NextResponse("This link has already been used", { status: 400 });
  if (new Date(record.expires_at) < new Date()) {
    return new NextResponse("This link has expired", { status: 400 });
  }

  const approved = record.action === "approve";

  // Update profile
  const { data: profile, error: updateErr } = await service
    .from("profiles")
    .update({ approved })
    .eq("id", record.user_id)
    .select("email")
    .single();

  if (updateErr) {
    return NextResponse.json({ ok: false, error: updateErr.message }, { status: 500 });
  }

  // Mark nonce as used
  await service.from("admin_action_nonce").update({ used: true }).eq("nonce", nonce);

  // Notify user
  if (profile?.email) {
    const subject = approved
      ? "Your account has been approved"
      : "Your account has been denied";
    const body = approved
      ? `Your account is approved. You can now sign in.`
      : `Sorry, your account request was denied.`;
    await sendEmail(profile.email, subject, `<p>${body}</p>`);
  }

  const html = `
    <html><body style="font-family:sans-serif;padding:24px;background:#0b1020;color:#e2e8f0">
      <h2>${approved ? "Approved" : "Denied"}</h2>
      <p>User: ${profile?.email || record.user_id}</p>
      <p>Status updated.</p>
    </body></html>
  `;
  return new NextResponse(html, { headers: { "content-type": "text/html" } });
}
