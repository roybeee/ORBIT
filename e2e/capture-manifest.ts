// Every screenshot the smoke takes is declared here, so a reviewer can see
// which screens are covered at which viewport without reading the spec.
export const VIEWPORTS = {
  mobile: { width: 390, height: 844 },
  desktop: { width: 1280, height: 800 },
} as const;

export type ViewportName = keyof typeof VIEWPORTS;

export const CAPTURES = {
  today: { route: "/", description: "Signed-in Today screen after first load" },
  "project-form-invalid": { route: "/", description: "New project dialog blocked by an empty title" },
  "project-created": { route: "/", description: "Project detail opened right after saving" },
  "project-after-reload": { route: "/", description: "Project list after a full page reload" },
} as const;

export type CaptureName = keyof typeof CAPTURES;

export function captureFile(screen: CaptureName, viewport: ViewportName): string {
  return `${viewport}-${screen}.png`;
}
