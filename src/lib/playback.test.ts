import { describe, expect, it } from 'vitest';
import {
  MAX_FPS,
  MIN_FPS,
  createPlayback,
  fpsErrorReason,
  parseFps,
  pause,
  play,
  resetForSequence,
  seek,
  tick,
  frameIntervalMs,
  type PlaybackState,
} from './playback';

/** 可控时钟：手动推进，返回当前时间，便于精确断言帧序而不依赖真实定时器。 */
class FakeClock {
  private t = 0;
  now = () => this.t;
  advance(ms: number) {
    this.t += ms;
  }
}

/** 从指定状态连续 tick 到时钟当前时刻，收集每次 tick 后的 0 基位置。 */
function runTicks(start: PlaybackState, clock: FakeClock, steps: number): number[] {
  const positions: number[] = [];
  let state = start;
  for (let i = 0; i < steps; i++) {
    state = tick(state, clock.now());
    positions.push(state.position);
  }
  return positions;
}

describe('createPlayback 初始状态', () => {
  it('新序列停在第 1 帧（位置 0）且状态为就绪', () => {
    const s = createPlayback(4, 10);
    expect(s.status).toBe('ready');
    expect(s.position).toBe(0);
    expect(s.frameCount).toBe(4);
    expect(s.fps).toBe(10);
    expect(s.expectedTime).toBeNull();
  });

  it('空序列帧数为 0', () => {
    expect(createPlayback(0, 10).frameCount).toBe(0);
  });
});

describe('play / pause 状态迁移', () => {
  it('ready 播放后变为 playing 并记录目标时间', () => {
    const clock = new FakeClock();
    const playing = play(createPlayback(3, 10), clock.now());
    expect(playing.status).toBe('playing');
    expect(playing.expectedTime).toBe(0);
    // 刚播放的同一时刻不应立即前进
    expect(tick(playing, clock.now()).position).toBe(0);
  });

  it('playing 暂停后变为 paused 并保留当前帧', () => {
    const clock = new FakeClock();
    let s = play(createPlayback(3, 10), clock.now());
    clock.advance(frameIntervalMs(10));
    s = tick(s, clock.now());
    expect(s.position).toBe(1);
    const paused = pause(s);
    expect(paused.status).toBe('paused');
    expect(paused.position).toBe(1);
  });

  it('已暂停时继续播放沿用新的目标时间，且暂停期间时间不计入', () => {
    const clock = new FakeClock();
    let s = play(createPlayback(3, 10), clock.now());
    clock.advance(frameIntervalMs(10));
    s = tick(s, clock.now()); // 位置 1
    s = pause(s);
    // 暂停很久：时间流逝不应推进
    clock.advance(10_000);
    s = tick(s, clock.now());
    expect(s.status).toBe('paused');
    expect(s.position).toBe(1);
    // 恢复：以恢复时刻重新锚定，再走一个间隔到位置 2
    s = play(s, clock.now());
    clock.advance(frameIntervalMs(10));
    s = tick(s, clock.now());
    expect(s.position).toBe(2);
  });

  it('ready 状态下时间流逝不前进帧', () => {
    const clock = new FakeClock();
    const ready = createPlayback(3, 10);
    clock.advance(5_000);
    expect(tick(ready, clock.now()).position).toBe(0);
    expect(tick(ready, clock.now()).status).toBe('ready');
  });

  it('对已在播放的状态再次 play 原样返回，空序列无法播放', () => {
    const s = play(createPlayback(2, 10), 0);
    expect(play(s, 100)).toBe(s);
    const empty = play(createPlayback(0, 10), 0);
    expect(empty.status).toBe('ready');
  });

  it('对非播放状态 pause 原样返回', () => {
    const ready = createPlayback(2, 10);
    expect(pause(ready)).toBe(ready);
    const paused = pause(play(ready, 0));
    expect(pause(paused)).toBe(paused);
  });
});

