import { describe, expect, it } from "vitest";
import { confusionAt, corrClass, divergingBars, histogramBars, linear, rocArea, ticks } from "../src/lib/charts";

describe("charts", () => {
  it("escala linear e domínio vazio", () => {
    expect(linear(0, 10, 0, 100)(5)).toBe(50);
    expect(linear(3, 3, 0, 100)(3)).toBe(0);
  });

  it("histograma: barra mínima de 1px e zero sem altura", () => {
    const bars = histogramBars([0, 1, 100], 30, 50);
    expect(bars.map((b) => b.h)).toEqual([0, 1, 50]);
    expect(bars[2].y).toBe(0);
    expect(histogramBars([], 30, 50)).toEqual([]);
  });

  it("barras divergentes começam do meio quando há negativo", () => {
    const [pos, neg] = divergingBars([2, -1], 100, 10);
    expect(pos.zero).toBe(50);
    expect(pos.x).toBe(50);
    expect(pos.w).toBe(50);
    expect(neg.x).toBe(25);
    expect(divergingBars([1, 2], 100, 10)[0].zero).toBe(0);
    // importância por permutação com ruído negativo minúsculo: não divide o gráfico ao meio
    const noise = divergingBars([0.08, 0.03, -0.0004], 100, 10);
    expect(noise[0].zero).toBe(0);
    expect(noise[0].w).toBe(100);
    expect(noise[2].w).toBe(0);
    expect(noise[2].x).toBe(0);
  });

  it("cor de correlação em 11 degraus", () => {
    expect(corrClass(1)).toBe("c-p5");
    expect(corrClass(-0.61)).toBe("c-n3");
    expect(corrClass(0)).toBe("c-p0");
    expect(corrClass(null)).toBe("c-na");
    expect(corrClass(7)).toBe("c-p5");
  });

  it("matriz de confusão num corte", () => {
    const y = [0, 0, 1, 1, 1];
    const p = [0.1, 0.6, 0.4, 0.7, 0.9];
    const c = confusionAt(y, p, 0.5);
    expect(c.matrix).toEqual([
      [1, 1],
      [1, 2],
    ]);
    expect(c.precision).toBeCloseTo(2 / 3);
    expect(c.recall).toBeCloseTo(2 / 3);
    expect(c.flagged).toBeCloseTo(3 / 5);
    expect(confusionAt(y, p, 1.01).precision).toBe(0);
  });

  it("marcas redondas", () => {
    expect(ticks(0, 1)).toEqual([0, 0.2, 0.4, 0.6, 0.8, 1]);
    expect(ticks(0, 97)).toEqual([0, 20, 40, 60, 80]);
    expect(ticks(5, 5)).toEqual([5]);
    expect(ticks(Number.NaN, 1)).toEqual([]);
  });

  it("área da ROC", () => {
    expect(rocArea([0, 1], [0, 1])).toBeCloseTo(0.5);
    expect(rocArea([0, 0, 1], [0, 1, 1])).toBeCloseTo(1);
  });
});
