import { describe, expect, it } from "vitest";
import { fmtCell, fmtInt, fmtMetric, fmtNum, fmtPct, fmtSeconds } from "../src/lib/format";

describe("formatação pt-BR", () => {
  it("inteiros e decimais", () => {
    expect(fmtInt(1015)).toBe("1.015");
    expect(fmtInt(null)).toBe("–");
    expect(fmtNum(0.7123)).toBe("0,712");
    expect(fmtNum(1234.56)).toBe("1.235");
    expect(fmtNum(2e7)).toBe("2,00e+7");
  });

  it("porcentagem, segundos e métrica", () => {
    expect(fmtPct(0.038).replace(/\s/g, " ")).toBe("3,8%");
    expect(fmtSeconds(0.25)).toBe("250 ms");
    expect(fmtSeconds(4.8)).toBe("4,8 s");
    expect(fmtSeconds(75)).toBe("1 min 15 s");
    expect(fmtMetric("roc_auc", 0.81234)).toBe("0,812");
    expect(fmtMetric("recall", 0.5)).toBe("50%");
  });

  it("células: ano sem ponto de milhar, valores grandes com", () => {
    expect(fmtCell(2024)).toBe("2024");
    expect(fmtCell(22106)).toBe("22.106");
    expect(fmtCell(142.5)).toBe("142,5");
    expect(fmtCell(null)).toBe("");
    expect(fmtCell("2024-03-01T00:00:00")).toBe("2024-03-01");
  });
});

describe("métricas com casas fixas", () => {
  it("AUC 0,8 aparece 0,800 e nada de notação científica", async () => {
    const { fmtFixed } = await import("../src/lib/format");
    expect(fmtMetric("roc_auc", 0.79998)).toBe("0,800");
    expect(fmtMetric("rmse", 12345.6)).toBe("12.346");
    expect(fmtFixed(-0.000397)).toBe("0,000");
    expect(fmtFixed(0.04)).toBe("0,040");
  });
});
