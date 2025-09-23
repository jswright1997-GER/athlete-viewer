// app/api/admin/approve/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY || "");
const service = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(req: Request) {
  const url = new URL(req.url);
  const userId = url.searchParams.get("user_id");
  const action = url.searchParams.get("action"); // "approve" | "deny"
  const token  = url.searchParams.get("token");

  if (!token || token !== process.env.ADMIN_ACTION_TOKEN)
    return new NextResponse("Unauthorized", { status: 401 });

  if (!userId || !["approve", "deny"].includes(action || ""))
    return new NextResponse("Bad request", { status: 400 });

  const approved = action === "approve";

  // Update profile
  const { data, error } = await service
    .from("profiles")
    .update({ approved })
    .eq("id", userId)
    .select("email")
    .single();

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  // Optional: notify the user
  if (resend && process.env.RESEND_FROM && data?.email) {
    const subject = approved ? "Your account was approved" : "Your account was denied";
    const body = approved
      ? `Your account is approved. You can now sign in.`
      : `Sorry, your account request was denied.`;
    await resend.emails.send({
      from: process.env.RESEND_FROM!,
      to: data.email,
      subject,
      html: `<p>${body}</p>`,
    });
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
