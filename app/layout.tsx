import type { Metadata, Viewport } from "next";
import "./globals.css";
import { LocaleProvider } from "@/lib/i18n";

export const metadata: Metadata = {
  title: "墨架 Inkshelf",
  description: "私人图书馆：导入自己的 PDF / EPUB，跨设备同步阅读",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    title: "墨架",
    statusBarStyle: "default",
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f4f4f2" },
    { media: "(prefers-color-scheme: dark)", color: "#141310" },
  ],
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

// 防白闪：绘制前依据 localStorage 设 data-theme（system 则不设，交给 prefers-color-scheme）
const themeInit = `(function(){try{var t=localStorage.getItem('inkshelf-theme');if(t==='dark'||t==='light')document.documentElement.dataset.theme=t;}catch(e){}})();`;

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh">
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInit }} />
      </head>
      <body>
        <LocaleProvider>{children}</LocaleProvider>
      </body>
    </html>
  );
}
