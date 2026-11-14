import { describe, expect, it } from "vitest";
import { confusionAt, thresholdNear, tipPosition } from "../src/lib/charts";

describe("interação dos gráficos", () => {
  const y = [0, 0, 0, 0, 1, 1, 1, 1];
  const p = [0.1, 0.2, 0.35, 0.6, 0.4, 0.7, 0.8, 0.9];

  it("clicar no canto de cima à esquerda da ROC escolhe um corte sem falso positivo", () => {
    // classes separáveis: existe corte com recall 1 e nenhum falso positivo
    const ps = [0.1, 0.2, 0.3, 0.4, 0.6, 0.7, 0.8, 0.9];
    const r = thresholdNear(y, ps, 0, 1);
    const c = confusionAt(y, ps, r.threshold);
    expect(c.matrix[0][1]).toBe(0);
    expect(c.recall).toBe(1);
    expect(r.threshold).toBeGreaterThanOrEqual(0.05);
    expect(r.threshold).toBeLessThanOrEqual(0.95);
  });

  it("clicar no canto de cima à direita escolhe um corte baixo (marca quase tudo)", () => {
    const r = thresholdNear(y, p, 1, 1);
    expect(r.tpr).toBe(1);
    expect(r.threshold).toBeLessThanOrEqual(0.4);
  });

  it("o ponto devolvido é o do próprio corte", () => {
    const r = thresholdNear(y, p, 0.25, 0.75);
    const c = confusionAt(y, p, r.threshold);
    expect(r.tpr).toBe(c.recall);
    expect(r.fpr).toBe(c.matrix[0][1] / 4);
  });

  it("a dica não sai da tela", () => {
    expect(tipPosition(10, 10, 100, 30, 800, 600)).toEqual({ left: 24, top: 24 });
    const r = tipPosition(790, 590, 100, 30, 800, 600);
    expect(r.left + 100).toBeLessThanOrEqual(800);
    expect(r.top + 30).toBeLessThanOrEqual(600);
    expect(tipPosition(5, 5, 900, 30, 800, 600).left).toBe(8);
  });
});
