import { expect, test } from "@playwright/test";
import { SITE_NAME } from "../../src/lib/site";

test("トップページが開き、スマホ幅で横にはみ出さない", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle(SITE_NAME);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(SITE_NAME);

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});
