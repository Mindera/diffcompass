// Tests that position the viewport manually must first deliver the user input
// which cancels any unfinished automatic tour/file reveal in the real UI.
export async function beginManualScroll(page) {
  await page.evaluate(() => {
    window.manualWheelSeen = false;
    window.addEventListener('wheel', () => { window.manualWheelSeen = true; }, { once: true, capture: true });
  });
  await page.locator('.diff-toolbar').hover();
  await page.mouse.wheel(0, 1);
  await page.waitForFunction(() => window.manualWheelSeen);
}
