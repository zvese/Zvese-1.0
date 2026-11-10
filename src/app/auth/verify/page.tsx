import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { resendOtp, verifyOtp } from "@/app/auth/actions";
import { BackButton } from "@/components/navigation/back-button";
import { Button } from "@/components/ui/button";
import { VerifySubmitButton } from "@/components/auth/verify-submit-button";
import { signedInDestination } from "@/lib/auth/destination";
import { safeNextPath, withAuthParams } from "@/lib/auth/redirects";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Verify your email",
  description: "Enter the verification code we sent to your email.",
};

export default async function VerifyPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string; error?: string; message?: string; next?: string }>;
}) {
  const { email = "", error, message, next: requestedNext } = await searchParams;
  const next = safeNextPath(requestedNext);
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (user) redirect(await signedInDestination(supabase, user, next));

  return (
    <div className="mx-auto flex max-w-md flex-col px-4 py-16 sm:px-6">
      <div className="mb-6 self-start"><BackButton fallback="/sign-up" /></div>
      <h1 className="text-3xl font-bold tracking-tight">Check your email</h1>
      <p className="mt-3 text-muted-foreground">
        We sent a verification code to{" "}
        <span className="font-semibold text-foreground">{email || "your email"}</span>.
      </p>

      {message ? (
        <p className="mt-6 rounded-md bg-accent px-3 py-2 text-sm text-accent-foreground">{message}</p>
      ) : null}
      {error ? (
        <p className="mt-6 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
      ) : null}

      {email ? (
        <>
          <form action={verifyOtp} className="mt-8 space-y-5">
            <input type="hidden" name="email" value={email} />
            {next ? <input type="hidden" name="next" value={next} /> : null}
            <label className="block text-sm font-medium">
              Verification code
              <input
                name="token"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]*"
                placeholder="6-digit code"
                required
                className="mt-2 w-full rounded-md border bg-background px-3 py-2.5 text-center text-xl tracking-[0.3em]"
              />
            </label>
            <VerifySubmitButton pendingText="Verifying…">Verify</VerifySubmitButton>
          </form>

          <form action={resendOtp} className="mt-4">
            <input type="hidden" name="email" value={email} />
            {next ? <input type="hidden" name="next" value={next} /> : null}
            <VerifySubmitButton pendingText="Sending…" variant="outline">
              Resend code
            </VerifySubmitButton>
          </form>
        </>
      ) : (
        <div className="mt-8 flex flex-wrap gap-3">
          <Button asChild variant="outline">
            <Link href={withAuthParams("/sign-up", { next })}>Back to sign up</Link>
          </Button>
        </div>
      )}
    </div>
  );
}
