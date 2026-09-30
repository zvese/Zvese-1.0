import "server-only";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireBuyer } from "@/lib/orders/server";
import { parseDelivery } from "@/lib/orders/checkout";

// Context is captured by an encrypted inline Server Action, not form fields.
export async function placeOrder(context: { listingId: string; revision: number; checkoutId: string; buyerId: string }, form: FormData) {
  const { client, user } = await requireBuyer();
  if (user.id !== context.buyerId) redirect("/account/orders?error=Your%20session%20changed.%20Start%20checkout%20again.");
  let delivery: Record<string, string>;
  try { delivery = parseDelivery(form); }
  catch (error) {
    redirect(`/checkout/${context.listingId}?error=${encodeURIComponent(error instanceof Error ? error.message : "Check delivery details.")}`);
  }
  const { data, error } = await client.rpc("create_buyer_order", {
    p_listing_id: context.listingId, p_expected_revision: context.revision,
    p_checkout_id: context.checkoutId, p_delivery: delivery,
  });
  if (error || !data) redirect(`/checkout/${context.listingId}?error=${encodeURIComponent("Order could not be confirmed. Check your order history before retrying; the listing may no longer be available.")}`);
  revalidatePath("/account/orders");
  revalidatePath("/account/orders/sales");
  revalidatePath("/admin/orders");
  redirect(`/account/orders/${data}`);
}
