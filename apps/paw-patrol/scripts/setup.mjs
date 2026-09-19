import { constants, copyFileSync, existsSync } from "node:fs";

const root = new URL("../", import.meta.url);
const target = new URL(".env.local", root);
if (existsSync(target)) {
  console.log("Kept your existing .env.local unchanged.");
} else {
  copyFileSync(new URL(".env.example", root), target, constants.COPYFILE_EXCL);
  console.log("Created .env.local. Add your Mapbox public token before starting.");
}
console.log("Run npm run dev, then open http://localhost:5176.");
