import { describe, expect, it } from "vitest";
import { filterUsers, rankAssignees } from "./jira.js";
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
