import { constants, copyFileSync, existsSync } from "node:fs";

const root = new URL("../", import.meta.url);
for (const directory of ["", "apps/paw-patrol/"]) {
  const target = new URL(`${directory}.env.local`, root);
  if (existsSync(target)) {
    console.log(`Kept your existing ${directory}.env.local unchanged.`);
  } else {
    copyFileSync(new URL(`${directory}.env.example`, root), target, constants.COPYFILE_EXCL);
    console.log(`Created ${directory}.env.local.`);
  }
}
console.log("Set your public Mapbox token in apps/paw-patrol/.env.local.");
console.log("Run npm run dev from the repository root:");
console.log("  Dispatch http://localhost:5176");
console.log("  Officer  http://localhost:5177");
console.log("  Hospital http://localhost:5178");
console.log("The optional original map uses root .env.local and npm run dev:map.");
