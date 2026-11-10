"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { isUuid } from "@/lib/admin/seller-review-data";
import { signInPath } from "@/lib/auth/redirects";
import { createClient } from "@/lib/supabase/server";

export async function markNotificationRead(formData: FormData) {
  const notificationId = String(formData.get("notification_id") ?? "").trim();

  if (!isUuid(notificationId)) {
    redirect("/account/messages?error=Invalid notification identifier.");
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(signInPath("/account/messages", "Please sign in to view your messages."));
  }

  const { error } = await supabase.rpc("mark_notification_read", {
    p_notification_id: notificationId,
  });

  if (error) {
    redirect("/account/messages?error=Could not mark that message as read.");
  }

  revalidatePath("/account/messages");
  revalidatePath("/account");
  redirect("/account/messages");
}
