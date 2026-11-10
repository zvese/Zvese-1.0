import "server-only";

import type { SupabaseClient, User } from "@supabase/supabase-js";

import { defaultSignedInPath, safeNextPath } from "@/lib/auth/redirects";

export async function signedInDestination(
  supabase: SupabaseClient,
  user: User,
  requestedNext?: string | null
) {
  const safeNext = safeNextPath(requestedNext);
  if (safeNext) return safeNext;

  const { data: sellerProfile } = await supabase
    .from("seller_profiles")
    .select("status")
    .eq("user_id", user.id)
    .maybeSingle();

  return defaultSignedInPath(sellerProfile?.status);
}
