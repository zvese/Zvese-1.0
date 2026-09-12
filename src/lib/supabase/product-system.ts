import "server-only";
import { createClient } from "@supabase/supabase-js";

// Never import into client code. This client must not accept a browser token.
export function createProductSystemClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Product file delivery is not configured.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
}
