import { redirect } from "next/navigation";

import { signInPath } from "@/lib/auth/redirects";
import { createClient } from "@/lib/supabase/server";

export const SELLER_REVIEWER_ROLES = [
  "seller_reviewer",
  "super_admin",
] as const;

export type SellerReviewerRole = (typeof SELLER_REVIEWER_ROLES)[number];

export interface AdminMembership {
  userId: string;
  role: SellerReviewerRole;
}

function isSellerReviewerRole(value: string): value is SellerReviewerRole {
  return SELLER_REVIEWER_ROLES.some((role) => role === value);
}

export async function requireSellerReviewer(next = "/admin/sellers") {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(signInPath(next, "Please sign in to access seller reviews."));
  }

  const { data, error } = await supabase
    .from("admin_memberships")
    .select("user_id, role, is_active")
    .eq("user_id", user.id)
    .maybeSingle();

  if (
    error ||
    !data ||
    typeof data.user_id !== "string" ||
    data.is_active !== true ||
    typeof data.role !== "string" ||
    !isSellerReviewerRole(data.role)
  ) {
    redirect(
      "/account?error=" +
        encodeURIComponent("You are not authorized to access seller reviews.")
    );
  }

  return {
    supabase,
    user,
    membership: {
      userId: data.user_id,
      role: data.role,
    } satisfies AdminMembership,
  };
}
