import { useEffect, useRef, useState } from 'react';
import { Pressable, Text } from 'react-native';
import { defineMethod, type MethodInputProps } from './types';

type Value = { ms: number | undefined };
type Phase = 'idle' | 'waiting' | 'go' | 'early';

/** Login with reaction time: click when the color appears. */
function ReactionTest({ value, onChange }: MethodInputProps<Value>) {
  const [phase, setPhase] = useState<Phase>('idle');
  const shownAt = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  function press() {
    if (phase === 'waiting') {
      clearTimeout(timer.current);
      setPhase('early');
    } else if (phase === 'go') {
      onChange({ ms: Math.round(performance.now() - shownAt.current) });
      setPhase('idle');
    } else {
      onChange({ ms: undefined });
      setPhase('waiting');
      timer.current = setTimeout(() => {
        shownAt.current = performance.now();
        setPhase('go');
      }, 1500 + Math.random() * 2500);
    }
  }

  const label = {
    idle: value.ms === undefined ? 'Tap to start' : `${value.ms} ms. Tap to try again`,
    waiting: 'Wait for green…',
    go: 'Tap now!',
    early: 'Too soon! Tap to try again',
  }[phase];

  return (
    <Pressable
      onPress={press}
      style={{
        height: 120,
        borderRadius: 8,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: phase === 'go' ? '#2ecc71' : phase === 'waiting' ? '#c0392b' : '#eee',
      }}
    >
      <Text style={{ fontSize: 18, fontWeight: '600', color: phase === 'idle' || phase === 'early' ? '#222' : '#fff' }}>
        {label}
      </Text>
    </Pressable>
  );
}

export default defineMethod<Value>({
  type: 'reaction_time',
  label: 'Reaction Time',
  kind: 'form',
  initial: { ms: undefined },
  Input: ReactionTest,
  isValid: (v) => v.ms !== undefined,
});
