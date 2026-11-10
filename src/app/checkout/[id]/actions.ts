import "server-only";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireBuyer } from "@/lib/orders/server";
import { parseDelivery } from "@/lib/orders/checkout";
import { commerceEnabled } from "@/lib/orders/commerce-server";
import { isUuid } from "@/lib/admin/seller-review-data";

// Context is captured by an encrypted inline Server Action, not form fields.
export async function placeOrder(context: { listingId: string; revision: number; checkoutId: string; buyerId: string }, form: FormData) {
  const { client, user } = await requireBuyer();
  if (user.id !== context.buyerId) redirect("/account/orders?error=Your%20session%20changed.%20Start%20checkout%20again.");
  let delivery: Record<string, string>;
  try { delivery = parseDelivery(form); }
  catch (error) {
    redirect(`/checkout/${context.listingId}?error=${encodeURIComponent(error instanceof Error ? error.message : "Check delivery details.")}`);
  }
  const args = {
    p_listing_id: context.listingId, p_expected_revision: context.revision,
    p_checkout_id: context.checkoutId, p_delivery: delivery,
  };
  const rateId = String(form.get("rate_id") ?? "");
  if (commerceEnabled() && !isUuid(rateId)) redirect(`/checkout/${context.listingId}?error=Select%20an%20available%20delivery%20service.`);
  const { data, error } = commerceEnabled()
    ? await client.rpc("create_checkout_order", { ...args, p_rate_id: rateId })
    : await client.rpc("create_buyer_order", args);
  if (error || !data) redirect(`/checkout/${context.listingId}?error=${encodeURIComponent("Order could not be confirmed. Check your order history before retrying; the listing may no longer be available.")}`);
  revalidatePath("/account/orders");
  revalidatePath("/account/orders/sales");
  revalidatePath("/admin/orders");
  redirect(`/account/orders/${data}`);
}
