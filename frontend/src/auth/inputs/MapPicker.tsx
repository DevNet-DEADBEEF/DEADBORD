import { useRef, useState } from 'react';
import { Image, Text, View } from 'react-native';
import { API_URL } from '@/api/request';
import { Button } from '@/components';
import { styles } from '@/styles';
import { useDrag, type DragTarget } from './useDrag';

const TILE = 256;
const HEIGHT = 300;
const MIN_ZOOM = 1;
const MAX_ZOOM = 18;
/** Pointer movement (px) under which a drag counts as a tap. */
const TAP_SLOP = 6;

export type LatLng = { lat: number; lng: number };

// Web Mercator, in pixels of a world 256 * 2^zoom wide.
const MAX_LAT = 85.05112878;
function project({ lat, lng }: LatLng, zoom: number) {
  const world = TILE * 2 ** zoom;
  const sin = Math.sin((Math.max(-MAX_LAT, Math.min(MAX_LAT, lat)) * Math.PI) / 180);
  return { x: ((lng + 180) / 360) * world, y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * world };
}
function unproject(x: number, y: number, zoom: number): LatLng {
  const world = TILE * 2 ** zoom;
  const lng = ((((x / world) * 360) % 360) + 360) % 360 - 180;
  const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / world))) * 180) / Math.PI;
  return { lat, lng };
}

/**
 * Login with coordinates: a map (OpenStreetMap tiles, proxied by the
 * backend's /tiles). Drag to pan, tap to drop the pin.
 */
export function MapPicker({ value, onChange }: { value: LatLng | undefined; onChange(place: LatLng): void }) {
  const [width, setWidth] = useState(0);
  const [zoom, setZoom] = useState(value ? 14 : 2);
  const [center, setCenter] = useState<LatLng>(value ?? { lat: 20, lng: 0 });
  const gesture = useRef({ lastX: 0, lastY: 0, moved: 0 });

  const c = project(center, zoom);
  const left = c.x - width / 2;
  const top = c.y - HEIGHT / 2;

  const dragRef = useRef<DragTarget>(null);
  const drag = useDrag(dragRef, (x, y, phase) => {
    const g = gesture.current;
    if (phase === 'start') {
      gesture.current = { lastX: x, lastY: y, moved: 0 };
      return;
    }
    const dx = x - g.lastX;
    const dy = y - g.lastY;
    g.moved += Math.hypot(dx, dy);
    g.lastX = x;
    g.lastY = y;
    if (phase === 'end' && g.moved < TAP_SLOP) {
      const place = unproject(left + x, top + y, zoom);
      onChange({ lat: round(place.lat), lng: round(place.lng) });
      return;
    }
    const world = TILE * 2 ** zoom;
    // Several moves can arrive before a render, so build on the latest center.
    setCenter((prev) => {
      const p = project(prev, zoom);
      return unproject(p.x - dx, Math.max(0, Math.min(world, p.y - dy)), zoom);
    });
  });

  const tiles: { key: string; x: number; y: number; uri: string }[] = [];
  if (width) {
    const n = 2 ** zoom;
    for (let ty = Math.floor(top / TILE); ty <= Math.floor((top + HEIGHT) / TILE); ty++) {
      if (ty < 0 || ty >= n) continue;
      for (let tx = Math.floor(left / TILE); tx <= Math.floor((left + width) / TILE); tx++) {
        const wrapped = ((tx % n) + n) % n;
        tiles.push({ key: `${tx}/${ty}`, x: tx * TILE - left, y: ty * TILE - top, uri: `${API_URL}/tiles/${zoom}/${wrapped}/${ty}.png` });
      }
    }
  }
  const pin = value && width ? project(value, zoom) : undefined;

  return (
    <View style={{ gap: 6 }}>
      <View
        ref={dragRef}
        {...drag}
        onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
        style={{ height: HEIGHT, borderRadius: 6, overflow: 'hidden', backgroundColor: '#aad3df' }}
      >
        {tiles.map((t) => (
          <Image key={t.key} source={{ uri: t.uri }} pointerEvents="none" style={{ position: 'absolute', left: t.x, top: t.y, width: TILE, height: TILE }} />
        ))}
        {pin ? (
          <View
            pointerEvents="none"
            style={{
              position: 'absolute',
              left: pin.x - left - 9,
              top: pin.y - top - 9,
              width: 18,
              height: 18,
              borderRadius: 9,
              backgroundColor: '#c0392b',
              borderWidth: 3,
              borderColor: '#fff',
            }}
          />
        ) : null}
        <Text pointerEvents="none" style={{ position: 'absolute', right: 4, bottom: 2, fontSize: 10, color: '#333', backgroundColor: '#ffffffb0', paddingHorizontal: 3 }}>
          © OpenStreetMap contributors
        </Text>
      </View>
      <View style={styles.row}>
        <Button label="−" size="small" disabled={zoom <= MIN_ZOOM} onPress={() => setZoom(zoom - 1)} />
        <Button label="+" size="small" disabled={zoom >= MAX_ZOOM} onPress={() => setZoom(zoom + 1)} />
        <Button label="Go to pin" size="small" disabled={!value} onPress={() => {
            if (!value) return;
            setCenter(value);
            setZoom(Math.max(zoom, 14));
          }}
        />
        <Text style={[styles.muted, styles.grow, { textAlign: 'right' }]}>
          {value ? `${value.lat.toFixed(5)}, ${value.lng.toFixed(5)}` : 'Tap the map to drop a pin'}
        </Text>
      </View>
    </View>
  );
}

/** About a meter. */
const round = (n: number) => Math.round(n * 1e5) / 1e5;
