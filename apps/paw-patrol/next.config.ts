import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { workspaceConfig } from "./features/paw-patrol/workspace";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));
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
