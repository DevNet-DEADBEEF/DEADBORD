import { useRef, useState } from 'react';
import { View } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { useDrag, type DragTarget } from './useDrag';

const HEX = /^#[0-9a-f]{6}$/i;
const SQUARE_HEIGHT = 180;
const HUE_HEIGHT = 24;

type Hsv = { h: number; s: number; v: number };

const clamp = (n: number) => Math.min(1, Math.max(0, n));

export function hsvToHex({ h, s, v }: Hsv): string {
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    return Math.round(255 * (v - v * s * Math.max(0, Math.min(k, 4 - k, 1))));
  };
  return `#${[f(5), f(3), f(1)].map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}

export function hexToHsv(hex: string): Hsv {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  let h = 0;
  if (d) h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: (h * 60 + 360) % 360, s: max ? d / max : 0, v: max };
}

/**
 * A color picker: a saturation/brightness square for the chosen hue, and a
 * hue bar under it. Reports 24-bit hex colors.
 */
export function ColorPicker({ color, onChange }: { color: string; onChange(hex: string): void }) {
  const [width, setWidth] = useState(0);
  // Kept separately so the hue survives dragging to black or white.
  const [hsv, setHsv] = useState<Hsv>(() => (HEX.test(color) ? hexToHsv(color) : { h: 210, s: 0.8, v: 0.9 }));
  const current = HEX.test(color) && hsvToHex(hsv) !== color.toLowerCase() ? hexToHsv(color) : hsv;

  function update(next: Hsv) {
    setHsv(next);
    onChange(hsvToHex(next));
  }

  const squareRef = useRef<DragTarget>(null);
  const square = useDrag(squareRef, (x, y) => width && update({ ...current, s: clamp(x / width), v: 1 - clamp(y / SQUARE_HEIGHT) }));
  const hueRef = useRef<DragTarget>(null);
  const hue = useDrag(hueRef, (x) => width && update({ ...current, h: clamp(x / width) * 359.9 }));
  const pure = hsvToHex({ h: current.h, s: 1, v: 1 });

  return (
    <View style={{ gap: 8 }} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      <View ref={squareRef} {...square} style={{ height: SQUARE_HEIGHT, borderRadius: 6, overflow: 'hidden' }}>
        {width ? (
          <Svg width={width} height={SQUARE_HEIGHT} viewBox={`0 0 ${width} ${SQUARE_HEIGHT}`} pointerEvents="none">
            <Defs>
              <LinearGradient id="sat" x1="0" y1="0" x2="1" y2="0">
                <Stop offset="0" stopColor="#fff" />
                <Stop offset="1" stopColor={pure} />
              </LinearGradient>
              <LinearGradient id="val" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor="#000" stopOpacity="0" />
                <Stop offset="1" stopColor="#000" stopOpacity="1" />
              </LinearGradient>
            </Defs>
            <Rect x="0" y="0" width={width} height={SQUARE_HEIGHT} fill="url(#sat)" />
            <Rect x="0" y="0" width={width} height={SQUARE_HEIGHT} fill="url(#val)" />
          </Svg>
        ) : null}
        <Marker left={current.s * width} top={(1 - current.v) * SQUARE_HEIGHT} />
      </View>
      <View ref={hueRef} {...hue} style={{ height: HUE_HEIGHT, borderRadius: 6, overflow: 'hidden' }}>
        {width ? (
          <Svg width={width} height={HUE_HEIGHT} viewBox={`0 0 ${width} ${HUE_HEIGHT}`} pointerEvents="none">
            <Defs>
              <LinearGradient id="hue" x1="0" y1="0" x2="1" y2="0">
                {[0, 60, 120, 180, 240, 300, 360].map((h) => (
                  <Stop key={h} offset={String(h / 360)} stopColor={hsvToHex({ h: h % 360, s: 1, v: 1 })} />
                ))}
              </LinearGradient>
            </Defs>
            <Rect x="0" y="0" width={width} height={HUE_HEIGHT} fill="url(#hue)" />
          </Svg>
        ) : null}
        <Marker left={(current.h / 360) * width} top={HUE_HEIGHT / 2} />
      </View>
    </View>
  );
}

function Marker({ left, top }: { left: number; top: number }) {
  return (
    <View
      pointerEvents="none"
      style={{
        position: 'absolute',
        left: left - 8,
        top: top - 8,
        width: 16,
        height: 16,
        borderRadius: 8,
        borderWidth: 2,
        borderColor: '#fff',
        shadowColor: '#000',
        shadowOpacity: 0.5,
        shadowRadius: 2,
      }}
    />
  );
}
