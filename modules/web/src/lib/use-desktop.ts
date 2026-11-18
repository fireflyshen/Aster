import { useSyncExternalStore } from "react";

export const DESKTOP_QUERY = "(min-width: 768px)";
export const isDesktop = () => window.matchMedia(DESKTOP_QUERY).matches;
export const WIDE_WORKSPACE_QUERY = "(min-width: 1100px)";
export const isWideWorkspace = () =>
  window.matchMedia(WIDE_WORKSPACE_QUERY).matches;

function subscribe(callback: () => void) {
  const media = window.matchMedia(DESKTOP_QUERY);
  media.addEventListener("change", callback);
  return () => media.removeEventListener("change", callback);
}

/** Match the existing md layout boundary, including live orientation changes. */
export function useDesktop() {
  return useSyncExternalStore(subscribe, isDesktop, () => false);
}

function subscribeWideWorkspace(callback: () => void) {
  const media = window.matchMedia(WIDE_WORKSPACE_QUERY);
  media.addEventListener("change", callback);
  return () => media.removeEventListener("change", callback);
}

/** Reserve a persistent sidebar only when the task canvas has enough room. */
export function useWideWorkspace() {
  return useSyncExternalStore(
    subscribeWideWorkspace,
    isWideWorkspace,
    () => false,
  );
}
