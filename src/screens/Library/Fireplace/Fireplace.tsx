import { useEffect, useMemo, useRef, useState } from 'react';
import './Fireplace.css';

type FireplaceProps = {
  scale?: number;
  intensity?: number;
  speed?: number;
  showCandles?: boolean;
  showEmbers?: boolean;
};

const W = 56;
const H = 34;

const row = (s: string) => (s + ' '.repeat(W)).slice(0, W);

const STRUCTURE = [
  row(`                                                     `),
  row(`                                                   `),
  row(`         \\|/                             \\|/         `),
  row(`     ___|___|___                     ___|___|___     `),
  row(`    [___________]   .  *  ,  .      [___________]     `),
  row(`    |__|__|__|__|        .          |__|__|__|__|     `),
  row(`    |__|__|__|__|  .   *    .  *    |__|__|__|__|     `),
  row(`    |__|__|__|__|___________________|__|__|__|__|    `),
  row(`   _|__|__|__|__|___________________|__|__|__|__|_   `),
  row(`  [_______________________________________________] `),
  row(`  |==|==|==|==|==|==|==|==|==|==|==|==|==|==|==|==| `),
  row(`  |__|__|__|__|__|__|__|__|__|__|__|__|__|__|__|__| `),
  row(`  |==|==|==|==|==|==|==|==|==|==|==|==|==|==|==|==| `),
  row(`  |__|__|__|__|                       |__|__|__|__| `),
  row(`  |==|==|==|==|                       |==|==|==|==| `),
  row(`  |__|__|__|__|                       |__|__|__|__| `),
  row(`  |==|==|==|==|                       |==|==|==|==| `),
  row(`  |__|__|__|__|                       |__|__|__|__| `),
  row(`  |==|==|==|==|                       |==|==|==|==| `),
  row(`  |__|__|__|__|                       |__|__|__|__| `),
  row(`  |==|==|==|==|                       |==|==|==|==| `),
  row(`  |__|__|__|__|                       |__|__|__|__| `),
  row(`  |==|==|==|==|                       |==|==|==|==| `),
  row(`  |__|__|__|__|                       |__|__|__|__| `),
  row(`  |==|==|==|==|_______________________|==|==|==|==| `),
  row(`  |__|__|__|__|_______________________|__|__|__|__| `),
  row(`  [_______________________________________________] `),
  row(`   \\\\___________________________________________//`),
  row(`    '-.._____________________________________..-'`),
  row(`                                                      `),
  row(`                                                      `),
  row(`                                                      `),
  row(`                                                      `),
  row(`                                                      `),
];

const FIRE = {
  rowStart: 10,
  rowEnd: 23,
  colStart: 16,
  colEnd: 38,
};

const SMOKE_H = 9;
const CHIMNEY_COLS = [10, 42];

const CANDLES = [
  { col: 20, row: 4 },
  { col: 24, row: 4 },
  { col: 28, row: 4 },
  { col: 32, row: 4 },
];

type Ember = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  ch: string;
};

function pick(t: number, r: number, c: number, arr: string[]) {
  const bucket = Math.floor(t / 110) + r * 13 + c * 7;
  const x = Math.sin(bucket * 12.9898) * 43758.5453;
  const f = x - Math.floor(x);
  return arr[Math.floor(f * arr.length) % arr.length];
}

