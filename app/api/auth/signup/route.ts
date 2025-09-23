// app/api/auth/signup/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import dns from "dns/promises";

export const runtime = "nodejs";

const supabaseAnon = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

// ---- basic helpers ----
const EMAIL_RE =
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;

// quick disposable domain blocklist (expand as needed)
const DISPOSABLE = new Set([
  "mailinator.com", "yopmail.com", "guerrillamail.com",
  "10minutemail.com", "temp-mail.org", "getnada.com",
  "trashmail.com", "dispostable.com"
]);

function domainOf(email: string) {
  const at = email.lastIndexOf("@");
  return at === -1 ? "" : email.slice(at + 1).toLowerCase();
}

async function verifyTurnstile(token: string, ip?: string) {
  const secret = process.env.TURNSTILE_SECRET_KEY!;
  const body = new URLSearchParams({ secret, response: token });
  if (ip) body.set("remoteip", ip);

  const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    body,
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });
  const data = await res.json().catch(() => ({}));
  return Boolean(data?.success);
}

async function hasMx(domain: string) {
  try {
    const rec = await dns.resolveMx(domain);
    return Array.isArray(rec) && rec.length > 0;
  } catch {
    return false;
  }
}

export async function POST(req: Request) {
  // Expect JSON body
  let body: {
    first_name?: string;
    last_name?: string;
    role_requested?: "athlete" | "coach";
    email?: string;
    password?: string;
    turnstileToken?: string;
  };

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Bad JSON" }, { status: 400 });
  }

  const ip =
    (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() ||
    undefined;

  const first_name = (body.first_name || "").trim();
  const last_name  = (body.last_name  || "").trim();
  const role_req   = (body.role_requested === "coach" ? "coach" : "athlete") as
    "coach" | "athlete";
  const email      = (body.email || "").trim().toLowerCase();
  const password   = body.password || "";
  const captcha    = body.turnstileToken || "";

  // --- Basic validations ---
  if (!captcha) {
    return NextResponse.json({ ok: false, error: "Captcha required" }, { status: 400 });
  }
  const captchaOk = await verifyTurnstile(captcha, ip);
  if (!captchaOk) {
    return NextResponse.json({ ok: false, error: "Captcha failed" }, { status: 400 });
  }

  if (!first_name || !last_name) {
    return NextResponse.json({ ok: false, error: "Name is required" }, { status: 400 });
  }

  if (!EMAIL_RE.test(email)) {
    return NextResponse.json({ ok: false, error: "Invalid email address" }, { status: 400 });
  }

  const domain = domainOf(email);
  if (DISPOSABLE.has(domain)) {
    return NextResponse.json({ ok: false, error: "Disposable email domains are not allowed" }, { status: 400 });
  }

  // optional: DNS MX check (a bit slow but good signal)
  if (!(await hasMx(domain))) {
    return NextResponse.json({ ok: false, error: "Email domain is not accepting mail (no MX records)" }, { status: 400 });
  }

  // --- password policy (example) ---
  // 10+ chars, must include lower, upper, digit, symbol
  const longEnough = password.length >= 10;
  const lower = /[a-z]/.test(password);
  const upper = /[A-Z]/.test(password);
  const digit = /[0-9]/.test(password);
  const symb  = /[^A-Za-z0-9]/.test(password);
  if (!(longEnough && lower && upper && digit && symb)) {
    return NextResponse.json(
      { ok: false, error: "Password must be 10+ chars and include lower, upper, number, and symbol." },
      { status: 400 }
    );
  }

  // --- create the user (still requires email confirmation) ---
  const { error } = await supabaseAnon.auth.signUp({
    email,
    password,
    options: {
      data: { first_name, last_name, role_requested: role_req },
      emailRedirectTo: `${process.env.APP_URL || "https://athlete-viewer.vercel.app"}/confirmed`,
    },
  });

  if (error) {
    // friendly remap for common cases
    if (error.message?.toLowerCase().includes("user already registered")) {
      return NextResponse.json({ ok: false, error: "Email is already registered." }, { status: 409 });
    }
    return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
