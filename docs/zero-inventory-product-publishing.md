# Zero-inventory publishing: blocker corrections and controlled rollout

Status: LOCAL PROPOSAL ONLY. No Supabase migration, live bucket, live row, model call, order, payment or fulfillment change was made. Do not apply this proposal until the database/Storage integration gate below passes.

## Architecture and changes

Products retain canonical descriptions; listings retain seller/product ownership, price and currency. Only active owners can manage their own listings, through authenticated RPCs. Direct products/listings DML and TRUNCATE are revoked, and the legacy stock/publish RPC is disabled for browser and service roles. Existing seller review, notifications and email functions are untouched.

Historical inventory_quantity/inventory_mode columns remain for compatibility. New listings always write 0/external. No application availability query or publishing decision reads them. They confer no stock ownership, publication or availability rights.

### Schema

- listings: availability_mode=source_managed; availability_state=checking/available/unavailable; review_state=legacy_unreviewed/draft/pending_review/approved/rejected/withdrawn; current_revision; draft_epoch; submitted_at; reviewed_at; deleted_at.
- listing_sources: listing ownership FK; one of supplier/manufacturer/production_partner/pod_partner/customization_partner/other; internal partner reference.
- product_files: immutable identity/path/visibility/type/size declarations; reservation_state, expires_at, draft_epoch, finalized Storage version/time and content_validation_state.
- listing_draft_files: current editable attachment set, with composite ownership FK.
- listing_submissions: immutable (listing_id,revision), canonical product/source/file snapshot, database SHA256 and submission time.
- submission_files: immutable exact file IDs and finalized staging versions, constrained to the same listing and submission.
- product_file_validations: one immutable result per file version, unique job UUID, passed/failed, content SHA256, validator, validated_at, internal evidence reference, validated vault path/version.
- product_review_events: one immutable decision per revision; globally unique review-job UUID, snapshot hash, file fingerprint, availability, structured provenance and timestamp.
- product_cleanup_queue: non-destructive reconciliation candidates with reason, first_seen_at, not_before and needs_review/approved/completed state.

No new migration timestamp was added: the never-applied proposal `20260908130000_zero_inventory_product_files.sql` is revised. If that version is already in a target's migration history, STOP and prepare a separately timestamped forward migration; never overwrite an applied migration.

## Immutable revision and review model

1. Saving a new product creates a draft (current_revision=0). Only draft content can be saved or have files attached/detached.
2. Submitting locks the listing and active seller, snapshots product/price/source and finalized file versions, and advances the submission number. It becomes pending_review/checking and stays unpublished.
3. Submitted content cannot be edited in place. `begin_listing_revision` explicitly withdraws publication, changes to draft and rotates draft_epoch. The old submission remains immutable. The next submit advances current_revision; repeated saves within that new draft do not create empty submission records.
4. Files are separate immutable records. Removing from a revised draft only detaches the working association; old snapshots, metadata and validated content are retained. Changing visibility or replacing bytes requires a new file reservation in a new draft.
5. Review accepts expected revision, snapshot hash, exact validation/file fingerprint and unique job UUID. It locks listing and submission, checks active seller, current pending state and all files, then inserts one event and updates state in one transaction. Stale revisions/hash/fingerprint fail with 40001. Duplicate job or already-decided revision fails with 23505. Invalid transitions or validation gaps fail with 55000. Jobs cannot replay approved-to-approved changes.
6. Approval requires every file in that revision (including private documents) to have a passed immutable validation and matching vault object version/metadata. No files is allowed for the MVP; this is not a claim of content or source verification.

Trusted functions have fixed empty search_path. PUBLIC, anon and authenticated cannot execute review/validation/input/delivery/cleanup RPCs; only service_role can. Browser endpoints do not forward privileged review or validation requests. Table owners/superusers retain PostgreSQL bypass powers and must be restricted operationally. Service credentials are themselves a broad privileged trust boundary; a compromised worker can lie about evidence. SQL cannot prove an external scanner or model ran.

## Upload lifecycle and Storage

All five buckets are private:

