/**
 * 测试用 PNG 生成器：仅依赖 Node 内置 zlib，手写 PNG 编码（RGBA, 8-bit）。
 * 生成的精灵图每个网格帧填充可预测的纯色，e2e 可直接采样裁切结果像素做比对。
 */
import zlib from 'node:zlib';

export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

const CRC_TABLE: number[] = (() => {
  const table: number[] = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buf) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

export function encodePng(width: number, height: number, pixels: Uint8ClampedArray | Buffer): Buffer {
  if (pixels.length !== width * height * 4) {
    throw new Error(`像素数据长度 ${pixels.length} 与尺寸 ${width}x${height} 不匹配`);
  }
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  // 每行前加 filter 字节 0
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    Buffer.from(pixels.buffer, pixels.byteOffset + y * width * 4, width * 4).copy(
      raw,
      y * (width * 4 + 1) + 1,
    );
  }
  const idat = zlib.deflateSync(raw);

  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

export interface SheetOptions {
  rows: number;
  columns: number;
  frameWidth: number;
  frameHeight: number;
  marginTop: number;
  marginRight: number;
  marginBottom: number;
  marginLeft: number;
  gapX: number;
  gapY: number;
}

/** 按与应用相同的布局公式构造每帧纯色、其余透明的精灵图。 */
export function makeSpriteSheet(opts: SheetOptions): { buffer: Buffer; width: number; height: number } {
  const { rows, columns, frameWidth: fw, frameHeight: fh } = opts;
  const width = opts.marginLeft + columns * fw + (columns - 1) * opts.gapX + opts.marginRight;
  const height = opts.marginTop + rows * fh + (rows - 1) * opts.gapY + opts.marginBottom;
  const px = Buffer.alloc(width * height * 4, 0); // 全透明

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < columns; col++) {
      const x0 = opts.marginLeft + col * (fw + opts.gapX);
      const y0 = opts.marginTop + row * (fh + opts.gapY);
      const color = frameColor(row, col);
      for (let y = y0; y < y0 + fh; y++) {
        for (let x = x0; x < x0 + fw; x++) {
          const i = (y * width + x) * 4;
          px[i] = color.r;
          px[i + 1] = color.g;
          px[i + 2] = color.b;
          px[i + 3] = color.a;
        }
      }
    }
  }
  return { buffer: encodePng(width, height, px), width, height };
}

/** 网格位置 → 确定的纯色（与行列一一对应，便于断言裁切区域是否正确）。 */
export function frameColor(row: number, col: number): Rgba {
  return {
    r: 40 + row * 60,
    g: 40 + col * 50,
    b: 120,
    a: 255,
  };
}

export const FIXTURE_LAYOUT: SheetOptions = {
  rows: 2,
  columns: 4,
  frameWidth: 10,
  frameHeight: 12,
  marginTop: 1,
  marginRight: 3,
  marginBottom: 4,
  marginLeft: 2,
  gapX: 2,
  gapY: 3,
};