function makeFlameField(t: number, intensity: number, jitter: number) {
  const rows = Array.from({ length: H }, () => Array(W).fill(' '));

  const baseRow = FIRE.rowEnd;
  const tipRow = FIRE.rowStart + 2;
  const cx = (FIRE.colStart + FIRE.colEnd) / 2;
  const halfW = (FIRE.colEnd - FIRE.colStart) / 2;

  const breathe = 0.5 + 0.5 * Math.sin(t * 0.0011);
  const heatBoost = 0.85 + breathe * 0.3 * intensity;

  for (let r = tipRow; r <= baseRow - 1; r++) {
    const hf = (baseRow - 1 - r) / (baseRow - 1 - tipRow);
    const widthAtRow = halfW * (1 - hf * 0.55);

    for (let c = FIRE.colStart + 1; c <= FIRE.colEnd - 1; c++) {
      const dx = c - cx;
      const sway =
        Math.sin(t * 0.0009 + r * 0.4) * 1.3 +
        Math.sin(t * 0.0021 + r * 0.7 + c * 0.3) * 0.8 * jitter;

      const xnorm = (dx - sway) / widthAtRow;
      if (Math.abs(xnorm) > 1) continue;

      const radial = 1 - xnorm * xnorm;
      const vertical = Math.pow(1 - hf, 0.55);
      const turb =
        0.5 +
        0.5 * Math.sin(t * 0.003 + r * 1.1 + c * 0.7) * Math.cos(t * 0.0017 + r * 0.5 - c * 0.4);

      const heat = radial * vertical * (0.7 + 0.3 * turb) * heatBoost;
      if (heat < 0.18) continue;

      let ch: string;

      if (hf > 0.78) ch = pick(t, r, c, ['.', '.', ' ', '.']);
      else if (hf > 0.55) ch = pick(t, r, c, ['.', '^', '.', ':']);
      else if (hf > 0.3) ch = pick(t, r, c, ['^', '*', ':', '^']);
      else if (hf > 0.12) ch = pick(t, r, c, ['*', ':', '*', '#', ':']);
      else ch = pick(t, r, c, ['#', '#', ':', '*', '#']);

      if (heat > 0.35) rows[r][c] = ch[0];
    }
  }

  return rows.map((arr) => arr.join(''));
}

