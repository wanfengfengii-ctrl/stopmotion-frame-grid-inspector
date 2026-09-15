/**
 * 逐帧动画播放引擎（纯状态机 + 可控时钟，不依赖 React / DOM，便于单元测试）。
 *
 * 三个状态：
 * - ready（就绪）：新序列生成后停在第 1 帧；
 * - playing（播放中）：按目标时间推进，每个计时滴答最多前进一帧，末帧后循环回第 1 帧；
 * - paused（已暂停）：保留当前帧，等待继续或修改。
 *
 * 计时约定：调用方通过 now() 提供单调时间（毫秒）。tick(now) 依据
 * 「目标时间」(expectedTime) 推进——只有当真实经过时间达到一帧时长才前进，
 * 且一次只前进一帧（帧间隔保持节奏，后台标签卡造成的时间缺口不会跳多帧）。
 */

export type PlaybackStatus = 'ready' | 'playing' | 'paused';

export interface PlaybackState {
  status: PlaybackStatus;
  /** 当前帧在序列中的位置（0 基）；空序列时为 0 */
  position: number;
  /** 序列帧数 */
  frameCount: number;
  /** 每秒帧数（1..30 的整数） */
  fps: number;
  /** 最近一次推进所依据的目标时间（毫秒），ready 时为 null */
  expectedTime: number | null;
}

/** 一帧时长（毫秒）。fps 已由调用方保证为 1..30 的整数。 */
export function frameIntervalMs(fps: number): number {
  return 1000 / fps;
}

/** 构造停在第 1 帧的就绪状态。 */
export function createPlayback(frameCount: number, fps: number): PlaybackState {
  return {
    status: 'ready',
    position: 0,
    frameCount: Math.max(0, Math.trunc(frameCount)),
    fps,
    expectedTime: null,
  };
}

function withPosition(state: PlaybackState, position: number): PlaybackState {
  return position === state.position ? state : { ...state, position };
}

/** 从就绪或暂停开始播放；已在播放或无帧时原样返回。记录首帧目标时间。 */
export function play(state: PlaybackState, now: number): PlaybackState {
  if (state.status === 'playing' || state.frameCount === 0) return state;
  return { ...state, status: 'playing', expectedTime: now };
}

/** 暂停播放；本就不在播放时原样返回（保留位置与状态）。 */
export function pause(state: PlaybackState): PlaybackState {
  if (state.status !== 'playing') return state;
  return { ...state, status: 'paused' };
}

/**
 * 推进播放。仅在 playing 状态有效：自目标时间起每经过一个帧间隔前进一帧，
 * 一次最多前进一帧，末帧之后循环回第 1 帧。非播放状态（ready / paused）下
 * 时间流逝不改变画面。
 *
 * 若落后目标时间超过一个帧间隔（如后台标签卡造成的大缺口），前进一帧后把
 * 目标时间锚定到当前时刻，丢弃积压帧而不是连续快进，保证「一次只前进一帧」。
 */
export function tick(state: PlaybackState, now: number): PlaybackState {
  if (state.status !== 'playing' || state.frameCount === 0 || state.expectedTime === null) {
    return state;
  }
  const interval = frameIntervalMs(state.fps);
  if (now < state.expectedTime + interval) return state;
  const next = (state.position + 1) % state.frameCount;
  let nextExpected = state.expectedTime + interval;
  // 再走一帧的时刻也已到期 → 说明存在积压，锚定到当前时刻避免下一 tick 连走
  if (now >= nextExpected + interval) nextExpected = now;
  return { ...state, position: next, expectedTime: nextExpected };
}

/**
 * 序列变化（切换编号顺序或修改裁切参数产生新帧）时调用：
 * 停止旧计时并从新序列第 1 帧、就绪状态重新开始。
 */
export function resetForSequence(frameCount: number, fps: number): PlaybackState {
  return createPlayback(frameCount, fps);
}

/**
 * 调整帧率（1..30）。播放中调速会把目标时间重新锚定到当前时刻，
 * 使下一帧按新间隔到来，避免旧节奏造成的立即跳帧；不改变位置与状态。
 */
export function withFps(state: PlaybackState, fps: number, now: number): PlaybackState {
  if (state.fps === fps) return state;
  return {
    ...state,
    fps,
    expectedTime: state.status === 'playing' ? now : state.expectedTime,
  };
}

/** 跳到指定位置（夹取到 [0, frameCount)）；不改变播放状态。 */
export function seek(state: PlaybackState, position: number): PlaybackState {
  if (state.frameCount === 0) return state;
  const clamped = Math.min(state.frameCount - 1, Math.max(0, Math.trunc(position)));
  return withPosition(state, clamped);
}

export const MIN_FPS = 1;
export const MAX_FPS = 30;

/**
 * 解析每秒帧数输入。
 * 合法：1..30 的整数（字符串仅接受纯十进制整数，拒绝空白、小数、科学计数法）。
 * 非法（空、非整数、越界）返回 null，由调用方暂停动画并就地说明原因。
 */
export function parseFps(raw: string | number | null | undefined): number | null {
  if (raw === null || raw === undefined || raw === '') return null;
  if (typeof raw === 'string') {
    if (!/^-?\d+$/.test(raw)) return null;
    const n = Number(raw);
    if (!Number.isSafeInteger(n)) return null;
    return n >= MIN_FPS && n <= MAX_FPS ? n : null;
  }
  if (typeof raw === 'number') {
    return Number.isSafeInteger(raw) && raw >= MIN_FPS && raw <= MAX_FPS ? raw : null;
  }
  return null;
}

/** 帧率非法时给出面向用户的中文原因。 */
export function fpsErrorReason(raw: string): string {
  if (raw.trim() === '') return '帧率为空：请输入 1 至 30 之间的整数（帧/秒），动画已暂停';
  if (!/^-?\d+$/.test(raw.trim())) {
    return `帧率非整数：“${raw}” 不是整数，仅接受 1 至 30 的整数，动画已暂停`;
  }
  return `帧率越界：${raw.trim()} 不在 1 至 30 之间，动画已暂停`;
}
