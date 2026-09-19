import assert from "node:assert/strict";
import test from "node:test";
import { findInvalidLockEntries } from "./check-lockfile.mjs";

test("accepts complete package metadata, prereleases, and workspace links", () => {
  assert.deepEqual(
    findInvalidLockEntries({
      lockfileVersion: 3,
      packages: {
        "": { version: "0.1.0" },
        "node_modules/example": { version: "1.2.3-beta.1+build.2" },
        "node_modules/workspace": { link: true, resolved: "packages/workspace" },
      },
    }),
    [],
  );
});

test("rejects the versionless optional entries that broke CI", () => {
  assert.deepEqual(
    findInvalidLockEntries({
      lockfileVersion: 3,
      packages: {
        "node_modules/sharp/node_modules/@img/sharp-linux-x64": { optional: true },
      },
    }),
    ["node_modules/sharp/node_modules/@img/sharp-linux-x64: missing or invalid package version"],
  );
});

test("rejects blank and malformed versions", () => {
  assert.equal(
    findInvalidLockEntries({
      lockfileVersion: 3,
      packages: {
        "node_modules/a": { version: "" },
        "node_modules/b": { version: "not-a-version" },
      },
    }).length,
    2,
  );
});

test("rejects missing or unsupported lockfile structure", () => {
  assert.equal(findInvalidLockEntries({}).length, 1);
  assert.equal(findInvalidLockEntries({ lockfileVersion: 2, packages: {} }).length, 1);
});
