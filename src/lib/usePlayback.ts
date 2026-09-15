/**
 * 把纯播放引擎接到 React：用 requestAnimationFrame 按目标时间推进，
 * 并对两类外部变化做出反应：
 *
 * 1. 新帧序列（切换编号顺序或修改裁切参数后重新裁切）：
 *    停止旧计时，状态回到 ready、停在新序列第 1 帧；
 * 2. 帧率输入变化：合法（1..30 整数）时更新帧率，播放中重新锚定节奏；
 *    非法（空 / 非整数 / 越界）时暂停动画并给出就地说明。
 *
 * 预览画面始终直接取当前编号顺序下的裁切帧（CroppedFrame），不复制像素。
 */
import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';
import type { CroppedFrame } from './image';
import {
  createPlayback,
  fpsErrorReason,
  parseFps,
  pause,
  play,
  resetForSequence,
  seek,
  tick,
  withFps,
  type PlaybackState,
} from './playback';

export const DEFAULT_FPS = 12;

export interface FpsState {
  ok: boolean;
  /** 合法时为 1..30 的整数；非法时保留默认值，不参与播放 */
  fps: number;
  /** 非法时面向用户的就地说明 */
  reason: string | null;
}

type Action =
  | { type: 'play'; now: number }
  | { type: 'pause' }
  | { type: 'tick'; now: number }
  | { type: 'reset'; frameCount: number; fps: number }
  | { type: 'setFps'; fps: number; now: number }
  | { type: 'seek'; position: number };

function reducer(state: PlaybackState, action: Action): PlaybackState {
  switch (action.type) {
    case 'play':
      return play(state, action.now);
    case 'pause':
      return pause(state);
    case 'tick':
      // 未到下一帧目标时间时引擎返回同一引用，React 会跳过重渲染
      return tick(state, action.now);
    case 'reset':
      return resetForSequence(action.frameCount, action.fps);
    case 'setFps':
      return withFps(state, action.fps, action.now);
    case 'seek':
      return seek(state, action.position);
  }
}

export interface FramePlayback {
  pb: PlaybackState;
  fpsState: FpsState;
  /** 当前应展示的裁切帧（与帧卡、清单同源）；无帧时为 null */
  currentFrame: CroppedFrame | null;
  /** 播放 / 暂停（同一个按钮按状态切换） */
  toggle: () => void;
  /** 跳到第 position+1 帧（夹取到范围内） */
  jumpTo: (position: number) => void;
}

export function useFramePlayback(frames: CroppedFrame[], fpsInput: string): FramePlayback {
  const [pb, dispatch] = useReducer(reducer, frames.length, (count) => createPlayback(count, DEFAULT_FPS));

  const fpsState = useMemo<FpsState>(() => {
    const parsed = parseFps(fpsInput);
    return parsed === null
      ? { ok: false, fps: DEFAULT_FPS, reason: fpsErrorReason(fpsInput) }
      : { ok: true, fps: parsed, reason: null };
  }, [fpsInput]);

  // 始终保存最新的合法帧率，供新序列重置时使用
  const fpsRef = useRef(fpsState);
  fpsRef.current = fpsState;

  // 帧序列签名：编号顺序 / 裁切参数 / 像素内容任一变化都会产生新签名。
  // dataUrl 纳入签名，保证换图但矩形恰好相同时也视为新序列。
  const signature = useMemo(
    () => frames.map((f) => `${f.index}:${f.x},${f.y},${f.width}x${f.height}:${f.dataUrl}`).join('|'),
    [frames],
  );

  // 新序列：停止旧计时，从第 1 帧、就绪状态开始（挂载时也执行一次，与初始态一致）
  useEffect(() => {
    const latest = fpsRef.current;
    dispatch({ type: 'reset', frameCount: frames.length, fps: latest.ok ? latest.fps : DEFAULT_FPS });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  // 帧率输入：合法则更新（播放中重新锚定），非法则暂停动画
  const fpsOk = fpsState.ok;
  const fpsValue = fpsState.fps;
  useEffect(() => {
    if (fpsOk) dispatch({ type: 'setFps', fps: fpsValue, now: performance.now() });
    else dispatch({ type: 'pause' });
  }, [fpsOk, fpsValue]);

  // 仅在播放中挂 rAF；tick 不到时刻时返回同引用，不引发重渲染
  const playing = pb.status === 'playing' && fpsState.ok && pb.frameCount > 0;
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const loop = (now: number) => {
      dispatch({ type: 'tick', now });
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  const pbRef = useRef(pb);
  pbRef.current = pb;

  const toggle = useCallback(() => {
    const latest = fpsRef.current;
    if (!latest.ok) return; // 帧率非法时禁止开始播放
    if (pbRef.current.status === 'playing') dispatch({ type: 'pause' });
    else dispatch({ type: 'play', now: performance.now() });
  }, []);

  const jumpTo = useCallback((position: number) => {
    dispatch({ type: 'seek', position });
  }, []);

  const currentFrame = pb.position >= 0 && pb.position < frames.length ? frames[pb.position] : null;

  return { pb, fpsState, currentFrame, toggle, jumpTo };
}
