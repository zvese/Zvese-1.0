# Zvese MVP handoff — 30 October 2026

Local implementation only. No hosted database access, public deployment, live activation or real charge was performed. The completed Stage 00/01/02 rehearsal was not rerun. The approved drafts remain unchanged.

## What is implemented

- Public browsing now uses the anonymous RLS context and explicitly excludes legacy/unreviewed listings, even for signed-in sellers or administrators. Existing search, categories, cart, authentication, seller applications, listing revisions and manual product review are retained.
- Cart quantities remain planning quantities. Checkout is explicitly **one item, one unit, one seller per order**; prices come from the authenticated canonical listing RPC, never local storage.
- Optional commerce checkout selects an active, explicitly configured standard/express rate matching country, region/city and currency. The database atomically creates the order and snapshots shipping/total. No rates or delivery promises are invented or seeded.
- Pesepay sandbox initiation, encrypted request/response handling, authenticated callback processing and independent status polling are implemented. Browser redirects never mark an order paid. One reserved attempt per order prevents automatic duplicate initiation after an ambiguous timeout. Paid/refunded transitions do not regress when stale events arrive.
- Buyer order pages/history show separate payment and fulfillment state, shipping totals, tracking and cancellation/refund requests. Admins can simulate manual sourcing, dispatch and delivery only after verified sandbox payment. Sellers receive only their own single-item order projection. Sandbox orders must never cause real shipment.
- Admins can validate static JPEG/PNG/WebP images through a complete bounded decode, version checks and a non-overwriting verified vault copy. Publication still requires the original revision/hash guards. This is **not antivirus scanning**; videos/documents remain blocked until a dedicated trusted validator is available. Failed vault writes/recording are preserved for review, never automatically cleaned up.
- Shared loading/error handling avoids false order/payment success. System fonts remove build-time dependence on Google Fonts.

## Database proposal and limitations

`supabase/proposals/20261030120000_mvp_commerce.sql` is deliberately outside automatic migration discovery. It adds four tables and eight tightly scoped RPCs; it does not modify the approved repair drafts or rewrite existing orders. It installs **sandbox-only** payment/fulfillment state. No production or persistent local installation has been performed.

Existing unpaid orders remain unchanged. New quoted orders use `create_checkout_order`, wrapping the reviewed `create_buyer_order` inside the same transaction. Shipping mismatch rolls back both. A single-item guard prevents initiating payment on an unsupported multi-item order. Multi-seller commerce needs a separately reviewed migration covering item-level shipping, seller projections, inventory/availability reservation, refunds and fulfillment; merely adding a second item is insufficient.

`scripts/test-commerce-local.mjs` is pinned to the existing local development database container, not the rehearsal/production database. It executes the proposal and synthetic assertions inside one transaction, then rolls back and checks that the new table is absent. It accepts no database URL or credential. `tests/commerce.local.sql` covers ownership/RLS, direct-write denial, service-only reconciliation, duplicate attempts/events, amount/currency/reference mismatch, ordered fulfillment, tracking and refund holds. These tests are not a hosted compatibility review or a provider sandbox test.

## Production database blocker: SQLSTATE 28P01

The prior production connection failed authentication before any inspection SQL ran. Production identity and compatibility remain unverified. The rejected credential was not retried in this sprint.

Required owner action:

1. Open the existing Supabase project **mbjvlshewksqvxrpmjae** and verify its connection panel and intended database identity. Retrieve the current database password from your approved password manager. Do not paste it into chat, shell arguments, screenshots or the repository. Do not substitute an API/service-role key for a database password.
2. Securely create a **new** Windows DPAPI-encrypted PSCredential file using an interactive `Get-Credential` prompt and `Export-Clixml`, in an access-controlled local credential directory owned by this Windows user. Use the exact connection-panel database username. Preserve the old backup/evidence credential files; do not overwrite them. If the current password cannot be recovered, a password reset is a separate owner decision, not authorized here.
3. Confirm only that the credential has been corrected and provide its protected local path, without the secret. Then authorize one fresh read-only compatibility review. Enforce TLS identity verification and `BEGIN READ ONLY` / `ROLLBACK`; stop on target/read-only failure. Do not automatically retry rejected credentials.

The project `.env.local` points at loopback Supabase and must not be treated as a production connection source.

## Minimal production sequence (each write requires separate approval)

1. Correct access as above; authorize a fresh read-only production identity/schema/ACL/RLS/storage/event-trigger/migration/data-preservation comparison against the exact three approved hashes.
2. Verify a current recoverable backup and restoration evidence before writes. The historical backup alone does not prove a current recovery point.
3. Separately approve Stage 00, execute once with fail-fast timeouts, verify and report commit status. Then independently approve/verify Stage 01, then Stage 02. Do not run a runner that implicitly advances through unauthorized stages.
4. Review and rehearse the new commerce proposal independently before authorizing its production installation. Also review the image-validation path and Storage integration. Confirm least privilege, event-trigger effects, existing-row fingerprints and migration ledger handling.
5. Configure approved shipping rates/service areas/currency, sandbox credentials and HTTPS callback origin. Complete provider sandbox testing before reviewing any live activation implementation.
6. A live adapter, provider approval, actual refund procedures, merchant reconciliation and a real paid-order smoke test remain separate launch gates. The current implementation intentionally cannot enable live payments by changing an environment variable.

