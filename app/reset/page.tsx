"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../lib/supabaseClient";

export default function ResetPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState("");

  async function handleReset(e: React.FormEvent) {
    e.preventDefault();
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      setMsg(error.message);
    } else {
      setMsg("Password updated! Redirecting to login…");
      setTimeout(() => router.replace("/login"), 1500);
    }
  }

  useEffect(() => {
    // supabase-js should already consume the access_token from URL fragment
    // and establish a session automatically
  }, []);

  return (
    <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "#0b1020", color: "#e2e8f0" }}>
      <form onSubmit={handleReset} style={{ background: "#121a2e", padding: 20, borderRadius: 12 }}>
        <h2>Set a new password</h2>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="New password"
          required
          style={{ marginBottom: 12 }}
        />
        <button type="submit" style={{ background: "#22c55e", padding: "8px 14px", borderRadius: 8 }}>
          Update Password
        </button>
        {msg && <p style={{ marginTop: 10 }}>{msg}</p>}
      </form>
    </main>
  );
}
