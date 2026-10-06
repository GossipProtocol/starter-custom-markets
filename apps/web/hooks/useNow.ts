'use client';

import { useSession } from '@/app/providers';
import { useDemoTick } from './useDemoTick';

/** Current unix seconds. In demo mode this includes the skipped time. */
export function useNow(): number {
  const { demo } = useSession();
  useDemoTick();
  return demo ? demo.now() : Math.floor(Date.now() / 1000);
}
