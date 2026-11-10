"use server";

import { redirect } from "next/navigation";

import { signedInDestination } from "@/lib/auth/destination";
import { safeNextPath, withAuthParams } from "@/lib/auth/redirects";
import { createClient } from "@/lib/supabase/server";

function nextFrom(formData: FormData) {
  return safeNextPath(formData.get("next"));
}

export async function signIn(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const next = nextFrom(formData);

  if (!email || !password) {
    redirect(withAuthParams("/sign-in", {
      error: "Enter your email and password.",
      next,
    }));
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error || !data.user) {
    redirect(withAuthParams("/sign-in", {
      error: "We could not sign you in. Check your details and try again.",
      next,
    }));
  }

  redirect(await signedInDestination(supabase, data.user, next));
}

export async function signUp(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const next = nextFrom(formData);

  if (!email || password.length < 8) {
    redirect(withAuthParams("/sign-up", {
      error: "Use a valid email and a password of at least 8 characters.",
      next,
    }));
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({ email, password });

  if (error) {
    redirect(withAuthParams("/sign-up", {
      error: "We could not create your account. Please try again.",
      next,
    }));
  }

  if (data.session && data.user) {
    redirect(await signedInDestination(supabase, data.user, next));
  }

  // Email confirmation required; only the address and safe destination continue.
  redirect(withAuthParams("/auth/verify", { email, next }));
}

export async function verifyOtp(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  const token = String(formData.get("token") ?? "").trim();
  const next = nextFrom(formData);

  if (!email || !token) {
    redirect(withAuthParams("/auth/verify", {
      email,
      error: "Enter the verification code sent to your email.",
      next,
    }));
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.verifyOtp({ email, token, type: "email" });

  if (error) {
    const message = /expired|invalid/i.test(error.message)
      ? "That code is invalid or has expired. Request a new one or try again."
      : "We could not verify that code. Please try again.";
    redirect(withAuthParams("/auth/verify", { email, error: message, next }));
  }

  if (!data.user) {
    redirect(withAuthParams("/sign-in", {
      error: "Your email was verified, but a session could not be started. Please sign in.",
      next,
    }));
  }

  redirect(await signedInDestination(supabase, data.user, next));
}

export async function resendOtp(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  const next = nextFrom(formData);

  if (!email) {
    redirect(withAuthParams("/auth/verify", {
      error: "We need your email to resend a code.",
      next,
    }));
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.resend({ type: "signup", email });

  if (error) {
    const message = /rate/i.test(error.message)
      ? "You requested a code too recently. Please wait a moment and try again."
      : "We could not resend the code. Please try again.";
    redirect(withAuthParams("/auth/verify", { email, error: message, next }));
  }

  redirect(withAuthParams("/auth/verify", {
    email,
    message: "A new verification code has been sent to your email.",
    next,
  }));
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/");
}
