import type { CSSProperties, JSX } from "react";

// Inline stroke icons — a single 16px grid, currentColor, no icon dependency.

const P: Record<string, string> = {
  back: "M10 12.5 5.5 8 10 3.5",
  fwd: "M6 3.5 10.5 8 6 12.5",
  reload: "M13 8a5 5 0 1 1-1.6-3.7M13 2.5V5.5H10",
  close: "M4 4l8 8M12 4l-8 8",
  globe: "M8 14A6 6 0 1 0 8 2a6 6 0 0 0 0 12M2.2 6.4h11.6M2.2 9.6h11.6M8 2c-3 3.5-3 8.5 0 12 3-3.5 3-8.5 0-12",
  target: "M8 14A6 6 0 1 0 8 2a6 6 0 0 0 0 12M8 10.5A2.5 2.5 0 1 0 8 5.5a2.5 2.5 0 0 0 0 5M8 1v2M8 13v2M1 8h2M13 8h2",
  crop: "M4.5 1.5v10h10M1.5 4.5h10v10",
  code: "M5.5 5 2.5 8l3 3M10.5 5l3 3-3 3",
  gear: "M8 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4M12.9 9.6a1.1 1.1 0 0 0 .2 1.2l.1.1a1.3 1.3 0 1 1-1.9 1.9l-.1-.1a1.1 1.1 0 0 0-1.2-.2 1.1 1.1 0 0 0-.7 1v.2a1.3 1.3 0 1 1-2.6 0v-.1a1.1 1.1 0 0 0-.7-1 1.1 1.1 0 0 0-1.2.2l-.1.1a1.3 1.3 0 1 1-1.9-1.9l.1-.1a1.1 1.1 0 0 0 .2-1.2 1.1 1.1 0 0 0-1-.7h-.2a1.3 1.3 0 1 1 0-2.6h.1a1.1 1.1 0 0 0 1-.7 1.1 1.1 0 0 0-.2-1.2l-.1-.1a1.3 1.3 0 1 1 1.9-1.9l.1.1a1.1 1.1 0 0 0 1.2.2h.1a1.1 1.1 0 0 0 .7-1v-.2a1.3 1.3 0 1 1 2.6 0v.1a1.1 1.1 0 0 0 .7 1 1.1 1.1 0 0 0 1.2-.2l.1-.1a1.3 1.3 0 1 1 1.9 1.9l-.1.1a1.1 1.1 0 0 0-.2 1.2v.1a1.1 1.1 0 0 0 1 .7h.2a1.3 1.3 0 1 1 0 2.6h-.1a1.1 1.1 0 0 0-1 .7",
  steps: "M2.5 4h2M2.5 8h2M2.5 12h2M7 4h6.5M7 8h6.5M7 12h6.5",
  alert: "M8 5.5v3.5M8 11.2v.3M7.1 2.4 1.5 12a1 1 0 0 0 .9 1.5h11.2a1 1 0 0 0 .9-1.5L8.9 2.4a1 1 0 0 0-1.8 0",
  sparkle: "M8 1.5 9.4 5.6 13.5 7 9.4 8.4 8 12.5 6.6 8.4 2.5 7l4.1-1.4zM12.8 11l.5 1.4 1.4.5-1.4.5-.5 1.4-.5-1.4-1.4-.5 1.4-.5z",
  copy: "M5.5 5.5h7v7h-7zM3.5 10.5h-1v-7h7v1",
  send: "M14 2 7 9M14 2l-4.5 12-2.5-5-5-2.5z",
  check: "M3 8.5 6.5 12 13 4.5",
  trash: "M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.2a1 1 0 0 0 1 .8h3.8a1 1 0 0 0 1-.8l.6-8.2",
  user: "M8 8a2.6 2.6 0 1 0 0-5.2A2.6 2.6 0 0 0 8 8M2.8 14a5.2 5.2 0 0 1 10.4 0",
  link: "M6.5 9.5 9.5 6.5M6.9 4.6 8.4 3a3 3 0 0 1 4.3 4.3l-1.6 1.5M9.1 11.4l-1.5 1.6A3 3 0 0 1 3.3 8.7l1.6-1.5",
  back2: "M13 8H3M6.5 4.5 3 8l3.5 3.5",
  rotate: "M11 2.5h2.5V5M13.2 5.4A5.6 5.6 0 0 0 2.6 7.2M5 13.5H2.5V11M2.8 10.6a5.6 5.6 0 0 0 10.6-1.8",
  frame: "M2.5 2.5h11v11h-11zM2.5 5.5h11M5.5 5.5v8",
  record: "M8 13a5 5 0 1 0 0-10 5 5 0 0 0 0 10",
  chevDown: "M4 6.5 8 10.5l4-4",
  chevUp: "M4 9.5 8 5.5l4 4",
  plus: "M8 3.5v9M3.5 8h9",
  window: "M2 4.5h9v8H2zM5 2.5h9v8",
  star: "M8 2.2l1.75 3.6 3.95.57-2.86 2.8.68 3.95L8 11.25l-3.52 1.87.68-3.95-2.86-2.8 3.95-.57z",
  starOn: "M8 2.2l1.75 3.6 3.95.57-2.86 2.8.68 3.95L8 11.25l-3.52 1.87.68-3.95-2.86-2.8 3.95-.57z",
  question: "M6 6a2 2 0 1 1 2.6 1.9c-.4.2-.6.5-.6.9v.7M8 12.2v.3M8 14A6 6 0 1 0 8 2a6 6 0 0 0 0 12",
};

/** Icons drawn as solid shapes rather than outlines — a saved bookmark reads as
 *  filled, an unsaved one as an outline, which is the whole affordance. */
const FILLED = new Set(["starOn"]);

export function Icon({ name, className = "", size = 15, style }: {
  name: keyof typeof P | string;
  className?: string;
  size?: number;
  style?: CSSProperties;
}): JSX.Element {
  return (
    <svg
      width={size} height={size} viewBox="0 0 16 16" fill="none"
      stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"
      className={className} style={style} aria-hidden="true"
    >
      <path d={P[name] ?? ""} fill={FILLED.has(name) ? "currentColor" : "none"} />
    </svg>
  );
}
