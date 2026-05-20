/**
 * Lightweight pub/sub for photo capture results.
 * Allows capture.tsx to update pole-detail/destination-pole cards
 * INSTANTLY — before the navigation animation even starts.
 */

export type CaptureResult = {
  uri: string;
  tab: "before" | "after" | "tag";
  ownerType: string;
  ownerPoleId: string;
  skipStamp?: boolean; // true when capture.tsx already burned the stamp
};

type Listener = (result: CaptureResult) => void;
const listeners = new Set<Listener>();

export const captureEvents = {
  on(fn: Listener): () => void {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  emit(result: CaptureResult): void {
    listeners.forEach(fn => fn(result));
  },
};
