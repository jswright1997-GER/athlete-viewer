// app/api/admin/approve/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

const service = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// --- optional email helper via Resend HTTP (no SDK) ---
async function sendEmail(to: string, subject: string, html: string) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM;
  if (!apiKey || !from) return; // silently skip if email is not configured

  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from, to, subject, html }),
  }).catch((e) => {
    console.error("Resend send error:", e);
  });
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const userId = url.searchParams.get("user_id");
  const action = url.searchParams.get("action"); // "approve" | "deny"
  const token  = url.searchParams.get("token");

  // authorize admin action
  if (!token || token !== process.env.ADMIN_ACTION_TOKEN) {
    return new NextResponse("Unauthorized", { status: 401 });
  }
  if (!userId || !["approve", "deny"].includes(action || "")) {
    return new NextResponse("Bad request", { status: 400 });
  }

  const approved = action === "approve";

  // update the profile row
  const { data, error } = await service
    .from("profiles")
    .update({ approved })
    .eq("id", userId)
    .select("email")
    .single();

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  // optional notify user
  if (data?.email) {
    const subject = approved
      ? "Your Regensburg Academy account was approved"
      : "Your Regensburg Academy account was denied";
    const body = approved
      ? `Your account is approved. You can now sign in.`
      : `Sorry, your account request was denied.`;
    await sendEmail(data.email, subject, `<p>${body}</p>`);
  }

  const html = `
    <html><body style="font-family:sans-serif;padding:24px;background:#0b1020;color:#e2e8f0">
      <h2>${approved ? "Approved" : "Denied"}</h2>
      <p>User: ${data?.email || userId}</p>
      <p>Status updated.</p>
    </body></html>
  `;
  return new NextResponse(html, { headers: { "content-type": "text/html" } });
}
