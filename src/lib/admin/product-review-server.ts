import "server-only";
import { redirect } from "next/navigation";
import { signInPath } from "@/lib/auth/redirects";
import { createClient } from "@/lib/supabase/server";
import { createProductSystemClient } from "@/lib/supabase/product-system";
import { isProductModerator, type ProductModerator, type ProductReviewRecord } from "./product-review";

export async function getProductModerator(): Promise<ProductModerator | null> {
  const session = await createClient();
  const { data: { user }, error: authError } = await session.auth.getUser();
  if (authError || !user) return null;
  const { data, error } = await session.from("admin_memberships").select("user_id,role,is_active").eq("user_id", user.id).maybeSingle();
  if (error || !data || data.user_id !== user.id) return null;
  return { id: user.id, role: data.role, isActive: data.is_active };
}
export async function requireProductModerator(next = "/admin/products") {
  const session = await createClient();
  const { data: { user } } = await session.auth.getUser();
  if (!user) redirect(signInPath(next, "Please sign in to access product reviews."));
  const actor = await getProductModerator();
  if (!isProductModerator(actor)) redirect("/account?error=Active%20super%20administrator%20access%20required.");
  return actor;
}

// Called only after a page/action has authenticated the product moderator.
export async function loadProductReview(id: string): Promise<ProductReviewRecord | null> {
  const system = createProductSystemClient();
  const { data, error } = await system.from("listings")
    .select("id,current_revision,review_state,status,deleted_at,availability_state,seller:seller_profiles!inner(user_id,status,store_name),product:products!inner(created_by,status,slug)")
    .eq("id", id).maybeSingle();
  if (error) throw new Error("Could not load product review.");
  if (!data || !data.current_revision) return null;
  const seller = Array.isArray(data.seller) ? data.seller[0] : data.seller;
  const product = Array.isArray(data.product) ? data.product[0] : data.product;
  if (!seller || !product) return null;
  const [submission, input] = await Promise.all([
    system.from("listing_submissions").select("snapshot,snapshot_hash,submitted_at").eq("listing_id", id).eq("revision", data.current_revision).maybeSingle(),
    system.rpc("get_product_review_input", { p_listing_id: id, p_expected_revision: data.current_revision }),
  ]);
  if (submission.error || input.error) throw new Error("Could not load submitted revision.");
  if (!submission.data) return null;
  const snapshot = submission.data.snapshot as ProductReviewRecord["snapshot"];
  const ids = snapshot.files.map((file) => file.id);
  const files = ids.length ? await system.from("product_files")
    .select("id,original_name,content_validation_state,reservation_state,storage_version").eq("listing_id", id).in("id", ids)
    : { data: [], error: null };
  if (files.error) throw new Error("Could not load validation summary.");
  return {
    id, revision: data.current_revision, reviewState: data.review_state, listingStatus: data.status, deletedAt: data.deleted_at,
    sellerUserId: seller.user_id, sellerName: seller.store_name, sellerStatus: seller.status,
    productCreatorId: product.created_by, productStatus: product.status, productSlug: product.slug,
    availability: data.availability_state, submittedAt: submission.data.submitted_at,
    snapshot, snapshotHash: submission.data.snapshot_hash,
    filesFingerprint: input.data?.[0]?.files_fingerprint ?? null,
    files: (files.data ?? []).map((file) => ({ id: file.id, name: file.original_name, validation: file.content_validation_state,
      reservation: file.reservation_state, storageVersion: file.storage_version })),
  };
}
