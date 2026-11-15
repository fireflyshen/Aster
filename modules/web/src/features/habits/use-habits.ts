import type {
  BindTaskHabitInput,
  CreateHabitInput,
  DayDetailResponse,
  HabitDetailResponse,
  HabitListItem,
  HabitStatus,
  HeatmapResponse,
  TodayHabitsResponse,
  UpdateHabitInput,
} from "@core/habits/model";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  bindTaskHabitApi,
  createHabitApi,
  deleteHabitApi,
  fetchHabitDayDetail,
  fetchHabitDetail,
  fetchHabitHeatmap,
  fetchHabitsList,
  fetchTodayHabits,
  recordNegativeEventApi,
  setChecklistItemApi,
  setHabitDailyNoteApi,
  setHabitStatusApi,
  switchDayPlanApi,
  togglePositiveHabitApi,
  unbindTaskHabitApi,
  undoNegativeEventApi,
  updateHabitApi,
  updateNegativeEventNoteApi,
} from "./habits-api";

export function useHabitsWorkspace(options: {
  habitsPageActive: boolean;
  isTodayView: boolean;
  workspaceSyncKey?: string;
}) {
  const { habitsPageActive, isTodayView, workspaceSyncKey } = options;

  const [todayData, setTodayData] = useState<TodayHabitsResponse | null>(null);
  const [allHabits, setAllHabits] = useState<HabitListItem[]>([]);
  const [habits, setHabits] = useState<HabitListItem[]>([]);
  const [heatmap, setHeatmap] = useState<HeatmapResponse | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [dayDetail, setDayDetail] = useState<DayDetailResponse | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [detailData, setDetailData] = useState<HabitDetailResponse | null>(null);

  const [projectFilter, setProjectFilter] = useState<string>("");
  const [tagFilter, setTagFilter] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<HabitStatus | "all">("active");
  const [rangeDays, setRangeDays] = useState<number>(365);

  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const todayGen = useRef(0);
  const workspaceGen = useRef(0);
  const dayGen = useRef(0);
  const detailGen = useRef(0);

  const refreshToday = useCallback(async () => {
    const ticket = ++todayGen.current;
    try {
      const [todayRes, allRes] = await Promise.all([
        fetchTodayHabits(),
        fetchHabitsList({ status: "all" }),
      ]);
      if (ticket !== todayGen.current) return;
      setTodayData(todayRes);
      setAllHabits(allRes.habits);
    } catch (err) {
      if (ticket === todayGen.current) {
        setError((err as Error).message);
      }
    }
  }, []);

  const refreshWorkspace = useCallback(async () => {
    const ticket = ++workspaceGen.current;
    setLoading(true);
    try {
      const [listRes, heatmapRes] = await Promise.all([
        fetchHabitsList({
          status: statusFilter,
          project: projectFilter || undefined,
          tag: tagFilter || undefined,
        }),
        fetchHabitHeatmap({
          days: rangeDays,
          project: projectFilter || undefined,
          tag: tagFilter || undefined,
        }),
      ]);
      if (ticket !== workspaceGen.current) return;
      setHabits(listRes.habits);
      setHeatmap(heatmapRes);
      setError("");
    } catch (err) {
      if (ticket === workspaceGen.current) {
        setError((err as Error).message);
      }
    } finally {
      if (ticket === workspaceGen.current) setLoading(false);
    }
  }, [statusFilter, projectFilter, tagFilter, rangeDays]);

  const refreshDayDetail = useCallback(
    async (date: string | null) => {
      if (!date) {
        setDayDetail(null);
        return;
      }
      const ticket = ++dayGen.current;
      try {
        const res = await fetchHabitDayDetail({
          date,
          project: projectFilter || undefined,
          tag: tagFilter || undefined,
        });
        if (ticket !== dayGen.current) return;
        setDayDetail(res);
      } catch (err) {
        if (ticket === dayGen.current) setError((err as Error).message);
      }
    },
    [projectFilter, tagFilter],
  );

  const refreshDetail = useCallback(
    async (id: string | null) => {
      if (!id) {
        setDetailData(null);
        return;
      }
      const ticket = ++detailGen.current;
      try {
        const res = await fetchHabitDetail(id, rangeDays);
        if (ticket !== detailGen.current) return;
        setDetailData(res);
      } catch (err) {
        if (ticket === detailGen.current) setError((err as Error).message);
      }
    },
    [rangeDays],
  );

  useEffect(() => {
    void refreshToday();
    if (habitsPageActive) {
      void refreshWorkspace();
    }
  }, [refreshToday, refreshWorkspace, habitsPageActive, isTodayView, workspaceSyncKey]);

  useEffect(() => {
    if (habitsPageActive) {
      void refreshDayDetail(selectedDate);
    }
  }, [habitsPageActive, selectedDate, refreshDayDetail]);

  useEffect(() => {
    if (detailId) {
      void refreshDetail(detailId);
    } else {
      setDetailData(null);
    }
  }, [detailId, refreshDetail]);

  const syncAfterMutation = useCallback(
    async (affectedDate?: string) => {
      const tasks: Promise<unknown>[] = [refreshToday()];
      if (habitsPageActive) {
        tasks.push(refreshWorkspace());
        if (selectedDate && (!affectedDate || affectedDate === selectedDate)) {
          tasks.push(refreshDayDetail(selectedDate));
        }
      }
      if (detailId) {
        tasks.push(refreshDetail(detailId));
      }
      await Promise.all(tasks);
    },
    [
      refreshToday,
      habitsPageActive,
      refreshWorkspace,
      selectedDate,
      refreshDayDetail,
      detailId,
      refreshDetail,
    ],
  );

  const runAction = useCallback(
    async <T>(fn: () => Promise<T>, affectedDate?: string): Promise<T | null> => {
      setBusy(true);
      setError("");
      try {
        const result = await fn();
        await syncAfterMutation(affectedDate);
        return result;
      } catch (err) {
        setError((err as Error).message);
        return null;
      } finally {
        setBusy(false);
      }
    },
    [syncAfterMutation],
  );

  const createHabit = useCallback(
    (input: CreateHabitInput) => runAction(() => createHabitApi(input)),
    [runAction],
  );

  const updateHabit = useCallback(
    (habitId: string, patch: UpdateHabitInput) =>
      runAction(() => updateHabitApi(habitId, patch)),
    [runAction],
  );

  const setHabitStatus = useCallback(
    (habitId: string, status: HabitStatus) =>
      runAction(() => setHabitStatusApi(habitId, status)),
    [runAction],
  );

  const deleteHabit = useCallback(
    async (habitId: string) => {
      const res = await runAction(() => deleteHabitApi(habitId));
      if (res && detailId === habitId) {
        setDetailId(null);
      }
      return res;
    },
    [runAction, detailId],
  );

  const togglePositive = useCallback(
    (habitId: string, date?: string, completed?: boolean) =>
      runAction(() => togglePositiveHabitApi(habitId, date, completed), date),
    [runAction],
  );

  const setChecklistItem = useCallback(
    (input: {
      habitId: string;
      itemId: string;
      date?: string;
      done?: boolean;
      sets?: string | null;
      reps?: string | null;
      weight?: string | null;
      planId?: string;
    }) => runAction(() => setChecklistItemApi(input), input.date),
    [runAction],
  );

  const switchPlan = useCallback(
    (habitId: string, planId: string, date?: string) =>
      runAction(() => switchDayPlanApi({ habitId, planId, date }), date),
    [runAction],
  );

  const recordNegative = useCallback(
    (habitId: string, date?: string, note?: string) =>
      runAction(() => recordNegativeEventApi({ habitId, date, note }), date),
    [runAction],
  );

  const undoNegative = useCallback(
    (habitId: string, date?: string, eventId?: string) =>
      runAction(() => undoNegativeEventApi({ habitId, date, eventId }), date),
    [runAction],
  );

  const updateNegativeNote = useCallback(
    (habitId: string, eventId: string, note: string, date?: string) =>
      runAction(() => updateNegativeEventNoteApi({ habitId, eventId, note }), date),
    [runAction],
  );

  const setDailyNote = useCallback(
    (habitId: string, note: string, date?: string) =>
      runAction(() => setHabitDailyNoteApi({ habitId, date, note }), date),
    [runAction],
  );

  const bindTaskHabit = useCallback(
    (input: BindTaskHabitInput) =>
      runAction(() => bindTaskHabitApi(input)),
    [runAction],
  );

  const unbindTaskHabit = useCallback(
    async (taskUuid: string) => {
      const res = await runAction(() => unbindTaskHabitApi(taskUuid));
      if (res && detailId === taskUuid) {
        setDetailId(null);
      }
      return res;
    },
    [runAction, detailId],
  );

  const habitByTaskUuid = useMemo(() => {
    const map = new Map<string, HabitListItem>();
    for (const item of allHabits) {
      map.set(item.taskUuid || item.id, item);
    }
    return map;
  }, [allHabits]);

  const todayScheduledHabitIds = useMemo(
    () =>
      new Set(
        (todayData?.items ?? []).map((item) => item.habit.taskUuid || item.habit.id),
      ),
    [todayData],
  );

  return {
    todayData,
    allHabits,
    habitByTaskUuid,
    todayScheduledHabitIds,
    habits,
    heatmap,
    selectedDate,
    setSelectedDate,
    dayDetail,
    detailId,
    setDetailId,
    detailData,
    projectFilter,
    setProjectFilter,
    tagFilter,
    setTagFilter,
    statusFilter,
    setStatusFilter,
    rangeDays,
    setRangeDays,
    loading,
    busy,
    error,
    setError,
    refreshToday,
    refreshWorkspace,
    createHabit,
    bindTaskHabit,
    unbindTaskHabit,
    updateHabit,
    setHabitStatus,
    deleteHabit,
    togglePositive,
    setChecklistItem,
    switchPlan,
    recordNegative,
    undoNegative,
    updateNegativeNote,
    setDailyNote,
  };
}
