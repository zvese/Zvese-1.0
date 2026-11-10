import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import {
  defaultSignedInPath,
  safeNextPath,
  signInPath,
  withAuthParams,
} from "../src/lib/auth/redirects.ts";

const source = (path) =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("safe next redirects accept internal destinations and reject open redirects", () => {
  assert.equal(safeNextPath("/checkout/123?coupon=one#delivery"), "/checkout/123?coupon=one#delivery");
  assert.equal(safeNextPath("/admin/sellers/123"), "/admin/sellers/123");

  for (const value of [
    "https://evil.example/path",
    "http://evil.example/path",
    "javascript:alert(1)",
    "//evil.example/path",
    "/\\evil.example/path",
    "/%2f%2fevil.example/path",
    "/%5cevil.example/path",
    "/%0aLocation:%20https://evil.example",
    "/sign-in",
    "/sign-up?next=/account",
    "/auth/verify",
  ]) {
    assert.equal(safeNextPath(value), null, value);
  }
});

test("auth URLs retain only safe destinations", () => {
  assert.match(signInPath("/checkout/123", "Please sign in"), /next=%2Fcheckout%2F123/);
  assert.doesNotMatch(signInPath("//evil.example", "Please sign in"), /next=/);
  assert.equal(
    withAuthParams("/sign-up", { next: "https://evil.example", error: "Try again" }),
    "/sign-up?error=Try+again"
  );
});

test("auth destinations distinguish buyers, active sellers, and protected next paths", () => {
  const destination = source("src/lib/auth/destination.ts");
  const actions = source("src/app/auth/actions.ts");

  assert.equal(defaultSignedInPath(null), "/marketplace");
  assert.equal(defaultSignedInPath("pending"), "/marketplace");
  assert.equal(defaultSignedInPath("active"), "/account#seller-dashboard");
  assert.match(destination, /defaultSignedInPath\(sellerProfile\?\.status\)/);
  assert.match(actions, /signedInDestination\(supabase, data\.user, next\)/);
  assert.match(actions, /safeNextPath\(formData\.get\("next"\)\)/);
  assert.doesNotMatch(actions, /password.*(?:cookie|storage|localStorage)/i);
});

test("navbar renders guest, buyer, and active-seller controls on desktop and mobile", () => {
  const navbar = source("src/components/layout/navbar.tsx");

  assert.match(navbar, /const isActiveSeller = sellerProfile\?\.status === "active"/);
  assert.equal((navbar.match(/>Sign in</g) ?? []).length, 2);
  assert.equal((navbar.match(/>Get started</g) ?? []).length, 2);
  assert.match(navbar, /isActiveSeller\s*\? \{ label: "Seller Dashboard"/);
  assert.match(navbar, /: \{ label: "Creators"/);
  assert.match(navbar, /isActiveSeller \? "Profile" : "Account"/);
  assert.match(navbar, /md:flex/);
  assert.match(navbar, /md:hidden/);
});

test("sessions refresh and persist without storing passwords", () => {
  const browserClient = source("src/lib/supabase/client.ts");
  const middleware = source("src/lib/supabase/middleware.ts");
  const home = source("src/app/page.tsx");
  const actions = source("src/app/auth/actions.ts");

  assert.match(browserClient, /persistSession: true/);
  assert.match(browserClient, /autoRefreshToken: true/);
  assert.match(middleware, /await supabase\.auth\.getUser\(\)/);
  assert.match(home, /if \(user\) redirect\(await signedInDestination/);
  assert.match(actions, /await supabase\.auth\.signOut\(\)/);
});

test("password visibility and back navigation remain accessible and reusable", () => {
  const password = source("src/components/auth/password-input.tsx");
  const signIn = source("src/app/sign-in/page.tsx");
  const signUp = source("src/app/sign-up/page.tsx");
  const back = source("src/components/navigation/back-button.tsx");

  assert.match(password, /type=\{visible \? "text" : "password"\}/);
  assert.match(password, /type="button"/);
  assert.match(password, /aria-label=\{visible \? "Hide password" : "Show password"\}/);
  assert.match(signIn, /<PasswordInput[^>]*autoComplete="current-password"/);
  assert.match(signUp, /<PasswordInput[^>]*autoComplete="new-password"/);
  assert.match(back, /router\.back\(\)/);
  assert.match(back, /router\.push\(safeNextPath\(fallback\) \?\? "\/marketplace"\)/);
});

test("protected pages return through sign-in while admin roles remain enforced", () => {
  const orders = source("src/lib/orders/server.ts");
  const sellerAdmin = source("src/lib/admin/authorization.ts");
  const productAdmin = source("src/lib/admin/product-review-server.ts");
  const checkout = source("src/app/checkout/[id]/page.tsx");

  assert.match(checkout, /requireBuyer\(`\/checkout\/\$\{id\}`\)/);
  assert.match(orders, /signInPath\(next/);
  assert.match(orders, /actor\.role !== "super_admin" \|\| !actor\.isActive/);
  assert.match(sellerAdmin, /SELLER_REVIEWER_ROLES/);
  assert.match(sellerAdmin, /data\.is_active !== true/);
  assert.match(productAdmin, /isProductModerator\(actor\)/);
});
