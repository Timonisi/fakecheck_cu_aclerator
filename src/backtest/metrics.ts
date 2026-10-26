export type RankedLabel = {
  score: number;
  positive: boolean;
};

export function auc(pairs: RankedLabel[]): number | null {
  const positives = pairs.filter((pair) => pair.positive).length;
  const negatives = pairs.length - positives;
  if (positives === 0 || negatives === 0) return null;

  const sorted = [...pairs].sort((a, b) => a.score - b.score);
  let rankSum = 0;
  let index = 0;
  while (index < sorted.length) {
    let end = index;
    while (end < sorted.length && sorted[end].score === sorted[index].score) end += 1;
    const averageRank = (index + 1 + end) / 2;
    for (let cursor = index; cursor < end; cursor += 1) {
      if (sorted[cursor].positive) rankSum += averageRank;
    }
    index = end;
  }
  return (rankSum - (positives * (positives + 1)) / 2) / (positives * negatives);
}

export type PrecisionAtK = {
  k: number;
  precision: number | null;
  evaluated: number;
  truncated: boolean;
};

export function precisionAtK(sortedPositiveFlags: boolean[], k: number): PrecisionAtK {
  if (sortedPositiveFlags.length === 0 || k <= 0) {
    return { k, precision: null, evaluated: 0, truncated: sortedPositiveFlags.length < k };
  }
  const evaluated = Math.min(k, sortedPositiveFlags.length);
  const hits = sortedPositiveFlags.slice(0, evaluated).filter(Boolean).length;
  return {
    k,
    precision: hits / evaluated,
    evaluated,
    truncated: sortedPositiveFlags.length < k,
  };
}

export type CalibrationBin = {
  decile: number;
  count: number;
  meanPredicted: number;
  meanActual: number;
};

export function calibrationByDecile(
  rows: Array<{ predicted: number; actual: number }>,
): CalibrationBin[] {
  if (rows.length === 0) return [];
  const sorted = rows.map((row, index) => ({ ...row, index })).sort((a, b) => a.predicted - b.predicted || a.index - b.index);
  const bins: Array<Array<{ predicted: number; actual: number }>> = Array.from({ length: 10 }, () => []);
  for (let index = 0; index < sorted.length; index += 1) {
    const bin = Math.min(9, Math.floor((index * 10) / sorted.length));
    bins[bin].push(sorted[index]);
  }
  const result: CalibrationBin[] = [];
  bins.forEach((bin, index) => {
    if (bin.length === 0) return;
    const meanPredicted = bin.reduce((sum, row) => sum + row.predicted, 0) / bin.length;
    const meanActual = bin.reduce((sum, row) => sum + row.actual, 0) / bin.length;
    result.push({ decile: index + 1, count: bin.length, meanPredicted, meanActual });
  });
  return result;
}
