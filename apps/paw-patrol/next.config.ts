import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { workspaceConfig } from "./features/paw-patrol/workspace";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(projectRoot, "../..");
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
  // The live workspace imports the canonical generated contracts from /shared.
  turbopack: { root: repositoryRoot },
  outputFileTracingRoot: repositoryRoot,
};

export default config;
