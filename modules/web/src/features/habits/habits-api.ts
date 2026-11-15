import { api } from "@/lib/api";
import type {
  BindTaskHabitInput,
  CreateHabitInput,
  DayDetailResponse,
  HabitDayEvaluation,
  HabitDetailResponse,
  HabitListItem,
  HabitStatus,
  HeatmapResponse,
  TodayHabitsResponse,
  UpdateHabitInput,
} from "@core/habits/model";

export type HabitsListResponse = {
  todayDate: string;
  timezone: string;
  habits: HabitListItem[];
};

export function fetchHabitsList(params?: {
  status?: HabitStatus | "all";
  project?: string;
  tag?: string;
}): Promise<HabitsListResponse> {
  const qs = new URLSearchParams();
  if (params?.status) qs.set("status", params.status);
  if (params?.project) qs.set("project", params.project);
  if (params?.tag) qs.set("tag", params.tag);
  const query = qs.toString();
  return api<HabitsListResponse>(`habits${query ? `?${query}` : ""}`);
}

export function fetchTodayHabits(): Promise<TodayHabitsResponse> {
  return api<TodayHabitsResponse>("habits/today");
}

export function fetchHabitDetail(
  id: string,
  days = 365,
): Promise<HabitDetailResponse> {
  const qs = new URLSearchParams({ id, days: String(days) });
  return api<HabitDetailResponse>(`habits/detail?${qs.toString()}`);
}

export function fetchHabitHeatmap(params?: {
  days?: number;
  startDate?: string;
  endDate?: string;
  project?: string;
  tag?: string;
  habitId?: string;
}): Promise<HeatmapResponse> {
  const qs = new URLSearchParams();
  if (params?.days) qs.set("days", String(params.days));
  if (params?.startDate) qs.set("startDate", params.startDate);
  if (params?.endDate) qs.set("endDate", params.endDate);
  if (params?.project) qs.set("project", params.project);
  if (params?.tag) qs.set("tag", params.tag);
  if (params?.habitId) qs.set("habitId", params.habitId);
  const query = qs.toString();
  return api<HeatmapResponse>(`habits/heatmap${query ? `?${query}` : ""}`);
}

export function fetchHabitDayDetail(params?: {
  date?: string;
  project?: string;
  tag?: string;
  habitId?: string;
}): Promise<DayDetailResponse> {
  const qs = new URLSearchParams();
  if (params?.date) qs.set("date", params.date);
  if (params?.project) qs.set("project", params.project);
  if (params?.tag) qs.set("tag", params.tag);
  if (params?.habitId) qs.set("habitId", params.habitId);
  const query = qs.toString();
  return api<DayDetailResponse>(`habits/day${query ? `?${query}` : ""}`);
}

export function createHabitApi(
  input: CreateHabitInput,
): Promise<{ habit: HabitListItem }> {
  return api<{ habit: HabitListItem }>("habits/create", input);
}

export function updateHabitApi(
  habitId: string,
  patch: UpdateHabitInput,
): Promise<{ habit: HabitListItem }> {
  return api<{ habit: HabitListItem }>("habits/update", { habitId, ...patch });
}

export function setHabitStatusApi(
  habitId: string,
  status: HabitStatus,
): Promise<{ habit: HabitListItem }> {
  return api<{ habit: HabitListItem }>("habits/status", { habitId, status });
}

export function deleteHabitApi(habitId: string): Promise<{ ok: true }> {
  return api<{ ok: true }>("habits/delete", { habitId });
}

export function bindTaskHabitApi(
  input: BindTaskHabitInput,
): Promise<{ habit: HabitListItem }> {
  return api<{ habit: HabitListItem }>("habits/bind", input);
}

export function unbindTaskHabitApi(taskUuid: string): Promise<{ ok: true }> {
  return api<{ ok: true }>("habits/unbind", { taskUuid });
}

export function togglePositiveHabitApi(
  habitId: string,
  date?: string,
  completed?: boolean,
): Promise<{ evaluation: HabitDayEvaluation }> {
  return api<{ evaluation: HabitDayEvaluation }>("habits/toggle", {
    habitId,
    ...(date ? { date } : {}),
    ...(completed !== undefined ? { completed } : {}),
  });
}

export function setChecklistItemApi(input: {
  habitId: string;
  itemId: string;
  date?: string;
  done?: boolean;
  sets?: string | null;
  reps?: string | null;
  weight?: string | null;
  planId?: string;
}): Promise<{ evaluation: HabitDayEvaluation }> {
  return api<{ evaluation: HabitDayEvaluation }>("habits/checklist-item", input);
}

export function switchDayPlanApi(input: {
  habitId: string;
  planId: string;
  date?: string;
}): Promise<{ evaluation: HabitDayEvaluation }> {
  return api<{ evaluation: HabitDayEvaluation }>("habits/switch-plan", input);
}

export function recordNegativeEventApi(input: {
  habitId: string;
  date?: string;
  note?: string;
}): Promise<{ eventId: string; evaluation: HabitDayEvaluation }> {
  return api<{ eventId: string; evaluation: HabitDayEvaluation }>(
    "habits/negative/record",
    input,
  );
}

export function undoNegativeEventApi(input: {
  habitId: string;
  date?: string;
  eventId?: string;
}): Promise<{ evaluation: HabitDayEvaluation }> {
  return api<{ evaluation: HabitDayEvaluation }>("habits/negative/undo", input);
}

export function updateNegativeEventNoteApi(input: {
  habitId: string;
  eventId: string;
  note: string;
}): Promise<{ evaluation: HabitDayEvaluation }> {
  return api<{ evaluation: HabitDayEvaluation }>("habits/negative/note", input);
}

export function setHabitDailyNoteApi(input: {
  habitId: string;
  date?: string;
  note: string;
}): Promise<{ evaluation: HabitDayEvaluation }> {
  return api<{ evaluation: HabitDayEvaluation }>("habits/daily-note", input);
}
