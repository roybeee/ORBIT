import type { Metadata, Viewport } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Orbit · 나의 운영실",
  description: "오늘의 실행과 내일의 계획을 연결하는 개인 매니지먼트 앱",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Orbit", statusBarStyle: "default" },
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
};
export const viewport: Viewport = {width:"device-width",initialScale:1,themeColor:"#5558e8"};
export default function RootLayout({children}: Readonly<{children: React.ReactNode}>) {
  return <html lang="ko"><body>{children}</body></html>;
}
