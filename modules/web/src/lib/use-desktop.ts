import { useSyncExternalStore } from "react";

export const DESKTOP_QUERY = "(min-width: 768px)";
export const isDesktop = () => window.matchMedia(DESKTOP_QUERY).matches;

function subscribe(callback: () => void) {
  const media = window.matchMedia(DESKTOP_QUERY);
  media.addEventListener("change", callback);
  return () => media.removeEventListener("change", callback);
}

/** Match the existing md layout boundary, including live orientation changes. */
export function useDesktop() {
  return useSyncExternalStore(subscribe, isDesktop, () => false);
}
