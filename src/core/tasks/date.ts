export function formatTaskDate(date: Date, existing?: Date): string {
  // Resolve the selected day in the client's timezone before it reaches the VPS.
  const sameDay =
    existing &&
    existing.getFullYear() === date.getFullYear() &&
    existing.getMonth() === date.getMonth() &&
    existing.getDate() === date.getDate();
  const resolved = sameDay ? existing : new Date(date.getFullYear(), date.getMonth(), date.getDate());
  return resolved
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
}