Each draft/proposal is transactional. A pre-commit error must roll back. After commit, do not assume a generic down migration is safe: permission/data changes require a reviewed compensating change or a restore to a verified recovery point. Never delete orders/payment evidence to roll back. After provider timeout, preserve the attempt and reconcile its merchant reference before authorizing any new attempt.

## Environment names and deployment

Required names only (values must be configured privately):

- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` — server-only
- `NEXT_PUBLIC_APP_URL` — intended canonical origin for the owned `zvese.store` domain, HTTPS when deployed
- `RESEND_API_KEY`, `ZVESE_EMAIL_FROM` — existing seller-decision email; sender verification required
- `ZVESE_COMMERCE_ENABLED` — leave disabled until the proposal is installed/reviewed
- `ZVESE_PAYMENT_MODE` — disabled or sandbox only
- `PESEPAY_INTEGRATION_KEY`, `PESEPAY_ENCRYPTION_KEY` — sandbox keys only, server-only

Use the existing Next.js Node runtime, `npm ci`, `npm test`, `npm run lint`, `npm run build`, then `npm start` on an approved host. Sharp is pinned to the already installed version. Do not export the app as static HTML: auth, server actions, file delivery and payments require the server runtime. Do not expose local Supabase or Docker ports publicly.

Before authorizing deployment: confirm hosting ownership, privately set deployment environment, configure Supabase auth Site URL and permitted return URLs for the owned domain, configure DNS/TLS using the chosen host's exact instructions, verify the sender and callback reachability, and test staging. No hosting provider/DNS records were invented or changed. This repository build does not establish that `zvese.store` is hosted.

## Payment documentation and sandbox procedure

Implementation follows official [initiation](https://developers.pesepay.com/api/initiate-transaction/), [status lookup](https://developers.pesepay.com/api/check-payment-status/), [encryption](https://developers.pesepay.com/security/encryption/) and [callback](https://developers.pesepay.com/webhooks/result-callback/) specifications reviewed on 30 October 2026. It uses raw HTTP because the documented SDK is production-only. No provider calls were made without sandbox credentials.

Obtain sandbox application integration/encryption keys privately and confirm the merchant application supports the selected currency and payment methods. Configure a separately authorized HTTPS staging callback. In the reviewed local/staging schema, seed only owner-approved shipping rates and a real reviewed product. Test: successful hosted checkout; cancellation; failure; forged callback; amount/currency/reference mismatch; duplicate callback; delayed callback; interrupted initiation; lost callback recovered by the buyer's explicit status check; reversal/refund; and concurrent repeated pay submissions. Confirm one provider reference and one paid transition, no raw card data, no browser-trusted status, and no real fulfillment from a test order.

Pesepay callbacks may be missed; the implementation provides explicit reconciliation, not a durable background job. An initiation whose response/binding was lost remains `initiating` and requires an operator to reconcile the merchant reference in Pesepay. Never press a new-payment workaround or delete the attempt. Refund/cancellation requests record intent only; they do not call undocumented refund APIs or claim money was returned.

## Minimum launch checklist

- Current production compatibility and recoverable backup; individually approved schema changes verified.
- Real seller and product approved by a different active administrator; image versions validated; current source availability and lawful product information confirmed.
- Approved standard/express rates, exact service areas, support contact, delivery limitations, returns/privacy/terms and manual supplier ownership established. Existing legal/contact pages still need business-owner content/review before public launch.
- Sandbox round trip verified with the actual provider; live merchant/card approval confirmed separately. Review a live adapter and separately authorize activation. No mock result can satisfy this gate.
- Buyer A cannot access Buyer B's order; Seller A cannot see Seller B's sale; unpublished/revoked products and files remain private; no elevated browser grants.
- Separately authorize a real product → single-item order → real provider payment → server reconciliation → buyer confirmation → manual sourcing → dispatch reference → delivery smoke test. Reconcile the merchant settlement and arrange a reviewed refund test. Never use test payment success as evidence of a real paid order.
- Seller application decisions continue to appear on the account page and in-app messages; test the existing Resend delivery with a verified sender. Order confirmation currently appears in the account, not a newly implemented order email service.

## Validation commands

`npm test`; `npm run lint`; `npm run build`; `node scripts/smoke-local.mjs` (loopback-only, payments disabled); `node scripts/test-commerce-local.mjs` (explicit local Docker permission, transaction rolled back).

No full authenticated browser purchase or external payment test should be claimed from unit tests, rollback SQL tests or HTTP smoke checks alone.
