/// <reference types="node" />
import { readFileSync } from "node:fs";
import type { Snapshot, StepKey } from "../src/lib/assistant/context";
import type { PredictSummary, Profile, Source, Step, StepReport, TargetInfo, TrainResult } from "../src/lib/types";

// O que o motor devolve de verdade para os exemplos (scripts/make_fixtures.py).
export type Fixture = {
  source: Source;
  rawProfile: Profile;
  steps: Step[];
  reports: StepReport[];
  profile: Profile;
  targetInfo: TargetInfo;
  result: TrainResult;
  batch: PredictSummary;
};
export const fixture = (name: string): Fixture =>
  JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), "utf8"));

export function snapshot(f: Fixture, current: StepKey, over: Partial<Snapshot> = {}): Snapshot {
  return {
    current,
    source: f.source,
    rawColumns: f.rawProfile.columns.map((c) => c.name),
    profile: f.profile,
    steps: f.steps,
    reports: f.reports,
    previewOk: true,
    target: f.targetInfo.target,
    problem: f.targetInfo.problem,
    targetInfo: f.targetInfo,
    budget: 60,
    training: false,
    metric: f.result.metric,
    candidates: f.result.ranking,
    result: f.result,
    stale: false,
    batch: f.batch,
    mlReady: true,
    busy: false,
    previewing: false,
    ...over,
  };
}
