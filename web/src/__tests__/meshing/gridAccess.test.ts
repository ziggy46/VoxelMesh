import { describe, expect, it } from "vitest";
import { chunkIndex, demoteIfUniform, getCell, gridCells, setCell } from "../../worker/meshingKernel/gridAccess";
import type { SparseGrid } from "../../types/mesh";

const mk = (): SparseGrid => ({ blocks: [2, 2, 1], cells: [0, 3, 0, 0] });

describe("gridAccess", () => {
  it("reads numeric chunks, out-of-range as air, and reports extent", () => {
    const g = mk();
    expect(gridCells(g)).toEqual([32, 32, 16]);
    expect(chunkIndex(g, 1, 1, 0)).toBe(3);
    expect(getCell(g, 16, 0, 0)).toBe(3);
    expect(getCell(g, 0, 0, 0)).toBe(0);
    expect(getCell(g, -1, 0, 0)).toBe(0);
    expect(getCell(g, 32, 0, 0)).toBe(0);
    expect(getCell(g, 0, 0, 16)).toBe(0);
  });

  it("promotes only when the value changes, then demotes on request", () => {
    const g = mk();
    setCell(g, 16, 0, 0, 3);
    expect(g.cells[1]).toBe(3);
    setCell(g, 17, 2, 5, 9);
    expect(g.cells[1]).toBeInstanceOf(Uint16Array);
    expect(getCell(g, 17, 2, 5)).toBe(9);
    expect(getCell(g, 16, 0, 0)).toBe(3);
    setCell(g, 17, 2, 5, 3);
    expect(demoteIfUniform(g, 1)).toBe(true);
    expect(g.cells[1]).toBe(3);
    expect(demoteIfUniform(g, 1)).toBe(false);
  });

  it("throws outside the grid on write", () => {
    expect(() => setCell(mk(), 32, 0, 0, 1)).toThrow(RangeError);
  });
});
