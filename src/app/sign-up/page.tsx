import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { signUp } from "@/app/auth/actions";
import { PasswordInput } from "@/components/auth/password-input";
import { BackButton } from "@/components/navigation/back-button";
import { VerifySubmitButton } from "@/components/auth/verify-submit-button";
import { getPageUser } from "@/lib/auth/page-user";
import { signedInDestination } from "@/lib/auth/destination";
import { safeNextPath, withAuthParams } from "@/lib/auth/redirects";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Get started",
  description: "Create your Zvese account.",
};

export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string }>;
}) {
  const { error, next: requestedNext } = await searchParams;
  const next = safeNextPath(requestedNext);
  const supabase = await createClient();
  const { data: { user } } = await getPageUser();

  if (user) redirect(await signedInDestination(supabase, user, next));

  return (
    <div className="mx-auto flex max-w-md flex-col px-4 py-16 sm:px-6">
      <div className="mb-6 self-start"><BackButton /></div>
      <h1 className="text-3xl font-bold tracking-tight">Get started</h1>
      <p className="mt-3 text-muted-foreground">Create your Zvese account.</p>
      {error ? <p className="mt-6 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p> : null}
      <form action={signUp} className="mt-8 space-y-5">
        {next ? <input type="hidden" name="next" value={next} /> : null}
        <label className="block text-sm font-medium" htmlFor="sign-up-email">Email<input id="sign-up-email" name="email" type="email" autoComplete="email" required className="mt-2 w-full rounded-md border bg-background px-3 py-2.5" /></label>
        <div><label className="block text-sm font-medium" htmlFor="sign-up-password">Password</label><PasswordInput id="sign-up-password" name="password" autoComplete="new-password" minLength={8} required /></div>
        <p className="text-xs text-muted-foreground">Use at least 8 characters.</p>
        <VerifySubmitButton pendingText="Creating account…" className="w-full">Create account</VerifySubmitButton>
      </form>
      <p className="mt-6 text-center text-sm text-muted-foreground">Already have an account? <Link href={withAuthParams("/sign-in", { next })} className="font-medium text-primary hover:underline">Sign in</Link></p>
    </div>
  );
}
