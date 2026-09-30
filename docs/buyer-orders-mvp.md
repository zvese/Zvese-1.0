# Buyer orders MVP

The flow is `/marketplace/[slug]` → `/checkout/[listing-id]` → `/account/orders/[order-id]`.
History is at `/account/orders`, active sellers see `/account/orders/sales`, and active super admins see `/admin/orders`.
An unsigned buyer signs in using the existing sign-in flow, then returns to the product's Buy now link.

Each checkout creates one item of quantity one, with `pending` status. There is no payment, fee quote, stock reservation, inventory decrement, delivery promise or fulfillment execution. Standard/express records a preference only. The schema permits multiple item rows for a later milestone; the current RPC deliberately accepts one listing only.

## Security contract

`create_buyer_order(listing_id, expected_revision, checkout_id, delivery)` uses the session JWT's `auth.uid()`. It loads the canonical product, seller, price and currency and rechecks active seller/product, current approved revision, snapshot/file fingerprints, existing public eligibility and source-managed `available` status. Legacy visibility is not purchase authorization. Listing, seller and product locks serialize checkout against ordinary review, suspension and editing operations. Current Storage/file validation rules are reused unchanged.

Prices and totals are bigint minor units, matching marketplace `price_minor`. Order amounts are bounded to JavaScript's exact integer range. The database writes both header and canonical item snapshot in one transaction; failure leaves neither. A buyer-scoped checkout UUID, request fingerprint and transaction advisory lock make repeat submissions of the same checkout return the same order. Reusing that key with different details fails. Refreshing checkout starts a new checkout; after an uncertain network result, check history before starting another.

The action authenticates every invocation and binds its buyer ID, listing, revision and checkout UUID in a server-generated encrypted Server Action closure. It forwards delivery fields only, with matching database validation. No service-role client or browser-supplied price, seller, totals, status or buyer identity is used.

Orders and items have RLS and no browser INSERT/UPDATE/DELETE grants. Buyers read their own headers/items; active super admins read all. Sellers can read their own item rows only while active. Sellers have no sale-based access to full order headers: `get_my_sales` returns only their lines plus recipient/contact/address/delivery/status/date, without buyer account ID, order subtotal, checkout key or other sellers' items. Confirmation uses orders RLS, so a seller cannot access a buyer's confirmation merely because they have a sale. PostgreSQL owners remain trusted and bypass RLS; no new service-role table or function grants are added.

Order records and canonical snapshots are retained. Foreign keys restrict deletion of referenced users/products/listings/sellers/orders. No automatic deletion or personal-data retention deadline is introduced; a future retention policy must explicitly handle these records. No email or notification is sent in this milestone.

## Disposable-local verification

Use only the confirmed Docker Desktop local daemon and local Supabase project. The new migration is `20260914120000_buyer_orders.sql`. Do not reset the database, edit previous migrations, use linked/remote flags or run db push.

For a local stack with all earlier migrations applied, run `npx.cmd supabase migration up --local` to install the new migration through normal migration tracking. The SQL tests in `supabase/tests/buyer_orders.sql` create synthetic users/products, review them through the existing RPC and roll back all fixtures. They must never be run against production. Using the project's confirmed local container:

```powershell
Get-Content -Raw -Encoding utf8 supabase/tests/buyer_orders.sql | docker --host npipe:////./pipe/dockerDesktopLinuxEngine exec -i supabase_db_zvese-1-0 psql -X -U postgres -d postgres -v ON_ERROR_STOP=1
if ($LASTEXITCODE -ne 0) { throw 'Local order SQL tests failed' }
npm.cmd run lint
node --experimental-strip-types --test tests/*.test.mjs
npm.cmd run build
git diff --check
git status --short
```

For manual verification, preserve Basic Black T-Shirt at `checking`: its Buy now button must be disabled and checkout by listing ID must refuse it. Use a separate attachment-free local test listing. The active seller submits it; a different active super admin reviews that exact revision and selects `available` only with a valid basis. An already-decided revision cannot be approved again: use the existing seller new-revision/submission path first when reassessment is necessary.

Sign in as a buyer, open that approved/available product, select Buy now, enter delivery details and place the pending order. Verify confirmation and history, then verify the owning seller's sales and super admin's orders. A different buyer/seller must not see it. Suspending the seller must block new checkout and sales access while preserving existing buyer history. Do not suspend the real test store merely to run this check; use disposable fixtures. No availability change is made automatically by checkout.
