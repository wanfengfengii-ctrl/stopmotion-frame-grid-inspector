import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import { FIXTURE_LAYOUT, frameColor, makeSpriteSheet } from './makePng';

const sheet = makeSpriteSheet(FIXTURE_LAYOUT);

async function setField(page: Page, testid: string, value: string) {
  await page.getByTestId(testid).fill(value);
}

async function fillFixtureParams(page: Page) {
  await setField(page, 'rows', String(FIXTURE_LAYOUT.rows));
  await setField(page, 'columns', String(FIXTURE_LAYOUT.columns));
  await setField(page, 'marginTop', String(FIXTURE_LAYOUT.marginTop));
  await setField(page, 'marginRight', String(FIXTURE_LAYOUT.marginRight));
  await setField(page, 'marginBottom', String(FIXTURE_LAYOUT.marginBottom));
  await setField(page, 'marginLeft', String(FIXTURE_LAYOUT.marginLeft));
  await setField(page, 'gapX', String(FIXTURE_LAYOUT.gapX));
  await setField(page, 'gapY', String(FIXTURE_LAYOUT.gapY));
}

async function uploadSheet(page: Page) {
  await page
    .getByTestId('file-input')
    .setInputFiles({ name: 'sheet.png', mimeType: 'image/png', buffer: sheet.buffer });
}

/** 读取某编号帧裁切图中心点的 RGBA。 */
async function sampleFramePixel(page: Page, index: number): Promise<[number, number, number, number]> {
  return page.$eval(
    `[data-testid="frame-card"][data-index="${index}"] img`,
    (img) =>
      new Promise((resolve) => {
        const image = img as HTMLImageElement;
        const draw = () => {
          const canvas = document.createElement('canvas');
          canvas.width = image.naturalWidth;
          canvas.height = image.naturalHeight;
          const ctx = canvas.getContext('2d')!;
          ctx.drawImage(image, 0, 0);
          const px = ctx.getImageData(canvas.width >> 1, canvas.height >> 1, 1, 1).data;
          resolve([px[0], px[1], px[2], px[3]]);
        };
        if (image.complete && image.naturalWidth > 0) draw();
        else image.addEventListener('load', draw, { once: true });
      }),
  );
}

async function cardCount(page: Page) {
  return page.getByTestId('frame-card').count();
}

/** 读取动画预览画面中心点的 RGBA。 */
async function samplePlayerPixel(page: Page): Promise<[number, number, number, number]> {
  return page.$eval('[data-testid="player-frame-img"]', (img) =>
    new Promise((resolve) => {
      const image = img as HTMLImageElement;
      const draw = () => {
        const canvas = document.createElement('canvas');
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(image, 0, 0);
        const px = ctx.getImageData(canvas.width >> 1, canvas.height >> 1, 1, 1).data;
        resolve([px[0], px[1], px[2], px[3]]);
      };
      if (image.complete && image.naturalWidth > 0) draw();
      else image.addEventListener('load', draw, { once: true });
    }),
  );
}

function rgba(row: number, col: number): [number, number, number, number] {
  const c = frameColor(row, col);
  return [c.r, c.g, c.b, c.a];
}

async function expectPlayerColor(page: Page, row: number, col: number, timeout = 3000) {
  await expect.poll(() => samplePlayerPixel(page), { timeout }).toEqual(rgba(row, col));
}

async function readManifest(page: Page) {
  const text = (await page.getByTestId('manifest').textContent()) ?? '';
  return JSON.parse(text);
}

async function collectCardCoords(page: Page): Promise<string[]> {
  const cards = await page.getByTestId('frame-card').all();
  return Promise.all(cards.map((card) => card.getByTestId('frame-coords').innerText()));
}

