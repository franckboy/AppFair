import { describe, expect, it } from "vitest";
import { textColorFor } from "./colorContrast";

describe("textColorFor", () => {
  it("picks white ink on a near-black fill", () => {
    expect(textColorFor("#0b0b0b")).toBe("#ffffff");
  });

  it("picks dark ink on a near-white fill", () => {
    expect(textColorFor("#ffffff")).toBe("#0b0b0b");
  });

  it("picks white ink on the status palette's critical red", () => {
    expect(textColorFor("#d03b3b")).toBe("#ffffff");
  });

  it("picks dark ink on the status palette's warning yellow", () => {
    expect(textColorFor("#fab219")).toBe("#0b0b0b");
  });
});
