/// <reference types="vite/client" />

import type { TesterApi } from "../../preload/index.js";

/** Minimal typing for Electron's <webview>. Only the members we actually use —
 *  the full surface is large and untyped by Electron for the renderer. */
export interface WebviewEl extends HTMLElement {
  src: string;
  getURL(): string;
  getTitle(): string;
  loadURL(url: string): Promise<void>;
  reload(): void;
  stop(): void;
  goBack(): void;
  goForward(): void;
  canGoBack(): boolean;
  canGoForward(): boolean;
  isLoading(): boolean;
  executeJavaScript(code: string): Promise<unknown>;
  capturePage(rect?: { x: number; y: number; width: number; height: number }): Promise<{ toDataURL(): string }>;
  openDevTools(): void;
  closeDevTools(): void;
  isDevToolsOpened(): boolean;
  setZoomFactor(f: number): void;
  getUserAgent(): string;
  setUserAgent(userAgent: string): void;
}

declare global {
  interface Window { tester: TesterApi }
}

// No JSX augmentation for <webview> here on purpose. @types/react already
// declares the intrinsic (React.WebViewHTMLAttributes), and a second
// declaration does not override it — it merges, loses, and is hidden by
// skipLibCheck, so it reads as authoritative while having no effect at all.
// Anything that looks wrong about the guest's props is wrong in React's
// declaration, and has to be handled at the call site. See `GuestView.tsx`.

export {};
