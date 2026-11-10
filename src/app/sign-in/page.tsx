import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { signIn } from "@/app/auth/actions";
import { PasswordInput } from "@/components/auth/password-input";
import { BackButton } from "@/components/navigation/back-button";
import { Button } from "@/components/ui/button";
import { signedInDestination } from "@/lib/auth/destination";
import { safeNextPath, withAuthParams } from "@/lib/auth/redirects";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to your Zvese account.",
};

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; message?: string; next?: string }>;
}) {
  const { error, message, next: requestedNext } = await searchParams;
  const next = safeNextPath(requestedNext);
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (user) redirect(await signedInDestination(supabase, user, next));

  return (
    <div className="mx-auto flex max-w-md flex-col px-4 py-16 sm:px-6">
      <div className="mb-6 self-start"><BackButton /></div>
      <h1 className="text-3xl font-bold tracking-tight">Sign in</h1>
      <p className="mt-3 text-muted-foreground">Welcome back to Zvese.</p>
      {message ? <p className="mt-6 rounded-md bg-accent px-3 py-2 text-sm text-accent-foreground">{message}</p> : null}
      {error ? <p className="mt-6 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p> : null}
      <form action={signIn} className="mt-8 space-y-5">
        {next ? <input type="hidden" name="next" value={next} /> : null}
        <label className="block text-sm font-medium" htmlFor="sign-in-email">Email<input id="sign-in-email" name="email" type="email" autoComplete="email" required className="mt-2 w-full rounded-md border bg-background px-3 py-2.5" /></label>
        <div><label className="block text-sm font-medium" htmlFor="sign-in-password">Password</label><PasswordInput id="sign-in-password" name="password" autoComplete="current-password" required /></div>
        <Button type="submit" className="w-full">Sign in</Button>
      </form>
      <p className="mt-6 text-center text-sm text-muted-foreground">New to Zvese? <Link href={withAuthParams("/sign-up", { next })} className="font-medium text-primary hover:underline">Create an account</Link></p>
    </div>
  );
}
