"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useSearchParams } from "next/navigation";
import Image from "next/image";
import { supabase } from "../../lib/supabaseClient";
import BaseballIcon from "../icons/baseball.ico";

/** Shows friendly banners based on ?msg=… */
function LoginBanner() {
  const params = useSearchParams();
  const msg = params.get("msg");
  if (msg === "await_approval") {
    return (
      <div style={{ background: "#0f172a", border: "1px solid #334155", color: "#93c5fd", padding: "10px 12px", borderRadius: 10, marginBottom: 12 }}>
        Email confirmed. Please await approval from an admin.
      </div>
    );
  }
  if (msg === "check_email") {
    return (
      <div style={{ background: "#0f172a", border: "1px solid #334155", color: "#93c5fd", padding: "10px 12px", borderRadius: 10, marginBottom: 12 }}>
        Please check your inbox and click the confirmation link to continue.
      </div>
    );
  }
  return null;
}

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // If already signed in, route to / or /pending based on approval
  useEffect(() => {
    let mounted = true;

    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!mounted || !user) return;
      const { data: profile } = await supabase
        .from("profiles")
        .select("approved")
        .eq("id", user.id)
        .single();
      router.replace(profile?.approved ? "/" : "/pending");
    })();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_evt, session) => {
      if (!mounted) return;
      const user = session?.user;
      if (!user) return;
      const { data: profile } = await supabase
        .from("profiles")
        .select("approved")
        .eq("id", user.id)
        .single();
      router.replace(profile?.approved ? "/" : "/pending");
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [router]);

  async function signin(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setIsLoading(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (error) {
        // Give clearer guidance for common cases
        const msg = error.message?.toLowerCase() || "";
        if (msg.includes("invalid login credentials")) {
          setErr("Invalid email or password.");
        } else if (msg.includes("email not confirmed")) {
          setErr("Your email isn’t confirmed yet. Check your inbox or resend below.");
        } else {
          setErr(error.message);
        }
        // small delay to avoid brute-force hammering UX
        await new Promise((r) => setTimeout(r, 350));
        return;
      }
      // onAuthStateChange handler will redirect to / or /pending
    } finally {
      setIsLoading(false);
    }
  }

  async function resendConfirmation() {
    setErr(null);
    setIsLoading(true);
    try {
      const { error } = await supabase.auth.resend({ type: "signup", email: email.trim() });
      if (error) {
        setErr(error.message);
      } else {
        // nudge the user to check email
        router.replace("/login?msg=check_email");
      }
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

        {/* Banner for messages like ?msg=await_approval */}
        <Suspense fallback={null}>
          <LoginBanner />
        </Suspense>

        <label style={{ display: "grid", gap: 6, marginBottom: 10 }}>
          <span style={{ fontSize: 12, color: "#94a3b8" }}>Email</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
            style={{ background: "#0f172a", color: "#e2e8f0", border: "1px solid #1f2937", padding: "10px 12px", borderRadius: 10 }}
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
            style={{ background: "#0f172a", color: "#e2e8f0", border: "1px solid #1f2937", padding: "10px 12px", borderRadius: 10 }}
          />
        </label>

        {err && (
          <div style={{ color: "#fca5a5", fontSize: 13, marginBottom: 10 }}>{err}</div>
        )}

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

        {/* Helper to resend confirmation if needed */}
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
