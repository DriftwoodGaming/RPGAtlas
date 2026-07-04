/* RPGAtlas — tests-e2e/fixtures/perf.mjs
   Shared helpers for the performance budget specs (renderer-perf, load-perf,
   adv-perf). Single-sourced so the measurement logic and the deterministic
   RNG cannot drift between the specs whose numbers get compared against each
   other. GPL-3.0-or-later. */

/** Deterministic LCG — identical fixture content every run (same recipe as
 *  scripts/build-atlas-quest-hd.mjs, which must stay byte-reproducible). */
export function makeRand(seed) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

/** Average ms/frame over `frames` rAF ticks after `warmup` ticks, measured
 *  in-page. rAF cadence means a scene holding 60 fps reports ~16.7 ms. */
export function measureFrames(page, { warmup, frames }) {
  return page.evaluate(
    ({ warmup, frames }) =>
      new Promise((resolve) => {
        let n = 0;
        let start = 0;
        function tick(now) {
          n++;
          if (n === warmup) start = now;
          if (n === warmup + frames) {
            resolve((now - start) / frames);
            return;
          }
          requestAnimationFrame(tick);
        }
        requestAnimationFrame(tick);
      }),
    { warmup, frames },
  );
}
