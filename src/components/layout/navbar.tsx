import Link from "next/link";
import { MenuIcon } from "lucide-react";

import { Logo } from "@/components/brand/logo";
import { CartLink } from "@/components/cart/cart-link";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { siteConfig } from "@/config/site";
import { getCurrentSellerProfile } from "@/lib/marketplace/sellers";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

export async function Navbar() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const sellerProfile = user ? (await getCurrentSellerProfile()).data : null;
  const isActiveSeller = sellerProfile?.status === "active";
  const navLinks = [
    { label: "Marketplace", href: siteConfig.links.marketplace },
    isActiveSeller
      ? { label: "Seller Dashboard", href: "/account#seller-dashboard" }
      : { label: "Creators", href: siteConfig.links.creators },
    { label: "About", href: siteConfig.links.about },
    { label: "Contact", href: siteConfig.links.contact },
  ];

  return (
    <header className="sticky top-0 z-40 w-full border-b border-border/60 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        <Logo />

        <nav
          className="hidden items-center gap-8 md:flex"
          aria-label="Main navigation"
        >
          {navLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="text-sm font-medium text-muted-foreground transition-colors hover:text-primary"
            >
              {link.label}
            </Link>
          ))}
          <CartLink className="text-sm text-muted-foreground transition-colors hover:text-primary" />
        </nav>

        <div className="hidden items-center gap-3 md:flex">
          {user ? (
            <Button size="sm" asChild>
              <Link href="/account#profile">{isActiveSeller ? "Profile" : "Account"}</Link>
            </Button>
          ) : (
            <>
              <Button variant="ghost" size="sm" asChild>
                <Link href="/sign-in">Sign in</Link>
              </Button>
              <Button size="sm" asChild>
                <Link href="/sign-up">Get started</Link>
              </Button>
            </>
          )}
        </div>

        <Sheet>
          <SheetTrigger asChild className="md:hidden">
            <Button variant="ghost" size="icon" aria-label="Open menu">
              <MenuIcon className="size-5" />
            </Button>
          </SheetTrigger>
          <SheetContent side="right" className="w-full max-w-xs">
            <SheetHeader>
              <SheetTitle>
                <Logo />
              </SheetTitle>
            </SheetHeader>
            <nav
              className="mt-6 flex flex-col gap-1"
              aria-label="Mobile navigation"
            >
              {navLinks.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className={cn(
                    "rounded-md px-3 py-2.5 text-base font-medium text-foreground",
                    "transition-colors hover:bg-accent hover:text-accent-foreground"
                  )}
                >
                  {link.label}
                </Link>
              ))}
              <CartLink
                className={cn(
                  "rounded-md px-3 py-2.5 text-base text-foreground",
                  "transition-colors hover:bg-accent hover:text-accent-foreground"
                )}
              />
            </nav>
            <div className="mt-6 flex flex-col gap-2">
              {user ? (
                <Button asChild>
                  <Link href="/account#profile">{isActiveSeller ? "Profile" : "Account"}</Link>
                </Button>
              ) : (
                <>
                  <Button variant="outline" asChild>
                    <Link href="/sign-in">Sign in</Link>
                  </Button>
                  <Button asChild>
                    <Link href="/sign-up">Get started</Link>
                  </Button>
                </>
              )}
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </header>
  );
}
