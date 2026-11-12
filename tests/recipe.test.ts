import { describe, expect, it } from "vitest";
import { forEngine, History, move, OPS, sameStep, validate, withUid } from "../src/lib/recipe";
import type { Step } from "../src/lib/types";

describe("receita", () => {
  it("mover passos", () => {
    expect(move(["a", "b", "c"], 0, 2)).toEqual(["b", "c", "a"]);
    expect(move(["a", "b", "c"], 2, 0)).toEqual(["c", "a", "b"]);
    expect(move(["a", "b", "c"], 1, 9)).toEqual(["a", "c", "b"]);
    const same = ["a"];
    expect(move(same, 0, 0)).toBe(same);
  });

  it("desfazer e refazer", () => {
    const h = new History<number>();
    h.push(1);
    h.push(2);
    expect(h.undo(3)).toBe(2);
    expect(h.undo(2)).toBe(1);
    expect(h.undo(1)).toBeUndefined();
    expect(h.redo(1)).toBe(2);
    h.push(2);
    expect(h.canRedo).toBe(false);
  });

  it("histórico com limite", () => {
    const h = new History<number>(2);
    [1, 2, 3].forEach((n) => h.push(n));
    expect(h.past).toEqual([2, 3]);
  });

  it("uid só para a lista: o motor não recebe", () => {
    const s = withUid({ op: "drop_duplicates" } as Step);
    expect(s.uid).toBeTruthy();
    expect(withUid(s)).toBe(s);
    expect(forEngine([s])[0]).toEqual({ op: "drop_duplicates" });
  });

  it("mesmo passo independe de uid, ligado/desligado e ordem das chaves", () => {
    // o "Corrigir" de um alerta vem do Python com outra ordem de chaves que o formulário
    const a = { op: "impute", columns: ["idade"], strategy: "median" } as Step;
    const b = { strategy: "median", uid: "x", disabled: true, columns: ["idade"], op: "impute" } as Step;
    expect(sameStep(a, b)).toBe(true);
    expect(sameStep(a, { ...a, strategy: "mean" } as Step)).toBe(false);
    expect(sameStep(a, { ...a, columns: ["renda"] } as Step)).toBe(false);
  });

  it("validação dos campos", () => {
    expect(validate({ op: "impute", columns: [] } as unknown as Step)).toBe("escolha ao menos uma coluna");
    expect(validate({ op: "nada" } as unknown as Step)).toBe("passo desconhecido");
    expect(validate({ op: "drop_duplicates" } as Step)).toBeNull();
  });

  it("todo passo do catálogo tem rótulo e ajuda", () => {
    for (const o of OPS) {
      expect(o.label.length).toBeGreaterThan(3);
      expect(o.help.length).toBeGreaterThan(10);
    }
  });
});
