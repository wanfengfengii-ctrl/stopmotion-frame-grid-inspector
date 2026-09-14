import { describe, expect, it } from 'vitest';
import {
  computeFrames,
  parseNonNegativeInt,
  parsePositiveInt,
  validateBounds,
  type FrameRect,
  type InspectorParams,
} from './geometry';

const baseParams: InspectorParams = {
  rows: 2,
  columns: 3,
  marginTop: 0,
  marginRight: 0,
  marginBottom: 0,
  marginLeft: 0,
  gapX: 0,
  gapY: 0,
  order: 'row',
};

describe('parsePositiveInt / parseNonNegativeInt', () => {
  it('接受合法整数字符串与数字', () => {
    expect(parsePositiveInt('1')).toBe(1);
    expect(parsePositiveInt(42)).toBe(42);
    expect(parseNonNegativeInt('0')).toBe(0);
    expect(parseNonNegativeInt(0)).toBe(0);
  });

  it('拒绝空值、小数、负数、非数字与科学计数意外输入', () => {
    expect(parsePositiveInt('')).toBeNull();
    expect(parsePositiveInt(undefined)).toBeNull();
    expect(parsePositiveInt('0')).toBeNull();
    expect(parsePositiveInt('-1')).toBeNull();
    expect(parsePositiveInt('1.5')).toBeNull();
    expect(parsePositiveInt('abc')).toBeNull();
    expect(parsePositiveInt(' 3')).toBeNull();
    expect(parseNonNegativeInt('-0.1')).toBeNull();
    expect(parseNonNegativeInt(NaN)).toBeNull();
    expect(parseNonNegativeInt(Infinity)).toBeNull();
  });
});

describe('computeFrames 基本公式', () => {
  it('无边距无间距时均匀切满整张图', () => {
    const r = computeFrames(60, 40, { ...baseParams });
    expect(r.ok).toBe(true);
    expect(r.frameWidth).toBe(20);
    expect(r.frameHeight).toBe(20);
    expect(r.frames).toHaveLength(6);
    expect(r.frames).toEqual([
      { index: 1, x: 0, y: 0, width: 20, height: 20 },
      { index: 2, x: 20, y: 0, width: 20, height: 20 },
      { index: 3, x: 40, y: 0, width: 20, height: 20 },
      { index: 4, x: 0, y: 20, width: 20, height: 20 },
      { index: 5, x: 20, y: 20, width: 20, height: 20 },
      { index: 6, x: 40, y: 20, width: 20, height: 20 },
    ]);
  });

  it('按公式扣除四边距与（列数-1）倍水平间距、（行数-1）倍垂直间距', () => {
    const r = computeFrames(100, 80, {
      ...baseParams,
      marginTop: 5,
      marginRight: 7,
      marginBottom: 9,
      marginLeft: 3,
      gapX: 4,
      gapY: 6,
    });
    // 有效宽 = 100 - 3 - 7 - 2*4 = 82，帧宽 = 82/3 … 不能整除
    expect(r.ok).toBe(false);
    expect(r.error).toContain('不能被列数 3 整除');

    const ok = computeFrames(98, 80, {
      ...baseParams,
      marginTop: 5,
      marginRight: 7,
      marginBottom: 9,
      marginLeft: 3,
      gapX: 4,
      gapY: 6,
    });
    // 有效宽 = 98-3-7-8 = 80，帧宽 26… 80/3 不行，改 columns
    expect(ok.ok).toBe(false);

    const good = computeFrames(94, 80, {
      rows: 2,
      columns: 2,
      marginTop: 5,
      marginRight: 7,
      marginBottom: 9,
      marginLeft: 3,
      gapX: 4,
      gapY: 6,
      order: 'row',
    });
    // 宽 = 94-3-7-4 = 80，帧宽 40；高 = 80-5-9-6 = 60，帧高 30
    expect(good.ok).toBe(true);
    expect(good.frameWidth).toBe(40);
    expect(good.frameHeight).toBe(30);
    expect(good.area).toEqual({ x: 3, y: 5, width: 80, height: 60 });
    expect(good.frames).toEqual([
      { index: 1, x: 3, y: 5, width: 40, height: 30 },
      { index: 2, x: 47, y: 5, width: 40, height: 30 },
      { index: 3, x: 3, y: 41, width: 40, height: 30 },
      { index: 4, x: 47, y: 41, width: 40, height: 30 },
    ]);
  });
});

describe('computeFrames 非法输入必须失败并给出原因', () => {
  it('有效宽度为 0 或负时报错', () => {
    const r = computeFrames(10, 40, { ...baseParams, marginLeft: 6, marginRight: 6 });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/有效宽度非正/);
    expect(r.frames).toBeUndefined();
  });

  it('有效高度为 0 或负时报错', () => {
    const r = computeFrames(60, 10, { ...baseParams, marginTop: 6, marginBottom: 6 });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/有效高度非正/);
  });

  it('水平间距把有效宽度挤没时报错', () => {
    const r = computeFrames(10, 40, { ...baseParams, columns: 3, gapX: 5 });
    // 10 - 2*5 = 0
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/有效宽度非正/);
  });

  it('不能整除时报错并显示余数', () => {
    const w = computeFrames(58, 40, baseParams); // 58/3 余 1
    expect(w.ok).toBe(false);
    expect(w.error).toContain('余 1');
    const h = computeFrames(60, 41, baseParams); // 41/2 余 1
    expect(h.ok).toBe(false);
    expect(h.error).toContain('余 1');
  });

  it('单帧（1x1）时间距不参与计算，任意可容纳尺寸都合法', () => {
    const r = computeFrames(5, 8, { ...baseParams, rows: 1, columns: 1, gapX: 99, gapY: 99 });
    expect(r.ok).toBe(true);
    expect(r.frames).toEqual([{ index: 1, x: 0, y: 0, width: 5, height: 8 }]);
  });
});

