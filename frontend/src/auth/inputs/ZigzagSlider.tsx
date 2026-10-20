import { useMemo, useRef, useState } from 'react';
import { View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { INK } from '@/styles';
import { useDrag, type DragTarget } from './useDrag';

type Point = { x: number; y: number };

/** Positions run from 0 to STEPS, with DECIMALS decimal places. */
const STEPS = 1000;
const DECIMALS = 3;
const ROWS = 4;
const TEETH = 5;
const PAD = 14;
/** How far along the track (in whole steps) one drag event may move the thumb, so it can't jump between crossing loops. */
const WINDOW = 40;
/** A drag must start this close (px) to the thumb. */
const GRAB_RADIUS = 32;

/**
 * The track in unit coordinates (width ~1): rows of zigzags joined by
 * U-turns, with a loop-the-loop at the end of every row.
 */
function trackOutline(): Point[] {
  const h = 0.3; // row pitch
  const a = 0.06; // zigzag amplitude
  const r = 0.07; // loop radius
  const xs = h / 2;
  const xe = 1 - h / 2;
  const pts: Point[] = [];
  const arc = (cx: number, cy: number, radius: number, from: number, to: number) => {
    const n = Math.ceil((Math.abs(to - from) * radius) / 0.004);
    for (let i = 1; i <= n; i++) {
      const t = from + ((to - from) * i) / n;
      pts.push({ x: cx + radius * Math.cos(t), y: cy + radius * Math.sin(t) });
    }
  };
  const line = (to: Point) => {
    const from = pts[pts.length - 1];
    const n = Math.max(1, Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / 0.004));
    for (let i = 1; i <= n; i++) pts.push({ x: from.x + ((to.x - from.x) * i) / n, y: from.y + ((to.y - from.y) * i) / n });
  };

  pts.push({ x: xs, y: 0 });
  for (let row = 0; row < ROWS; row++) {
    const y = row * h;
    const rightward = row % 2 === 0;
    const [from, to] = rightward ? [xs, xe] : [xe, xs];
    for (let k = 1; k <= 2 * TEETH; k++) {
      const x = from + ((to - from) * k) / (2 * TEETH);
      line({ x, y: k === 2 * TEETH ? y : y + (k % 2 ? -a : a) });
    }
    // Loop-the-loop: a full circle above the row's end, back to where it started.
    const dir = rightward ? 1 : -1;
    arc(to, y - r, r, Math.PI / 2, Math.PI / 2 - dir * 2 * Math.PI);
    // U-turn down to the next row.
    if (row < ROWS - 1) arc(to, y + h / 2, h / 2, -Math.PI / 2, -Math.PI / 2 + dir * Math.PI);
  }
  return pts;
}

/** `count` + 1 points evenly spaced along the polyline. */
function resample(pts: Point[], count: number): Point[] {
  const lengths = [0];
  for (let i = 1; i < pts.length; i++) lengths.push(lengths[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  const total = lengths[lengths.length - 1];
  const out: Point[] = [];
  let j = 1;
  for (let i = 0; i <= count; i++) {
    const at = (total * i) / count;
    while (j < pts.length - 1 && lengths[j] < at) j++;
    const span = lengths[j] - lengths[j - 1] || 1;
    const t = (at - lengths[j - 1]) / span;
    out.push({ x: pts[j - 1].x + (pts[j].x - pts[j - 1].x) * t, y: pts[j - 1].y + (pts[j].y - pts[j - 1].y) * t });
  }
  return out;
}

const UNIT_TRACK = resample(trackOutline(), STEPS);
const BOUNDS = UNIT_TRACK.reduce(
  (b, p) => ({ minX: Math.min(b.minX, p.x), maxX: Math.max(b.maxX, p.x), minY: Math.min(b.minY, p.y), maxY: Math.max(b.maxY, p.y) }),
  { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity },
);

const pathOf = (pts: Point[]) => pts.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join('');

/** The point `position` steps along the track (positions between samples are interpolated). */
function pointAt(track: Point[], position: number): Point {
  const i = Math.min(STEPS - 1, Math.floor(position));
  const t = position - i;
  return { x: track[i].x + (track[i + 1].x - track[i].x) * t, y: track[i].y + (track[i + 1].y - track[i].y) * t };
}

/** The position of the nearest point to (x, y) on segments `from`..`to` of the track. */
function nearestPosition(track: Point[], x: number, y: number, from: number, to: number): number {
  let best = from;
  let bestDist = Infinity;
  for (let i = from; i < to; i++) {
    const a = track[i];
    const b = track[i + 1];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / (dx * dx + dy * dy || 1)));
    const d = Math.hypot(x - (a.x + dx * t), y - (a.y + dy * t));
    if (d < bestDist) [best, bestDist] = [i + t, d];
  }
  const scale = 10 ** DECIMALS;
  return Math.round(best * scale) / scale;
}

/**
 * Login with slider: a giant, looping, zigzagging slider. Drag the thumb
 * along the track; the position is how far along it is (0-1000, to three
 * decimal places). The thumb only follows a finger that stays on the track.
 */
export function ZigzagSlider({ position, onChange }: { position: number; onChange(position: number): void }) {
  const [width, setWidth] = useState(0);
  const dragging = useRef(false);

  const scale = width ? (width - 2 * PAD) / (BOUNDS.maxX - BOUNDS.minX) : 0;
  const height = scale ? (BOUNDS.maxY - BOUNDS.minY) * scale + 2 * PAD : 0;
  const track = useMemo(
    () => UNIT_TRACK.map((p) => ({ x: PAD + (p.x - BOUNDS.minX) * scale, y: PAD + (p.y - BOUNDS.minY) * scale })),
    [scale],
  );
  const full = useMemo(() => (track.length ? pathOf(track) : ''), [track]);

  const dragRef = useRef<DragTarget>(null);
  const drag = useDrag(dragRef, (x, y, phase) => {
    if (!track.length) return;
    const thumb = pointAt(track, position);
    if (phase === 'start') dragging.current = Math.hypot(x - thumb.x, y - thumb.y) <= GRAB_RADIUS;
    if (!dragging.current) return;
    if (phase === 'end') dragging.current = false;
    const at = Math.floor(position);
    const best = nearestPosition(track, x, y, Math.max(0, at - WINDOW), Math.min(STEPS, at + WINDOW + 1));
    if (best !== position) onChange(best);
  });

  const thumb = track.length ? pointAt(track, position) : undefined;
  return (
    <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      <View ref={dragRef} {...drag} style={{ height: height || 200 }}>
        {width && thumb ? (
          <Svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} pointerEvents="none">
            <Path d={full} stroke="#e2e2e2" strokeWidth={14} strokeLinecap="round" strokeLinejoin="round" fill="none" />
            <Path
              d={pathOf([...track.slice(0, Math.floor(position) + 1), thumb])}
              stroke={INK}
              strokeWidth={6}
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
            />
            <Circle cx={thumb.x} cy={thumb.y} r={13} fill="#fff" stroke={INK} strokeWidth={3} />
          </Svg>
        ) : null}
      </View>
    </View>
  );
}
