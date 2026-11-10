"use server";

import { redirect } from "next/navigation";

import {
  isSupportedCountryCode,
  isSupportedCurrencyCode,
} from "@/config/marketplace-options";
import { signInPath } from "@/lib/auth/redirects";
import { createClient } from "@/lib/supabase/server";

const STORE_SLUG_REGEX = /^(?!.*\.\.)[a-z0-9_](?:[a-z0-9._]*[a-z0-9_])?$/;

export async function applyForSellerProfile(formData: FormData) {
  const storeName = String(formData.get("store_name") ?? "").trim();
  const storeSlug = String(formData.get("store_slug") ?? "");
  const storeDescription = String(formData.get("store_description") ?? "").trim();
  const rawCountryCode = String(formData.get("country_code") ?? "").trim().toUpperCase();
  const rawDefaultCurrency = String(formData.get("default_currency") ?? "").trim().toUpperCase();

  const countryCode = rawCountryCode ? rawCountryCode : null;
  const defaultCurrency = rawDefaultCurrency;

  // Validate Store Name (2 - 160 characters)
  if (storeName.length < 2 || storeName.length > 160) {
    redirect(
      "/creators/apply?error=" +
        encodeURIComponent("Store name must be between 2 and 160 characters.")
    );
  }

  // Validate Store Slug (2-160 characters, using the canonical Zvese handle format)
  if (
    storeSlug.length < 2 ||
    storeSlug.length > 160 ||
    !STORE_SLUG_REGEX.test(storeSlug)
  ) {
    redirect(
      "/creators/apply?error=" +
        encodeURIComponent(
          "Store handle must be 2-160 characters using lowercase letters, numbers, periods, and underscores. Periods cannot be first, last, or consecutive."
        )
    );
  }

  // Validate country membership against the canonical marketplace option set.
  if (countryCode && !isSupportedCountryCode(countryCode)) {
    redirect(
      "/creators/apply?error=" +
        encodeURIComponent("Select a supported country or territory.")
    );
  }

  // Validate currency membership against the canonical active-tender option set.
  if (!isSupportedCurrencyCode(defaultCurrency)) {
    redirect(
      "/creators/apply?error=" +
        encodeURIComponent("Select a supported listing currency.")
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(signInPath("/creators/apply", "Please sign in to apply as a creator."));
  }

  // Prevent duplicate seller applications
  const { data: existingProfile } = await supabase
    .from("seller_profiles")
    .select("status, store_name")
    .eq("user_id", user.id)
    .maybeSingle();

  if (existingProfile) {
    if (existingProfile.status === "pending") {
      redirect(
        "/account?message=" +
          encodeURIComponent("Your seller application is already under review.")
      );
    } else if (existingProfile.status === "active") {
      redirect(
        "/account?message=" +
          encodeURIComponent("You already have an active seller profile.")
      );
    } else {
      redirect(
        "/account?error=" +
          encodeURIComponent(
            `Your seller profile status is currently ${existingProfile.status}. Please contact support.`
          )
      );
    }
  }

  // Insert seller profile with status 'pending' adhering to RLS and database trigger
  const { error } = await supabase.from("seller_profiles").insert({
    user_id: user.id,
    store_name: storeName,
    store_slug: storeSlug,
    store_description: storeDescription || null,
    country_code: countryCode,
    default_currency: defaultCurrency,
    status: "pending",
  });

  if (error) {
    const errorMsg = error.message.toLowerCase();
    if (errorMsg.includes("store_slug") || errorMsg.includes("unique") || error.code === "23505") {
      redirect(
        "/creators/apply?error=" +
          encodeURIComponent(
            "This store handle/slug is already taken. Please choose a different one."
          )
      );
    }

    redirect(
      "/creators/apply?error=" +
        encodeURIComponent(`Could not submit application: ${error.message}`)
    );
  }

  redirect(
    "/account?message=" +
      encodeURIComponent(
        "Your seller application has been submitted and is currently under review."
      )
  );
}
