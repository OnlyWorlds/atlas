import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  // Files run in parallel across workers; tests WITHIN a file stay serial
  // (fullyParallel: false). Specs fresh-boot with isolated OPFS/localStorage,
  // so cross-file parallelism is safe. Validated session 236: full suite 2×
  // clean at 4 workers (~52s vs ~108s serial) + the load-sensitive writing
  // specs (split/autolink) stress-passed with --repeat-each=2. If a flake
  // class returns under load, drop back to workers: 1 and re-bisect.
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  // Local retry added session 240: the unified entity header added click-to-edit
  // + a second TipTap-mounting spec family (knowledge/share editors). At 4 workers
  // the on-demand TipTap chunk compilation occasionally CPU-starves ONE sibling
  // test per full run (a varying test — confirmed load-sensitivity: every failing
  // test passes 100% serially / at --repeat-each). A single retry heals the
  // starvation flake in isolation without masking real failures (a logic bug
  // fails both attempts). CI keeps 2.
  retries: 2,
  workers: 4,
  // Headroom for 4-worker TipTap-chunk contention: the per-test timeout (default
  // 30s) AND the per-assertion expect timeout (default 5s) both get starved when
  // several editor specs compile the TipTap chunk at once. test.slow() only
  // covers the test timeout — the actual flake was a `toBeVisible()` blowing the
  // 5s expect timeout — so bump expect too. Confirmed load-sensitivity (100%
  // pass serially); retries are the final safety net.
  timeout: 45_000,
  expect: { timeout: 12_000 },
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:3045',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3045',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
