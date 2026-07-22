// The project's bookmark bar. Bookmarks belong to the project, not the app —
// the staging URLs for one product are noise in another — so this bar changes
// with the project the window is pointed at.

import { useState } from "react";
import type { JSX } from "react";
import { useStore } from "./store.js";
import { Icon } from "./Icons.js";

export default function Bookmarks({
  onOpen,
}: { onOpen: (url: string, inNewTab: boolean) => void }): JSX.Element | null {
  const { bookmarks, unbookmark, bookmark, url, project } = useStore();
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  if (!bookmarks.length) return null;

  const commit = (bmUrl: string) => {
    const title = draft.trim();
    if (title) bookmark({ url: bmUrl, title });
    setRenaming(null);
  };

  return (
    <div className="no-drag flex items-center gap-1.5 overflow-x-auto px-3 pb-2">
      <span className="kicker shrink-0 !text-[9px] opacity-60" title={`Bookmarks for ${project || "this window"}`}>
        <Icon name="starOn" size={10} />
      </span>
      {bookmarks.map((b) => (
        <div key={b.url} className="group shrink-0">
          {renaming === b.url ? (
            <input
              className="field !w-[150px] !py-1 !text-[11px]"
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={() => commit(b.url)}
              onKeyDown={(e) => {
                if (e.key === "Enter") commit(b.url);
                if (e.key === "Escape") setRenaming(null);
              }}
            />
          ) : (
            <span
              className={`chip cursor-pointer ${b.url === url ? "chip--live" : ""}`}
              title={`${b.url}\n⌘-click to open in a new tab · double-click to rename`}
              // Middle-click and ⌘-click open in a new tab, as anywhere else.
              onClick={(e) => onOpen(b.url, e.metaKey || e.ctrlKey)}
              onAuxClick={(e) => { if (e.button === 1) onOpen(b.url, true); }}
              onDoubleClick={() => { setRenaming(b.url); setDraft(b.title); }}
            >
              <span className="max-w-[140px] truncate">{b.title}</span>
              <button
                className="ml-0.5 opacity-0 transition-opacity group-hover:opacity-60 hover:!opacity-100"
                onClick={(e) => { e.stopPropagation(); unbookmark(b.url); }}
                title="Remove bookmark"
              >
                <Icon name="close" size={9} />
              </button>
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
