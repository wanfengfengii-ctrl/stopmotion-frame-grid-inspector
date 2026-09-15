/**
 * 逐帧动画预览：始终复用当前编号顺序下的裁切帧（同一批 CroppedFrame，
 * 不另做裁切、不复制像素）。合法帧生成后停在第 1 帧；播放/暂停同一按钮
 * 切换，每秒帧数输入框调速（1..30），末帧循环回第 1 帧。
 *
 * 帧率非法（空 / 非整数 / 越界）只就地提示并暂停动画，不影响帧卡、总览
 * 与 JSON 下载；图片解码或几何校验失败时本组件随结果区一同卸载，
 * 不残留失效帧。
 */
import { useState } from 'react';
import type { CroppedFrame } from '../lib/image';
import { DEFAULT_FPS, useFramePlayback } from '../lib/usePlayback';

const STATUS_TEXT: Record<'ready' | 'playing' | 'paused', string> = {
  ready: '就绪',
  playing: '播放中',
  paused: '已暂停',
};

export function FramePlayer({ frames }: { frames: CroppedFrame[] }) {
  const [fpsInput, setFpsInput] = useState(String(DEFAULT_FPS));
  const { pb, fpsState, currentFrame, toggle, jumpTo } = useFramePlayback(frames, fpsInput);

  const playing = pb.status === 'playing';
  const frameCount = frames.length;

  return (
    <section className="panel player" aria-label="逐帧动画预览">
      <div className="player-head">
        <h2>动作连贯性预览</h2>
        <span
          className={`player-status status-${pb.status}`}
          data-testid="playback-status"
          data-status={pb.status}
        >
          {STATUS_TEXT[pb.status]}
        </span>
      </div>

      <div className="player-stage">
        {currentFrame && (
          <img
            key={currentFrame.dataUrl}
            src={currentFrame.dataUrl}
            alt={`动画预览：帧 ${currentFrame.index}`}
            data-testid="player-frame-img"
            width={currentFrame.width}
            height={currentFrame.height}
          />
        )}
      </div>

      <div className="player-controls">
        <button
          type="button"
          className="play-toggle"
          data-testid="play-toggle"
          data-playing={playing ? 'true' : 'false'}
          aria-pressed={playing}
          onClick={toggle}
          // 帧率非法时可点（用于把已暂停状态收束），但不会开始播放
          disabled={frameCount === 0}
        >
          {playing ? '暂停' : '播放'}
        </button>

        <label className="fps-field">
          <span>每秒帧数</span>
          <input
            data-testid="fps"
            type="number"
            min={1}
            max={30}
            step={1}
            value={fpsInput}
            aria-invalid={fpsState.ok ? undefined : 'true'}
            onChange={(e) => setFpsInput(e.target.value)}
          />
          <small>1 至 30 的整数（帧/秒）</small>
        </label>

        <span className="player-counter" data-testid="player-counter">
          第 {currentFrame ? currentFrame.index : 0} / {frameCount} 帧
          {currentFrame ? `（x=${currentFrame.x}, y=${currentFrame.y}）` : ''}
        </span>
      </div>

      {fpsState.reason && (
        <div className="fps-warning" role="status" data-testid="fps-error">
          {fpsState.reason}
        </div>
      )}

      <div className="player-dots" role="group" aria-label="选择帧">
        {frames.map((f, i) => (
          <button
            key={f.index}
            type="button"
            className={`player-dot${i === pb.position ? ' active' : ''}`}
            data-testid="player-dot"
            data-index={f.index}
            aria-label={`跳到第 ${f.index} 帧`}
            aria-current={i === pb.position}
            onClick={() => jumpTo(i)}
          >
            {f.index}
          </button>
        ))}
      </div>
    </section>
  );
}
