import { describe, expect, it } from "vitest";
import { collectStateRules, splitSelectors } from "../src/content/state-rules";

describe("state rules", () => {
  it("splits selector lists only at top-level commas", () => {
    expect(splitSelectors("a:hover, .x:is(.a, .b):focus , b")).toEqual([
      "a:hover",
      ".x:is(.a, .b):focus",
      "b",
    ]);
  });

  it("collects colours from :hover/:focus rules, including inside @media", () => {
    document.head.innerHTML =
      "<style>.a:hover{background:#eee;color:#900}.b{color:#111}@media (min-width:1px){.c:focus-visible,.c:hover{border-color:#123456}}.d:hover::after{color:#f00}</style>";
    const rules = collectStateRules(document);
    expect(rules).toHaveLength(2);
    expect(rules[0]?.selectors).toEqual([".a:hover"]);
    expect(rules[0]?.background?.r).toBe(238);
    expect(rules[0]?.text?.r).toBe(153);
    expect(rules[1]?.wrappers[0]).toContain("@media");
    expect(rules[1]?.selectors).toHaveLength(2);
    expect(rules[1]?.border?.b).toBe(0x56);
    document.head.innerHTML = "";
  });
});
