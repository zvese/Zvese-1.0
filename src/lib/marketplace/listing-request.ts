// A deadline stops this UI workflow, not a Server Action already in flight.
// Unknown outcomes must be reconciled from the saved draft before retrying.
export class ListingRequestUncertain extends Error {}

export async function listingRequest<T>(operation: () => Promise<T>, stage: string, timeoutMs = 30_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const recovery = "Wait for the request to finish, then reopen the saved draft and check its files and review state before retrying. If no draft link is shown, check Your saved listings first.";
  try {
    const result = await Promise.race([
      Promise.resolve().then(operation),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new ListingRequestUncertain(`${stage} timed out. ${recovery}`)), timeoutMs);
      }),
    ]);
    // Supabase/PostgREST reports network failures as returned error objects too.
    if (result && typeof result === "object" && "uncertain" in result && result.uncertain) {
      throw new ListingRequestUncertain(`${stage} could not be confirmed. Check your connection. ${recovery}`);
    }
    return result;
  } catch (failure) {
    if (failure instanceof ListingRequestUncertain) throw failure;
    // Transport errors may follow a committed write; never retry automatically.
    throw new ListingRequestUncertain(`${stage} could not be confirmed. Check your connection. ${recovery}`);
  } finally {
    clearTimeout(timer);
  }
}
