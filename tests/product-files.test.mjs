import assert from "node:assert/strict";
import test from "node:test";
import { validateProductFile } from "../src/lib/marketplace/product-files.ts";

const check = (name, type, size = 100, visibility = "public") => validateProductFile({ name, type, size }, visibility);

test("MIME and extension must both match; dangerous and unknown formats fail closed", () => {
  for (const [name, type] of [
    ["run.exe", "application/x-msdownload"], ["run.js", "text/javascript"],
    ["page.html", "text/html"], ["icon.svg", "image/svg+xml"],
    ["image.png", "application/octet-stream"], ["image.png", "image/jpeg"],
    ["image.png", ""], ["photo", "image/jpeg"], ["photo.jpg.exe", "image/jpeg"],
    ["../image.png", "image/png"], ["a\\image.png", "image/png"], ["bad\nname.png", "image/png"],
  ]) assert.ok(check(name, type), `${name} must fail`);
});
test("all supported formats and public/private boundaries", () => {
  for (const [name, type] of [["photo.JPG", "image/jpeg"], ["photo.png", "image/png"], ["photo.webp", "image/webp"], ["clip.mp4", "video/mp4"], ["clip.webm", "video/webm"], ["guide.pdf", "application/pdf"]]) {
    assert.equal(check(name, type), null);
  }
  for (const [name, type] of [["guide.pdf", "application/pdf"], ["source.txt", "text/plain"], ["data.csv", "text/csv"],
    ["source.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
    ["source.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"]]) {
    assert.equal(check(name, type, 100, "private"), null);
    if (!name.endsWith("pdf")) assert.ok(check(name, type));
  }
  assert.ok(check("photo.png", "image/png", 100, "private"));
  assert.ok(check("clip.mp4", "video/mp4", 100, "private"));
});
test("exact size boundaries, zero, fractional and nonfinite sizes", () => {
  for (const [name, type, limit] of [["image.jpg", "image/jpeg", 10], ["clip.mp4", "video/mp4", 100], ["guide.pdf", "application/pdf", 25]]) {
    assert.equal(check(name, type, limit * 1024 * 1024), null);
    assert.ok(check(name, type, limit * 1024 * 1024 + 1));
    for (const size of [0, -1, 1.5, NaN, Infinity]) assert.ok(check(name, type, size));
  }
});
