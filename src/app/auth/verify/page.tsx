import type { Metadata } from "next";
import Link from "next/link";

import { resendOtp, verifyOtp } from "@/app/auth/actions";
import { Button } from "@/components/ui/button";
import { VerifySubmitButton } from "@/components/auth/verify-submit-button";

export const metadata: Metadata = {
  title: "Verify your email",
  description: "Enter the verification code we sent to your email.",
};

export default async function VerifyPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string; error?: string; message?: string }>;
}) {
  const { email = "", error, message } = await searchParams;

  return (
    <div className="mx-auto flex max-w-md flex-col px-4 py-16 sm:px-6">
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
            <VerifySubmitButton pendingText="Sending…" variant="outline">
              Resend code
            </VerifySubmitButton>
          </form>
        </>
      ) : (
        <div className="mt-8 flex flex-wrap gap-3">
          <Button asChild variant="outline">
            <Link href="/sign-up">Back to sign up</Link>
          </Button>
        </div>
      )}
    </div>
  );
}