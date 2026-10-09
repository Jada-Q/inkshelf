import type { NextConfig } from "next";

/* iOS 离线包走静态导出（Capacitor）；Web（Vercel）保留 PPR。
   用 BUILD_TARGET=ios pnpm build 产出 out/ 静态站点。 */
const isExport = process.env.BUILD_TARGET === "ios";

const nextConfig: NextConfig = {
  ...(isExport
    ? { output: "export", images: { unoptimized: true } }
    : { cacheComponents: true, partialPrefetching: true }),
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
