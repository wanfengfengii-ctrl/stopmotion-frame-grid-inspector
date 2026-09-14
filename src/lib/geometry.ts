/**
 * 精灵图几何计算（纯函数，不依赖 DOM，便于单元测试）
 *
 * 坐标原点在图片左上角，x 向右、y 向下。
 * 帧矩形 [x, y, w, h] 含左上边、不含右下边（半开区间）。
 */

export type Order = 'row' | 'column';

export interface InspectorParams {
  /** 行数（正整数） */
  rows: number;
  /** 列数（正整数） */
  columns: number;
  marginTop: number;
  marginRight: number;
  marginBottom: number;
  marginLeft: number;
  /** 水平帧间距（非负整数，单位像素） */
  gapX: number;
  /** 垂直帧间距（非负整数，单位像素） */
  gapY: number;
  order: Order;
}

export interface FrameRect {
  /** 帧编号，从 1 开始 */
  index: number;
  /** 帧左上角到图片左边缘的距离（含左边） */
  x: number;
  /** 帧左上角到图片上边缘的距离（含上边） */
  y: number;
  width: number;
  height: number;
}

export interface ComputeResult {
  ok: boolean;
  /** 失败原因（ok 为 false 时存在），用于界面可见提示 */
  error?: string;
  frames?: FrameRect[];
  frameWidth?: number;
  frameHeight?: number;
  /** 有效区域（去掉四边距后的网格包围盒），供清单与调试使用 */
  area?: { x: number; y: number; width: number; height: number };
}

/**
 * 校验原始输入（可能为空字符串或非数字），返回规范化后的非负整数。
 * 返回 null 表示该字段缺失或非法。字符串仅接受纯十进制数字（拒绝空白、
 * 小数点、科学计数法等 Number() 会宽松接受的写法）；数字类型须为安全整数。
 */
export function parseNonNegativeInt(raw: string | number | null | undefined): number | null {
  if (raw === null || raw === undefined || raw === '') return null;
  if (typeof raw === 'string') {
    if (!/^\d+$/.test(raw)) return null;
    const n = Number(raw);
    return Number.isSafeInteger(n) && n >= 0 ? n : null;
  }
  if (typeof raw === 'number') {
    return Number.isSafeInteger(raw) && raw >= 0 ? raw : null;
  }
  return null;
}

/** 与 parseNonNegativeInt 相同，但额外要求为正（>= 1）。 */
export function parsePositiveInt(raw: string | number | null | undefined): number | null {
  const n = parseNonNegativeInt(raw);
  if (n === null) return null;
  return n >= 1 ? n : null;
}

/**
 * 根据图片尺寸与参数计算所有帧的裁切矩形。
 *
 * 有效宽度 = 图片宽度 - 左边距 - 右边距 - (列数 - 1) * 水平间距
 * 有效高度 = 图片高度 - 上边距 - 下边距 - (行数 - 1) * 垂直间距
 * 二者必须为正，且分别被列数、行数整除。
 */
export function computeFrames(imageWidth: number, imageHeight: number, p: InspectorParams): ComputeResult {
  const innerWidth = imageWidth - p.marginLeft - p.marginRight - (p.columns - 1) * p.gapX;
  const innerHeight = imageHeight - p.marginTop - p.marginBottom - (p.rows - 1) * p.gapY;

  if (innerWidth <= 0) {
    return {
      ok: false,
      error: `有效宽度非正（${innerWidth}）：图片宽度 ${imageWidth} 减去左右边距 ${p.marginLeft}+${p.marginRight} 与水平间距 ${p.columns - 1}×${p.gapX} 后必须大于 0`,
    };
  }
  if (innerHeight <= 0) {
    return {
      ok: false,
      error: `有效高度非正（${innerHeight}）：图片高度 ${imageHeight} 减去上下边距 ${p.marginTop}+${p.marginBottom} 与垂直间距 ${p.rows - 1}×${p.gapY} 后必须大于 0`,
    };
  }
  if (innerWidth % p.columns !== 0) {
    return {
      ok: false,
      error: `有效宽度 ${innerWidth} 不能被列数 ${p.columns} 整除（余 ${innerWidth % p.columns}），帧宽无法取精确整数`,
    };
  }
  if (innerHeight % p.rows !== 0) {
    return {
      ok: false,
      error: `有效高度 ${innerHeight} 不能被行数 ${p.rows} 整除（余 ${innerHeight % p.rows}），帧高无法取精确整数`,
    };
  }

  const frameWidth = innerWidth / p.columns;
  const frameHeight = innerHeight / p.rows;
  const area = { x: p.marginLeft, y: p.marginTop, width: innerWidth, height: innerHeight };

  const frames: FrameRect[] = [];
  for (let row = 0; row < p.rows; row++) {
    for (let col = 0; col < p.columns; col++) {
      const x = p.marginLeft + col * (frameWidth + p.gapX);
      const y = p.marginTop + row * (frameHeight + p.gapY);
      // 行优先：先列后行；列优先：先行后列
      const index = p.order === 'row' ? row * p.columns + col + 1 : col * p.rows + row + 1;
      frames.push({ index, x, y, width: frameWidth, height: frameHeight });
    }
  }
  frames.sort((a, b) => a.index - b.index);

  return { ok: true, frames, frameWidth, frameHeight, area };
}

/**
 * 边界检查：每帧矩形必须完整落在图片范围内。
 * 右下边为开区间，因此 x + width <= imageWidth、y + height <= imageHeight 合法。
 */
export function validateBounds(frames: FrameRect[], imageWidth: number, imageHeight: number): string | null {
  for (const f of frames) {
    if (f.x < 0 || f.y < 0 || f.width <= 0 || f.height <= 0) {
      return `帧 ${f.index} 的矩形参数非法（x=${f.x}, y=${f.y}, w=${f.width}, h=${f.height}）`;
    }
    if (f.x + f.width > imageWidth || f.y + f.height > imageHeight) {
      return `帧 ${f.index} 裁切越界：矩形 [${f.x}, ${f.y}, ${f.width}, ${f.height}] 超出图片范围 ${imageWidth}×${imageHeight}`;
    }
  }
  return null;
}