| Bucket | Purpose | Allowed declarations | Limit per file |
|---|---|---|---|
| product-images | Seller staging | JPEG (.jpg/.jpeg), PNG, WEBP | 10 MiB |
| product-videos | Seller staging | MP4, WEBM | 100 MiB |
| product-public-documents | Seller staging, intended buyer PDFs | PDF | 25 MiB |
| product-private-documents | Seller staging, internal documents | PDF, TXT, CSV, DOCX, XLSX | 25 MiB |
| product-validated-files | Worker-only validated immutable copies | Union of approved formats | 100 MiB bucket cap; original per-type reservation limit still applies |

The browser and RPC both require matching extension/MIME and size. At most 12 attachments per working draft, enforced under listing row lock. Extension/MIME checks are declarations ONLY. Executables, scripts, HTML, SVG, generic/empty MIME and mismatches fail the initial gate, but renamed malicious bytes require real trusted inspection.

`reserve_product_file` creates a reserved record expiring after 30 minutes, returns a generated `incoming/<auth.uid>/<listing UUID>/<file UUID>.<validated extension>` path only to its owner, and attaches it to the current draft epoch. Original filename is display metadata, never a path component. No anonymous INSERT, arbitrary path, cross-seller write, UPDATE/upsert/overwrite, DELETE or direct SELECT/sign is permitted by product Storage policies. Restrictive policies also constrain any broader pre-existing permissive policy.

`finish_product_file` independently locks/rechecks active ownership, draft state/epoch, attachment, reserved status, expiry, Storage MIME/size and exact version. Expired, cancelled, suspended, rejected or superseded uploads cannot finalize. Removing a reservation cancels it and detaches it. A late upload token or in-flight Storage write can still leave staging bytes: metadata finalization and the server-only vault ensure they never silently become public or join a submitted file set. This design does not claim SQL revokes already issued Storage upload capabilities.

Failed validation is terminal for that file identity: replace it with a newly reserved file. Pending/failed staging files are not served by the application, including to the seller. Local browser previews before upload remain available; passed files can be viewed by their active owner.

## Application access and revocation

`/api/product-files/<id>` checks session/anonymous metadata RLS, then uses a server-only client to get a protected validated-object descriptor. It downloads the vault object, checks size and SHA256, checks the descriptor version again and rechecks caller RLS before returning bytes. It returns no Storage URL or signed token. Public media enumeration is limited to public files in the current approved eligible revision, even for a logged-in seller viewing their own marketplace page. Private files are active-owner/system-only.

Buyer eligibility requires the current approved listing, active product/seller and intact validated file set. Legacy listings are the explicit compatibility exception described below; they acquire no public file access through this exception. Withdrawal, rejection, non-active seller, missing/changed vault object or superseded file excludes future buyer requests. Responses use no-store, nosniff, sandbox CSP; documents are attachments. Single byte ranges support video playback after full-object verification.

Revocation is checked per request, including just before responding. Data already delivered or an in-flight response after the final check cannot be recalled. There is no 60-second token claim anymore, and direct Supabase signing by buyers/sellers is denied. Deployment must verify CDN/proxy caching does not override no-store. Never grant ordinary Storage SELECT on these buckets or issue service-signed links elsewhere.

MVP delivery buffers up to 100 MiB and hashes the whole object even for ranges. Production requires memory/timeout/concurrency and abuse-rate testing; a bounded validating streaming proxy/cache with equivalent revocation may be necessary for scale. Upload size limits do not constitute a seller-wide storage/bandwidth quota. Configure operational quotas/rate limits before opening uploads widely.

## Exact protected worker contract (not an implementation)

TypeScript shapes: `src/lib/marketplace/product-worker-contract.ts`. No approved scanner, source integration or model exists here. No fake AI result is generated. A deployment without a trusted validator cannot publish uploaded files; it safely remains pending.

Run a separately authenticated service-side worker with secrets in its environment, no browser-triggerable generic privileged RPC endpoint. Never execute source URLs or file instructions, or expose credentials/tools to a model. Treat all seller content as untrusted data. Evidence references must be internal identifiers of the form `evidence://...`, with no credentials, query tokens or arbitrary external fetch target.

Worker processing order:

1. Fetch `get_product_review_input(p_listing_id,p_expected_revision)` as service_role. Retain the immutable snapshot and canonical snapshot_hash. Read only exact submission_files and product_files versions for this work item, not the mutable draft set. An empty result means obsolete/not pending/non-active; discard the job.
2. For each finalized pending file, fetch the exact staging object while checking its recorded Storage version before and after download; calculate SHA256 over the fetched bytes. Inspect actual format using trusted parsers, decoding and malware checks in a sandbox. Enforce size, content/format agreement, archive expansion/resource limits and document active-content policy. Validate image/video decodability; PDF scripts/embedded payloads; OOXML package safety/macros/external links; TXT/CSV encoding and spreadsheet formula payloads. A filename/MIME check or a model opinion is insufficient.
3. If passed, write these exact inspected bytes to `validated/<file UUID>/<64-character lowercase SHA256>.<reserved extension>` in product-validated-files with upsert=false and declared content type. The filename hash must equal p_sha256; the extension must exactly match the generated staging reservation's allowed extension/MIME pairing (including .jpg versus .jpeg). Read back/check size/version/hash. Never overwrite a vault path. If an interrupted attempt already wrote this exact path, verify its bytes, hash, MIME, size and Storage version before reusing it; a name alone is not evidence. Record `record_product_file_validation(p_file_id,p_storage_version,p_job_id,p_state,p_sha256,p_validator,p_evidence_reference,p_vault_path,p_vault_version)`. Failed validation uses null vault fields but still requires a valid lowercase SHA256. Persist scanner/version findings in protected evidence. On error, leave no attachable metadata and reconcile any orphan vault copy.
4. Fetch the review input again after validation and retain canonical files_fingerprint. Independently obtain genuine source availability for the snapshot's exact source reference; save source evidence, observed_at and availability. The RPC requires evidence no older than 24 hours, no more than 5 minutes in the future, and availability matching the decision argument. It does not fabricate ongoing supplier monitoring.
5. For genuine AI control, call an approved real model integration on that immutable revision/evidence, capture provider/model/response_id and hash the raw output into protected evidence. Validate the response against a strict output schema; apply a versioned deterministic policy outside the model, including source evidence, all file-validation results and prohibited-content/business rules. Untrusted model output cannot call the database or approve by itself. If no real model was called, use kind=manual for a real authorized human review and make no AI claim.
6. Call `record_product_review` with these named arguments:

```ts
{
  p_listing_id: input.listingId,
  p_expected_revision: input.expectedRevision,
  p_job_id: persistedUniqueReviewJobUuid,
  p_decision: policyResult,
  p_availability: sourceEvidence.availability,
  p_snapshot_hash: input.snapshotHash,
  p_files_fingerprint: input.filesFingerprint,
  p_provenance: {
    kind: "model", // only after a real model call
    controller: workerVersion,
    source: { reference: internalEvidenceId, observed_at: sourceObservedAt, availability: sourceEvidence.availability },
    policy: { version: policyVersion, result: policyResult },
    model: { provider, name: modelName, response_id: actualResponseId, output_sha256: actualOutputHash }
  }
}
```

Use the same persisted job UUID for retry: the database deliberately rejects duplicates; on an uncertain response, read the immutable event by job UUID and reconcile rather than generate a new decision. Discard stale work on 40001. A database deadlock (40P01) may be retried with the same immutable inputs after checking current state. Do not retry stale jobs against a newer revision. Genuine AI/JARVIS automation still requires implementing, securing and approving this worker, scanner, source connector, real model call and deterministic policy. None was invoked during this task.

## Historical compatibility

The migration assigns legacy_unreviewed to every existing row, preserves all old listing/product status and price values, and changes the default to draft only for subsequently created rows. Previously public active listing + product + active seller combinations remain visible, independent of old quantity values. Their detail page explicitly says source availability has not been verified. They are neither AI-approved nor source-verified.

Legacy migration is explicit: the owner chooses "Withdraw and start revised draft", completes source data and submits a new immutable revision. It disappears from public view only on that intentional transition, withdrawal or existing product/seller ineligibility. A shared canonical product cannot be edited this way; the RPC fails closed and an operator must prepare a coordinated clone/transition plan instead of altering other sellers' content. No existing store (including Notification Test Store) is renamed, re-reviewed or changed. Its exact live state was not inspected.

## Cleanup and retention policy

`withdraw_source_listing` is logical deletion: archive/withdraw, deleted_at, cancel outstanding reservations. It does not delete bytes, products or evidence. FKs restrict hard deletion; immutable triggers protect submission/validation/review history. This can intentionally block cascading hard deletion of sellers/users with retained evidence; a separate approved retention/account-erasure process is required.

