import { describe, expect, it } from "vitest";
import {
  filterUsers, flattenStatuses, isNoSprintError, jqlLiteral, queueJql, rankAssignees,
} from "./jira.js";
import type { JiraUser } from "../shared/types.js";

const user = (id: string, displayName: string, email?: string): JiraUser =>
  ({ id, displayName, email });

/** The shape `recentAssignees` returns: who holds issues here, and how many. */
const ranked = (entries: Array<[string, string, number]>) =>
  new Map(entries.map(([id, name, count]) => [id, { user: user(id, name), count }]));

describe("rankAssignees", () => {
  it("puts people working on the project first, busiest first", () => {
    const out = rankAssignees(
      [user("anna", "Anna"), user("bob", "Bob"), user("cara", "Cara"), user("dan", "Dan")],
      ranked([["cara", "Cara", 7], ["bob", "Bob", 12]]),
    );
    expect(out.map((u) => u.id)).toEqual(["bob", "cara", "anna", "dan"]);
  });

  it("marks the two groups so the picker can label them", () => {
    const out = rankAssignees([user("a", "A"), user("b", "B")], ranked([["a", "A", 3]]));
    expect(out[0]).toMatchObject({ id: "a", active: true, issueCount: 3 });
    expect(out[1]).toMatchObject({ id: "b", active: false });
    expect(out[1].issueCount).toBeUndefined();
  });

  it("breaks an issue-count tie alphabetically", () => {
    const out = rankAssignees(
      [user("z", "Zoe"), user("a", "Adam")],
      ranked([["z", "Zoe", 4], ["a", "Adam", 4]]),
    );
    expect(out.map((u) => u.displayName)).toEqual(["Adam", "Zoe"]);
  });

  it("sorts everyone else alphabetically, not by API order", () => {
    const out = rankAssignees(
      [user("c", "Carol"), user("a", "Alice"), user("b", "Bob")],
      ranked([]),
    );
    expect(out.map((u) => u.displayName)).toEqual(["Alice", "Bob", "Carol"]);
  });

  it("still offers someone holding issues who is missing from the roster", () => {
    // A permission quirk or a deactivated account can hide the very person most
    // likely to own the bug. Dropping them would be the worst possible omission.
    const out = rankAssignees([user("a", "Alice")], ranked([["ghost", "Ghost", 9]]));
    expect(out.map((u) => u.id)).toEqual(["ghost", "a"]);
    expect(out[0]).toMatchObject({ active: true, issueCount: 9 });
  });

  it("handles an empty project with nobody assigned yet", () => {
    const out = rankAssignees([user("a", "Alice"), user("b", "Bob")], ranked([]));
    expect(out.map((u) => u.id)).toEqual(["a", "b"]);
    expect(out.every((u) => !u.active)).toBe(true);
  });

  it("returns nothing when there is nothing", () => {
    expect(rankAssignees([], ranked([]))).toEqual([]);
  });
});

describe("jqlLiteral", () => {
  it("quotes an ordinary status name", () => {
    expect(jqlLiteral("Ready for QA")).toBe('"Ready for QA"');
  });

  it("escapes a quote, which would otherwise end the literal early", () => {
    // A status literally named  Won"t Fix  is legal in Jira. Unescaped, the
    // query would not merely fail — it would run and match the wrong thing.
    expect(jqlLiteral('Won"t Fix')).toBe('"Won\\"t Fix"');
  });

  it("escapes backslashes before quotes, so an escape cannot be forged", () => {
    expect(jqlLiteral("a\\b")).toBe('"a\\\\b"');
    expect(jqlLiteral('a\\"b')).toBe('"a\\\\\\"b"');
  });
});

