import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Runs before npm ci, so this check must not depend on node_modules.
export function findInvalidLockEntries(lockfile) {
  if (lockfile.lockfileVersion !== 3 || !lockfile.packages) {
    return ["Expected a version 3 package-lock.json with package entries."];
  }
  return Object.entries(lockfile.packages)
    .filter(([, entry]) => !entry.link)
    .filter(
      ([, entry]) =>
        typeof entry.version !== "string" ||
        !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(entry.version),
    )
    .map(([name]) => `${name || "(root)"}: missing or invalid package version`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const lockfile = JSON.parse(
    readFileSync(new URL("../package-lock.json", import.meta.url), "utf8"),
  );
  const errors = findInvalidLockEntries(lockfile);
  if (errors.length) {
    console.error(`Incomplete dependency lockfile:\n${errors.join("\n")}`);
    console.error("Regenerate with the documented npm version and a clean writable cache.");
    process.exitCode = 1;
  } else {
    console.log("Dependency lockfile metadata is complete.");
  }
}
