// The credential sheet for HTTP Basic/Digest and proxy challenges.
//
// It replaces the native dialog Chromium cannot show inside a <webview>. Two
// rules matter here beyond looking right: the origin being authenticated is
// stated plainly (a tester must never type a staging password into a prompt
// raised by some third-party asset on the page), and nothing typed here is ever
// logged or carried into a ticket.

import { useEffect, useState } from "react";
import type { JSX } from "react";
import { useStore } from "./store.js";
import { Icon } from "./Icons.js";

export default function AuthPrompt(): JSX.Element | null {
  const { authChallenge, setAuthChallenge } = useStore();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);

  // Never carry one site's typed credentials into another site's prompt.
  useEffect(() => {
    setUsername("");
    setPassword("");
    setRemember(true);
  }, [authChallenge?.id]);

  if (!authChallenge) return null;
  const c = authChallenge;

  const finish = (cancelled: boolean): void => {
    void window.tester.auth.respond({
      id: c.id,
      username: cancelled ? "" : username,
      password: cancelled ? "" : password,
      remember: !cancelled && remember,
      cancelled,
    });
    setAuthChallenge(null);
  };

  return (
    <div className="absolute inset-0 z-[60] flex items-center justify-center p-8"
      style={{ background: "rgba(10,8,6,.62)" }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) finish(true); }}>
      <form
        className="glass-surface rise w-[min(440px,92vw)] rounded-2xl"
        style={{ backdropFilter: "blur(34px) saturate(180%)" }}
        onSubmit={(e) => { e.preventDefault(); finish(false); }}
      >
        <div className="border-b px-6 py-5" style={{ borderColor: "var(--border)" }}>
          <div className="kicker mb-1.5">{c.isProxy ? "Proxy sign-in" : "Sign in"}</div>
          <div className="display text-[22px]">
            {c.isProxy ? "The proxy needs credentials" : "This site needs credentials"}
          </div>
          {/* The origin, stated plainly — this is the security-relevant line. */}
          <div className="mono mt-2.5 break-all text-[12px]" style={{ color: "rgb(var(--primary-soft))" }}>
            {c.origin}
          </div>
          {c.realm && <div className="faint mt-1 text-[11px]">Realm: {c.realm}</div>}
        </div>

        <div className="space-y-3 px-6 py-5">
          {c.retry && (
            <div className="chip chip--warn w-full !justify-start !py-1.5">
              <Icon name="alert" size={12} />
              <span>Those saved credentials were rejected. The saved copy has been removed.</span>
            </div>
          )}

          <div>
            <label className="label">Username</label>
            <input className="field" autoFocus autoComplete="off" value={username}
              onChange={(e) => setUsername(e.target.value)} />
          </div>
          <div>
            <label className="label">Password</label>
            <input className="field" type="password" autoComplete="off" value={password}
              onChange={(e) => setPassword(e.target.value)} />
          </div>

          <label className="glass-inset flex cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2">
            <input type="checkbox" checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
              style={{ accentColor: "rgb(var(--primary))" }} />
            <span className="text-[12.5px]">Remember for this site</span>
          </label>
          <div className="faint text-[10.5px] leading-relaxed">
            Saved logins are kept in a private file on this machine, readable only
            by your user account, and are never included in a ticket. Clear them
            any time from Settings → General.
          </div>
        </div>

        <div className="flex items-center gap-2 border-t px-6 py-4" style={{ borderColor: "var(--border)" }}>
          <span className="flex-1" />
          <button type="button" className="btn btn--ghost" onClick={() => finish(true)}>Cancel</button>
          <button type="submit" className="btn btn--clay" disabled={!username}>
            <Icon name="user" /> Sign in
          </button>
        </div>
      </form>
    </div>
  );
}
