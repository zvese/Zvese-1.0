import type { Metadata } from "next";
import Link from "next/link";

import { signIn } from "@/app/auth/actions";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to your Zvese account.",
};

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; message?: string }>;
}) {
  const { error, message } = await searchParams;

  return (
    <div className="mx-auto flex max-w-md flex-col px-4 py-16 sm:px-6">
      <h1 className="text-3xl font-bold tracking-tight">Sign in</h1>
      <p className="mt-3 text-muted-foreground">Welcome back to Zvese.</p>
      {message ? <p className="mt-6 rounded-md bg-accent px-3 py-2 text-sm text-accent-foreground">{message}</p> : null}
      {error ? <p className="mt-6 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p> : null}
      <form action={signIn} className="mt-8 space-y-5">
        <label className="block text-sm font-medium">Email<input name="email" type="email" autoComplete="email" required className="mt-2 w-full rounded-md border bg-background px-3 py-2.5" /></label>
        <label className="block text-sm font-medium">Password<input name="password" type="password" autoComplete="current-password" required className="mt-2 w-full rounded-md border bg-background px-3 py-2.5" /></label>
        <Button type="submit" className="w-full">Sign in</Button>
      </form>
      <p className="mt-6 text-center text-sm text-muted-foreground">New to Zvese? <Link href="/sign-up" className="font-medium text-primary hover:underline">Create an account</Link></p>
    </div>
  );
}
