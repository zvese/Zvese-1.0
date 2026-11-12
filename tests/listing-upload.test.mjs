import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";
import { listingRequest, ListingRequestUncertain } from "../src/lib/marketplace/listing-request.ts";
import * as productFiles from "../src/lib/marketplace/product-files.ts";

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

// Run the actual form event handlers with in-memory hooks and mocked boundaries.
// No Next build, browser session, Supabase credentials, or database writes.
function formFixture(overrides = {}, draft = null) {
  const calls = [];
  const slots = [];
  let cursor = 0;
  const defaults = {
    saveListing: async () => ({ listingId: "saved-listing" }),
    reserveFile: async () => ({ file: { id: "file-1", bucket_id: "product-images", object_path: "incoming/test.png", expires_at: "2099-01-01" } }),
    upload: async () => ({ error: null }),
    finishFile: async () => ({}), removeFile: async () => ({}), submitListing: async () => ({}), beginRevision: async () => ({}),
  };
  const actions = Object.fromEntries(Object.keys(defaults).map((name) => [name, (...args) => {
    calls.push({ name, args });
    return (overrides[name] || defaults[name])(...args);
  }]));
  const useState = (initial) => {
    const index = cursor++;
    if (!(index in slots)) slots[index] = initial;
    return [slots[index], (value) => { slots[index] = typeof value === "function" ? value(slots[index]) : value; }];
  };
  const exports = {};
  const source = readFileSync(new URL("../src/app/account/listings/new/listing-form.tsx", import.meta.url), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInNewContext(code, {
    exports, Error, crypto: { randomUUID: () => "selection-1" },
    FormData: class extends Map { constructor() { super(); } },
    window: { history: { replaceState() { throw new Error("History must not interrupt Server Actions"); } } },
    require(name) {
      if (name === "react") return { useState, useEffect() {}, useRef(initial) { return useState({ current: initial })[0]; } };
      if (name === "react/jsx-runtime") return { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
      if (name.includes("ui/button")) return { Button: "button" };
      if (name.includes("supabase/client")) return { createClient: () => ({ storage: { from: () => ({ upload: actions.upload }) } }) };
      if (name.includes("listing-request")) return { ListingRequestUncertain, listingRequest: (fn, stage) => listingRequest(fn, stage, 20) };
      if (name.includes("product-files")) return productFiles;
      if (name === "../actions") return actions;
      throw new Error(`Unexpected import ${name}`);
    },
  });
  const render = () => { cursor = 0; return exports.ListingForm({ currency: "USD", draft, initialFiles: [] }); };
  const all = (node) => {
    if (node == null || typeof node === "boolean") return [];
    if (Array.isArray(node)) return node.flatMap(all);
    return [node, ...all(node.props?.children)];
  };
  const nodes = () => all(render());
  const select = () => nodes().find((node) => node.type === "input" && node.props.type === "file").props.onChange({ target: { files: [{ name: "OG Wacho.png", type: "image/png", size: 100 }], value: "" } });
  const save = (submit = false) => render().props.onSubmit({ preventDefault() {}, currentTarget: {}, nativeEvent: { submitter: { getAttribute: () => submit ? "submit" : "save" } } });
  const text = () => nodes().filter((node) => typeof node === "string").join(" ");
  const button = (label) => nodes().find((node) => node.type === "button" && node.props.children === label);
  return { calls, select, save, text, button, nodes };
}

test("save → reserve → Storage → finish → submit; retry keeps the listing and skips completed files", async () => {
  const f = formFixture();
  f.select();
  await f.save();
  assert.deepEqual(f.calls.map((call) => call.name), ["saveListing", "reserveFile", "upload", "finishFile"]);
  assert.equal(f.calls[2].args[2].upsert, false);
  assert.match(f.text(), /Uploaded; content validation/);
  assert.equal(f.button("Save draft and upload").props.disabled, false);
  assert.ok(f.nodes().some((node) => node.props?.href === "/account/listings/new?draft=saved-listing"));
  await f.save(true);
  assert.equal(f.calls[4].args[0].get("listing_id"), "saved-listing");
  assert.deepEqual(f.calls.slice(4).map((call) => call.name), ["saveListing", "submitListing"]);
  assert.match(f.text(), /Submitted for review/);
});

test("explicit reservation rejection clears busy, retains selection and retries the same saved draft", async () => {
  let attempts = 0;
  const f = formFixture({ reserveFile: async () => ++attempts === 1 ? { error: "Editable draft required." } : { file: { id: "file-1", bucket_id: "product-images", object_path: "incoming/test.png" } } });
  f.select();
  await f.save();
  assert.match(f.text(), /Editable draft required/);
  assert.equal(f.button("Save draft and upload").props.disabled, false);
  assert.equal(f.calls.some((call) => call.name === "upload"), false);
  await f.save();
  assert.equal(f.calls[2].args[0].get("listing_id"), "saved-listing");
  assert.match(f.text(), /Draft and uploads saved/);
});

for (const stage of ["saveListing", "reserveFile", "upload", "finishFile", "submitListing"]) {
  test(`${stage} timeout clears progress and prevents duplicate mutation or late continuation`, async () => {
    const pending = deferred();
    const f = formFixture({ [stage]: () => pending.promise });
    f.select();
    const first = f.save(true);
    // A second event in the same React render must not create a second draft.
    await f.save(true);
    await first;
    assert.match(f.text(), /timed out/);
    assert.doesNotMatch(f.text(), /Uploading 1 of 1|Saving draft\.\.\.|Submitting for review\.\.\./);
    assert.equal(f.button("Save draft and upload").props.disabled, true);
    assert.ok(f.nodes().some((node) => node.type === "a"), "busy must clear and expose recovery link");
    const before = f.calls.length;
    await f.save(true);
    pending.resolve({ listingId: "late-draft", file: { id: "late-file" }, error: null });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(f.calls.length, before, "late results cannot resume an abandoned upload workflow");
    assert.equal(f.calls.filter((call) => call.name === stage).length, 1);
  });
}

test("Storage rejection retains incomplete record; remove/reselect recovers without reusing its path", async () => {
  let uploads = 0;
  let reservations = 0;
  const f = formFixture({
    reserveFile: async () => ({ file: { id: `file-${++reservations}`, bucket_id: "product-images", object_path: `incoming/${reservations}.png` } }),
    upload: async () => ++uploads === 1 ? { error: { message: "denied" } } : { error: null },
  });
  f.select();
  await f.save(true);
  assert.match(f.text(), /Remove the incomplete entry/);
  assert.equal(f.calls.some((call) => call.name === "submitListing"), false);
  await f.button("Remove").props.onClick();
  f.select();
  await f.save();
  assert.equal(f.calls.filter((call) => call.name === "upload").length, 2);
  assert.match(f.text(), /Draft and uploads saved/);
});

test("finalization failure retains incomplete record and does not submit", async () => {
  const f = formFixture({ finishFile: async () => ({ error: "Upload could not be confirmed. Remove the incomplete file and try again." }) });
  f.select();
  await f.save(true);
  assert.match(f.text(), /Incomplete or expired upload/);
  assert.equal(f.button("Save draft and upload").props.disabled, false);
  assert.equal(f.calls.some((call) => call.name === "submitListing"), false);
});

test("transport rejection is actionable and cannot be blindly replayed", async () => {
  const f = formFixture({ reserveFile: async () => { throw new Error("internal transport detail"); } });
  f.select();
  await f.save();
  assert.match(f.text(), /Reserving OG Wacho.png could not be confirmed/);
  assert.doesNotMatch(f.text(), /internal transport detail/);
  const before = f.calls.length;
  await f.save();
  assert.equal(f.calls.length, before);
});

test("returned PostgREST transport failure also requires reconciliation", async () => {
  const f = formFixture({ reserveFile: async () => ({ error: "Could not reserve this file.", uncertain: true }) });
  f.select();
  await f.save();
  assert.match(f.text(), /could not be confirmed/);
  assert.equal(f.button("Save draft and upload").props.disabled, true);
  const before = f.calls.length;
  await f.save();
  assert.equal(f.calls.length, before);
});
