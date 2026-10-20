import { useRef, type ComponentRef, type RefObject } from 'react';
import type { GestureResponderEvent, View, ViewProps } from 'react-native';

export type DragPhase = 'start' | 'move' | 'end';
export type DragTarget = ComponentRef<typeof View>;

/**
 * Pointer drags on the view `ref` is attached to, reported in its own
 * coordinates. Spread the returned handlers on that view. Its children
 * should have pointerEvents="none" so the first touch lands on the view.
 */
export function useDrag(ref: RefObject<DragTarget | null>, onDrag: (x: number, y: number, phase: DragPhase) => void): ViewProps {
  const origin = useRef({ x: 0, y: 0 });

  const at = (e: GestureResponderEvent, phase: DragPhase) =>
    onDrag(e.nativeEvent.pageX - origin.current.x, e.nativeEvent.pageY - origin.current.y, phase);

  return {
    onStartShouldSetResponder: () => true,
    onMoveShouldSetResponder: () => true,
    // Keep the drag when a parent ScrollView would like to scroll instead.
    onResponderTerminationRequest: () => false,
    onResponderGrant: (e) => {
      const { pageX, pageY, locationX, locationY } = e.nativeEvent;
      origin.current = { x: pageX - locationX, y: pageY - locationY };
      onDrag(locationX, locationY, 'start');
      // locationX is relative to whatever was touched; measure the view itself for the moves.
      ref.current?.measure((_x, _y, _w, _h, px, py) => {
        if (Number.isFinite(px) && Number.isFinite(py)) origin.current = { x: px, y: py };
      });
    },
    onResponderMove: (e) => at(e, 'move'),
    onResponderRelease: (e) => at(e, 'end'),
    onResponderTerminate: (e) => at(e, 'end'),
  };
}