test.describe('上传与解码', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('上传合法 PNG 后显示尺寸与逐帧裁切结果（编号、x、y、宽高）', async ({ page }) => {
    await uploadSheet(page);
    await fillFixtureParams(page);

    await expect(page.getByTestId('file-meta')).toContainText(`sheet.png（${sheet.width} × ${sheet.height}）`);
    await expect(page.getByTestId('summary')).toContainText('共 8 帧，每帧 10 × 12');
    expect(await cardCount(page)).toBe(8);
    await expect(page.getByTestId('error')).toHaveCount(0);

    const first = page.getByTestId('frame-card').filter({ hasText: '#1' });
    await expect(first).toContainText('x=2, y=1, w=10, h=12');
    const last = page.getByTestId('frame-card').filter({ hasText: '#8' });
    await expect(last).toContainText('x=38, y=16, w=10, h=12');
    await expect(page.getByTestId('overlay')).toBeVisible();
  });

  test('裁切图内容与网格位置对应（不是固定结果，逐像素采样）', async ({ page }) => {
    await uploadSheet(page);
    await fillFixtureParams(page);
    await expect(page.getByTestId('summary')).toBeVisible();

    // 行优先（默认）：#1=(行0,列0)，#2=(行0,列1)，#8=(行1,列3)
    const c00 = frameColor(0, 0);
    const c01 = frameColor(0, 1);
    const c13 = frameColor(1, 3);
    // data URL 解码是异步的，用 poll 等待新像素出现而不是固定等待
    await expect.poll(() => sampleFramePixel(page, 1)).toEqual([c00.r, c00.g, c00.b, c00.a]);
    await expect.poll(() => sampleFramePixel(page, 2)).toEqual([c01.r, c01.g, c01.b, c01.a]);
    await expect.poll(() => sampleFramePixel(page, 8)).toEqual([c13.r, c13.g, c13.b, c13.a]);
  });

  test('非 PNG 文件与损坏 PNG 都会清空旧帧并说明原因', async ({ page }) => {
    // 先得到一组合法结果
    await uploadSheet(page);
    await fillFixtureParams(page);
    expect(await cardCount(page)).toBe(8);

    // 上传文本文件：类型不对
    await page
      .getByTestId('file-input')
      .setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') });
    await expect(page.getByTestId('error')).toContainText('不是 image/png');
    expect(await cardCount(page)).toBe(0);

    // 再传扩展名为 .png 但内容损坏的文件：解码失败
    await page
      .getByTestId('file-input')
      .setInputFiles({ name: 'broken.png', mimeType: 'image/png', buffer: Buffer.from([0, 1, 2, 3, 4, 5]) });
    await expect(page.getByTestId('error')).toContainText('图片解码失败');
    expect(await cardCount(page)).toBe(0);
  });
});

test.describe('参数校验与错误可见性', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await uploadSheet(page);
    await fillFixtureParams(page);
    await expect(page.getByTestId('summary')).toBeVisible();
  });

  test('参数非法时清空旧帧并显示原因，恢复后重新出现', async ({ page }) => {
    expect(await cardCount(page)).toBe(8);

    // 右边距过大：有效宽度 = 51-2-100-6 < 0
    await setField(page, 'marginRight', '100');
    await expect(page.getByTestId('error')).toContainText('有效宽度非正');
    expect(await cardCount(page)).toBe(0);
    await expect(page.getByTestId('summary')).toHaveCount(0);

    // 改成不能整除：有效宽度 41，41/4 余 1
    await setField(page, 'marginRight', '2');
    await expect(page.getByTestId('error')).toContainText('不能被列数 4 整除');
    expect(await cardCount(page)).toBe(0);

    await setField(page, 'marginRight', String(FIXTURE_LAYOUT.marginRight));
    expect(await cardCount(page)).toBe(8);
    await expect(page.getByTestId('error')).toHaveCount(0);
  });

  test('行列数必须为正整数、边距间距必须为非负整数', async ({ page }) => {
    await setField(page, 'rows', '0');
    await expect(page.getByTestId('error')).toContainText('行数必须为正整数');
    expect(await cardCount(page)).toBe(0);

    await setField(page, 'rows', '2');
    await setField(page, 'gapX', '-2');
    await expect(page.getByTestId('error')).toContainText('水平帧间距必须为非负整数');
    expect(await cardCount(page)).toBe(0);

    await setField(page, 'gapX', '1.5');
    await expect(page.getByTestId('error')).toContainText('水平帧间距必须为非负整数');
    expect(await cardCount(page)).toBe(0);
  });
});

