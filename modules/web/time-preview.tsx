import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import "./src/app/styles.css";
import { TimeTodayPage } from "./src/features/time/time-today-page";
import { TimeWeeklyPage } from "./src/features/time/time-weekly-page";
import { TimeCostReportPage } from "./src/features/time/time-cost-report-page";
const date = "2026-11-15",
  start = Date.parse(date + "T08:00:00+08:00");
const segment = (id, title, offset, duration, cost, tags = []) => ({
  activityId: id,
  title,
  startMs: start + offset * 3600000,
  endMs: start + (offset + duration) * 3600000,
  durationSeconds: duration * 3600,
  confirmedSeconds: duration * 3600,
  confirmedCostCents: cost,
  provisionalSeconds: 0,
  provisionalCostCents: 0,
  tags,
  projectSnapshot: "上位机v1学习",
  reviewState: "confirmed",
  categoryId: "work",
  version: 1,
});
const segments = [
  segment("1", "C++ 作用域、生命周期与 using", 0, 1.25, 12497, ["编码"]),
  segment("2", "C++ 指针", 2, 0.6, 6139, ["阅读", "编码"]),
  segment("3", "整理学习笔记与项目回顾", 3, 1, 2239, ["复盘"]),
];
const daily = {
  date,
  coveredSeconds: 10260,
  confirmedCostCents: 20875,
  provisionalCostCents: 0,
  provisionalSeconds: 0,
  unrecordedSeconds: 3600,
  locatedSegments: segments,
  sleepCandidates: [],
  unlocatedEstimates: [],
  gaps: [
    {
      startMs: start + 1.25 * 3600000,
      endMs: start + 2 * 3600000,
      durationSeconds: 2700,
    },
  ],
};
const policy = {
  timezone: "Asia/Shanghai",
  hourlyRateCents: 2239,
  longActivityThresholdSeconds: 21600,
};
const weekly = {
  weekStartDate: "2026-11-09",
  weekEndDate: date,
  coveredSeconds: 40000,
  confirmedCostCents: 60000,
  unrecordedSeconds: 120000,
  unlocatedEstimates: [],
  byProjectSeconds: { 上位机v1学习: 30000, 家庭财务: 10000 },
  byProjectCostCents: { 上位机v1学习: 50000, 家庭财务: 10000 },
  byTagSeconds: { 编码: 24000, 阅读: 16000 },
  byTagCostCents: { 编码: 40000, 阅读: 20000 },
  daily: Array.from({ length: 7 }, (_, i) => ({
    ...daily,
    date: `2026-11-${String(9 + i).padStart(2, "0")}`,
    coveredSeconds: i * 1000,
    confirmedCostCents: i * 2000,
  })),
};
const refs = segments.map((seg) => ({ ...seg, date }));
const tasks = refs.map((seg, i) => ({
  taskUuid: String(i),
  title: seg.title,
  tags: seg.tags,
  periodSeconds: seg.confirmedSeconds,
  periodCostCents: seg.confirmedCostCents,
  cumulativeSeconds: seg.confirmedSeconds,
  cumulativeCostCents: seg.confirmedCostCents,
  overInitialBudgetCents: 0,
  hasBudget: false,
  segments: [seg],
  billLinks: [],
  cashExpenseCents: 0,
}));
const report = {
  granularity: "week",
  periodStartDate: "2026-11-09",
  periodEndDate: date,
  hourlyRateCents: 2239,
  totalPeriodConfirmedCostCents: 20875,
  totalPeriodConfirmedSeconds: 10260,
  totalPeriodProvisionalCostCents: 0,
  totalCashExpenseCents: 0,
  totalCombinedCostCents: 20875,
  byTask: tasks,
  byProject: [
    {
      projectKey: "work",
      projectName: "上位机v1学习",
      periodSeconds: 10260,
      periodCostCents: 20875,
      segments: refs,
    },
  ],
  unassignedSegments: [],
  unassignedBillLinks: [],
};
window.fetch = async () =>
  new Response(JSON.stringify(report), {
    headers: { "content-type": "application/json" },
  });
function Preview() {
  const [page, setPage] = useState("today");
  return (
    <main className="mx-auto max-w-4xl px-5 py-10">
      <nav className="mb-8 flex gap-5">
        {["today", "weekly", "report"].map((p) => (
          <button key={p} onClick={() => setPage(p)}>
            {p}
          </button>
        ))}
      </nav>
      <h1 className="mb-10 text-2xl font-semibold">
        {page === "today"
          ? "今日时间线"
          : page === "weekly"
            ? "本周分布"
            : "成本报告"}
      </h1>
      {page === "today" ? (
        <TimeTodayPage
          policy={policy}
          daily={daily}
          status={null}
          selectedDate={date}
          onSelectDate={() => {}}
          plans={[
            { id: "hidden", status: "ready", title: "不应显示的待开始计划" },
          ]}
          events={[]}
          pendingDetails={[]}
          tasks={[]}
          busy={false}
          onAckEvents={() => {}}
          runMutation={async () => {}}
        />
      ) : page === "weekly" ? (
        <TimeWeeklyPage
          policy={policy}
          selectedDate={date}
          onSelectDate={() => {}}
          weekly={weekly}
          onOpenDay={() => setPage("today")}
        />
      ) : (
        <TimeCostReportPage
          policy={policy}
          selectedDate={date}
          onSelectDate={() => {}}
          onOpenDay={() => setPage("today")}
        />
      )}
    </main>
  );
}
createRoot(document.getElementById("root")).render(<Preview />);
