import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  computeFrames,
  parseNonNegativeInt,
  parsePositiveInt,
  validateBounds,
  type InspectorParams,
  type Order,
} from './lib/geometry';
import { cropAllFrames, decodePng, type CroppedFrame, type DecodedImage } from './lib/image';
import { buildManifest, downloadManifest } from './lib/manifest';
import { FramePlayer } from './components/FramePlayer';

interface FormState {
  rows: string;
  columns: string;
  marginTop: string;
  marginRight: string;
  marginBottom: string;
  marginLeft: string;
  gapX: string;
  gapY: string;
}

const INITIAL_FORM: FormState = {
  rows: '2',
  columns: '2',
  marginTop: '0',
  marginRight: '0',
  marginBottom: '0',
  marginLeft: '0',
  gapX: '0',
  gapY: '0',
};

const NUMBER_FIELDS: Array<{ key: keyof FormState; label: string; positive: boolean; hint: string }> = [
  { key: 'rows', label: '行数', positive: true, hint: '正整数' },
  { key: 'columns', label: '列数', positive: true, hint: '正整数' },
  { key: 'marginTop', label: '上边距', positive: false, hint: '非负整数（像素）' },
  { key: 'marginRight', label: '右边距', positive: false, hint: '非负整数（像素）' },
  { key: 'marginBottom', label: '下边距', positive: false, hint: '非负整数（像素）' },
  { key: 'marginLeft', label: '左边距', positive: false, hint: '非负整数（像素）' },
  { key: 'gapX', label: '水平帧间距', positive: false, hint: '非负整数（像素）' },
  { key: 'gapY', label: '垂直帧间距', positive: false, hint: '非负整数（像素）' },
];

