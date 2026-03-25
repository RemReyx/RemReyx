const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');
const GIFEncoder = require('gif-encoder-2');
const { chromium } = require('playwright');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const repoRoot = path.join(__dirname, '..');
  const inputHtml = path.join(repoRoot, 'banner.html');
  const outGif = path.join(repoRoot, 'banner.gif');

  const width = 900;
  const height = 300;
  const fps = 6; // lower FPS keeps the GIF size reasonable
  const durationMs = 18000; // covers (roughly) the full typing cycle

  if (!fs.existsSync(inputHtml)) {
    throw new Error(`Missing input HTML: ${inputHtml}`);
  }

  // Ensure output folder exists (root write).
  if (fs.existsSync(outGif)) fs.unlinkSync(outGif);

  const frameCount = Math.max(1, Math.floor((durationMs / 1000) * fps));
  const frameDelayMs = 1000 / fps;

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    viewport: { width, height },
    deviceScaleFactor: 1,
  });

  // Use file:// so there are no external dependencies.
  await page.goto(`file://${inputHtml}`);

  // Wait until the typing starts rendering to avoid capturing a blank/initial frame.
  try {
    await page.waitForFunction(() => {
      const el = document.getElementById('typed');
      return el && el.textContent && el.textContent.length > 0;
    }, { timeout: 5000 });
  } catch (_e) {
    // Fallback: wait a bit regardless.
    await sleep(800);
  }

  const outStream = fs.createWriteStream(outGif);
  const encoder = new GIFEncoder(width, height, 'octree', false, frameCount);
  encoder.setDelay(frameDelayMs);
  encoder.setRepeat(0);
  encoder.start();

  encoder.createReadStream().pipe(outStream);

  let captured = 0;
  for (let i = 0; i < frameCount; i++) {
    const pngBuf = await page.screenshot({ type: 'png' });
    const png = PNG.sync.read(pngBuf);

    // gif-encoder-2 expects RGBA bytes (Uint8Array) length = width*height*4
    encoder.addFrame(png.data);
    captured++;

    // Maintain roughly the requested FPS.
    await sleep(frameDelayMs);
    // eslint-disable-next-line no-unused-vars
    const _ = i;
  }

  encoder.finish();

  await new Promise((resolve, reject) => {
    outStream.on('finish', resolve);
    outStream.on('error', reject);
  });

  await browser.close();
  // eslint-disable-next-line no-console
  console.log(`Wrote ${outGif} (${captured} frames @ ${fps}fps)`);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});

