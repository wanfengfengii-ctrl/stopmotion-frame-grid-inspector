import { describe, expect, it } from 'vitest';
import { buildManifest, type Manifest } from './manifest';
import type { CroppedFrame } from './image';
import type { InspectorParams } from './geometry';

const params: InspectorParams = {
  rows: 2,
  columns: 2,
  marginTop: 1,
  marginRight: 4,
  marginBottom: 3,
  marginLeft: 2,
  gapX: 2,
  gapY: 4,
  order: 'column',
};

function frame(index: number, x: number, y: number): CroppedFrame {
  return { index, x, y, width: 18, height: 10, dataUrl: `data:image/png;base64,FRAME${index}` };
}

describe('buildManifest', () => {
  it('帧按编号升序排列且字段与输入同源（画面与清单一致）', () => {
    const shuffled = [frame(4, 22, 15), frame(2, 2, 15), frame(1, 2, 1), frame(3, 22, 1)];
    const m = buildManifest('sheet.png', 44, 28, params, 18, 10, shuffled);

    expect(m.frames.map((f) => f.index)).toEqual([1, 2, 3, 4]);
    expect(m.frames[0]).toEqual({ index: 1, x: 2, y: 1, width: 18, height: 10, dataUrl: expect.any(String) });
    // 列优先：#2 在 #1 正下方，#3 换到右列
    expect([m.frames[1].x, m.frames[1].y]).toEqual([2, 15]);
    expect([m.frames[2].x, m.frames[2].y]).toEqual([22, 1]);
  });

  it('每个裁切区域在清单中只对应一个编号（无重复矩形、无重复编号）', () => {
    const frames = [frame(1, 2, 1), frame(2, 2, 15), frame(3, 22, 1), frame(4, 22, 15)];
    const m: Manifest = buildManifest('sheet.png', 44, 28, params, 18, 10, frames);
    const rectKeys = m.frames.map((f) => `${f.x},${f.y},${f.width},${f.height}`);
    expect(new Set(rectKeys).size).toBe(4);
    expect(new Set(m.frames.map((f) => f.index)).size).toBe(4);
    expect(m.image).toEqual({ name: 'sheet.png', width: 44, height: 28 });
    expect(m.frameWidth).toBe(18);
    expect(m.frameHeight).toBe(10);
  });
});
