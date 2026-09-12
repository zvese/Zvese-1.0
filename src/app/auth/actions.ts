"use server";

import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

function authRedirect(path: string, key: "error" | "message", value: string) {
  return `${path}?${new URLSearchParams({ [key]: value }).toString()}`;
}

function verifyRedirect(email: string, key: "error" | "message", value: string) {
  const params = new URLSearchParams({ email, [key]: value });
  return `/auth/verify?${params.toString()}`;
}

export async function signIn(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    redirect(authRedirect("/sign-in", "error", "Enter your email and password."));
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    redirect(authRedirect("/sign-in", "error", "We could not sign you in. Check your details and try again."));
  }

  redirect("/account");
}

export async function signUp(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!email || password.length < 8) {
    redirect(authRedirect("/sign-up", "error", "Use a valid email and a password of at least 8 characters."));
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
  });

  if (error) {
    redirect(authRedirect("/sign-up", "error", "We could not create your account. Please try again."));
  }

  if (data.session) {
    redirect("/account");
  }

  // Email confirmation required — send the user to the OTP verification page.
  // The email address is passed via query string so no password is exposed.
  redirect(`/auth/verify?email=${encodeURIComponent(email)}`);
}

export async function verifyOtp(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  const token = String(formData.get("token") ?? "").trim();

  if (!email || !token) {
    redirect(verifyRedirect(email, "error", "Enter the verification code sent to your email."));
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({ email, token, type: "email" });

  if (error) {
    const message = /expired|invalid/i.test(error.message)
      ? "That code is invalid or has expired. Request a new one or try again."
      : "We could not verify that code. Please try again.";
    redirect(verifyRedirect(email, "error", message));
  }

  // Session established by verifyOtp — no password needed again.
  redirect("/account");
}

export async function resendOtp(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();

  if (!email) {
    redirect(authRedirect("/auth/verify", "error", "We need your email to resend a code."));
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.resend({ type: "signup", email });

  if (error) {
    const message = /rate/i.test(error.message)
      ? "You requested a code too recently. Please wait a moment and try again."
      : "We could not resend the code. Please try again.";
    redirect(verifyRedirect(email, "error", message));
  }

  redirect(verifyRedirect(email, "message", "A new verification code has been sent to your email."));
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/");
}
