import { redirect } from "next/navigation";

import { HeroSection } from "@/components/sections/hero-section";
import { signedInDestination } from "@/lib/auth/destination";
import { createClient } from "@/lib/supabase/server";
import { getPageUser } from "@/lib/auth/page-user";

export default async function HomePage() {
  const supabase = await createClient();
  const { data: { user } } = await getPageUser();

  if (user) redirect(await signedInDestination(supabase, user));

  return <HeroSection />;
}
