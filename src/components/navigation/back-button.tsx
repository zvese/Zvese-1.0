"use client";

import { ArrowLeftIcon } from "lucide-react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { safeNextPath } from "@/lib/auth/redirects";

export function BackButton({ fallback = "/marketplace" }: { fallback?: string }) {
  const router = useRouter();

  function goBack() {
    const hasSameOriginReferrer = Boolean(
      document.referrer && new URL(document.referrer).origin === window.location.origin
    );

    if (window.history.length > 1 && hasSameOriginReferrer) {
      router.back();
      return;
    }

    router.push(safeNextPath(fallback) ?? "/marketplace");
  }

  return (
    <Button type="button" variant="ghost" size="sm" onClick={goBack}>
      <ArrowLeftIcon className="size-4" aria-hidden="true" />
      Back
    </Button>
  );
}
