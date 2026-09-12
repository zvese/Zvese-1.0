import type { Metadata } from "next";
import Link from "next/link";

import { signUp } from "@/app/auth/actions";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Get started",
  description: "Create your Zvese account.",
};

export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <div className="mx-auto flex max-w-md flex-col px-4 py-16 sm:px-6">
      <h1 className="text-3xl font-bold tracking-tight">Get started</h1>
      <p className="mt-3 text-muted-foreground">Create your Zvese account.</p>
      {error ? <p className="mt-6 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p> : null}
      <form action={signUp} className="mt-8 space-y-5">
        <label className="block text-sm font-medium">Email<input name="email" type="email" autoComplete="email" required className="mt-2 w-full rounded-md border bg-background px-3 py-2.5" /></label>
        <label className="block text-sm font-medium">Password<input name="password" type="password" autoComplete="new-password" minLength={8} required className="mt-2 w-full rounded-md border bg-background px-3 py-2.5" /></label>
        <p className="text-xs text-muted-foreground">Use at least 8 characters.</p>
        <Button type="submit" className="w-full">Create account</Button>
      </form>
      <p className="mt-6 text-center text-sm text-muted-foreground">Already have an account? <Link href="/sign-in" className="font-medium text-primary hover:underline">Sign in</Link></p>
    </div>
  );
}