function useEmbers(speed: number, intensity: number) {
  const ref = useRef<Ember[]>([]);

  useEffect(() => {
    let raf = 0;
    let last = performance.now();

    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;

      if (Math.random() < dt * 1.8 * intensity) {
        ref.current.push({
          x: FIRE.colStart + 2 + Math.random() * (FIRE.colEnd - FIRE.colStart - 4),
          y: FIRE.rowEnd - 1 - Math.random() * 1.5,
          vx: (Math.random() - 0.5) * 0.6,
          vy: -(0.6 + Math.random() * 0.9) * speed,
          life: 0,
          maxLife: 1.8 + Math.random() * 1.4,
          ch: ['.', '*', '.', '^'][Math.floor(Math.random() * 4)],
        });
      }

      for (const e of ref.current) {
        e.life += dt;
        e.x += e.vx * dt * 4;
        e.y += e.vy * dt * 4;
        e.vx += Math.sin(now * 0.002 + e.y) * dt * 0.3;
      }

      ref.current = ref.current.filter(
        (e) => e.life < e.maxLife && e.y > FIRE.rowStart - 4 && e.x > 1 && e.x < W - 1,
      );

      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [speed, intensity]);

  return ref;
}

function makeSmokeField(t: number, speed: number) {
  const rows = Array.from({ length: SMOKE_H }, () => Array(W).fill(' '));

  for (const cx of CHIMNEY_COLS) {
    for (let r = 0; r < SMOKE_H; r++) {
      const heightFromPot = SMOKE_H - 1 - r;
      const dissipate = heightFromPot / (SMOKE_H - 1);

      const drift =
        Math.sin(t * 0.0006 * speed + heightFromPot * 0.6 + cx * 0.3) * (1 + dissipate * 2.5) +
        Math.sin(t * 0.0013 * speed + heightFromPot * 1.1) * dissipate * 1.5;

      const density =
        (1 - dissipate * 0.85) *
        (0.6 + 0.4 * Math.sin(t * 0.0011 * speed + heightFromPot * 0.5 + cx));

      if (density < 0.18) continue;

      const spread = 1 + Math.floor(dissipate * 2.2);

      for (let dx = -spread; dx <= spread; dx++) {
        const c = Math.round(cx + drift + dx);
        if (c < 0 || c >= W) continue;

        const edgeFalloff = 1 - Math.abs(dx) / (spread + 0.5);
        const cell = density * edgeFalloff;
        if (cell < 0.22) continue;

        let ch: string;
        if (dissipate > 0.7) ch = pick(t, r, c, ['.', ' ', '.', ' ']);
        else if (dissipate > 0.4) ch = pick(t, r, c, ['.', ':', ' ', '.', ' ']);
        else ch = pick(t, r, c, ['o', ':', '.', '·', 'o', ' ']);

        if (ch !== ' ' && rows[r][c] === ' ') rows[r][c] = ch;
      }
    }
  }

  return rows.map((arr) => arr.join(''));
}

function makeCandleField(t: number) {
  const rows = Array.from({ length: H }, () => Array(W).fill(' '));

  for (const cand of CANDLES) {
    const flicker = Math.sin(t * 0.004 + cand.col) * 0.5 + 0.5;
    const ch = flicker > 0.55 ? 'i' : flicker > 0.25 ? '.' : "'";

    if (cand.row - 1 >= 0) rows[cand.row - 1][cand.col] = ch;
    if (flicker > 0.7) rows[cand.row][cand.col] = '.';
  }

  return rows.map((arr) => arr.join(''));
}

function makeGlowField(t: number) {
  const rows = Array.from({ length: H }, () => Array(W).fill(' '));
  const breathe = 0.5 + 0.5 * Math.sin(t * 0.0013);

  for (let r = FIRE.rowStart - 1; r <= FIRE.rowEnd + 1; r++) {
    for (let c = FIRE.colStart - 2; c <= FIRE.colEnd + 2; c++) {
      if (r < 0 || r >= H || c < 0 || c >= W) continue;

      const src = STRUCTURE[r]?.[c];
      if (!src || src === ' ') continue;

      const cx = (FIRE.colStart + FIRE.colEnd) / 2;
      const cy = (FIRE.rowStart + FIRE.rowEnd) / 2;
      const d = Math.hypot((c - cx) / 12, (r - cy) / 6);
      const w = Math.max(0, 1 - d);

      if (w * (0.7 + breathe * 0.3) > 0.45) {
        rows[r][c] = src;
      }
    }
  }

  return rows.map((arr) => arr.join(''));
}

function makeLogsField() {
  const rows = Array.from({ length: H }, () => ' '.repeat(W));
  rows[21] = '                   ___        ___                         ';
  rows[22] = '                 -~   ~--__--~   ~-_                      ';
  rows[23] = '               .-~ o   o    o   o  ~-.                  ';
  return rows;
}

export function Fireplace({
  scale = 0.48,
  intensity = 1,
  speed = 1,
  showCandles = true,
  showEmbers = true,
}: FireplaceProps) {
  const [now, setNow] = useState(() => performance.now());
  const embersRef = useEmbers(speed, showEmbers ? intensity : 0);

  useEffect(() => {
    let raf = 0;

    const loop = (n: number) => {
      setNow(n * speed);
      raf = requestAnimationFrame(loop);
    };

    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [speed]);

  const flameTick = Math.floor(now / 70);

  const flameField = useMemo(
    () => makeFlameField(flameTick * 70, intensity, 0.9),
    [flameTick, intensity],
  );

  const candleField = useMemo(
    () => (showCandles ? makeCandleField(now) : Array(H).fill(' '.repeat(W))),
    [Math.floor(now / 90), showCandles],
  );

  const glowField = useMemo(() => makeGlowField(now), [Math.floor(now / 120)]);
  const logsField = useMemo(() => makeLogsField(), []);
  const smokeField = useMemo(() => makeSmokeField(now, speed), [Math.floor(now / 130), speed]);

  const emberField = useMemo(() => {
    const rows = Array.from({ length: H }, () => Array(W).fill(' '));

    for (const e of embersRef.current) {
      const r = Math.round(e.y);
      const c = Math.round(e.x);
      if (r >= 0 && r < H && c >= 0 && c < W) rows[r][c] = e.ch;
    }

    return rows.map((a) => a.join(''));
  }, [Math.floor(now / 60)]);

  const fontSize = `${13 * scale}px`;

  return (
    <div className="fireplace-widget">
      <div
        className="fireplace-art"
        style={
          {
            '--ascii-size': fontSize,
          } as React.CSSProperties
        }
      >
        <pre className="fireplace-ascii fireplace-smoke">{smokeField.join('\n')}</pre>

        <pre className="fireplace-ascii fireplace-structure">{STRUCTURE.join('\n')}</pre>

        <pre className="fireplace-ascii fireplace-layer fireplace-glow">{glowField.join('\n')}</pre>
        <pre className="fireplace-ascii fireplace-layer fireplace-logs">{logsField.join('\n')}</pre>
        <pre className="fireplace-ascii fireplace-layer fireplace-flame">
          {flameField.join('\n')}
        </pre>
        <pre className="fireplace-ascii fireplace-layer fireplace-ember">
          {emberField.join('\n')}
        </pre>
        <pre className="fireplace-ascii fireplace-layer fireplace-candle">
          {candleField.join('\n')}
        </pre>
      </div>
    </div>
  );
}
