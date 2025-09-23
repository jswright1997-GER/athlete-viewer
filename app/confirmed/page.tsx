"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";


export default function ConfirmedPage() {
  const router = useRouter();

  useEffect(() => {
    let mounted = true;

    // Wait a tick so the SDK can process the confirmation URL if needed
    const t = setTimeout(async () => {
      if (!mounted) return;

      // Optional: sign the user out to avoid confusion (they're unapproved anyway)
      // await supabase.auth.signOut();

      router.replace("/login?msg=await_approval");
    }, 400);

    return () => { mounted = false; clearTimeout(t); };
  }, [router]);

  return (
    <main style={{ minHeight: "50vh", display: "grid", placeItems: "center", color: "#e2e8f0", background: "#0b1020" }}>
      <p>Confirming your email…</p>
    </main>
  );
}
