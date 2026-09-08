import type { Metadata, Viewport } from "next";
import {PwaProvider} from "@/components/orbit/pwa-provider";
import "./globals.css";
export const metadata: Metadata = {
  title: "Orbit · 나의 페이스메이커",
  description: "목표에 닿을 때까지 나를 살피고, 먼저 움직이는 AI 비서실장. 일과 건강, 마음과 배움까지.",
  appleWebApp: { capable: true, title: "Orbit", statusBarStyle: "default" },
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg", apple: "/icons/apple-touch-icon.png" },
};
// Vinext 0.0.50 omits viewportFit when serializing. Emit one explicit viewport below.
export const viewport: Viewport = {width:undefined,initialScale:undefined,themeColor:"#5558e8"};
export default function RootLayout({children}: Readonly<{children: React.ReactNode}>) {
  return <html lang="ko"><head><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"/><link rel="manifest" href="/manifest.webmanifest" crossOrigin="use-credentials"/></head><body><PwaProvider>{children}</PwaProvider></body></html>;
}
