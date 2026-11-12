import { createClient } from "@/lib/supabase/server";
import type { SellerProfile } from "@/types";
import { cache } from "react";
import { getPageUser } from "@/lib/auth/page-user";

export interface SellerApplicationDecisionNotice {
  decision: "approve" | "reject" | "hold" | "reopen";
  seller_status: SellerProfile["status"];
  public_reason: string | null;
  policy_version: string;
  decided_at: string;
}

export const getCurrentSellerProfile = cache(async (): Promise<{
  data: SellerProfile | null;
  error: Error | null;
}> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await getPageUser();

  if (!user) {
    return { data: null, error: null };
  }

  const { data, error } = await supabase
    .from("seller_profiles")
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) {
    return { data: null, error: new Error(error.message) };
  }

  return { data: data as SellerProfile | null, error: null };
});

export async function getCurrentSellerDecisionNotice(): Promise<{
  data: SellerApplicationDecisionNotice | null;
  error: Error | null;
}> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await getPageUser();

  if (!user) {
    return { data: null, error: null };
  }

  const { data, error } = await supabase.rpc(
    "get_my_latest_seller_application_decision"
  );

  if (error) {
    return { data: null, error: new Error(error.message) };
  }

  const decision = Array.isArray(data) ? data[0] : null;

  return {
    data: (decision as SellerApplicationDecisionNotice | undefined) ?? null,
    error: null,
  };
}