test.describe('行优先 / 列优先切换', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await uploadSheet(page);
    await fillFixtureParams(page);
    await expect(page.getByTestId('summary')).toBeVisible();
  });

  test('切换顺序只改变编号：矩形集合不变，每个裁切区域只对应一个编号', async ({ page }) => {
    type Card = { index: number; rect: string };
    const collect = async (): Promise<Card[]> => {
      const cards = await page.getByTestId('frame-card').all();
      return Promise.all(
        cards.map(async (card) => {
          const index = Number(await card.getByTestId('frame-index').innerText().then((t) => t.replace('#', '')));
          const coords = await card.getByTestId('frame-coords').innerText();
          const m = coords.match(/x=(-?\d+), y=(-?\d+), w=(-?\d+), h=(-?\d+)/)!;
          return { index, rect: `${m[1]},${m[2]},${m[3]},${m[4]}` };
        }),
      );
    };

    const rowCards = await collect();
    expect(rowCards.map((c) => c.index)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    const rowRects = rowCards.map((c) => c.rect).sort();

    // 行优先：#2 在 #1 右边（同行下一列）
    await expect(page.getByTestId('frame-card').filter({ hasText: '#2' })).toContainText('x=14, y=1');

    await page.getByTestId('order-column').check();
    const colCards = await collect();
    expect(colCards.map((c) => c.index)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    // 列优先：#2 在 #1 下边（同列下一行）
    await expect(page.getByTestId('frame-card').filter({ hasText: '#2' })).toContainText('x=2, y=16');

    // 矩形集合完全一致，且各自无重复（一个裁切区域只对应一个编号）
    expect(colCards.map((c) => c.rect).sort()).toEqual(rowRects);
    expect(new Set(rowCards.map((c) => c.rect)).size).toBe(8);
    expect(new Set(colCards.map((c) => c.rect)).size).toBe(8);

    // 像素内容跟随编号：#2 从（行0,列1）变为（行1,列0）。
    // data URL 解码异步，须轮询等待新像素，禁止固定 sleep。
    const a = frameColor(0, 1);
    const b = frameColor(1, 0);
    await expect.poll(() => sampleFramePixel(page, 2)).toEqual([b.r, b.g, b.b, b.a]);
    await page.getByTestId('order-row').check();
    // 等待画面坐标切回行优先（与新 dataUrl 在同一次提交中生成）
    await expect(page.getByTestId('frame-card').filter({ hasText: '#2' })).toContainText('x=14, y=1');
    await expect.poll(() => sampleFramePixel(page, 2)).toEqual([a.r, a.g, a.b, a.a]);
  });

  test('切换顺序后下载的 JSON 清单与画面一致', async ({ page }) => {
    const readManifest = async () => {
      // details 折叠时 innerText 为空，textContent 不受可见性影响
      const text = (await page.getByTestId('manifest').textContent()) ?? '';
      return JSON.parse(text) as {
        params: { order: string };
        frames: Array<{ index: number; x: number; y: number; width: number; height: number }>;
      };
    };

    const rowManifest = await readManifest();
    expect(rowManifest.params.order).toBe('row');
    expect(rowManifest.frames[1]).toMatchObject({ index: 2, x: 14, y: 1, width: 10, height: 12 });

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByTestId('download-json').click(),
    ]);
    expect(download.suggestedFilename()).toBe('sheet.frames.json');
    const path = await download.path();
    const downloaded = JSON.parse(fs.readFileSync(path!, 'utf8'));
    expect(downloaded).toEqual(rowManifest);

    await page.getByTestId('order-column').check();
    // 等待画面完成重渲染（坐标与清单在同一次状态提交中更新）
    await expect(page.getByTestId('frame-card').filter({ hasText: '#2' })).toContainText('x=2, y=16');
    const colManifest = await readManifest();
    expect(colManifest.params.order).toBe('column');
    expect(colManifest.frames[1]).toMatchObject({ index: 2, x: 2, y: 16, width: 10, height: 12 });
    // 画面中的卡片坐标与清单逐帧一致
    for (const f of colManifest.frames) {
      await expect(
        page.getByTestId('frame-card').filter({ hasText: `#${f.index}` }).getByTestId('frame-coords'),
      ).toContainText(`x=${f.x}, y=${f.y}, w=${f.width}, h=${f.height}`);
    }
  });
});

