"use client";

import { useState, useTransition } from "react";
import { supabase } from "../../lib/supabaseClient";
import Image from "next/image";
import BaseballIcon from "../icons/baseball.ico";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  async function signin(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setErr(error.message);
  }

  async function signup(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: `${location.origin}/` },
    });
    if (error) setErr(error.message);
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

        <label style={{ display: "grid", gap: 6, marginBottom: 10 }}>
          <span style={{ fontSize: 12, color: "#94a3b8" }}>Email</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
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
            }}
          >
            Sign in
          </button>
          <button
            type="button"
            onClick={(e) => startTransition(() => signup(e))}
            disabled={pending}
            style={{
              background: "#334155",
              color: "#e2e8f0",
              border: "1px solid #475569",
              padding: "10px 14px",
              borderRadius: 10,
              cursor: "pointer",
              flex: 1,
            }}
          >
            Create account
          </button>
        </div>
      </form>
    </main>
  );
}
