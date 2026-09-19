import type { Metadata, Viewport } from "next";
import {PwaProvider} from "@/components/orbit/pwa-provider";
import "./globals.css";
import "./cosmic.css";
import "./calendar.css";
import "./projects.css";
import "./brand-legacy.css";
import "./brand-system.css";
import "./focus.css";
import "./mobile-overlays.css";
import {AppearanceProvider} from "@/components/orbit/appearance";
export const metadata: Metadata = {
  title: "Orbit · 나의 페이스메이커",
  description: "나를 중심으로 프로젝트와 지식, 실행을 연결하고 성과로 확장하는 개인 AI 시스템.",
  appleWebApp: { capable: true, title: "Orbit", statusBarStyle: "black-translucent" },
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg", apple: "/icons/apple-touch-icon.png" },
};
// Vinext 0.0.50 omits viewportFit when serializing. Emit one explicit viewport below.
export const viewport: Viewport = {width:undefined,initialScale:undefined,themeColor:"#080B16"};
export default function RootLayout({children}: Readonly<{children: React.ReactNode}>) {
  return <html lang="ko" suppressHydrationWarning><head><script dangerouslySetInnerHTML={{__html:`try{var t=localStorage.getItem("orbit:appearance:v1");if(["dark","light","focus","system"].includes(t)){document.documentElement.dataset.orbitTheme=t==="system"?(matchMedia("(prefers-color-scheme: light)").matches?"light":"dark"):t}}catch(e){}`}}/><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"/><link rel="manifest" href="/manifest.webmanifest" crossOrigin="use-credentials"/></head><body><AppearanceProvider><PwaProvider>{children}</PwaProvider></AppearanceProvider></body></html>;
}