describe('tick 顺序推进与循环', () => {
  it('每经过一个帧间隔恰好前进一帧，按编号顺序 1→N', () => {
    const clock = new FakeClock();
    let s = play(createPlayback(4, 10), clock.now());
    const seen: number[] = [s.position];
    // 每个帧间隔推进一次，逐 tick 收集
    for (let i = 0; i < 3; i++) {
      clock.advance(frameIntervalMs(10));
      s = tick(s, clock.now());
      seen.push(s.position);
    }
    expect(seen).toEqual([0, 1, 2, 3]);
  });

  it('未到下一帧目标时间时不前进（一次只前进一帧）', () => {
    const clock = new FakeClock();
    let s = play(createPlayback(4, 10), clock.now());
    clock.advance(frameIntervalMs(10) - 1);
    s = tick(s, clock.now());
    expect(s.position).toBe(0);
    clock.advance(1);
    s = tick(s, clock.now());
    expect(s.position).toBe(1);
  });

  it('末帧之后循环回第 1 帧', () => {
    const clock = new FakeClock();
    let s = play(createPlayback(3, 10), clock.now());
    for (let i = 0; i < 3; i++) {
      clock.advance(frameIntervalMs(10));
      s = tick(s, clock.now());
    }
    // 0→1→2→0
    expect(s.position).toBe(0);
    expect(s.status).toBe('playing');
    // 循环后仍能继续推进
    clock.advance(frameIntervalMs(10));
    s = tick(s, clock.now());
    expect(s.position).toBe(1);
  });

  it('长时间缺口也只前进一帧（锚定目标时间，不跳帧）', () => {
    const clock = new FakeClock();
    let s = play(createPlayback(4, 1), clock.now()); // 每帧 1000ms
    clock.advance(100_000); // 模拟后台标签卡造成的巨大时间缺口
    s = tick(s, clock.now());
    expect(s.position).toBe(1); // 只走一帧
    // 目标时间只滚一个间隔；下一次 tick（同一时刻）不会连走
    s = tick(s, clock.now());
    expect(s.position).toBe(1);
  });

  it('以 30fps 播放时帧间隔为 1000/30 ms', () => {
    const clock = new FakeClock();
    let s = play(createPlayback(2, 30), clock.now());
    clock.advance(frameIntervalMs(30) - 0.01);
    s = tick(s, clock.now());
    expect(s.position).toBe(0);
    clock.advance(0.01);
    s = tick(s, clock.now());
    expect(s.position).toBe(1);
  });

  it('单帧序列循环后位置恒为 0', () => {
    const clock = new FakeClock();
    let s = play(createPlayback(1, 10), clock.now());
    clock.advance(frameIntervalMs(10));
    s = tick(s, clock.now());
    expect(s.position).toBe(0);
  });

  it('连续多次 tick 不到时刻保持静止', () => {
    const clock = new FakeClock();
    const s = play(createPlayback(4, 10), clock.now());
    expect(runTicks(s, clock, 5)).toEqual([0, 0, 0, 0, 0]);
  });
});

describe('调速改变帧间隔', () => {
  it('不同 fps 的帧间隔正确', () => {
    expect(frameIntervalMs(1)).toBe(1000);
    expect(frameIntervalMs(10)).toBe(100);
    expect(frameIntervalMs(30)).toBeCloseTo(33.333, 2);
  });
});

describe('resetForSequence 新序列', () => {
  it('切换序列时停止旧计时，从新序列第 1 帧、就绪状态开始', () => {
    const clock = new FakeClock();
    let s = play(createPlayback(4, 10), clock.now());
    // 每个真实帧边界推进一次时钟再 tick（与 rAF 每帧一个时间戳一致）
    clock.advance(frameIntervalMs(10));
    s = tick(s, clock.now());
    clock.advance(frameIntervalMs(10));
    s = tick(s, clock.now());
    expect(s.position).toBe(2);
    // 模拟切顺序 / 改裁切参数产生 6 帧新序列
    const reset = resetForSequence(6, 10);
    expect(reset.status).toBe('ready');
    expect(reset.position).toBe(0);
    expect(reset.frameCount).toBe(6);
    expect(reset.expectedTime).toBeNull();
    // 旧计时已停：即便时钟继续走，新就绪状态不前进
    clock.advance(5000);
    expect(tick(reset, clock.now()).position).toBe(0);
  });
});

describe('seek', () => {
  it('跳到指定位置并夹取到范围内，不改变播放状态', () => {
    const playing = play(createPlayback(4, 10), 0);
    const moved = seek(playing, 2);
    expect(moved.position).toBe(2);
    expect(moved.status).toBe('playing');
    expect(seek(playing, 99).position).toBe(3);
    expect(seek(playing, -5).position).toBe(0);
    const ready = seek(createPlayback(4, 10), 3);
    expect(ready.status).toBe('ready');
    expect(ready.position).toBe(3);
  });
});

describe('parseFps 帧率校验', () => {
  it('接受 1..30 的整数字符串与数字', () => {
    expect(parseFps('1')).toBe(1);
    expect(parseFps('30')).toBe(30);
    expect(parseFps('15')).toBe(15);
    expect(parseFps(10)).toBe(10);
    expect(MIN_FPS).toBe(1);
    expect(MAX_FPS).toBe(30);
  });

  it('拒绝空、非整数与越界', () => {
    expect(parseFps('')).toBeNull();
    expect(parseFps('   ')).toBeNull();
    expect(parseFps(undefined)).toBeNull();
    expect(parseFps(null)).toBeNull();
    expect(parseFps('0')).toBeNull();
    expect(parseFps('-1')).toBeNull();
    expect(parseFps('31')).toBeNull();
    expect(parseFps('1.5')).toBeNull();
    expect(parseFps('abc')).toBeNull();
    expect(parseFps('1e1')).toBeNull();
    expect(parseFps(0)).toBeNull();
    expect(parseFps(31)).toBeNull();
    expect(parseFps(10.5)).toBeNull();
  });

  it('非法时给出可就地展示的中文原因', () => {
    expect(fpsErrorReason('')).toContain('帧率为空');
    expect(fpsErrorReason('   ')).toContain('帧率为空');
    expect(fpsErrorReason('abc')).toContain('帧率非整数');
    expect(fpsErrorReason('1.5')).toContain('帧率非整数');
    expect(fpsErrorReason('0')).toContain('帧率越界');
    expect(fpsErrorReason('31')).toContain('帧率越界');
    expect(fpsErrorReason('-2')).toContain('帧率越界');
  });
});
