/**
 * JSON 清单生成与下载。清单内容与界面上逐帧显示的信息同源，
 * 保证“画面与清单一致”；每个裁切区域（x,y,width,height）只对应一个编号。
 */

import type { CroppedFrame } from './image';
import type { InspectorParams, Order } from './geometry';

export interface Manifest {
  image: {
    name: string;
    width: number;
    height: number;
  };
  params: {
    rows: number;
    columns: number;
    marginTop: number;
    marginRight: number;
    marginBottom: number;
    marginLeft: number;
    gapX: number;
    gapY: number;
    /** "row" = 行优先（先列后行）；"column" = 列优先（先行后列） */
    order: Order;
  };
  frameWidth: number;
  frameHeight: number;
  /** 帧按编号升序排列；坐标原点为图片左上角，矩形含左上边、不含右下边 */
  frames: Array<{
    index: number;
    x: number;
    y: number;
    width: number;
    height: number;
    /** 裁切结果 PNG 的 data URL（data:image/png;base64,...） */
    dataUrl: string;
  }>;
}

export function buildManifest(
  imageName: string,
  imageWidth: number,
  imageHeight: number,
  params: InspectorParams,
  frameWidth: number,
  frameHeight: number,
  frames: CroppedFrame[],
): Manifest {
  const sorted = [...frames].sort((a, b) => a.index - b.index);
  return {
    image: { name: imageName, width: imageWidth, height: imageHeight },
    params: {
      rows: params.rows,
      columns: params.columns,
      marginTop: params.marginTop,
      marginRight: params.marginRight,
      marginBottom: params.marginBottom,
      marginLeft: params.marginLeft,
      gapX: params.gapX,
      gapY: params.gapY,
      order: params.order,
    },
    frameWidth,
    frameHeight,
    frames: sorted.map((f) => ({
      index: f.index,
      x: f.x,
      y: f.y,
      width: f.width,
      height: f.height,
      dataUrl: f.dataUrl,
    })),
  };
}

/** 在浏览器端触发清单文件下载，全程离线、无网络请求。 */
export function downloadManifest(manifest: Manifest, imageName: string): void {
  const json = JSON.stringify(manifest, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const base = imageName.replace(/\.png$/i, '') || 'spritesheet';
  a.href = url;
  a.download = `${base}.frames.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // 给浏览器一点时间发起下载后再回收
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
