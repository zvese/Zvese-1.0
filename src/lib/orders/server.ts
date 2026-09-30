import "server-only";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getProductModerator } from "@/lib/admin/product-review-server";

export async function requireBuyer() {
  const client = await createClient();
  const { data: { user }, error } = await client.auth.getUser();
  if (error || !user) redirect("/sign-in?message=Sign%20in%20to%20place%20or%20view%20orders.");
  return { client, user };
}

export async function requireOrderAdmin() {
  const actor = await getProductModerator();
  if (!actor || actor.role !== "super_admin" || !actor.isActive) redirect("/account?error=Active%20super%20administrator%20access%20required.");
}

export interface OrderItem {
  id: string; order_id: string; product_name: string; seller_name: string;
  quantity: number; unit_price: number; line_total: number; currency: string;
}
export interface Delivery {
  recipient_name: string; phone: string; address_line1: string; address_line2: string | null;
  city: string; region: string; postal_code: string | null; country: string;
}
export interface Order extends Delivery {
  id: string; buyer_user_id: string; status: string; subtotal: number; currency: string;
  delivery_method: string; created_at: string; order_items: OrderItem[];
}
export interface Sale extends Delivery {
  order_id: string; product_name: string; seller_name: string; quantity: number; line_total: number;
  currency: string; delivery_method: string; status: string; created_at: string;
}
export const ORDER_SELECT = "id,buyer_user_id,status,subtotal,currency,delivery_method,created_at,recipient_name,phone,address_line1,address_line2,city,region,postal_code,country,order_items(id,order_id,product_name,seller_name,quantity,unit_price,line_total,currency)";
