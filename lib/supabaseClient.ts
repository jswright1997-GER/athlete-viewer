// lib/supabaseClient.ts
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,          // <-- required so login survives page loads
    autoRefreshToken: true,        // refresh in background
    detectSessionInUrl: true,      // parse tokens in URL fragments if present
    flowType: "pkce",              // safe default; fine for password + OAuth
  },
});
