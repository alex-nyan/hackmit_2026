import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { workspaceConfig } from "./features/paw-patrol/workspace";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));
// Dispatch, Officer and Hospital run as three concurrent dev servers off this
// one codebase. Each gets its own build directory and TypeScript project so the
// processes cannot overwrite one another's output.
const { workspace, distDir } = workspaceConfig(
  process.env.PAW_PATROL_WORKSPACE,
  process.env.PAW_PATROL_DIST_DIR,
);

const config: NextConfig = {
  distDir,
  typescript: {
    tsconfigPath: workspace ? `tsconfig.${workspace}.json` : "tsconfig.json",
  },
  reactStrictMode: true,
  devIndicators: false,
  poweredByHeader: false,
  turbopack: { root: projectRoot },
  outputFileTracingRoot: projectRoot,
};

export default config;
