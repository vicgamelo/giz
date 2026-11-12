import { describe, expect, it } from "vitest";
import { leaderKey, rankCandidates } from "../src/lib/ranking";
import type { Candidate } from "../src/lib/types";

const c = (key: string, status: Candidate["status"], folds: number[], score?: number): Candidate => ({
  key,
  label: key,
  status,
  folds,
  score,
});

describe("ranking do AutoML", () => {
  it("parcial (pulado/parado/erro) fica abaixo de quem terminou, mesmo com nota melhor", () => {
    // caso real: Random Forest pulado depois de 1 fold com RMSE 0,524 aparecia acima do k vizinhos (0,637)
    const ranked = rankCandidates(
      [c("knn", "done", [0.63, 0.64], 0.637), c("rf", "skipped", [0.524]), c("lgbm", "stopped", [0.47])],
      true,
    );
    expect(ranked.map((x) => x.key)).toEqual(["knn", "lgbm", "rf"]);
  });

  it("maior é melhor para AUC e quem ainda não tem nota vai para o fim", () => {
    const ranked = rankCandidates([c("a", "pending", []), c("b", "done", [0.7], 0.7), c("d", "running", [0.8])], false);
    expect(ranked.map((x) => x.key)).toEqual(["d", "b", "a"]);
  });

  it("líder ignora a referência e os parciais", () => {
    const ranked = rankCandidates(
      [c("baseline", "done", [0.5], 0.5), c("rf", "skipped", [0.9]), c("logreg", "done", [0.7], 0.7)],
      false,
    );
    expect(leaderKey(ranked)).toBe("logreg");
  });
});
