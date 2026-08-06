// The tab strip, following Chrome's two sizing rules — which are one rule,
// really: the strip belongs to the tabs, not to the window.
//
//   1. "New tab" rides directly after the last tab, so it is where the eye and
//      the cursor already are. Parked at the far right of the window it is a
//      long throw away from the thing it continues.
//   2. Tabs share the strip and shrink, rather than staying fixed width and
//      scrolling it. Scrolling is what pushes the button out of reach, so this
//      is what makes (1) hold up past three or four tabs.

import { useEffect, useRef, useState } from "react";
import type { JSX } from "react";
import { Icon } from "./Icons.js";
import { tabLabel } from "../../shared/tabs.js";
import type { Tab } from "../../shared/tabs.js";

/** Widest a tab is drawn, and its floor once they start sharing the strip.
 *  Below the floor the row scrolls — around seventeen tabs on a default window,
 *  which is well past what a test run has open. */
const MAX_TAB = 190;
const MIN_TAB = 76;

interface Props {
  tabs: Tab[];
  activeId: string;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onNew: () => void;
}

export default function TabStrip({ tabs, activeId, onSelect, onClose, onNew }: Props): JSX.Element {
  const rowRef = useRef<HTMLDivElement | null>(null);
  /**
   * Tab width, frozen while a run of tabs is being closed.
   *
   * Shrink-to-fit means closing a tab re-flows every other one, so the next
   * tab's × slides out from under a cursor that has not moved — closing three
   * tabs becomes three separate aiming problems, and one misfire closes a page
   * mid-test. Chrome holds the widths until the pointer leaves the strip, which
   * lands each successive × exactly where the last one was.
   */
  const [heldWidth, setHeldWidth] = useState<number | null>(null);

  // Opening a tab re-flows immediately. Only closing holds — the hold exists to
  // keep a target still, and a new tab is not something anyone is aiming at.
  const count = useRef(tabs.length);
  useEffect(() => {
    if (tabs.length > count.current) setHeldWidth(null);
    count.current = tabs.length;
  }, [tabs.length]);

  const closeAndHold = (id: string): void => {
    const first = rowRef.current?.firstElementChild;
    // Every tab is the same width, so the first one answers for all of them.
    // Guard the zero: an unlaid-out row would pin every tab to nothing.
    if (first instanceof HTMLElement) {
      const w = first.getBoundingClientRect().width;
      if (w > 0) setHeldWidth(w);
    }
    onClose(id);
  };

  return (
    // Removing the hovered × does not itself count as leaving: Chromium keeps
    // the strip hovered, so this fires only when the pointer really goes.
    <div className="no-drag flex items-end gap-1 px-3 pb-1.5"
      onMouseLeave={() => setHeldWidth(null)}>
      <div ref={rowRef} className="flex min-w-0 flex-1 items-end gap-1 overflow-x-auto">
        {tabs.map((t) => (
          <TabChip
            key={t.id}
            tab={t}
            active={t.id === activeId}
            closable={tabs.length > 1}
            held={heldWidth}
            onSelect={() => onSelect(t.id)}
            onClose={() => closeAndHold(t.id)}
          />
        ))}
        <button className="btn btn--icon btn--ghost shrink-0" onClick={onNew} title="New tab (⌘T)">
          <Icon name="plus" />
        </button>
      </div>
    </div>
  );
}

function TabChip({ tab, active, closable, held, onSelect, onClose }: {
  tab: Tab; active: boolean; closable: boolean; held: number | null;
  onSelect: () => void; onClose: () => void;
}): JSX.Element {
  return (
    <div
      data-tab={tab.id}
      className={`group flex cursor-default items-center gap-1.5 rounded-t-lg px-2.5 py-1.5 text-[11.5px] ${
        active ? "glass-surface" : "glass-inset"}`}
      style={{
        ...(active ? {} : { opacity: .7 }),
        // Grow to MAX_TAB, then share the strip down to MIN_TAB — or sit at the
        // width it had when a close froze the row.
        //
        // Both branches must state minWidth. A flex item defaults to
        // `min-width: auto`, which floors it at its *min-content* width — around
        // 159px here, icon plus a word plus the ×. Leaving it off the frozen
        // branch let the floor quietly overrule the basis, so the freeze widened
        // the tabs it was meant to pin, and only ever when they were shrunk,
        // which is the only time it does anything at all.
        ...(held === null
          ? { flex: `1 1 ${MAX_TAB}px`, minWidth: MIN_TAB, maxWidth: MAX_TAB }
          : { flex: `0 0 ${held}px`, minWidth: 0, maxWidth: MAX_TAB }),
      }}
      onMouseDown={onSelect}
      title={tab.url}
    >
      {tab.loading
        ? <span className="tabspin shrink-0" />
        : <Icon name="globe" size={11} className="shrink-0 opacity-40" />}
      <span className="min-w-0 flex-1 truncate">{tabLabel(tab)}</span>
      {closable && (
        <button
          className="btn btn--icon btn--ghost !h-4 !w-4 shrink-0 opacity-0 group-hover:opacity-100"
          onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); onClose(); }}
          title="Close tab"
        >
          <Icon name="close" size={10} />
        </button>
      )}
    </div>
  );
}
