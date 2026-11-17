import { describe, expect, it } from "vitest";
import { ElementRecords } from "../src/content/records";

describe("ElementRecords", () => {
  it("stores, iterates and deletes records", () => {
    const records = new ElementRecords<number>();
    const a = document.createElement("div");
    const b = document.createElement("p");
    records.set(a, 1).set(b, 2);
    expect(records.get(a)).toBe(1);
    expect(records.has(b)).toBe(true);
    expect(records.size).toBe(2);
    expect([...records.keys()]).toEqual([a, b]);
    expect([...records]).toEqual([
      [a, 1],
      [b, 2],
    ]);
    records.set(a, 3);
    expect(records.get(a)).toBe(3);
    expect(records.size).toBe(2);
    expect(records.delete(a)).toBe(true);
    expect(records.has(a)).toBe(false);
    expect([...records.keys()]).toEqual([b]);
    records.clear();
    expect(records.size).toBe(0);
  });

  it("can be modified while iterating", () => {
    const records = new ElementRecords<number>();
    const elements = [1, 2, 3].map(() => document.createElement("i"));
    elements.forEach((element, index) => {
      records.set(element, index);
    });
    for (const element of records.keys()) {
      records.delete(element);
    }
    expect(records.size).toBe(0);
  });
});
