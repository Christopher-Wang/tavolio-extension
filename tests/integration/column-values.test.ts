import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { fromValues } from "@tavolio/table";
import { columnTopValues, detectDateFrequency } from "@tavolio/preprocessing";

describe("column value breakdown", () => {
  it("counts spellings that differ only in case or spaces as one value, under the most common spelling", () => {
    const rows = [...Array(81).fill("No"), ...Array(43).fill("Yes"), "Yes ", "no", "", null].map((v) => [v]);
    const top = columnTopValues(fromValues(["Dependents"], rows), "Dependents");
    assert.deepEqual(top.map((t) => [t.value, t.count]), [["No", 82], ["Yes", 44]]);
    assert.deepEqual(top[0]!.variants, [{ spelling: "No", count: 81 }, { spelling: "no", count: 1 }]);
    assert.deepEqual(top[1]!.variants, [{ spelling: "Yes", count: 43 }, { spelling: "Yes ", count: 1 }]);
  });
});

const DAY = 86_400_000;
const start = Date.UTC(2024, 0, 1);
const every = (n: number, gap: (i: number) => number) => Array.from({ length: n }, (_, i) => start + gap(i) * DAY);

describe("date frequency", () => {
  it("recognises daily, weekly, monthly and annual columns", () => {
    assert.equal(detectDateFrequency(every(60, (i) => i)), "Daily");
    assert.equal(detectDateFrequency(every(30, (i) => 7 * i)), "Weekly");
    assert.equal(detectDateFrequency(Array.from({ length: 24 }, (_, i) => Date.UTC(2022, i, 1))), "Monthly");
    assert.equal(detectDateFrequency(Array.from({ length: 8 }, (_, i) => Date.UTC(2015 + i, 6, 4))), "Annually");
  });

  it("copes with order, repeats, business days and a few missing periods", () => {
    const shuffled = every(40, (i) => i).reverse().concat(every(5, (i) => i));
    assert.equal(detectDateFrequency(shuffled), "Daily");
    const business = [0, 1, 2, 3, 4, 7, 8, 9, 10, 11, 14, 15, 16, 17, 18, 21, 22].map((d) => start + d * DAY);
    assert.equal(detectDateFrequency(business), "Daily");
    const gappy = every(40, (i) => 7 * i).filter((_, i) => i !== 10 && i !== 22);
    assert.equal(detectDateFrequency(gappy), "Weekly");
  });

  it("says nothing for irregular or too few dates", () => {
    assert.equal(detectDateFrequency([0, 3, 50, 52, 400, 401, 900].map((d) => start + d * DAY)), null);
    assert.equal(detectDateFrequency(every(3, (i) => i)), null);
    assert.equal(detectDateFrequency([]), null);
  });
});