describe('坐标边界（半开区间：含左上边、不含右下边）', () => {
  it('最右列右边与最下行下边恰好等于图片尺寸时合法', () => {
    const r = computeFrames(30, 20, { ...baseParams, columns: 3, rows: 2 });
    expect(r.ok).toBe(true);
    const err = validateBounds(r.frames!, 30, 20);
    expect(err).toBeNull();
    const last = r.frames!.find((f) => f.index === 6)!;
    expect(last.x + last.width).toBe(30);
    expect(last.y + last.height).toBe(20);
  });

  it('带边距时帧的右下边不越过图片右下边', () => {
    const r = computeFrames(36, 28, {
      ...baseParams,
      rows: 2,
      columns: 3,
      marginLeft: 2,
      marginRight: 4,
      marginTop: 1,
      marginBottom: 3,
      gapX: 1,
      gapY: 2,
    });
    // 有效宽 = 36-2-4-2 = 28，帧宽 28/3 不整除 → 调整
    expect(r.ok).toBe(false);
    const ok = computeFrames(38, 28, {
      rows: 2,
      columns: 3,
      marginLeft: 2,
      marginRight: 4,
      marginTop: 1,
      marginBottom: 3,
      gapX: 1,
      gapY: 2,
      order: 'row',
    });
    // 有效宽 = 38-2-4-2 = 30，帧宽 10；有效高 = 28-1-3-2 = 22，帧高 11
    expect(ok.ok).toBe(true);
    expect(validateBounds(ok.frames!, 38, 28)).toBeNull();
    const rightBottom = ok.frames!.find((f) => f.index === 6)!;
    expect(rightBottom.x + rightBottom.width).toBe(38 - 4);
    expect(rightBottom.y + rightBottom.height).toBe(28 - 3);
  });

  it('validateBounds 对越过右边界或下边界的矩形报错并指出帧号', () => {
    const frames: FrameRect[] = [
      { index: 1, x: 0, y: 0, width: 10, height: 10 },
      { index: 2, x: 21, y: 0, width: 10, height: 10 }, // 右边 31 > 30
    ];
    expect(validateBounds(frames, 30, 20)).toMatch(/帧 2 裁切越界/);
    const below: FrameRect[] = [{ index: 3, x: 0, y: 15, width: 5, height: 6 }];
    expect(validateBounds(below, 30, 20)).toMatch(/帧 3 裁切越界/);
  });

  it('负数起点或非正宽高被判为非法', () => {
    expect(validateBounds([{ index: 1, x: -1, y: 0, width: 2, height: 2 }], 10, 10)).toMatch(/帧 1/);
    expect(validateBounds([{ index: 2, x: 0, y: 0, width: 0, height: 2 }], 10, 10)).toMatch(/帧 2/);
  });
});

describe('行优先与列优先编号', () => {
  it('行优先：先列后行，编号逐行递增', () => {
    const r = computeFrames(30, 20, { ...baseParams, rows: 2, columns: 3, order: 'row' });
    const byIndex = new Map(r.frames!.map((f) => [f.index, f]));
    // #1 左上，#3 右上，#4 左下，#6 右下
    expect([byIndex.get(1)!.x, byIndex.get(1)!.y]).toEqual([0, 0]);
    expect([byIndex.get(3)!.x, byIndex.get(3)!.y]).toEqual([20, 0]);
    expect([byIndex.get(4)!.x, byIndex.get(4)!.y]).toEqual([0, 10]);
    expect([byIndex.get(6)!.x, byIndex.get(6)!.y]).toEqual([20, 10]);
  });

  it('列优先：先行后列，编号逐列递增', () => {
    const r = computeFrames(30, 20, { ...baseParams, rows: 2, columns: 3, order: 'column' });
    const byIndex = new Map(r.frames!.map((f) => [f.index, f]));
    // #1 左上，#2 左下，#3 中上，#4 中下，#5 右上，#6 右下
    expect([byIndex.get(1)!.x, byIndex.get(1)!.y]).toEqual([0, 0]);
    expect([byIndex.get(2)!.x, byIndex.get(2)!.y]).toEqual([0, 10]);
    expect([byIndex.get(3)!.x, byIndex.get(3)!.y]).toEqual([10, 0]);
    expect([byIndex.get(5)!.x, byIndex.get(5)!.y]).toEqual([20, 0]);
    expect([byIndex.get(6)!.x, byIndex.get(6)!.y]).toEqual([20, 10]);
  });

  it('两种顺序下矩形集合完全相同（同一裁切区域只对应一个编号）', () => {
    const row = computeFrames(30, 20, { ...baseParams, order: 'row' });
    const col = computeFrames(30, 20, { ...baseParams, order: 'column' });
    const key = (f: FrameRect) => `${f.x},${f.y},${f.width},${f.height}`;
    const rowRects = new Set(row.frames!.map(key));
    const colRects = new Set(col.frames!.map(key));
    expect(rowRects.size).toBe(6);
    expect(colRects.size).toBe(6);
    expect(colRects).toEqual(rowRects);
    // 每个矩形在每种顺序内只出现一次
    expect(new Set(row.frames!.map(key)).size).toBe(row.frames!.length);
    // 编号都是 1..N 的排列
    expect(row.frames!.map((f) => f.index).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(col.frames!.map((f) => f.index).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6]);
  });
});
