// Never accepts a database URL or credentials. Only the pinned existing local dev container.
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const docker = "C:\\Users\\Dell\\AppData\\Local\\Programs\\DockerDesktop\\resources\\bin\\docker.exe";
const id = "d1ace9d8e335159651ca67e2969c1bd8f0fff7cdc275c9c5c0cc6ee80bc8e2fa";
const inspected = spawnSync(docker, ["inspect", "--type", "container", id], { encoding: "utf8", timeout: 15000 });
if (inspected.status !== 0) throw new Error("LOCAL_CONTAINER_INSPECTION_FAILED");
const [container] = JSON.parse(inspected.stdout);
if (container.Id !== id || container.Name !== "/supabase_db_zvese-1-0" || !container.State.Running ||
    container.Image !== "sha256:6942962433a569e87f228b4d4ab7e11db5deca64e43babb3a038443ad6c4f1bb" ||
    container.HostConfig.NetworkMode !== "supabase_network_zvese-1-0") throw new Error("LOCAL_CONTAINER_IDENTITY_MISMATCH");
const proposal = readFileSync(new URL("../supabase/proposals/20261030120000_mvp_commerce.sql", import.meta.url), "utf8");
if (!/\ncommit;\s*$/.test(proposal) || (proposal.match(/\bcommit\s*;/gi) ?? []).length !== 1) throw new Error("UNEXPECTED_TRANSACTION_BOUNDARY");
const tests = readFileSync(new URL("../tests/commerce.local.sql", import.meta.url), "utf8");
if (/\b(commit|rollback)\s*;/i.test(tests)) throw new Error("TEST_TRANSACTION_BOUNDARY_FORBIDDEN");
const input = proposal.replace(/\ncommit;\s*$/, "\n") + tests + "\nROLLBACK;\nSELECT to_regclass('public.order_commerce') IS NULL AS rollback_verified;\n";
const result = spawnSync(docker, ["exec", "-i", "--user", "postgres", id, "psql", "-X", "-q", "-v", "ON_ERROR_STOP=1", "-d", "postgres"], { input, encoding: "utf8", timeout: 90000, maxBuffer: 1024 * 1024 });
if (result.status !== 0) {
  // Test statements contain synthetic data only, but keep diagnostics bounded.
  process.stderr.write((result.stderr || "LOCAL_SQL_TEST_FAILED").slice(0, 3000));
  process.exitCode = 1;
} else if (!result.stdout.includes("LOCAL_COMMERCE_ASSERTIONS_PASS") || !/rollback_verified\s*\n[- ]+\n\s*t\b/.test(result.stdout)) {
  throw new Error("LOCAL_SQL_TEST_VERIFICATION_MISSING");
} else {
  process.stdout.write("LOCAL_COMMERCE_ASSERTIONS_PASS\nROLLBACK_VERIFIED\n");
}