export function App() {
  const [imageName, setImageName] = useState<string>('');
  const [decoded, setDecoded] = useState<DecodedImage | null>(null);
  const [decodeError, setDecodeError] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(INITIAL_FORM);
  const [order, setOrder] = useState<Order>('row');

  // 最近一次合法计算的结果；任何非法情况都会被清空
  const [frames, setFrames] = useState<CroppedFrame[]>([]);
  const [frameSize, setFrameSize] = useState<{ width: number; height: number } | null>(null);
  const [params, setParams] = useState<InspectorParams | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const bitmapRef = useRef<ImageBitmap | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(async (file: File | null | undefined) => {
    if (!file) return;
    setBusy(true);
    setDecodeError(null);
    try {
      const img = await decodePng(file);
      // 释放上一张图
      if (bitmapRef.current) bitmapRef.current.close();
      bitmapRef.current = img.bitmap;
      setImageName(file.name);
      setDecoded(img);
    } catch (err) {
      // 解码失败：清空旧帧并说明原因
      if (bitmapRef.current) {
        bitmapRef.current.close();
        bitmapRef.current = null;
      }
      setDecoded(null);
      setImageName(file.name);
      setFrames([]);
      setFrameSize(null);
      setParams(null);
      setDecodeError(err instanceof Error ? err.message : `图片解码失败：${String(err)}`);
    } finally {
      setBusy(false);
    }
  }, []);

  // 表单或图片一变就重新计算；任何一步失败都清空旧帧
  useEffect(() => {
    if (!decoded) {
      setFrames([]);
      setFrameSize(null);
      setParams(null);
      if (!decodeError) setError(null);
      return;
    }

    const fail = (message: string) => {
      setError(message);
      setFrames([]);
      setFrameSize(null);
      setParams(null);
    };

    const rows = parsePositiveInt(form.rows);
    if (rows === null) return fail('参数非法：行数必须为正整数（≥ 1 的整数）');
    const columns = parsePositiveInt(form.columns);
    if (columns === null) return fail('参数非法：列数必须为正整数（≥ 1 的整数）');

    const margins: Record<string, number | null> = {};
    for (const key of ['marginTop', 'marginRight', 'marginBottom', 'marginLeft', 'gapX', 'gapY'] as const) {
      margins[key] = parseNonNegativeInt(form[key]);
      if (margins[key] === null) {
        const def = NUMBER_FIELDS.find((f) => f.key === key)!;
        return fail(`参数非法：${def.label}必须为非负整数（≥ 0 的整数），当前为 “${form[key]}”`);
      }
    }

    const nextParams: InspectorParams = {
      rows,
      columns,
      marginTop: margins.marginTop!,
      marginRight: margins.marginRight!,
      marginBottom: margins.marginBottom!,
      marginLeft: margins.marginLeft!,
      gapX: margins.gapX!,
      gapY: margins.gapY!,
      order,
    };

    const result = computeFrames(decoded.width, decoded.height, nextParams);
    if (!result.ok || !result.frames) return fail(result.error ?? '计算失败');

    const boundError = validateBounds(result.frames, decoded.width, decoded.height);
    if (boundError) return fail(boundError);

    try {
      const cropped = cropAllFrames(decoded.bitmap, result.frames);
      setFrames(cropped);
      setFrameSize({ width: result.frameWidth!, height: result.frameHeight! });
      setParams(nextParams);
      setError(null);
    } catch (err) {
      return fail(err instanceof Error ? err.message : `裁切越界：${String(err)}`);
    }
  }, [decoded, form, order, decodeError]);

  // 注：位图在替换或解码失败时于 handleFile 中显式 close；
  // 不在卸载清理里 close，因为开发环境 StrictMode 会模拟一次卸载/重挂，
  // 关闭后重挂会让仍在状态中的位图失效。页面关闭时浏览器会回收资源。

  const valid = decoded !== null && error === null && decodeError === null && frames.length > 0;

  const manifest = useMemo(() => {
    if (!valid || !decoded || !params || !frameSize) return null;
    return buildManifest(imageName, decoded.width, decoded.height, params, frameSize.width, frameSize.height, frames);
  }, [valid, decoded, params, frameSize, frames, imageName]);

  const handleDownload = useCallback(() => {
    if (manifest) downloadManifest(manifest, imageName);
  }, [manifest, imageName]);

  const shownError = decodeError ?? error;

  return (
    <div className="app">
      <header>
        <h1>精灵图裁切检查器</h1>
        <p className="subtitle">
          完全离线运行 · 坐标原点在图片左上角 · 帧矩形含左上边、不含右下边 · 编号从 1 开始
        </p>
      </header>

      <section className="panel" aria-label="图片与参数">
        <div className="upload-row">
          <label className="upload-label">
            <span>PNG 精灵图</span>
            <input
              ref={fileInputRef}
              id="file-input"
              data-testid="file-input"
              type="file"
              accept="image/png,.png"
              // 允许再次选择同一个文件（否则不会触发 change）
              onClick={(e) => {
                e.currentTarget.value = '';
              }}
              onChange={(e) => handleFile(e.target.files?.[0])}
            />
          </label>
          {imageName && (
            <span className="file-meta" data-testid="file-meta">
              {imageName}
              {decoded ? `（${decoded.width} × ${decoded.height}）` : ''}
              {busy ? ' · 解码中…' : ''}
            </span>
          )}
        </div>

        <div className="form-grid">
          {NUMBER_FIELDS.map(({ key, label, hint }) => (
            <label key={key} className="field">
              <span>{label}</span>
              <input
                data-testid={key}
                type="number"
                min={key === 'rows' || key === 'columns' ? 1 : 0}
                step={1}
                value={form[key]}
                onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
              />
              <small>{hint}</small>
            </label>
          ))}
        </div>

        <fieldset className="order-field">
          <legend>编号顺序</legend>
          <label>
            <input
              type="radio"
              name="order"
              value="row"
              data-testid="order-row"
              checked={order === 'row'}
              onChange={() => setOrder('row')}
            />
            行优先（先列后行）
          </label>
          <label>
            <input
              type="radio"
              name="order"
              value="column"
              data-testid="order-column"
              checked={order === 'column'}
              onChange={() => setOrder('column')}
            />
            列优先（先行后列）
          </label>
        </fieldset>
      </section>

      {shownError && (
        <div className="error-box" role="alert" data-testid="error">
          {shownError}
        </div>
      )}

      {valid && decoded && params && frameSize && manifest && (
        <>
          <section className="panel" aria-label="总览与清单">
            <div className="summary" data-testid="summary">
              共 {frames.length} 帧，每帧 {frameSize.width} × {frameSize.height}；有效区域起点 (
              {params.marginLeft}, {params.marginTop})，顺序：
              {order === 'row' ? '行优先（先列后行）' : '列优先（先行后列）'}
            </div>
            <button type="button" data-testid="download-json" onClick={handleDownload}>
              下载 JSON 清单
            </button>
            <details>
              <summary>预览清单内容</summary>
              <pre className="manifest-pre" data-testid="manifest">
                {JSON.stringify(manifest, null, 2)}
              </pre>
            </details>
            <FrameOverlay decoded={decoded} frames={frames} />
          </section>

          <FramePlayer frames={frames} />

          <section className="frames" aria-label="逐帧裁切结果">
            {frames.map((frame) => (
              <figure key={frame.index} className="frame-card" data-testid="frame-card" data-index={frame.index}>
                <img src={frame.dataUrl} alt={`帧 ${frame.index} 裁切图`} width={frame.width} height={frame.height} />
                <figcaption>
                  <span className="frame-index" data-testid="frame-index">
                    #{frame.index}
                  </span>
                  <span className="frame-coords" data-testid="frame-coords">
                    x={frame.x}, y={frame.y}, w={frame.width}, h={frame.height}
                  </span>
                </figcaption>
              </figure>
            ))}
          </section>
        </>
      )}

      {!shownError && !valid && (
        <div className="hint" data-testid="empty-hint">
          请上传本地 PNG，并用正整数 / 非负整数填写行列数、边距与帧间距；参数全部合法后在此逐帧显示裁切结果。
        </div>
      )}
    </div>
  );
}

/** 在原图上叠加帧框与编号，帮助检查是否漏裁一列。 */
function FrameOverlay({ decoded, frames }: { decoded: DecodedImage; frames: CroppedFrame[] }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    canvas.width = decoded.width;
    canvas.height = decoded.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(decoded.bitmap, 0, 0);
    const fontSize = Math.max(10, Math.round(Math.min(decoded.width, decoded.height) / 24));
    ctx.font = `bold ${fontSize}px sans-serif`;
    ctx.textBaseline = 'top';
    for (const f of frames) {
      ctx.lineWidth = Math.max(1, Math.round(fontSize / 8));
      ctx.strokeStyle = '#ff2d78';
      ctx.strokeRect(f.x + 0.5, f.y + 0.5, f.width - 1, f.height - 1);
      const label = String(f.index);
      const pad = Math.round(fontSize / 6);
      const tw = ctx.measureText(label).width + pad * 2;
      ctx.fillStyle = '#ff2d78';
      ctx.fillRect(f.x, f.y, tw, fontSize + pad * 2);
      ctx.fillStyle = '#fff';
      ctx.fillText(label, f.x + pad, f.y + pad);
    }
  }, [decoded, frames]);

  return (
    <div className="overlay-wrap">
      <canvas ref={ref} data-testid="overlay" />
      <small>红色线框为裁切区域（含左上边、不含右下边），数字为帧编号。</small>
    </div>
  );
}
