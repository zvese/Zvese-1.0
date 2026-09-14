import "server-only";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createProductSystemClient } from "@/lib/supabase/product-system";
import { getProductModerator, loadProductReview } from "@/lib/admin/product-review-server";
import { performProductReview, ProductReviewError, type ReviewContext } from "@/lib/admin/product-review";

// Server-only helper, not a separately exported browser action. Context comes
// from the page's encrypted Server Action closure, never from form fields.
export async function decideProduct(context: ReviewContext, form: FormData): Promise<never> {
  let failure: string | null = null;
  try {
    const record = await performProductReview(context, {
      decision: String(form.get("decision") ?? ""), availability: String(form.get("availability") ?? ""),
      note: String(form.get("note") ?? ""),
    }, {
      actor: getProductModerator, load: loadProductReview, now: () => new Date().toISOString(),
      record: async (args) => {
        // No browser-supplied identity, evidence, policy, hash or job fields used.
        const { error } = await createProductSystemClient().rpc("record_product_review", args);
        return error;
      },
    });
    for (const path of ["/admin/products", `/admin/products/${record.id}`, "/account", "/account/listings/new", "/marketplace", `/marketplace/${record.productSlug}`]) revalidatePath(path);
  } catch (error) {
    failure = error instanceof ProductReviewError ? error.message : "Could not complete the review. Refresh to check the recorded state before retrying.";
  }
  if (failure) redirect(`/admin/products/${context.listingId}?error=${encodeURIComponent(failure)}`);
  redirect(`/admin/products/${context.listingId}`);
}
