// app/signup/page.tsx
"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../lib/supabaseClient";

type RoleRequested = "athlete" | "coach";

declare global {
  interface Window {
    turnstile?: {
      render: (el: string | HTMLElement, opts: any) => string;
      reset: (id?: string) => void;
      getResponse: (id?: string) => string | undefined;
    };
  }
}

export default function SignupPage() {
  const router = useRouter();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName]   = useState("");
  const [roleReq, setRoleReq]     = useState<RoleRequested>("athlete");
  const [email, setEmail]         = useState("");
  const [password, setPassword]   = useState("");
  const [err, setErr]             = useState<string | null>(null);
  const [okMsg, setOkMsg]         = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [captchaId, setCaptchaId] = useState<string | null>(null);

  // Load Turnstile script
  useEffect(() => {
    const existing = document.querySelector('script[data-turnstile]');
    if (existing) return;
    const s = document.createElement("script");
    s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js";
    s.async = true;
    s.defer = true;
    s.setAttribute("data-turnstile", "true");
    document.head.appendChild(s);
  }, []);

  // Render widget
  useEffect(() => {
    const int = setInterval(() => {
      if (window.turnstile && !captchaId) {
        const id = window.turnstile.render("#cf-turnstile", {
          sitekey: process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || process.env.TURNSTILE_SITE_KEY,
          theme: "dark",
        });
        setCaptchaId(id);
      }
    }, 200);
    return () => clearInterval(int);
  }, [captchaId]);

  // If already logged in, route based on approval
  useEffect(() => {
    let mounted = true;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!mounted || !user) return;
      const { data: profile } = await supabase.from("profiles").select("approved").eq("id", user.id).single();
      router.replace(profile?.approved ? "/" : "/pending");
    })();
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_evt, session) => {
      if (!mounted) return;
      const user = session?.user;
      if (!user) return;
      const { data: profile } = await supabase.from("profiles").select("approved").eq("id", user.id).single();
      router.replace(profile?.approved ? "/" : "/pending");
    });
    return () => { mounted = false; subscription.unsubscribe(); };
  }, [router]);

  async function signup(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setOkMsg(null);

    const turnstileToken = window.turnstile?.getResponse(captchaId || undefined);
    if (!turnstileToken) {
      return setErr("Please complete the CAPTCHA.");
    }

    const res = await fetch("/api/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        first_name: firstName.trim(),
        last_name:  lastName.trim(),
        role_requested: roleReq,
        email: email.trim(),
        password,
        turnstileToken,
      }),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data?.ok) {
      setErr(data?.error || "Signup failed.");
      // reset captcha on failure
      window.turnstile?.reset(captchaId || undefined);
      return;
    }

    setOkMsg("Account created. Please check your email to confirm.");
    // Optionally send them to login with a message:
    // router.replace("/login?msg=check_email");
  }

  return (
    <main style={{ minHeight: "100vh", background: "#0b1020", display: "grid", placeItems: "center", color: "#e2e8f0", padding: 16 }}>
      <form onSubmit={(e) => startTransition(() => signup(e))}
            style={{ width: "100%", maxWidth: 480, background: "#121a2e", border: "1px solid #1f2937", borderRadius: 16, padding: 20 }}>
        <h2 style={{ margin: 0, fontWeight: 800, letterSpacing: 0.2, marginBottom: 16 }}>Create account</h2>

        <div style={{ display: "grid", gap: 10, gridTemplateColumns: "1fr 1fr", marginBottom: 10 }}>
          <label style={{ display: "grid", gap: 6 }}>
            <span style={{ fontSize: 12, color: "#94a3b8" }}>First name</span>
            <input value={firstName} onChange={(e) => setFirstName(e.target.value)} required
                   style={{ background: "#0f172a", color: "#e2e8f0", border: "1px solid #1f2937", padding: "10px 12px", borderRadius: 10 }} />
          </label>
          <label style={{ display: "grid", gap: 6 }}>
            <span style={{ fontSize: 12, color: "#94a3b8" }}>Last name</span>
            <input value={lastName} onChange={(e) => setLastName(e.target.value)} required
                   style={{ background: "#0f172a", color: "#e2e8f0", border: "1px solid #1f2937", padding: "10px 12px", borderRadius: 10 }} />
          </label>
        </div>

        <label style={{ display: "grid", gap: 6, marginBottom: 10 }}>
          <span style={{ fontSize: 12, color: "#94a3b8" }}>I am a</span>
          <select value={roleReq} onChange={(e) => setRoleReq(e.target.value as RoleRequested)}
                  style={{ background: "#0f172a", color: "#e2e8f0", border: "1px solid #1f2937", padding: "10px 12px", borderRadius: 10 }}>
            <option value="athlete">Athlete</option>
            <option value="coach">Coach</option>
          </select>
        </label>

        <label style={{ display: "grid", gap: 6, marginBottom: 10 }}>
          <span style={{ fontSize: 12, color: "#94a3b8" }}>Email</span>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email"
                 style={{ background: "#0f172a", color: "#e2e8f0", border: "1px solid #1f2937", padding: "10px 12px", borderRadius: 10 }} />
        </label>

        <label style={{ display: "grid", gap: 6, marginBottom: 16 }}>
          <span style={{ fontSize: 12, color: "#94a3b8" }}>Password</span>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="new-password"
                 placeholder="10+ chars, upper/lower/number/symbol"
                 style={{ background: "#0f172a", color: "#e2e8f0", border: "1px solid #1f2937", padding: "10px 12px", borderRadius: 10 }} />
        </label>

        {/* Turnstile */}
        <div id="cf-turnstile" style={{ marginBottom: 14 }} />

        {err && <div style={{ color: "#fca5a5", fontSize: 13, marginBottom: 10 }}>{err}</div>}
        {okMsg && <div style={{ color: "#86efac", fontSize: 13, marginBottom: 10 }}>{okMsg}</div>}

        <div style={{ display: "flex", gap: 8 }}>
          <button type="submit" disabled={pending}
                  style={{ background: "#22c55e", color: "#0b1020", border: "none", padding: "10px 14px", borderRadius: 10, fontWeight: 800, cursor: "pointer", flex: 1, opacity: pending ? 0.8 : 1 }}>
            {pending ? "Creating…" : "Create account"}
          </button>
          <button type="button" onClick={() => router.push("/login")} disabled={pending}
                  style={{ background: "#334155", color: "#e2e8f0", border: "1px solid #475569", padding: "10px 14px", borderRadius: 10, cursor: "pointer", flex: 1, opacity: pending ? 0.8 : 1 }}>
            Back to sign in
          </button>
        </div>
      </form>
    </main>
  );
}
