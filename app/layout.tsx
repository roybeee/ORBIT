import type { Metadata, Viewport } from "next";
import {PwaProvider} from "@/components/orbit/pwa-provider";
import "./globals.css";
import "./cosmic.css";
import "./calendar.css";
export const metadata: Metadata = {
  title: "Orbit · 나의 페이스메이커",
  description: "나를 중심으로 프로젝트와 지식, 실행을 연결하고 성과로 확장하는 개인 AI 시스템.",
  appleWebApp: { capable: true, title: "Orbit", statusBarStyle: "black-translucent" },
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg", apple: "/icons/apple-touch-icon.png" },
};
// Vinext 0.0.50 omits viewportFit when serializing. Emit one explicit viewport below.
export const viewport: Viewport = {width:undefined,initialScale:undefined,themeColor:"#070a14"};
export default function RootLayout({children}: Readonly<{children: React.ReactNode}>) {
  return <html lang="ko"><head><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"/><link rel="manifest" href="/manifest.webmanifest" crossOrigin="use-credentials"/></head><body><PwaProvider>{children}</PwaProvider></body></html>;
}
