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

// React 19 moved the JSX namespace out of global and into the `react` module, so
// the <webview> intrinsic has to be declared there.
declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      webview: React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
        src?: string;
        partition?: string;
        allowpopups?: boolean;
        useragent?: string;
        webpreferences?: string;
      };
    }
  }
}

export {};
