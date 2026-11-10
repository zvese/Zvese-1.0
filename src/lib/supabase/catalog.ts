import "server-only";
import { createClient } from "@supabase/supabase-js";

// Public browsing must use the anonymous RLS branch even when the viewer is a
// seller/admin. Their broader authenticated reads must never publish private drafts.
export function createCatalogClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("Marketplace configuration unavailable.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
}