describe("queueJql", () => {
  it("scopes to the project and the open sprint, newest first", () => {
    expect(queueJql("RTT", ["Ready for QA"], true)).toBe(
      'project = "RTT" AND sprint in openSprints() AND status = "Ready for QA" ORDER BY updated DESC',
    );
  });

  it("uses `in` for several statuses", () => {
    expect(queueJql("RTT", ["Ready for QA", "In Review"], true)).toContain(
      'status in ("Ready for QA", "In Review")',
    );
  });

  it("drops the status clause entirely when nothing is selected", () => {
    // "No filter" must mean the whole sprint, not `status in ()` — which is a
    // syntax error, and would present as an empty queue.
    const jql = queueJql("RTT", [], true);
    expect(jql).not.toContain("status");
    expect(jql).toBe('project = "RTT" AND sprint in openSprints() ORDER BY updated DESC');
  });

  it("drops the sprint clause when the tester asked for the whole project", () => {
    expect(queueJql("RTT", ["Done"], false)).toBe(
      'project = "RTT" AND status = "Done" ORDER BY updated DESC',
    );
  });

  it("ignores blank status entries rather than emitting an empty literal", () => {
    expect(queueJql("RTT", ["  ", "Open"], false)).toContain('status = "Open"');
  });

  it("escapes the project key too — it is interpolated the same way", () => {
    expect(queueJql('A"B', [], false)).toContain('project = "A\\"B"');
  });
});

describe("isNoSprintError", () => {
  it("recognises a Jira without the sprint field", () => {
    expect(isNoSprintError(
      "400 — Field 'sprint' does not exist or you do not have permission to view it.",
    )).toBe(true);
  });

  it("does not treat an unrelated failure as a missing sprint", () => {
    // Retrying these unscoped would replace a real error with a wrong-scope
    // list, which is worse than the error.
    expect(isNoSprintError("401 Unauthorized")).toBe(false);
    expect(isNoSprintError("400 — The value 'Ready for QA' does not exist for the field 'status'."))
      .toBe(false);
  });
});

describe("flattenStatuses", () => {
  it("collapses the per-issue-type grouping Jira returns into one list", () => {
    const out = flattenStatuses([
      { statuses: [{ id: "1", name: "Open", statusCategory: { key: "new" } }, { id: "3", name: "Done", statusCategory: { key: "done" } }] },
      { statuses: [{ id: "1", name: "Open", statusCategory: { key: "new" } }, { id: "2", name: "Ready for QA", statusCategory: { key: "indeterminate" } }] },
    ]);
    expect(out.map((s) => s.name)).toEqual(["Open", "Done", "Ready for QA"]);
    expect(out[2].category).toBe("indeterminate");
  });

  it("survives a project with no statuses, or a malformed payload", () => {
    expect(flattenStatuses([])).toEqual([]);
    expect(flattenStatuses([{}])).toEqual([]);
    expect(flattenStatuses([{ statuses: [{ id: "1" }] }])).toEqual([]);
  });
});

describe("filterUsers", () => {
  const people = [
    user("anguyen", "Anh Nguyen", "anh@acme.io"),
    user("bsmith", "Bob Smith", "bob@acme.io"),
  ];

  it("matches on display name, case-insensitively", () => {
    expect(filterUsers(people, "anh").map((u) => u.id)).toEqual(["anguyen"]);
    expect(filterUsers(people, "SMITH").map((u) => u.id)).toEqual(["bsmith"]);
  });

  it("matches on email and username, since testers search by both", () => {
    expect(filterUsers(people, "bob@").map((u) => u.id)).toEqual(["bsmith"]);
    expect(filterUsers(people, "anguyen").map((u) => u.id)).toEqual(["anguyen"]);
  });

  it("returns everyone for an empty query", () => {
    expect(filterUsers(people, "   ")).toHaveLength(2);
  });

  it("preserves the ranking order of whatever survives", () => {
    const out = filterUsers([...people, user("cnguyen", "Cara Nguyen")], "nguyen");
    expect(out.map((u) => u.id)).toEqual(["anguyen", "cnguyen"]);
  });
});
