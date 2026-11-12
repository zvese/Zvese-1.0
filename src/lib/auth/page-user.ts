import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

// React request memoization only. Never use a public/global auth cache or use
// this helper for the fresh authorization recheck before a privileged mutation.
export const getPageUser = cache(async () => {
  const supabase = await createClient();
  return supabase.auth.getUser();
});
