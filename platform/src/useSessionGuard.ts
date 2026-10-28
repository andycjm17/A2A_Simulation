import { useEffect, useRef } from "react";

// Capture at request start; discard responses after scope changes, including A→B→A.
// Revocation only suppresses client effects; it cannot undo a committed server request.
export function useSessionGuard(scope: readonly unknown[]) {
  const state = useRef({ scope, generation: 0 });
  if (
    scope.length !== state.current.scope.length ||
    scope.some((v, i) => !Object.is(v, state.current.scope[i]))
  ) {
    state.current = { scope, generation: state.current.generation + 1 };
  }
  useEffect(
    () => () => {
      state.current.generation++;
    },
    [],
  );
  return () => {
    const generation = state.current.generation;
    return () => generation === state.current.generation;
  };
}
