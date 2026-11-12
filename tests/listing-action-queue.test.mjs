import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import test from "node:test";

const require = createRequire(import.meta.url);
// Execute the installed Next queue, isolating its reducer from React/network.
// Server Action results resolve before the reducer's promise leaves the queue.
function fixture() {
  const calls = [];
  const types = { ACTION_SERVER_ACTION: "server-action", ACTION_RESTORE: "restore", ACTION_REFRESH: "refresh" };
  const exports = {};
  vm.runInNewContext(readFileSync(require.resolve("next/dist/client/components/app-router-instance.js"), "utf8"), {
    exports, module: { exports }, process: { env: {} }, window: { location: { origin: "http://localhost" } },
    require(name) {
      if (name === "react") return { startTransition: (fn) => fn() };
      if (name.endsWith("router-reducer-types")) return types;
      if (name.endsWith("is-thenable")) return { isThenable: (value) => !!value?.then };
      if (name.endsWith("/router-reducer")) return { reducer(state, action) {
        calls.push(action.name || action.type);
        if (action.type !== types.ACTION_SERVER_ACTION) return state;
        return Promise.resolve().then(async () => {
          action.resolve(action.name);
          return state;
        });
      } };
      return {};
    },
  });
  const queue = exports.createMutableActionQueue({}, null);
  const dispatch = (action) => queue.dispatch(action, () => {});
  // Match Next's async callServer wrapper, including promise adoption timing.
  const call = async (name) => new Promise((resolve, reject) => dispatch({ type: types.ACTION_SERVER_ACTION, name, resolve, reject }));
  return { calls, call, restore: () => dispatch({ type: types.ACTION_RESTORE }) };
}

test("Next queue reproduction: history restore after save strands the reservation", async () => {
  const f = fixture();
  await f.call("save");
  f.restore();
  let settled = false;
  void f.call("reserve").then(() => { settled = true; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(settled, false);
  assert.deepEqual(f.calls, ["save", "restore", "refresh"]);
});

test("consecutive listing actions complete when history is not changed between them", async () => {
  const f = fixture();
  await f.call("save");
  await f.call("reserve");
  await f.call("finish");
  await f.call("submit");
  assert.deepEqual(f.calls, ["save", "reserve", "finish", "submit"]);
});
