import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  // ⚠️ appId = iOS bundle identifier，要和你 Apple 开发者账号里注册的一致，确认后再提审
  appId: "com.jadaqiu.inkshelf",
  appName: "墨架",
  webDir: "out", // 由 BUILD_TARGET=ios next build 产出的静态站点（含离线词典）
  ios: {
    contentInset: "always",
  },
};

export default config;
