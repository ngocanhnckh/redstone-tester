# Redstone Tester

A browser that files bugs. Drive the site under test in the built-in browser,
click what looks wrong, and get a professional Jira ticket — DOM reference,
screenshot, URL, steps to reproduce, expected vs current behaviour — in about
twenty seconds.

Visually a sibling of Redstone Cowork: the same Warm Ink / liquid-glass cockpit.

## Install

Download from [Releases](../../releases):

| Platform | File |
|---|---|
| macOS (Apple Silicon) | `Redstone Tester-<version>-arm64.dmg` |
| macOS (Intel) | `Redstone Tester-<version>-x64.dmg` |
| Windows installer | `Redstone Tester-Setup-<version>.exe` |
| Windows portable | `Redstone Tester-<version>-portable.exe` |

Builds are **unsigned**. macOS blocks the first launch — right-click the app and
choose *Open*, or run
`xattr -dr com.apple.quarantine "/Applications/Redstone Tester.app"`.
Windows shows a SmartScreen warning: *More info → Run anyway*.

## Develop

```
pnpm install
pnpm dev        # hot-reloading development
pnpm start      # run the built app
pnpm test       # 126 unit tests

pnpm release        # macOS (arm64 + x64) and Windows (x64) into release/
pnpm release:mac
pnpm release:win
```

Releases are **unsigned** — there is no Developer ID or Windows certificate here.
macOS will refuse the first launch: right-click the app and choose *Open*, or
`xattr -dr com.apple.quarantine "/Applications/Redstone Tester.app"`. Windows will
show a SmartScreen warning; *More info → Run anyway*. Windows artifacts build on
macOS without wine, but must be smoke-tested on real Windows — I have only
verified the macOS bundle launches.

The app icon is `icon.png` at the repo root; `build/icon.png` is the 1024² copy
electron-builder converts into `.icns` and `.ico`.

## How a bug gets filed

1. **Pick a project.** On first entry with Jira connected, the window asks which
   project it files into. Switch it any time from the title bar, or open a second
   window (`⌘⇧N`) to test another project side by side — each window keeps its
   own project, tabs, recording and capture.

   Each project remembers its own session: the tabs you had open come back next
   time, and bookmarks (`☆` in the address bar) are per-project, since one
   product's staging URLs are noise in another's.
2. **Pick a size.** The live viewport is always shown in the toolbar and goes
   into the ticket. Choose a device preset — phones, tablets, laptops, monitors —
   to test responsiveness at a real size, and rotate it. Sizes are logical CSS
   pixels (the number media queries actually see), and mobile presets carry the
   matching user agent for UA-sniffing sites.
3. **Record** (`⌘⇧S`). Recording is explicit: nothing is logged until you start
   it, so the steps are the run you meant to capture. Every click, field entry
   and navigation appears in the steps panel as you go, and each one can be
   removed before it reaches the ticket. Password, card and token fields are
   labelled but never captured.
4. **Highlight** (`⌘⇧E`). Hover to see element bounds, click anything that looks
   wrong. Each pin captures its CSS selector, DOM path, attributes, computed
   styles, bounding box and a cropped screenshot. Note what's wrong beside it.
   Or **Region** (`⌘⇧R`) to drag a box around a purely visual defect.
   Highlighting is never recorded as a test step — marking a defect is not
   something a developer should reproduce.
5. **Review with AI.** The model reads the whole draft plus every screenshot, and
   does three things: rewrites what the evidence supports, flags the fields still
   too vague for a developer to act on (with a concrete rewrite), and asks you
   what it genuinely cannot infer. Answer inline and re-run — your answers are
   treated as evidence, so the ticket converges instead of being one-shot
   rewritten. A readiness bar says whether it would land as-is.
6. **File it.** With Jira connected: pick an assignee and create the issue, with
   screenshots attached and the ticket dropped into the active sprint. Without
   Jira: copy the whole ticket, or the screenshot, to the clipboard.

   The assignee list is ordered by who is already carrying issues in the project
   (busiest first, with their issue count), then everyone else alphabetically —
   an alphabetical roster of everyone with permission buries the few people who
   could pick the bug up today. It is searchable, and searching re-queries Jira
   so a large directory still works.

Everything is editable before it leaves the app, and the Markdown you preview is
exactly what gets filed.

## Settings