`reconcile_product_files` is service-only and NON-DESTRUCTIVE. It expires abandoned/non-active/superseded reservations and queues cancelled/expired staging, post-validation staging, rejected/withdrawn/detached vault copies and unreferenced objects. Queue inserts are idempotent. It never deletes Storage metadata or bytes, never approves its own queue entries and does not run on a schedule yet.

Proposed minimum holds: seven days for abandoned staging/orphans after expiry or discovery; seven days for staging after validation; thirty days for rejected/withdrawn/detached validated copies. These are earliest investigation times, NOT deletion authorization. Failed validation metadata and historical source/review evidence remain retained. No automatic destructive retention policy is installed.

A future authorized cleanup operator must recheck live reservation status/expiry, attachment and ALL submission references, active worker jobs and legal/audit holds immediately before approving deletion. Never delete a current/pending/approved or retained historical revision's vault bytes merely because a stale queue record exists. Keep evidence metadata unless a separately approved retention migration permits removal. Serialize cleanup with worker activity, delete using the Storage API (not SQL storage.objects DELETE), verify success, then mark completed using a privileged operator procedure. Retry/reconcile late writes; existing upload capabilities may recreate abandoned staging objects. Do not enable destructive cleanup until policy and race tests are approved.

## RLS / grants

All eight new tables enable RLS. Default grants are revoked from PUBLIC, anon, authenticated and service_role, then only intended SELECT grants are restored. None grant browser writes or service direct table writes.

| Table | anon | authenticated | RLS policies |
|---|---|---|---|
| listing_sources | none | SELECT | active owner only |
| listing_draft_files | none | SELECT | active owner only |
| product_files | SELECT safe display/status columns | same | active owner OR eligible current public file |
| listing_submissions | none | none | none; trusted service/owner only |
| submission_files | none | none | none; trusted service/owner only |
| product_file_validations | none | none | none; trusted service/owner only |
| product_review_events | none | none | none; trusted service/owner only |
| product_cleanup_queue | none | none | none; trusted service/owner only |

service_role gets SELECT on all eight and guarded worker RPC EXECUTE; its BYPASSRLS does not grant missing DML. PostgreSQL owners retain owner bypass. Security-definer functions run as that trusted migration owner; fixed search_path and explicit grants delimit their use. Products/listings retain owner read policies; their public policy becomes eligibility-based. Seller Auth/status/admin/notification/email policies and functions are unchanged. Product Storage gets one own-reservation INSERT policy and restrictive INSERT/SELECT/UPDATE/DELETE boundaries for all five bucket IDs. No anonymous or authenticated vault write is granted.

## Required checks and controlled application steps

