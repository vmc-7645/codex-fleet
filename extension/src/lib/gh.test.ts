import { describe, it, expect } from "vitest";
import { parsePRs } from "./gh";

describe("parsePRs", () => {
  it("maps gh search output, preferring nameWithOwner and the author login", () => {
    const json = JSON.stringify([
      {
        number: 42,
        title: "Fix the thing",
        url: "https://github.com/acme/widgets/pull/42",
        state: "open",
        isDraft: false,
        repository: { name: "widgets", nameWithOwner: "acme/widgets" },
        author: { login: "octocat" },
      },
    ]);
    expect(parsePRs(json)).toEqual([
      {
        number: 42,
        title: "Fix the thing",
        repo: "acme/widgets",
        url: "https://github.com/acme/widgets/pull/42",
        state: "open",
        isDraft: false,
        author: "octocat",
      },
    ]);
  });

  it("falls back to bare repo name, defaults state, and tolerates a missing author", () => {
    const json = JSON.stringify([
      {
        number: 7,
        title: "WIP",
        url: "u",
        isDraft: true,
        repository: { name: "solo" },
      },
    ]);
    expect(parsePRs(json)).toEqual([
      {
        number: 7,
        title: "WIP",
        repo: "solo",
        url: "u",
        state: "open",
        isDraft: true,
        author: undefined,
      },
    ]);
  });

  it("returns an empty array for an empty result", () => {
    expect(parsePRs("[]")).toEqual([]);
  });
});
