// app/login/page.tsx
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { supabase } from "../../lib/supabaseClient";
import BaseballIcon from "../icons/baseball.ico";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // If already signed in (local session), go home.
  useEffect(() => {
    let mounted = true;
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!mounted) return;
      if (data.session) router.replace("/");
    })();
    return () => {
      mounted = false;
    };
  }, [router]);

  async function signin(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setIsLoading(true);

    try {
      // 1) Password login
      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password,
      });

      if (error) {
        const msg = (error.message || "").toLowerCase();
        if (msg.includes("email not confirmed")) {
          setErr("Your email isn’t confirmed yet. Click the link we sent or use “Resend confirmation”.");
        } else if (msg.includes("invalid login credentials")) {
          setErr("Invalid email or password.");
        } else {
          setErr(error.message);
        }
        return;
      }

      // 2) Grab current session from client
      const { data: s } = await supabase.auth.getSession();
      const access_token = s.session?.access_token;
      const refresh_token = s.session?.refresh_token;
      if (!access_token || !refresh_token) {
        setErr("Signed in, but session didn’t load. If you use private mode or strict blockers, allow storage for this site and try again.");
        return;
      }

      // 3) Sync tokens to server cookies so middleware/server can read session
      const res = await fetch("/api/auth/set", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ access_token, refresh_token }),
      });
      if (!res.ok) {
        const { error: apiErr } = (await res.json().catch(() => ({}))) as { error?: string };
        setErr(apiErr || "Failed to persist session. Please try again.");
        return;
      }

      // 4) Hard navigate so server immediately sees the sb-* cookies
      window.location.assign("/");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Unexpected error signing in.");
    } finally {
      setIsLoading(false);
    }
  }

  async function resendConfirmation() {
    setErr(null);
    setIsLoading(true);
    try {
      const { error } = await supabase.auth.resend({
        type: "signup",
        email: email.trim().toLowerCase(),
      });
      if (error) setErr(error.message);
      else router.replace("/login?msg=check_email");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <main
      style={{
        minHeight: "100vh",
        background: "#0b1020",
        display: "grid",
        placeItems: "center",
        color: "#e2e8f0",
        padding: 16,
      }}
    >
      <form
        onSubmit={signin}
        style={{
          width: "100%",
          maxWidth: 420,
          background: "#121a2e",
          border: "1px solid #1f2937",
          borderRadius: 16,
          padding: 20,
          boxShadow: "0 1px 0 rgba(255,255,255,0.06) inset",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
          <Image src={BaseballIcon} alt="Logo" width={28} height={28} style={{ borderRadius: 6 }} />
          <h2 style={{ margin: 0, fontWeight: 800, letterSpacing: 0.2 }}>Sign in</h2>
        </div>

        <label style={{ display: "grid", gap: 6, marginBottom: 10 }}>
          <span style={{ fontSize: 12, color: "#94a3b8" }}>Email</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
            style={{
              background: "#0f172a",
              color: "#e2e8f0",
              border: "1px solid #1f2937",
              padding: "10px 12px",
              borderRadius: 10,
            }}
          />
        </label>

        <label style={{ display: "grid", gap: 6, marginBottom: 14 }}>
          <span style={{ fontSize: 12, color: "#94a3b8" }}>Password</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="current-password"
            style={{
              background: "#0f172a",
              color: "#e2e8f0",
              border: "1px solid #1f2937",
              padding: "10px 12px",
              borderRadius: 10,
            }}
          />
        </label>

        {err && <div style={{ color: "#fca5a5", fontSize: 13, marginBottom: 10 }}>{err}</div>}

        <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
          <button
            type="submit"
            disabled={isLoading}
            style={{
              background: "#22c55e",
              color: "#0b1020",
              border: "none",
              padding: "10px 14px",
              borderRadius: 10,
              fontWeight: 800,
              cursor: "pointer",
              flex: 1,
              opacity: isLoading ? 0.8 : 1,
            }}
          >
            {isLoading ? "Signing in…" : "Sign in"}
          </button>

          <button
            type="button"
            onClick={() => router.push("/signup")}
            disabled={isLoading}
            style={{
              background: "#334155",
              color: "#e2e8f0",
              border: "1px solid #475569",
              padding: "10px 14px",
              borderRadius: 10,
              cursor: "pointer",
              flex: 1,
              opacity: isLoading ? 0.8 : 1,
            }}
          >
            Create account
          </button>
        </div>

        <button
          type="button"
          onClick={resendConfirmation}
          disabled={isLoading || !email}
          style={{
            width: "100%",
            background: "transparent",
            color: "#93c5fd",
            border: "none",
            textDecoration: "underline",
            cursor: email ? "pointer" : "not-allowed",
          }}
        >
          Resend confirmation email
        </button>
      </form>
    </main>
  );
}
