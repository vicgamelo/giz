// Geometria dos gráficos (SVG feito à mão, sem biblioteca e sem estilo inline: só atributos).

export type Bar = { x: number; y: number; w: number; h: number; value: number; label?: string };

export function linear(d0: number, d1: number, r0: number, r1: number) {
  const span = d1 - d0 || 1;
  return (v: number) => r0 + ((v - d0) / span) * (r1 - r0);
}

export function histogramBars(counts: number[], width: number, height: number, gap = 1): Bar[] {
  if (!counts.length) return [];
  const max = Math.max(...counts, 1);
  const w = width / counts.length;
  return counts.map((c, i) => {
    const h = c === 0 ? 0 : Math.max(1, (c / max) * height);
    return { x: i * w + gap / 2, y: height - h, w: Math.max(w - gap, 0.5), h, value: c };
  });
}

/** Há negativo que mereça meio gráfico? Ruído de −0,0001 contra máximo 0,08 não merece. */
export function hasNegative(values: number[]): boolean {
  const max = Math.max(...values.map(Math.abs), 1e-12);
  return values.some((v) => v < 0 && -v > 0.05 * max);
}

/** Barras horizontais com valores possivelmente negativos (importância, efeito numa previsão). */
export function divergingBars(values: number[], width: number, rowHeight: number, pad = 0.2) {
  const max = Math.max(...values.map(Math.abs), 1e-12);
  const hasNeg = hasNegative(values);
  const zero = hasNeg ? width / 2 : 0;
  const scale = (hasNeg ? width / 2 : width) / max;
  return values.map((v, i) => {
    // negativo desprezível (ruído da permutação) sem eixo central: barra zerada
    const len = !hasNeg && v < 0 ? 0 : Math.abs(v) * scale;
    return {
      x: v >= 0 ? zero : zero - len,
      y: i * rowHeight + rowHeight * pad,
      w: Math.max(len, len === 0 ? 0 : 1),
      h: rowHeight * (1 - 2 * pad),
      value: v,
      zero,
    };
  });
}

/** Cor divergente para correlação (−1 azul, 0 neutro, +1 laranja), como classe CSS em 11 degraus. */
export function corrClass(v: number | null): string {
  if (v == null || Number.isNaN(v)) return "c-na";
  const step = Math.round(Math.max(-1, Math.min(1, v)) * 5);
  return step < 0 ? `c-n${-step}` : `c-p${step}`;
}

export function polyline(xs: number[], ys: number[], sx: (v: number) => number, sy: (v: number) => number): string {
  return xs.map((x, i) => `${sx(x).toFixed(1)},${sy(ys[i]).toFixed(1)}`).join(" ");
}

/** Matriz de confusão binária num corte qualquer, a partir das probabilidades do holdout. */
export function confusionAt(y: number[], p: number[], threshold: number) {
  let tn = 0;
  let fp = 0;
  let fn = 0;
  let tp = 0;
  for (let i = 0; i < y.length; i++) {
    const pred = p[i] >= threshold ? 1 : 0;
    if (y[i] === 1) pred === 1 ? tp++ : fn++;
    else pred === 1 ? fp++ : tn++;
  }
  const n = y.length || 1;
  return {
    matrix: [
      [tn, fp],
      [fn, tp],
    ],
    accuracy: (tp + tn) / n,
    precision: tp + fp ? tp / (tp + fp) : 0,
    recall: tp + fn ? tp / (tp + fn) : 0,
    flagged: (tp + fp) / n,
  };
}

/** Marcas "redondas" para um eixo. */
export function ticks(min: number, max: number, count = 5): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [];
  if (min === max) return [min];
  const raw = (max - min) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const out = [];
  for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-9; v += step) out.push(Number(v.toFixed(10)));
  return out;
}

/** Área sob a curva ROC pelos trapézios (confere a AUC que o motor manda). */
export function rocArea(fpr: number[], tpr: number[]): number {
  let a = 0;
  for (let i = 1; i < fpr.length; i++) a += ((fpr[i] - fpr[i - 1]) * (tpr[i] + tpr[i - 1])) / 2;
  return a;
}
