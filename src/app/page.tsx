import { redirect } from "next/navigation";

import { HeroSection } from "@/components/sections/hero-section";
import { signedInDestination } from "@/lib/auth/destination";
import { createClient } from "@/lib/supabase/server";

export default async function HomePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (user) redirect(await signedInDestination(supabase, user));

  return <HeroSection />;
}
