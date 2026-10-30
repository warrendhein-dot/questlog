import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { expect, test } from "@playwright/test";

const run = promisify(execFile);

// `npm run check:live` is how the deployed site gets checked. Running it here, against the
// production build this suite already starts, keeps the script honest: if a header, a redirect or the
// script itself breaks, this fails before the real site is ever checked.
test("the live-site check passes against a production build running on this computer", async ({
  baseURL,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "one run is enough");

  let output: string;
  try {
    output = (
      await run(
        process.execPath,
        [
          "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON",
          "scripts/check-live.ts",
          baseURL!,
          "--allow-http",
        ],
        {
          timeout: 60_000,
        },
      )
    ).stdout;
  } catch (error) {
    // A failing check exits with 1: show its report, which says which rule failed and why.
    throw new Error((error as { stdout?: string }).stdout || String(error));
  }

  expect(output).toMatch(/\d+ of \d+ checks passed\./);
  expect(output).not.toContain("FAIL");
});
