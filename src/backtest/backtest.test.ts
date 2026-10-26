import { describe, expect, it } from "vitest";
import { DAY_SECONDS } from "../scoring/scoring.config.ts";
import { clockCommunity, separatedCommunity, tiedCommunity } from "./fixtures.ts";
import { runBacktest, scoreTrainWindow } from "./backtest.ts";
import { auc } from "./metrics.ts";

describe("backtest", () => {
  it("separates silent members from reactors", () => {
    const fixture = separatedCommunity();
    const result = runBacktest(fixture);
    expect(result.status).toBe("ok");
    expect(result.trainPosts).toBe(7);
    expect(result.testPosts).toBe(3);
    expect(result.auc).not.toBeNull();
    expect(result.auc!).toBeGreaterThan(0.6);
    expect(result.aucUnreliable).toBe(false);
    expect(result.precisionAtK[0]).toMatchObject({ k: 100, precision: 1, truncated: false });
    expect(result.precisionAtK[1].truncated).toBe(true);
    expect(result.silentBaseRate).toBeCloseTo(100 / 110);
    const first = result.calibration[0];
    const last = result.calibration[result.calibration.length - 1];
    expect(last.meanPredicted).toBeGreaterThan(first.meanPredicted);
    expect(last.meanActual).toBeGreaterThan(first.meanActual);
  });

  it("returns AUC 0.5 when harm does not differ", () => {
    const result = runBacktest(tiedCommunity());
    expect(result.status).toBe("ok");
    expect(result.auc).toBeCloseTo(0.5);
    expect(result.aucUnreliable).toBe(true);
  });

  it("scores exposure at the current clock, not at the split", () => {
    const exposureNow = 1_800_000_000;
    const fixture = clockCommunity(exposureNow);
    const trained = scoreTrainWindow(fixture);
    expect("error" in trained).toBe(false);
    if ("error" in trained) return;
    expect(trained.splitAt).toBeLessThan(exposureNow - 150 * DAY_SECONDS);
    expect(trained.scores[0].exposure).toBe(0.05);
  });

  it("reports insufficient posts and a single class without an AUC warning", () => {
    const fixture = separatedCommunity({ silent: 2, reactors: 0 });
    expect(runBacktest({ ...fixture, posts: fixture.posts.slice(0, 1) }).status).toBe("insufficient_posts");
    const single = runBacktest(fixture);
    expect(single.status).toBe("single_class");
    expect(single.auc).toBeNull();
    expect(single.aucUnreliable).toBe(false);
  });

  it("treats tied scores as 0.5 in AUC", () => {
    expect(
      auc([
        { score: 1, positive: true },
        { score: 1, positive: false },
      ]),
    ).toBeCloseTo(0.5);
  });
});
