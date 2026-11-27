import { ViewTransition } from "react";

/**
 * Fade boundary for in-page content swaps.
 *
 * React only runs view transitions for updates scheduled inside
 * `startTransition` (or `Suspense` / `useDeferredValue`), so callers must
 * wrap the state update that swaps the children in a transition.
 */
export function FadeTransition({ children }: { children: React.ReactNode }) {
  return (
    <ViewTransition enter="fade-in" exit="fade-out" default="none">
      {children}
    </ViewTransition>
  );
}
