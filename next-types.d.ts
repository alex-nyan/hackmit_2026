// Next rewrites next-env.d.ts for every process. Keep shared framework types
// stable; each tsconfig includes only its own generated route declarations.
import "next";
import "next/image-types/global";
