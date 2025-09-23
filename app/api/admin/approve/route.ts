// app/api/admin/approve/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

const service = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Optional notify helper (Resend HTTP, no SDK)
async function sendEmail(to: string, subject: string, html: string) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM;
  if (!apiKey || !from) return; // silently skip if email isn't configured

  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from, to, subject, html }),
  }).catch((e) => console.error("Resend send error:", e));
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const nonce = url.searchParams.get("nonce");

  if (!nonce) {
    return new NextResponse("Bad request", { status: 400 });
  }

  // Look up nonce (single-use, not expired)
  const { data: record, error: nonceErr } = await service
    .from("admin_action_nonce")
    .select("user_id, action, expires_at, used")
    .eq("nonce", nonce)
    .single();

  if (nonceErr || !record) {
    return new NextResponse("Invalid or expired link", { status: 400 });
  }
  if (record.used) {
    return new NextResponse("This link has already been used", { status: 400 });
  }
  if (new Date(record.expires_at) < new Date()) {
    return new NextResponse("This link has expired", { status: 400 });
  }

  const approved = record.action === "approve";

  // Update profile.approved and fetch profile details for email
  const { data: profile, error: updateErr } = await service
    .from("profiles")
    .update({ approved })
    .eq("id", record.user_id)
    .select("email, first_name, last_name, role_requested")
    .single();

  if (updateErr) {
    return NextResponse.json({ ok: false, error: updateErr.message }, { status: 500 });
  }

  // Mark nonce as used
  await service
    .from("admin_action_nonce")
    .update({ used: true })
    .eq("nonce", nonce);

  // Notify the user
  const fullName = [profile?.first_name, profile?.last_name].filter(Boolean).join(" ").trim();
  const displayName = fullName || "there";
  const roleText = profile?.role_requested ? `Role: <b>${profile.role_requested}</b><br/>` : "";

  if (profile?.email) {
    if (approved) {
      await sendEmail(
        profile.email,
        "Your account has been approved",
        `<p>Hi ${displayName},</p>
         <p>The admin has approved you to view the dashboard.</p>
         <p>${roleText}You can now sign in here:</p>
         <p><a href="${process.env.APP_URL || "https://athlete-viewer.vercel.app"}" target="_blank">Open Athlete Viewer</a></p>
         <p>— Regensburg Academy</p>`
      );
    } else {
      await sendEmail(
        profile.email,
        "Your account request was denied",
        `<p>Hi ${displayName},</p>
         <p>We're sorry — your request to access the dashboard was denied.</p>
         <p>If you believe this was a mistake, please contact support.</p>
         <p>— Regensburg Academy</p>`
      );
    }
  }

  // Simple confirmation page for the admin
  const html = `
    <html><body style="font-family:sans-serif;padding:24px;background:#0b1020;color:#e2e8f0">
      <h2>${approved ? "Approved" : "Denied"}</h2>
      <p>User: ${profile?.email || record.user_id}</p>
      <p>Status updated. ${approved ? "They’ve been emailed with next steps." : ""}</p>
      <p><a href="${process.env.APP_URL || "/"}" style="color:#93c5fd">Back to app</a></p>
    </body></html>
  `;
  return new NextResponse(html, { headers: { "content-type": "text/html" } });
}
