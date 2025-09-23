"use client";

import { Suspense, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useSearchParams } from "next/navigation";
import Image from "next/image";
import { supabase } from "../../lib/supabaseClient";
import BaseballIcon from "../icons/baseball.ico";

/** Small banner that reads a ?msg=… query param and shows helper text. */
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
  const [pending, startTransition] = useTransition();

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
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setErr(error.message);
    // Redirect handled by onAuthStateChange above
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
        onSubmit={(e) => startTransition(() => signin(e))}
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

        <div style={{ display: "flex", gap: 8 }}>
          <button
            type="submit"
            disabled={pending}
            style={{
              background: "#22c55e",
              color: "#0b1020",
              border: "none",
              padding: "10px 14px",
              borderRadius: 10,
              fontWeight: 800,
              cursor: "pointer",
              flex: 1,
              opacity: pending ? 0.8 : 1,
            }}
          >
            {pending ? "Signing in…" : "Sign in"}
          </button>

          {/* Dedicated signup page */}
          <button
            type="button"
            onClick={() => router.push("/signup")}
            disabled={pending}
            style={{
              background: "#334155",
              color: "#e2e8f0",
              border: "1px solid #475569",
              padding: "10px 14px",
              borderRadius: 10,
              cursor: "pointer",
              flex: 1,
              opacity: pending ? 0.8 : 1,
            }}
          >
            Create account
          </button>
        </div>
      </form>
    </main>
  );
}
