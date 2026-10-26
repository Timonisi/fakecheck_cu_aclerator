import { existsSync } from "node:fs";
import { separatedCommunity, tiedCommunity } from "../backtest/fixtures.ts";
import { runBacktest } from "../backtest/backtest.ts";
import type { BacktestResult } from "../backtest/backtest.ts";
import { loadCommunity, openDatabase } from "../db/database.ts";
import { loadEnv } from "../env.ts";

function printResult(title: string, result: BacktestResult): void {
  console.log(`\n${title}`);
  console.log(`статус: ${result.status}, train ${result.trainPosts}, test ${result.testPosts}`);
  console.log(result.auc == null ? "AUC: нет" : `AUC: ${result.auc.toFixed(3)}${result.aucUnreliable ? " (ненадёжно)" : ""}`);
  console.log(result.silentBaseRate == null ? "доля молчунов: нет" : `доля молчунов: ${result.silentBaseRate.toFixed(3)}`);
  for (const row of result.precisionAtK) {
    const value = row.precision == null ? "нет" : row.precision.toFixed(3);
    console.log(`precision@${row.k}: ${value} (n=${row.evaluated}${row.truncated ? ", усечено" : ""})`);
  }
  for (const bin of result.calibration) {
    console.log(
      `дециль ${bin.decile}: прогноз ${bin.meanPredicted.toFixed(3)}, факт ${bin.meanActual.toFixed(3)}, n=${bin.count}`,
    );
  }
  console.log(result.note);
}

loadEnv();
printResult("Фикстура: молчуны отделяются", runBacktest(separatedCommunity()));
printResult("Фикстура: одинаковый harm", runBacktest(tiedCommunity()));

const dbPath = process.env.DB_PATH ?? "data/fakestata.sqlite";
if (!existsSync(dbPath)) {
  console.log(`\nБазы ${dbPath} нет. Живой бэктест появится после синхронизации.`);
} else {
  const data = loadCommunity(openDatabase(dbPath));
  if (data.posts.length === 0) {
    console.log(`\nВ ${dbPath} нет постов. Живой бэктест появится после синхронизации.`);
  } else {
    printResult(
      "База сообщества",
      runBacktest({ ...data, exposureNow: Math.floor(Date.now() / 1000) }),
    );
  }
}