**Jira** — endpoint, deployment (Data Center/Server or Cloud), token, default
project, issue type, default labels, and whether to auto-add to the active
sprint. The default project only seeds new windows; each window's actual project
is chosen in its title bar.
Data Center authenticates with a bearer PAT and identifies users by username;
Cloud uses Basic auth with your account email plus an API token and identifies
users by account ID. Pick the right one — it is the most common setup failure.
**Test connection** verifies the credentials and then populates the project and
board pickers.

**AI** — any OpenAI-compatible `/chat/completions` endpoint: OpenAI, a gateway,
or a local runtime. Set the base URL, key and model.

*Ask me questions in* and *Write the ticket in* are **independent**, because they
serve different readers: the AI's questions are read by the tester, the ticket by
whoever fixes the bug. Being asked in Vietnamese and filing in English is a normal
setup on a mixed-language team. Both fields are free text with a preset list — an
LLM handles any language, so the app doesn't limit the choice.

English and Vietnamese ship with hand-written section headings and step-recorder
phrasing. For any other language the AI translates the headings on its first
review and they are cached in settings, so later tickets aren't half-English;
until then headings fall back to English. Selectors, DOM paths, URLs, console
output and severity values are never translated — a developer has to match those
against the real product, and severity is a Jira field rather than prose. *Send the screenshot* sends
the cropped defect shots and the annotated full page so a vision model can
describe what it sees; turn it off for models without vision, or when pages under
test show data that must not leave the machine.

Settings live in `settings.json` under the app's userData directory, written
`0600`. Nothing is sent anywhere except the Jira and LLM endpoints you configure.

## Architecture

```
src/main/       Electron main — windows, settings, Jira client, LLM reviewer
src/preload/    the only bridge: a typed API on window.tester, no raw ipcRenderer
src/renderer/   the React cockpit: browser chrome, composer, settings
src/shared/     types, IPC channel names, ticket rendering, Markdown→Jira markup
```

The page under test runs in a `<webview>` with no preload and no node
integration. Because an Electron guest paints above all host DOM, the annotation
UI cannot be a React overlay — it is injected *into* the guest
(`renderer/src/guest.ts`) and signals back over `console.log` with a marker
prefix, the one channel a preload-less guest has that reaches the host verbatim.
Both injected programs are re-entrant and fully tear down, so toggling a mode off
leaves the page pristine. They are plain strings the compiler can't check, so
`guest.test.ts` runs them in jsdom and asserts on the signals they emit.

Screenshots come from `webview.capturePage()` (device pixels) and are cropped
against boxes the guest reports (CSS pixels); the scale factor is derived from
the captured image width, which also absorbs page zoom.

Tabs stay mounted when inactive — unmounting would destroy the page and make
every tab switch a reload — but only the focused tab is ever injected into, so a
background page that redirects itself can't write phantom steps into a repro
path. A guest's `src` is set once: it is an attribute, so re-rendering it with
the tab's current URL would re-issue a load on every navigation. Sessions are
saved debounced and written via write-then-rename, so a crash mid-write leaves
the previous session intact rather than a truncated file.

The assignable-users endpoint takes a different parameter across Jira versions
and returns an empty list rather than an error when it is wrong — which presents
as a missing assignee picker with nothing to explain it. `listAssignees` tries
the known spellings in turn and takes the first that yields anyone. The ranked
list also merges in whoever holds issues in the project, so a permission quirk
that hides the obvious assignee from the roster cannot drop them entirely.

A window only persists the project it is pointed at, and the "new window" button
deliberately opens with no project selected — two windows on one project would
both persist the same workspace and the last writer would clobber the other's
tabs.

Ticket bodies are rendered once, in `shared/ticketFormat.ts`. The Jira path only
converts that Markdown to wiki markup — it never re-composes the content, so the
preview and the filed issue cannot drift.

Device emulation resizes the frame and scales it down to fit the stage. Scaling
is a CSS transform on the wrapper, which does not change layout size, so the page
still lays out at the device's real CSS width. There is exactly one `<webview>`
in the tree across every device mode — rendering a second one in a branch would
remount it and reload the page on each switch.

Two guest-lifecycle rules the code depends on. `executeJavaScript` throws
*synchronously* before `dom-ready`, so a trailing `.catch()` never sees it —
every injection goes through `runInGuest`, gated on a ready flag that a new
navigation clears. And the recorder stands down whenever the annotation overlay
is up: both listen on `document` in the capture phase, the recorder is registered
first, so without that guard registration order would log a defect-pin click as a
step the tester supposedly took.
