import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Orbit · 나의 운영실",
  description: "오늘의 실행과 내일의 계획을 연결하는 개인 매니지먼트 앱 — 인터랙티브 설계 시안",
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
};
export default function RootLayout({children}: Readonly<{children: React.ReactNode}>) {
  return <html lang="ko"><body>{children}</body></html>;
}
