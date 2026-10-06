'use client';

import { useEffect, useState } from 'react';

/** Re-renders once a second so countdowns and the multiplier move. */
export function useDemoTick(intervalMs = 1000): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return tick;
}
