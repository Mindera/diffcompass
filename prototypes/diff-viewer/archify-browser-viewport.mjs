// Chrome-only browser-test sizing; this never changes the app or iframe sandbox.
// Playwright 1.63 sizes headless Chrome 154's outer window to the emulated
// viewport. Chrome reserves window chrome, so iframe clicks in the bottom
// strip reach only the outer iframe element. Match the real content surface
// as well as CSS/device metrics; use real pointer input without click retries.
export async function setDiagramViewport(page, size) {
  await page.setViewportSize(size);
  const session = await page.context().newCDPSession(page);
  try {
    const { windowId } = await session.send('Browser.getWindowForTarget');
    await session.send('Browser.setContentsSize', { windowId, ...size });
  } finally {
    await session.detach();
  }
  await page.waitForFunction(({ width, height }) => innerWidth === width && innerHeight === height, size);
}
