/** Touch activators have no clientX; keyboard input has no screen point. */
export function dragInputPoint(
  event: Event,
): { x: number; y: number } | undefined {
  if ("touches" in event) {
    const touch = (event as TouchEvent).touches[0];
    return touch ? { x: touch.clientX, y: touch.clientY } : undefined;
  }
  if ("clientX" in event && "clientY" in event) {
    return { x: Number(event.clientX), y: Number(event.clientY) };
  }
  return undefined;
}
