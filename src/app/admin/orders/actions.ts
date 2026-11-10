"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireBuyer, requireOrderAdmin } from "@/lib/orders/server";
import { isUuid } from "@/lib/admin/seller-review-data";

export async function advanceFulfillment(form: FormData) {
  await requireOrderAdmin();
  const { client } = await requireBuyer();
  const id = String(form.get("order_id") ?? "");
  if (!isUuid(id)) throw new Error("Invalid order.");
  const { error } = await client.rpc("advance_order_fulfillment", {
    p_order_id: id, p_expected: String(form.get("expected")), p_next: String(form.get("next")),
    p_tracking: String(form.get("tracking") ?? "").trim() || null,
  });
  if (error) redirect("/admin/orders?message=Order%20could%20not%20advance.%20Check%20verified%20payment%2C%20open%20requests%20and%20current%20state.");
  revalidatePath("/admin/orders"); revalidatePath(`/account/orders/${id}`); revalidatePath("/account/orders/sales");
  redirect("/admin/orders?message=Sandbox%20fulfillment%20status%20updated.");
}
