import { addLocalDays } from "../../../../core/time/zone.ts";

export function upcomingWeek(date: string) {
  const day = new Date(`${date}T12:00:00`);
  const mondayOffset = (day.getDay() + 6) % 7;
  const monday = addLocalDays(date, -mondayOffset);
  return Array.from({ length: 7 }, (_, index) => addLocalDays(monday, index));
}
