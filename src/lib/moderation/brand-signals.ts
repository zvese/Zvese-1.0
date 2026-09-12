import type { SellerReviewSignal } from "@/lib/moderation/review-contract";

const COMMON_BRAND_WORDS = new Set([
  "and",
  "brand",
  "co",
  "company",
  "design",
  "designs",
  "global",
  "official",
  "shop",
  "store",
  "studio",
  "the",
]);

export interface BrandSignalSubject {
  id: string;
  storeName: string;
  storeSlug: string;
}

function normalizeText(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("en")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function meaningfulTokens(value: string): string[] {
  return normalizeText(value)
    .split(" ")
    .filter((token) => token.length >= 3 && !COMMON_BRAND_WORDS.has(token));
}

function compactHandle(value: string): string {
  return value.toLocaleLowerCase("en").replace(/[._]/g, "");
}

function bigrams(value: string): Set<string> {
  const result = new Set<string>();

  for (let index = 0; index < value.length - 1; index += 1) {
    result.add(value.slice(index, index + 2));
  }

  return result;
}

function diceSimilarity(left: string, right: string): number {
  if (left === right) {
    return left.length > 0 ? 1 : 0;
  }

  if (left.length < 2 || right.length < 2) {
    return 0;
  }

  const leftBigrams = bigrams(left);
  const rightBigrams = bigrams(right);
  let overlap = 0;

  for (const bigram of leftBigrams) {
    if (rightBigrams.has(bigram)) {
      overlap += 1;
    }
  }

  return (2 * overlap) / (leftBigrams.size + rightBigrams.size);
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(1, Number(value.toFixed(4))));
}

/**
 * Finds review candidates only. No signal is an infringement finding and this
 * function never approves, rejects, holds, or otherwise changes seller state.
 */
export function buildDeterministicBrandSignals(
  subject: BrandSignalSubject,
  candidates: readonly BrandSignalSubject[]
): SellerReviewSignal[] {
  const signals: SellerReviewSignal[] = [];
  const normalizedSubjectName = normalizeText(subject.storeName);
  const subjectTokens = meaningfulTokens(subject.storeName);
  const subjectMeaningfulName = subjectTokens.join(" ");
  const subjectHandle = subject.storeSlug.toLocaleLowerCase("en");
  const compactSubjectHandle = compactHandle(subject.storeSlug);

  for (const candidate of candidates) {
    if (candidate.id === subject.id) {
      continue;
    }

    const normalizedCandidateName = normalizeText(candidate.storeName);
    const candidateTokens = meaningfulTokens(candidate.storeName);
    const candidateMeaningfulName = candidateTokens.join(" ");
    const candidateHandle = candidate.storeSlug.toLocaleLowerCase("en");
    const compactCandidateHandle = compactHandle(candidate.storeSlug);

    if (
      normalizedSubjectName.length > 0 &&
      normalizedSubjectName === normalizedCandidateName &&
      subjectTokens.length > 0
    ) {
      signals.push({
        code: "exact_normalized_store_name",
        severity: "high",
        score: 1,
        summary: `Exact normalized store-name match with ${candidate.storeName}.`,
        matchedSellerProfileId: candidate.id,
      });
    } else if (
      subjectMeaningfulName.length >= 4 &&
      candidateMeaningfulName.length >= 4
    ) {
      const nameScore = diceSimilarity(
        subjectMeaningfulName,
        candidateMeaningfulName
      );

      if (nameScore >= 0.82) {
        signals.push({
          code: "near_store_name_candidate",
          severity: "medium",
          score: clampScore(nameScore),
          summary: `Similar distinctive store-name terms found in ${candidate.storeName}.`,
          matchedSellerProfileId: candidate.id,
        });
      }
    }

    if (subjectHandle === candidateHandle && subjectHandle.length > 0) {
      signals.push({
        code: "exact_store_handle",
        severity: "high",
        score: 1,
        summary: `Exact store-handle match with @${candidate.storeSlug}.`,
        matchedSellerProfileId: candidate.id,
      });
    } else if (
      compactSubjectHandle.length >= 4 &&
      compactCandidateHandle.length >= 4
    ) {
      const handleScore = diceSimilarity(
        compactSubjectHandle,
        compactCandidateHandle
      );

      if (handleScore >= 0.86) {
        signals.push({
          code: "near_store_handle_candidate",
          severity: "medium",
          score: clampScore(handleScore),
          summary: `Similar store handle found: @${candidate.storeSlug}.`,
          matchedSellerProfileId: candidate.id,
        });
      }
    }
  }

  return signals.sort((left, right) => {
    if (right.score !== left.score) {
      return right.score - left.score;
    }

    return left.code.localeCompare(right.code);
  });
}
