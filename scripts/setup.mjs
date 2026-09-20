import { constants, copyFileSync, existsSync } from "node:fs";

const root = new URL("../", import.meta.url);
const target = new URL(".env.local", root);
if (existsSync(target)) {
  console.log("Kept your existing .env.local unchanged.");
} else {
  copyFileSync(new URL(".env.example", root), target, constants.COPYFILE_EXCL);
  console.log("Created .env.local. Add your Mapbox public token before starting.");
}
console.log("Run pnpm run dev from the repository root:");
console.log("  Dispatch http://localhost:5176");
console.log("  Officer  http://localhost:5177");
console.log("  Hospital http://localhost:5178");
console.log("pnpm run dev:map serves every route on http://localhost:5173, including /map.");
