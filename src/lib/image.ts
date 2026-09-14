/**
 * 图片解码与逐帧裁切。全部走浏览器原生 API（createImageBitmap / Canvas），
 * 不发起任何网络请求，应用可完全离线运行。
 */

import type { FrameRect } from './geometry';

export interface DecodedImage {
  bitmap: ImageBitmap;
  width: number;
  height: number;
}

export interface CroppedFrame {
  index: number;
  x: number;
  y: number;
  width: number;
  height: number;
  /** 裁切结果的 PNG data URL，用于预览与清单内嵌 */
  dataUrl: string;
}

/** 解码用户选择的本地 PNG 文件；失败时抛出带中文说明的错误。 */
export async function decodePng(file: File): Promise<DecodedImage> {
  if (file.type !== '' && file.type !== 'image/png') {
    throw new Error(`图片解码失败：文件类型 “${file.type || '未知'}” 不是 image/png，请选择 PNG 文件`);
  }
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch (err) {
    throw new Error(`图片解码失败：${err instanceof Error ? err.message : String(err)}`);
  }
  if (bitmap.width <= 0 || bitmap.height <= 0) {
    bitmap.close();
    throw new Error('图片解码失败：解码出的图片尺寸为 0');
  }
  return { bitmap, width: bitmap.width, height: bitmap.height };
}

/**
 * 按帧矩形裁到离屏 canvas 上。矩形越界直接抛错（调用方应已做过边界校验，
 * 此处为最后一道防线，禁止静默裁出错误内容）。矩形含左上边、不含右下边，
 * 故 x + width === source.width 仍合法。
 */
export function cropFrameToCanvas(source: ImageBitmap, frame: FrameRect): HTMLCanvasElement {
  const sx = frame.x;
  const sy = frame.y;
  const sw = frame.width;
  const sh = frame.height;
  if (sx < 0 || sy < 0 || sw <= 0 || sh <= 0 || sx + sw > source.width || sy + sh > source.height) {
    throw new Error(
      `帧 ${frame.index} 裁切越界：矩形 [${sx}, ${sy}, ${sw}, ${sh}] 超出图片范围 ${source.width}×${source.height}`,
    );
  }

  const canvas = document.createElement('canvas');
  canvas.width = sw;
  canvas.height = sh;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error(`帧 ${frame.index} 裁切失败：无法创建 Canvas 2D 上下文`);
  ctx.drawImage(source, sx, sy, sw, sh, 0, 0, sw, sh);
  return canvas;
}

/** 批量裁切；任一帧失败立即抛错，不返回部分结果。 */
export function cropAllFrames(source: ImageBitmap, frames: FrameRect[]): CroppedFrame[] {
  return frames.map((frame) => {
    const canvas = cropFrameToCanvas(source, frame);
    return {
      index: frame.index,
      x: frame.x,
      y: frame.y,
      width: frame.width,
      height: frame.height,
      dataUrl: canvas.toDataURL('image/png'),
    };
  });
}
