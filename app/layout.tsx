import type { Metadata, Viewport } from "next";
import {PwaProvider} from "@/components/orbit/pwa-provider";
import "./globals.css";
export const metadata: Metadata = {
  title: "Orbit · 나의 운영실",
  description: "오늘의 실행과 내일의 계획을 연결하는 개인 매니지먼트 앱",
  appleWebApp: { capable: true, title: "Orbit", statusBarStyle: "default" },
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg", apple: "/icons/apple-touch-icon.png" },
};
// Vinext 0.0.50 omits viewportFit when serializing. Emit one explicit viewport below.
export const viewport: Viewport = {width:undefined,initialScale:undefined,themeColor:"#5558e8"};
export default function RootLayout({children}: Readonly<{children: React.ReactNode}>) {
  return <html lang="ko"><head><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"/><link rel="manifest" href="/manifest.webmanifest" crossOrigin="use-credentials"/></head><body><PwaProvider>{children}</PwaProvider></body></html>;
}