test.describe('逐帧动画预览', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await uploadSheet(page);
    await fillFixtureParams(page);
    await expect(page.getByTestId('summary')).toBeVisible();
  });

  test('合法帧生成后预览停在第 1 帧且状态为就绪', async ({ page }) => {
    await expect(page.getByTestId('playback-status')).toHaveAttribute('data-status', 'ready');
    await expect(page.getByTestId('playback-status')).toHaveText('就绪');
    await expect(page.getByTestId('player-counter')).toContainText('第 1 / 8 帧');
    await expect(page.getByTestId('play-toggle')).toHaveText('播放');
    await expectPlayerColor(page, 0, 0);
  });

  test('播放按编号顺序逐帧推进，末帧后循环回第 1 帧（逐像素确认）', async ({ page }) => {
    // 2fps：每帧 500ms，节奏宽裕；按行优先顺序逐帧采样
    await page.getByTestId('fps').fill('2');
    await page.getByTestId('play-toggle').click();
    await expect(page.getByTestId('playback-status')).toHaveAttribute('data-status', 'playing');
    await expect(page.getByTestId('play-toggle')).toHaveText('暂停');

    const order: Array<[number, number]> = [
      [0, 0], [0, 1], [0, 2], [0, 3],
      [1, 0], [1, 1], [1, 2], [1, 3],
      // 循环
      [0, 0], [0, 1],
    ];
    for (const [r, c] of order) {
      await expect.poll(() => samplePlayerPixel(page), { timeout: 1500, intervals: [60] }).toEqual(rgba(r, c));
    }
    // 循环一轮后仍在播放
    await expect(page.getByTestId('playback-status')).toHaveAttribute('data-status', 'playing');
  });

  test('暂停后画面冻结在当前帧，继续后从该帧播放', async ({ page }) => {
    await page.getByTestId('fps').fill('2');
    await page.getByTestId('play-toggle').click();
    // 等到走到第 2 帧
    await expectPlayerColor(page, 0, 1);

    await page.getByTestId('play-toggle').click();
    await expect(page.getByTestId('playback-status')).toHaveAttribute('data-status', 'paused');
    const frozen = await samplePlayerPixel(page);

    // 暂停 1.2s（若仍在播放 2fps 下应已前进 2 帧），像素不变
    await page.waitForTimeout(1200);
    expect(await samplePlayerPixel(page)).toEqual(frozen);
    await expect(page.getByTestId('playback-status')).toHaveAttribute('data-status', 'paused');

    // 继续：下一帧应在约 500ms 后出现
    await page.getByTestId('play-toggle').click();
    await expect(page.getByTestId('playback-status')).toHaveAttribute('data-status', 'playing');
    await expect.poll(() => samplePlayerPixel(page), { timeout: 1500, intervals: [60] }).toEqual(rgba(0, 2));
  });

  test('调速：1fps 时帧切换缓慢，改为 30fps 后快速循环', async ({ page }) => {
    await page.getByTestId('fps').fill('1');
    await page.getByTestId('play-toggle').click();
    await expectPlayerColor(page, 0, 0);
    // 800ms 时仍在第 1 帧
    await page.waitForTimeout(800);
    expect(await samplePlayerPixel(page)).toEqual(rgba(0, 0));
    // 约 1s 后切到第 2 帧
    await expect.poll(() => samplePlayerPixel(page), { timeout: 1500, intervals: [60] }).toEqual(rgba(0, 1));

    // 暂停后调到 30fps 再播放
    await page.getByTestId('play-toggle').click();
    await page.getByTestId('fps').fill('30');
    await expect(page.getByTestId('fps-error')).toHaveCount(0);
    await page.getByTestId('play-toggle').click();
    // 30fps 下从第 2 帧出发，约 7 帧（~240ms）后循环回到第 1 帧
    await expect.poll(() => samplePlayerPixel(page), { timeout: 2000, intervals: [30] }).toEqual(rgba(0, 0));
  });

  test('切换编号顺序时停止播放并从新序列第 1 帧开始，像素按新顺序推进', async ({ page }) => {
    await page.getByTestId('fps').fill('2');
    await page.getByTestId('play-toggle').click();
    await expectPlayerColor(page, 0, 1);

    // 播放中切列优先：旧计时停止、回到就绪、停在第 1 帧
    await page.getByTestId('order-column').check();
    await expect(page.getByTestId('playback-status')).toHaveAttribute('data-status', 'ready');
    await expect(page.getByTestId('player-counter')).toContainText('第 1 / 8 帧');
    await expectPlayerColor(page, 0, 0);

    // 列优先：#2=(行1,列0)，#3=(行0,列1)
    await page.getByTestId('play-toggle').click();
    await expect.poll(() => samplePlayerPixel(page), { timeout: 1500, intervals: [60] }).toEqual(rgba(1, 0));
    await expect.poll(() => samplePlayerPixel(page), { timeout: 1500, intervals: [60] }).toEqual(rgba(0, 1));
  });

  test('帧率为空、非整数或越界时暂停并就地说明，恢复后可继续播放', async ({ page }) => {
    await page.getByTestId('fps').fill('2');
    await page.getByTestId('play-toggle').click();
    await expectPlayerColor(page, 0, 1);

    // 越界
    await page.getByTestId('fps').fill('31');
    await expect(page.getByTestId('fps-error')).toContainText('帧率越界');
    await expect(page.getByTestId('playback-status')).toHaveAttribute('data-status', 'paused');
    let frozen = await samplePlayerPixel(page);
    await page.waitForTimeout(700);
    expect(await samplePlayerPixel(page)).toEqual(frozen);

    // 非整数
    await page.getByTestId('fps').fill('1.5');
    await expect(page.getByTestId('fps-error')).toContainText('帧率非整数');
    expect(await samplePlayerPixel(page)).toEqual(frozen);

    // 为空
    await page.getByTestId('fps').fill('');
    await expect(page.getByTestId('fps-error')).toContainText('帧率为空');

    // 非法期间帧卡、总览、JSON 下载仍然可用
    expect(await cardCount(page)).toBe(8);
    await expect(page.getByTestId('summary')).toBeVisible();
    await expect(page.getByTestId('download-json')).toBeVisible();

    // 恢复合法：提示消失，播放正常
    await page.getByTestId('fps').fill('2');
    await expect(page.getByTestId('fps-error')).toHaveCount(0);
    await page.getByTestId('play-toggle').click();
    await expect(page.getByTestId('playback-status')).toHaveAttribute('data-status', 'playing');
    // 当前停在 (0,1)，下一帧为 (0,2)
    frozen = await samplePlayerPixel(page);
    expect(frozen).toEqual(rgba(0, 1));
    await expect.poll(() => samplePlayerPixel(page), { timeout: 1500, intervals: [60] }).toEqual(rgba(0, 2));
  });

  test('播放状态不改写裁切坐标与 JSON 清单', async ({ page }) => {
    const beforeCoords = await collectCardCoords(page);
    const beforeManifest = await readManifest(page);

    // 高速播放超过一整轮
    await page.getByTestId('fps').fill('30');
    await page.getByTestId('play-toggle').click();
    await expect.poll(() => samplePlayerPixel(page), { timeout: 2000, intervals: [30] }).toEqual(rgba(0, 0));
    await page.waitForTimeout(600); // 再多走若干帧
    await page.getByTestId('play-toggle').click();
    await expect(page.getByTestId('playback-status')).toHaveAttribute('data-status', 'paused');

    // 帧卡坐标与清单逐字节不变
    expect(await collectCardCoords(page)).toEqual(beforeCoords);
    expect(await readManifest(page)).toEqual(beforeManifest);

    // 经过非法帧率再恢复，清单依旧不变
    await page.getByTestId('fps').fill('0');
    await expect(page.getByTestId('fps-error')).toBeVisible();
    await page.getByTestId('fps').fill('30');
    expect(await readManifest(page)).toEqual(beforeManifest);
    expect(await collectCardCoords(page)).toEqual(beforeCoords);
  });

  test('几何校验失败或图片解码失败时动画画面随原链路清空，恢复后重新就绪', async ({ page }) => {
    // 几何非法：整个预览（含动画）卸载，不残留失效帧
    await setField(page, 'marginRight', '100');
    await expect(page.getByTestId('error')).toBeVisible();
    expect(await page.getByTestId('player-frame-img').count()).toBe(0);
    expect(await page.getByTestId('playback-status').count()).toBe(0);

    // 恢复：动画重新出现，停在第 1 帧、就绪
    await setField(page, 'marginRight', String(FIXTURE_LAYOUT.marginRight));
    await expect(page.getByTestId('playback-status')).toHaveAttribute('data-status', 'ready');
    await expect(page.getByTestId('player-counter')).toContainText('第 1 / 8 帧');
    await expectPlayerColor(page, 0, 0);

    // 解码失败同样清空动画画面
    await page
      .getByTestId('file-input')
      .setInputFiles({ name: 'broken.png', mimeType: 'image/png', buffer: Buffer.from([0, 1, 2, 3]) });
    await expect(page.getByTestId('error')).toContainText('图片解码失败');
    expect(await page.getByTestId('player-frame-img').count()).toBe(0);
    expect(await page.getByTestId('playback-status').count()).toBe(0);
  });
});