1. Do not apply now. Confirm the target migration history through an authorized read-only review; this timestamp must be absent. Compare the actual schema/functions/column grants/default privileges/Storage policies with the prior migrations. Existing bucket IDs or function/table/policy collisions must be investigated rather than silently replaced. Backup/snapshot first when future deployment is approved.
2. Provision a disposable LOCAL Supabase outside live, once authorized and tooling is available. Restore a sanitized representative pre-proposal schema/data including active legacy listings, stock values, shared products and active/pending/rejected/suspended sellers. Apply migrations there ONLY and run `psql -v ON_ERROR_STOP=1 -f supabase/tests/zero_inventory_product_files.sql`. This task did not run that command or apply even a local Supabase migration.
3. Test the actual local Storage HTTP service: every declared type/size boundary; anonymous/cross-seller writes; upsert/copy/move/sign/read denial; path traversal; reservations cancelled/expired/seller suspended after token issuance; late in-flight upload persistence; exact version/hash checks; vault isolation; private file access and public withdrawal. SQL metadata fixtures are not equivalent to Storage HTTP/byte tests.
4. Run concurrent local sessions: same revision with same and different review-job UUIDs (exactly one event); submit vs edit; begin-revision vs delayed old review; finalization vs suspension/expiry/cancellation; Storage upload completion vs review; cleanup inspection vs reattachment/new submission. Listing/seller locks and unique constraints should reject/serialize; verify no stale state commits. The supplied SQL suite covers sequential adversarial cases; actual concurrency tests remain outstanding.
5. Implement and independently validate the trusted scanner/worker contract before enabling new-file approvals. Provide a server-only service credential for delivery, and load-test 100 MiB/range responses, concurrency, rate/quotas and no-store behavior. No client bundle, logs or response may expose that key or internal paths. Real AI enablement requires the genuine model/source/policy integration described above.
6. Re-run local checks: `npx.cmd tsc --noEmit --incremental false`; `npx.cmd eslint src tests next.config.ts eslint.config.mjs postcss.config.mjs tailwind.config.ts`; `node --experimental-strip-types --test tests/*.test.mjs`; `npm.cmd run build`. Use ESLint directly because the existing package lint script uses removed `next lint`.
7. Only after these gates and explicit future live authorization: use a coordinated maintenance deployment; pause product writes/review jobs, back up, apply the reviewed proposal through the normal migration tool exactly once (bucket rows/policies are included; no manual bucket creation), deploy its matching application, configure the real validator/review worker, then smoke-test legacy visibility and access before reopening writes. If the old proposal was ever applied, stop and use an independently reviewed forward migration instead.
8. Verify locally with two active sellers and one buyer: create a source draft; upload public PNG/video/PDF and private documents; confirm pending files have no remote view link; submit and observe revision 1 pending/checking; test privileged worker fixtures; after genuine trusted validation/review confirm buyer public-only media and owner private links. Start a revised draft, see explicit withdrawal, change source/remove a file, submit revision 2 and reject delayed revision-1 jobs. Suspend seller during an upload and confirm finalization fails. Cancel/expire a reservation and confirm late bytes remain unpublishable. Confirm the unchanged account inbox, seller decisions and email regression paths.

The migration intentionally fails transactionally on unexpected existing bucket/table/column/policy names; it does not silently modify live Storage. Non-null additions have safe defaults for all existing rows; new FK/check constraints bind new tables. Existing stock values are not constrained or rewritten. Locks/backfill cost and deployment compatibility still require testing against a representative database.

Verdict pending those gates: BLOCKED for live application. This is a hardened AI-ready foundation, not a claim that genuine AI control or real content inspection is currently deployed.

## Retesting the SHA256 vault-path correction on the disposable local instance

The user has confirmed this proposal was applied only to their disposable local instance. Editing the source does not update that instance's installed function. Rebuild that disposable database from the corrected migrations; do not rerun the entire migration over existing tables, repair remote migration history, or use db push. This discards local database fixtures, so preserve any wanted local test evidence first and recreate uploads/reservations afterward. Never reuse old file IDs, versions or validation payloads after reset.

From the repository root, with the local Docker stack running, first confirm `supabase status` identifies the expected local stack (API 127.0.0.1:54321 and PostgreSQL 127.0.0.1:54322 in this config). Then run these commands yourself against the disposable instance only:

```powershell
npx.cmd supabase status
npx.cmd supabase db reset --local --no-seed
if ($LASTEXITCODE -ne 0) { throw "Disposable local reset failed" }
psql -X -h 127.0.0.1 -p 54322 -U postgres -d postgres -W -v ON_ERROR_STOP=1 -f supabase/tests/zero_inventory_product_files.sql
if ($LASTEXITCODE -ne 0) { throw "Disposable local SQL regression failed" }
```

The psql command explicitly targets loopback and prompts for the LOCAL database password. It requires the PostgreSQL client. If psql is available only in Docker, use the following alternative only after confirming Docker is using the local Desktop daemon and the exact container is `supabase_db_Zvese_1.0` (matching this config's project_id):

```powershell
Get-Content -Raw -Encoding utf8 supabase/tests/zero_inventory_product_files.sql | docker exec -i supabase_db_Zvese_1.0 psql -X -U postgres -d postgres -v ON_ERROR_STOP=1
if ($LASTEXITCODE -ne 0) { throw "Disposable local SQL regression failed" }
```

The suite rolls back its fixtures and tests catalog metadata; it does not upload or inspect real bytes. Repeat the real local Storage test with a newly finalized 38-byte TXT reservation, compute its actual SHA256, write the identical bytes to `validated/<new file ID>/<actual hash>.txt` with upsert=false, and call the local validation RPC using that exact hash and both current Storage versions. Expect service-role success and seller-role denial. Keep all API calls at the local API URL with local credentials. No commands in this section were executed during the correction task.
