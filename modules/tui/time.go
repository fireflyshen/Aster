package main

import (
	"errors"
	"fmt"
	"math"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
)

const defaultHourlyRateCents int64 = 10000

type TaskCostSummary struct {
	TaskUUID                string   `json:"taskUuid"`
	ConfirmedSeconds        float64  `json:"confirmedSeconds"`
	ConfirmedCostCents      int64    `json:"confirmedCostCents"`
	ProvisionalSeconds      float64  `json:"provisionalSeconds"`
	ProvisionalCostCents    int64    `json:"provisionalCostCents"`
	HasBudget               bool     `json:"hasBudget"`
	InitialAllowanceSeconds *float64 `json:"initialAllowanceSeconds,omitempty"`
	InitialBudgetCents      *int64   `json:"initialBudgetCents,omitempty"`
	CurrentAllowanceSeconds *float64 `json:"currentAllowanceSeconds,omitempty"`
	CurrentBudgetCents      *int64   `json:"currentBudgetCents,omitempty"`
	AddedBudgetCents        int64    `json:"addedBudgetCents"`
	OverInitialBudgetCents  int64    `json:"overInitialBudgetCents"`
	OverCurrentBudgetCents  int64    `json:"overCurrentBudgetCents"`
	PlannedStartAtMs        *int64   `json:"plannedStartAtMs,omitempty"`
	HardStopAtMs            *int64   `json:"hardStopAtMs,omitempty"`
	LinkedCashCents         int64    `json:"linkedCashCents"`
	CombinedCostCents       int64    `json:"combinedCostCents"`
	CurrentHourlyRateCents  int64    `json:"currentHourlyRateCents"`
}

type SleepTemplate struct {
	Enabled   bool   `json:"enabled"`
	StartTime string `json:"startTime"`
	EndTime   string `json:"endTime"`
	Version   int    `json:"version"`
}

type ReconcileReminderPolicy struct {
	Enabled bool `json:"enabled"`
	Hour    int  `json:"hour"`
	Minute  int  `json:"minute"`
}

type TimePolicy struct {
	PolicyVersion                int                     `json:"policyVersion"`
	Timezone                     string                  `json:"timezone"`
	SleepTemplate                SleepTemplate           `json:"sleepTemplate"`
	LongActivityThresholdSeconds int                     `json:"longActivityThresholdSeconds"`
	ReconcileReminder            ReconcileReminderPolicy `json:"reconcileReminder"`
	HourlyRateCents              *int64                  `json:"hourlyRateCents,omitempty"`
	TaskListHighlightCost        *bool                   `json:"taskListHighlightCost,omitempty"`
}

type LocatedSegment struct {
	ActivityID           string   `json:"activityId"`
	Version              int      `json:"version"`
	Title                string   `json:"title"`
	CategoryID           string   `json:"categoryId"`
	TaskUUID             string   `json:"taskUuid,omitempty"`
	ProjectSnapshot      string   `json:"projectSnapshot,omitempty"`
	Tags                 []string `json:"tags,omitempty"`
	HourlyRateCents      *int64   `json:"hourlyRateCents,omitempty"`
	StartMs              int64    `json:"startMs"`
	EndMs                int64    `json:"endMs"`
	DurationSeconds      float64  `json:"durationSeconds"`
	ConfirmedSeconds     float64  `json:"confirmedSeconds"`
	ProvisionalSeconds   float64  `json:"provisionalSeconds"`
	ConfirmedCostCents   int64    `json:"confirmedCostCents"`
	ProvisionalCostCents int64    `json:"provisionalCostCents"`
	Running              bool     `json:"running"`
	Precision            string   `json:"precision"`
	Source               string   `json:"source"`
	ReviewState          string   `json:"reviewState"`
	SuspendMs            *int64   `json:"suspendMs,omitempty"`
	ConfirmedThroughMs   *int64   `json:"confirmedThroughMs,omitempty"`
	ReviewDueAtMs        *int64   `json:"reviewDueAtMs,omitempty"`
	ReviewReason         string   `json:"reviewReason,omitempty"`
	TimingPlanID         string   `json:"timingPlanId,omitempty"`
	AutoStopAtMs         *int64   `json:"autoStopAtMs,omitempty"`
	TimerStoppedAtMs     *int64   `json:"timerStoppedAtMs,omitempty"`
	StopReason           string   `json:"stopReason,omitempty"`
	ExceededPlanSeconds  *float64 `json:"exceededPlanSeconds,omitempty"`
}

type SleepCandidate struct {
	Key             string `json:"key"`
	Date            string `json:"date"`
	TemplateVersion int    `json:"templateVersion"`
	StartMs         int64  `json:"startMs"`
	EndMs           int64  `json:"endMs"`
	Status          string `json:"status"`
	ActivityID      string `json:"activityId,omitempty"`
	HasConflict     bool   `json:"hasConflict"`
}

type DailyLedgerSummary struct {
	Date                   string             `json:"date"`
	Timezone               string             `json:"timezone"`
	DayStartMs             int64              `json:"dayStartMs"`
	DayEndMs               int64              `json:"dayEndMs"`
	AsOfMs                 int64              `json:"asOfMs"`
	PastCapacitySeconds    float64            `json:"pastCapacitySeconds"`
	CoveredSeconds         float64            `json:"coveredSeconds"`
	ProvisionalSeconds     float64            `json:"provisionalSeconds"`
	ConfirmedCostCents     int64              `json:"confirmedCostCents"`
	ProvisionalCostCents   int64              `json:"provisionalCostCents"`
	UnrecordedSeconds      float64            `json:"unrecordedSeconds"`
	EstimatedBoundsSeconds float64            `json:"estimatedBoundsSeconds"`
	ReviewRequiredSeconds  float64            `json:"reviewRequiredSeconds"`
	ByProjectSeconds       map[string]float64 `json:"byProjectSeconds"`
	ByProjectCostCents     map[string]int64   `json:"byProjectCostCents"`
	ByTagSeconds           map[string]float64 `json:"byTagSeconds"`
	ByTagCostCents         map[string]int64   `json:"byTagCostCents"`
	LocatedSegments        []LocatedSegment   `json:"locatedSegments"`
	SleepCandidates        []SleepCandidate   `json:"sleepCandidates"`
}

type WeeklyDistributionSummary struct {
	WeekStartDate          string             `json:"weekStartDate"`
	WeekEndDate            string             `json:"weekEndDate"`
	Timezone               string             `json:"timezone"`
	AsOfMs                 int64              `json:"asOfMs"`
	IsPartialWeek          bool               `json:"isPartialWeek"`
	PastCapacitySeconds    float64            `json:"pastCapacitySeconds"`
	CoveredSeconds         float64            `json:"coveredSeconds"`
	ProvisionalSeconds     float64            `json:"provisionalSeconds"`
	ConfirmedCostCents     int64              `json:"confirmedCostCents"`
	ProvisionalCostCents   int64              `json:"provisionalCostCents"`
	UnrecordedSeconds      float64            `json:"unrecordedSeconds"`
	EstimatedBoundsSeconds float64            `json:"estimatedBoundsSeconds"`
	ReviewRequiredSeconds  float64            `json:"reviewRequiredSeconds"`
	ByProjectSeconds       map[string]float64 `json:"byProjectSeconds"`
	ByProjectCostCents     map[string]int64   `json:"byProjectCostCents"`
	ByTagSeconds           map[string]float64 `json:"byTagSeconds"`
	ByTagCostCents         map[string]int64   `json:"byTagCostCents"`
}

type TimingPlan struct {
	ID                      string   `json:"id"`
	Version                 int      `json:"version"`
	Title                   string   `json:"title"`
	CategoryID              string   `json:"categoryId,omitempty"`
	TaskUUID                string   `json:"taskUuid,omitempty"`
	ProjectSnapshot         string   `json:"projectSnapshot,omitempty"`
	Tags                    []string `json:"tags,omitempty"`
	Note                    string   `json:"note,omitempty"`
	Timezone                string   `json:"timezone"`
	HourlyRateCents         *int64   `json:"hourlyRateCents,omitempty"`
	InitialAllowanceSeconds *float64 `json:"initialAllowanceSeconds,omitempty"`
	InitialBudgetCents      *int64   `json:"initialBudgetCents,omitempty"`
	AllowanceSeconds        *float64 `json:"allowanceSeconds,omitempty"`
	CurrentBudgetCents      *int64   `json:"currentBudgetCents,omitempty"`
	PlannedStartAtMs        *int64   `json:"plannedStartAtMs,omitempty"`
	HardStopAtMs            *int64   `json:"hardStopAtMs,omitempty"`
	ConsumedSeconds         float64  `json:"consumedSeconds"`
	RemainingSeconds        *float64 `json:"remainingSeconds,omitempty"`
	EffectiveAutoStopAtMs   *int64   `json:"effectiveAutoStopAtMs,omitempty"`
	EffectiveAutoStopBasis  string   `json:"effectiveAutoStopBasis,omitempty"`
	Status                  string   `json:"status"`
	LastStopReason          string   `json:"lastStopReason,omitempty"`
	LastStoppedAtMs         *int64   `json:"lastStoppedAtMs,omitempty"`
	ActiveActivityID        string   `json:"activeActivityId,omitempty"`
}

type BillExpenseItem struct {
	TxKey          string   `json:"txKey"`
	Source         string   `json:"source"`
	TxID           string   `json:"txId"`
	PayTime        string   `json:"payTime"`
	Payee          string   `json:"payee"`
	Narration      string   `json:"narration"`
	Account        string   `json:"account"`
	Amount         float64  `json:"amount"`
	Currency       string   `json:"currency"`
	CnyAmountCents int64    `json:"cnyAmountCents"`
	Tags           []string `json:"tags"`
}

type BillLink struct {
	ID             string `json:"id"`
	TxKey          string `json:"txKey"`
	TaskUUID       string `json:"taskUuid,omitempty"`
	ActivityID     string `json:"activityId,omitempty"`
	Source         string `json:"source"`
	TxID           string `json:"txId"`
	PayTime        string `json:"payTime"`
	Payee          string `json:"payee"`
	Narration      string `json:"narration"`
	Account        string `json:"account"`
	Currency       string `json:"currency"`
	CnyAmountCents int64  `json:"cnyAmountCents"`
	Note           string `json:"note,omitempty"`
}

type TaskCostDetailResponse struct {
	Summary   TaskCostSummary  `json:"summary"`
	Segments  []LocatedSegment `json:"segments"`
	Plans     []TimingPlan     `json:"plans"`
	BillLinks []BillLink       `json:"billLinks"`
}

type CostReportSegmentRef struct {
	ActivityID           string   `json:"activityId"`
	Title                string   `json:"title"`
	Date                 string   `json:"date"`
	StartMs              int64    `json:"startMs"`
	EndMs                int64    `json:"endMs"`
	ConfirmedSeconds     float64  `json:"confirmedSeconds"`
	ConfirmedCostCents   int64    `json:"confirmedCostCents"`
	ProvisionalSeconds   float64  `json:"provisionalSeconds"`
	ProvisionalCostCents int64    `json:"provisionalCostCents"`
	HourlyRateCents      int64    `json:"hourlyRateCents"`
	ProjectSnapshot      string   `json:"projectSnapshot,omitempty"`
	Tags                 []string `json:"tags,omitempty"`
	TaskUUID             string   `json:"taskUuid,omitempty"`
	ReviewState          string   `json:"reviewState"`
}

type CostReportTaskRow struct {
	TaskUUID                       string                 `json:"taskUuid"`
	Title                          string                 `json:"title"`
	ProjectSnapshot                string                 `json:"projectSnapshot,omitempty"`
	Tags                           []string               `json:"tags"`
	PeriodSeconds                  float64                `json:"periodSeconds"`
	PeriodCostCents                int64                  `json:"periodCostCents"`
	PeriodProvisionalCostCents     int64                  `json:"periodProvisionalCostCents"`
	CumulativeSeconds              float64                `json:"cumulativeSeconds"`
	CumulativeCostCents            int64                  `json:"cumulativeCostCents"`
	CumulativeProvisionalCostCents int64                  `json:"cumulativeProvisionalCostCents"`
	HasBudget                      bool                   `json:"hasBudget"`
	InitialBudgetCents             *int64                 `json:"initialBudgetCents,omitempty"`
	CurrentBudgetCents             *int64                 `json:"currentBudgetCents,omitempty"`
	OverInitialBudgetCents         int64                  `json:"overInitialBudgetCents"`
	CashExpenseCents               int64                  `json:"cashExpenseCents"`
	CombinedCumulativeCostCents    int64                  `json:"combinedCumulativeCostCents"`
	Segments                       []CostReportSegmentRef `json:"segments"`
	BillLinks                      []BillLink             `json:"billLinks"`
}

type CostReportProjectRow struct {
	ProjectKey                 string                 `json:"projectKey"`
	ProjectName                string                 `json:"projectName"`
	PeriodSeconds              float64                `json:"periodSeconds"`
	PeriodCostCents            int64                  `json:"periodCostCents"`
	PeriodProvisionalCostCents int64                  `json:"periodProvisionalCostCents"`
	OverInitialBudgetCents     int64                  `json:"overInitialBudgetCents"`
	CashExpenseCents           int64                  `json:"cashExpenseCents"`
	CombinedPeriodCostCents    int64                  `json:"combinedPeriodCostCents"`
	TaskCount                  int                    `json:"taskCount"`
	Segments                   []CostReportSegmentRef `json:"segments"`
}

type CostReportSummary struct {
	Granularity                   string                 `json:"granularity"`
	PeriodStartDate               string                 `json:"periodStartDate"`
	PeriodEndDate                 string                 `json:"periodEndDate"`
	Timezone                      string                 `json:"timezone"`
	SortBy                        string                 `json:"sortBy"`
	HourlyRateCents               int64                  `json:"hourlyRateCents"`
	TotalPeriodConfirmedSeconds   float64                `json:"totalPeriodConfirmedSeconds"`
	TotalPeriodConfirmedCostCents int64                  `json:"totalPeriodConfirmedCostCents"`
	TotalPeriodProvisionalSeconds float64                `json:"totalPeriodProvisionalSeconds"`
	TotalPeriodProvisionalCents   int64                  `json:"totalPeriodProvisionalCostCents"`
	TotalCashExpenseCents         int64                  `json:"totalCashExpenseCents"`
	TotalCombinedCostCents        int64                  `json:"totalCombinedCostCents"`
	ByProject                     []CostReportProjectRow `json:"byProject"`
	ByTask                        []CostReportTaskRow    `json:"byTask"`
	UnassignedSegments            []CostReportSegmentRef `json:"unassignedSegments"`
	UnassignedBillLinks           []BillLink             `json:"unassignedBillLinks"`
}

type TimeState struct {
	SelectedDate       string
	Daily              *DailyLedgerSummary
	Weekly             *WeeklyDistributionSummary
	Plans              []TimingPlan
	Policy             *TimePolicy
	Report             *CostReportSummary
	ReportGranularity  string
	ReportSort         string
	ReportGroupBy      string
	TaskDetail         *TaskCostDetailResponse
	TaskDetailUUID     string
	Bills              []BillExpenseItem
	BillTargetTaskUUID string
	BillTargetActivity string
	BillUnlinkChoices  []BillLink
	EditingPlan        *TimingPlan
	EditingSegment     *LocatedSegment
}

type continuationPreview struct {
	RequestedSeconds         float64
	HardStopRemainingSeconds *float64
	EffectiveSeconds         float64
	AdditionalCostCents      int64
	CappedByHardStop         bool
	Expired                  bool
}

type timeDataLoadedMsg struct {
	view           string
	daily          *DailyLedgerSummary
	weekly         *WeeklyDistributionSummary
	plans          []TimingPlan
	policy         *TimePolicy
	report         *CostReportSummary
	taskDetail     *TaskCostDetailResponse
	taskDetailUUID string
	bills          []BillExpenseItem
	billsAvailable bool
	billTaskUUID   string
	billActivityID string
	openSettings   bool
	openPlanExtend *TimingPlan
	err            error
}

type timeMutationMsg struct {
	err            error
	message        string
	refreshTaskDet string
}

func idempotencyKey(prefix string) string {
	return fmt.Sprintf("tui-%s-%d", prefix, time.Now().UnixNano())
}

func normalizeHourlyRateCents(rate int64) int64 {
	if rate <= 0 {
		return defaultHourlyRateCents
	}
	return rate
}

func formatCurrencyCny(cents int64) string {
	sign := ""
	abs := cents
	if abs < 0 {
		sign = "-"
		abs = -abs
	}
	if abs%100 == 0 {
		return fmt.Sprintf("%s¥%d", sign, abs/100)
	}
	if abs%10 == 0 {
		return fmt.Sprintf("%s¥%.1f", sign, float64(abs)/100)
	}
	return fmt.Sprintf("%s¥%.2f", sign, float64(abs)/100)
}

func computeDurationCostCents(seconds float64, hourlyRateCents int64) int64 {
	if seconds <= 0 || hourlyRateCents <= 0 {
		return 0
	}
	return int64(math.Round((seconds * float64(hourlyRateCents)) / 3600))
}

func formatRateConversionHint(hourlyRateCents int64) string {
	rate := normalizeHourlyRateCents(hourlyRateCents)
	return fmt.Sprintf(
		"30 分钟 ≈ %s，2 小时 ≈ %s",
		formatCurrencyCny(computeDurationCostCents(1800, rate)),
		formatCurrencyCny(computeDurationCostCents(7200, rate)),
	)
}

func computeContinuationCostPreview(
	requestedSeconds float64,
	hourlyRateCents int64,
	hardStopAtMs *int64,
	nowMs int64,
) continuationPreview {
	if requestedSeconds < 0 {
		requestedSeconds = 0
	}
	req := math.Round(requestedSeconds)
	rate := normalizeHourlyRateCents(hourlyRateCents)
	var remPtr *float64
	expired := false
	effective := req
	capped := false
	if hardStopAtMs != nil {
		rem := math.Max(0, math.Floor(float64(*hardStopAtMs-nowMs)/1000))
		remPtr = &rem
		if rem <= 0 {
			expired = true
		}
		if rem < effective {
			effective = rem
		}
		if req > rem {
			capped = true
		}
	}
	return continuationPreview{
		RequestedSeconds:         req,
		HardStopRemainingSeconds: remPtr,
		EffectiveSeconds:         effective,
		AdditionalCostCents:      computeDurationCostCents(effective, rate),
		CappedByHardStop:         capped,
		Expired:                  expired,
	}
}

func highlightTaskListCost(snap *TimerSnapshot) bool {
	if snap != nil && snap.TaskListHighlightCost != nil {
		return *snap.TaskListHighlightCost
	}
	return true
}

func currentHourlyRateCents(snap *TimerSnapshot, policy *TimePolicy) int64 {
	if policy != nil && policy.HourlyRateCents != nil && *policy.HourlyRateCents > 0 {
		return *policy.HourlyRateCents
	}
	if snap != nil && snap.HourlyRateCents > 0 {
		return snap.HourlyRateCents
	}
	return defaultHourlyRateCents
}

func isSleepActivity(act *ActiveActivitySnapshot) bool {
	return act != nil && strings.EqualFold(act.CategoryID, "sleep")
}

func lookupTaskCost(snap *TimerSnapshot, uuid string) (TaskCostSummary, bool) {
	if snap == nil || len(snap.TaskCosts) == 0 || uuid == "" {
		return TaskCostSummary{}, false
	}
	if s, ok := snap.TaskCosts[strings.ToLower(uuid)]; ok {
		return s, true
	}
	s, ok := snap.TaskCosts[uuid]
	return s, ok
}

func displayedTaskCost(
	snap *TimerSnapshot,
	uuid string,
	isTiming bool,
	extraSecs float64,
) (TaskCostSummary, bool) {
	sum, ok := lookupTaskCost(snap, uuid)
	if !ok {
		return TaskCostSummary{}, false
	}
	if !isTiming || extraSecs <= 0 || snap == nil || snap.ActiveActivity == nil ||
		isSleepActivity(snap.ActiveActivity) {
		return sum, true
	}
	rate := snap.ActiveActivity.HourlyRateCents
	if rate <= 0 {
		rate = sum.CurrentHourlyRateCents
	}
	if rate <= 0 {
		rate = normalizeHourlyRateCents(snap.HourlyRateCents)
	}
	extraCost := computeDurationCostCents(extraSecs, rate)
	sum.ProvisionalSeconds += extraSecs
	sum.ProvisionalCostCents += extraCost
	return sum, true
}

func displayedActiveCost(
	snap *TimerSnapshot,
	now time.Time,
	activeElapsed float64,
	hasElapsed bool,
) (isSleep bool, confirmedCents int64, provisionalCents int64, ok bool) {
	if snap == nil || snap.ActiveActivity == nil {
		return false, 0, 0, false
	}
	act := snap.ActiveActivity
	if isSleepActivity(act) {
		return true, 0, 0, true
	}
	if !hasElapsed {
		return false, 0, 0, false
	}
	rate := act.HourlyRateCents
	if rate <= 0 {
		rate = normalizeHourlyRateCents(snap.HourlyRateCents)
	}
	started := date(act.StartedAt)
	var confirmedSecs float64
	if act.ConfirmedThrough != "" && !started.IsZero() {
		if conf := date(act.ConfirmedThrough); !conf.IsZero() && !conf.Before(started) {
			confirmedSecs = min(activeElapsed, conf.Sub(started).Seconds())
		}
	}
	provSecs := max(0.0, activeElapsed-confirmedSecs)
	return false, computeDurationCostCents(confirmedSecs, rate), computeDurationCostCents(provSecs, rate), true
}

func formatAutoStopCountdown(autoStopAt string, now time.Time) (string, bool) {
	if autoStopAt == "" {
		return "", false
	}
	stop := date(autoStopAt)
	if stop.IsZero() {
		return "", false
	}
	rem := stop.Sub(now)
	clock := stop.Local().Format("15:04")
	if rem <= 0 {
		return "已到 " + clock, true
	}
	return fmt.Sprintf("剩 %s · %s 停", formatDurationShort(rem.Seconds()), clock), true
}

func timingPlanStatusLabel(status string) string {
	switch status {
	case "scheduled":
		return "待开始"
	case "active":
		return "计时中"
	case "paused":
		return "已暂停"
	case "stopped":
		return "已停止"
	case "expired":
		return "已过期"
	case "archived":
		return "已归档"
	default:
		if status == "" {
			return "待开始"
		}
		return status
	}
}

func formatClockMs(ms int64) string {
	if ms <= 0 {
		return "—"
	}
	return time.UnixMilli(ms).Local().Format("15:04")
}

func formatDateTimeMs(ms int64) string {
	if ms <= 0 {
		return "—"
	}
	return time.UnixMilli(ms).Local().Format("2006-01-02 15:04")
}

func formatClockRangeMs(startMs, endMs int64) string {
	if startMs <= 0 && endMs <= 0 {
		return "—"
	}
	if endMs <= 0 {
		return formatClockMs(startMs) + " – 进行中"
	}
	return formatClockMs(startMs) + "–" + formatClockMs(endMs)
}

func formatProjectAndTags(project string, tags []string) string {
	var parts []string
	if strings.TrimSpace(project) != "" {
		parts = append(parts, project)
	}
	for _, t := range tags {
		if strings.TrimSpace(t) != "" {
			parts = append(parts, "#"+t)
		}
	}
	return strings.Join(parts, " ")
}

func parseTimeInputToSpec(input string, defaultDate string) (ms *int64, dateStr string, timeStr string, err error) {
	raw := strings.TrimSpace(input)
	if raw == "" {
		return nil, "", "", nil
	}
	if len(raw) <= 5 && strings.Contains(raw, ":") {
		parts := strings.Split(raw, ":")
		if len(parts) != 2 {
			return nil, "", "", fmt.Errorf("时间格式应为 HH:MM 或 YYYY-MM-DD HH:MM")
		}
		h, eh := strconv.Atoi(parts[0])
		minVal, em := strconv.Atoi(parts[1])
		if eh != nil || em != nil || h < 0 || h > 23 || minVal < 0 || minVal > 59 {
			return nil, "", "", fmt.Errorf("小时(0-23)或分钟(0-59)无效")
		}
		clock := fmt.Sprintf("%02d:%02d", h, minVal)
		return nil, defaultDate, clock, nil
	}
	for _, layout := range []string{"2006-01-02 15:04", "2006-01-02T15:04"} {
		if parsed, e := time.ParseInLocation(layout, raw, time.Local); e == nil {
			v := parsed.UnixMilli()
			return &v, "", "", nil
		}
	}
	return nil, "", "", fmt.Errorf("日期时间格式应为 HH:MM 或 YYYY-MM-DD HH:MM")
}

func parseDateTimeMs(input string, defaultDate string) (int64, error) {
	ms, d, tm, err := parseTimeInputToSpec(input, defaultDate)
	if err != nil {
		return 0, err
	}
	if ms != nil {
		return *ms, nil
	}
	if tm == "" {
		return 0, errRequired("时间")
	}
	if d == "" {
		d = time.Now().Format("2006-01-02")
	}
	parsed, e := time.ParseInLocation("2006-01-02 15:04", d+" "+tm, time.Local)
	if e != nil {
		return 0, fmt.Errorf("日期时间无效")
	}
	return parsed.UnixMilli(), nil
}

func parseYuanToCents(input string) (int64, error) {
	raw := strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(input), "¥"))
	if raw == "" {
		return 0, errRequired("时间单价（元/小时）")
	}
	v, err := strconv.ParseFloat(raw, 64)
	if err != nil || math.IsNaN(v) || math.IsInf(v, 0) || v <= 0 {
		return 0, fmt.Errorf("请输入大于 0 的金额（例如 100 或 120.5）")
	}
	cents := int64(math.Round(v * 100))
	if cents <= 0 {
		return 0, fmt.Errorf("金额必须大于 0")
	}
	return cents, nil
}

func (m model) isTimeNavView() bool {
	return m.view == "time.today" || m.view == "time.weekly" || m.view == "time.report"
}

func (m model) effectiveTimeDate() string {
	if m.timeState.SelectedDate != "" {
		return m.timeState.SelectedDate
	}
	return time.Now().Format("2006-01-02")
}

func (m model) timeReportDefaults() (granularity, sortBy, groupBy string) {
	granularity = m.timeState.ReportGranularity
	if granularity != "month" {
		granularity = "week"
	}
	sortBy = m.timeState.ReportSort
	if sortBy != "highest_over_budget" {
		sortBy = "highest_cost"
	}
	groupBy = m.timeState.ReportGroupBy
	if groupBy != "project" {
		groupBy = "task"
	}
	return granularity, sortBy, groupBy
}

func (m model) loadTimeViewCmd(view string) tea.Cmd {
	d := m.effectiveTimeDate()
	gran, sortBy, _ := m.timeReportDefaults()
	c := m.client
	return func() tea.Msg {
		if _, err := c.workspace(); err != nil {
			return timeDataLoadedMsg{view: view, err: err}
		}
		var policy TimePolicy
		_ = c.request("/api/time/policy", nil, &policy)
		msg := timeDataLoadedMsg{view: view, policy: &policy}
		switch view {
		case "time.today":
			var daily DailyLedgerSummary
			if err := c.request("/api/time/daily?date="+url.QueryEscape(d), nil, &daily); err != nil {
				msg.err = err
				return msg
			}
			var plans struct {
				Plans []TimingPlan `json:"plans"`
			}
			_ = c.request("/api/time/plans", nil, &plans)
			msg.daily = &daily
			msg.plans = plans.Plans
		case "time.weekly":
			var weekly WeeklyDistributionSummary
			if err := c.request("/api/time/weekly?date="+url.QueryEscape(d), nil, &weekly); err != nil {
				msg.err = err
				return msg
			}
			msg.weekly = &weekly
		case "time.report":
			var rep CostReportSummary
			q := fmt.Sprintf(
				"/api/time/cost-report?granularity=%s&date=%s&sortBy=%s",
				url.QueryEscape(gran),
				url.QueryEscape(d),
				url.QueryEscape(sortBy),
			)
			if err := c.request(q, nil, &rep); err != nil {
				msg.err = err
				return msg
			}
			msg.report = &rep
		}
		return msg
	}
}

func (m model) fetchTaskCostDetailCmd(taskUUID string) tea.Cmd {
	c := m.client
	return func() tea.Msg {
		if _, err := c.workspace(); err != nil {
			return timeDataLoadedMsg{err: err}
		}
		var det TaskCostDetailResponse
		if err := c.request("/api/time/task-detail?taskUuid="+url.QueryEscape(taskUUID), nil, &det); err != nil {
			return timeDataLoadedMsg{err: err}
		}
		var policy TimePolicy
		_ = c.request("/api/time/policy", nil, &policy)
		return timeDataLoadedMsg{
			taskDetail:     &det,
			taskDetailUUID: taskUUID,
			policy:         &policy,
		}
	}
}

func (m model) fetchBillsCmd(query, taskUUID, activityID string) tea.Cmd {
	c := m.client
	return func() tea.Msg {
		if _, err := c.workspace(); err != nil {
			return timeDataLoadedMsg{err: err}
		}
		route := "/api/time/bills/expenses?limit=60"
		if strings.TrimSpace(query) != "" {
			route += "&q=" + url.QueryEscape(strings.TrimSpace(query))
		}
		var resp struct {
			Available bool              `json:"available"`
			Expenses  []BillExpenseItem `json:"expenses"`
		}
		if err := c.request(route, nil, &resp); err != nil {
			return timeDataLoadedMsg{err: err}
		}
		return timeDataLoadedMsg{
			bills:          resp.Expenses,
			billsAvailable: resp.Available,
			billTaskUUID:   taskUUID,
			billActivityID: activityID,
		}
	}
}

func (m model) fetchPolicyForSettingsCmd() tea.Cmd {
	c := m.client
	return func() tea.Msg {
		if _, err := c.workspace(); err != nil {
			return timeDataLoadedMsg{err: err}
		}
		var policy TimePolicy
		if err := c.request("/api/time/policy", nil, &policy); err != nil {
			return timeDataLoadedMsg{err: err}
		}
		return timeDataLoadedMsg{policy: &policy, openSettings: true}
	}
}

func (m model) fetchPlanForExtendCmd(planID string) tea.Cmd {
	c := m.client
	return func() tea.Msg {
		if _, err := c.workspace(); err != nil {
			return timeDataLoadedMsg{err: err}
		}
		var resp struct {
			Plan TimingPlan `json:"plan"`
		}
		if err := c.request("/api/time/plan?id="+url.QueryEscape(planID), nil, &resp); err != nil {
			return timeDataLoadedMsg{err: err}
		}
		return timeDataLoadedMsg{openPlanExtend: &resp.Plan}
	}
}

func (m model) handleTimeLoaded(msg timeDataLoadedMsg) (tea.Model, tea.Cmd) {
	m.busy = false
	if msg.err != nil {
		m.message = msg.err.Error()
		return m, nil
	}
	if msg.policy != nil {
		m.timeState.Policy = msg.policy
	}
	if msg.daily != nil {
		m.timeState.Daily = msg.daily
	}
	if msg.plans != nil {
		m.timeState.Plans = msg.plans
	}
	if msg.weekly != nil {
		m.timeState.Weekly = msg.weekly
	}
	if msg.report != nil {
		m.timeState.Report = msg.report
	}
	if msg.taskDetail != nil {
		m.timeState.TaskDetail = msg.taskDetail
		m.timeState.TaskDetailUUID = msg.taskDetailUUID
		if msg.openPlanExtend == nil && !msg.openSettings && len(msg.bills) == 0 {
			m.detail = true
			m.message = "已加载任务成本与流水明细"
		}
	}
	if msg.openSettings {
		return m, m.openTimeSettingsForm()
	}
	if msg.openPlanExtend != nil {
		return m, m.openExtendPlanForm(*msg.openPlanExtend)
	}
	if msg.billTaskUUID != "" || msg.billActivityID != "" {
		if !msg.billsAvailable {
			m.message = "Bills 数据目录不可用，请确认服务端配置"
			return m, nil
		}
		m.timeState.Bills = msg.bills
		m.timeState.BillTargetTaskUUID = msg.billTaskUUID
		m.timeState.BillTargetActivity = msg.billActivityID
		options := []choice{
			{"time.bill.search", "按关键词搜索 Bill 账单…", "向服务端查询更多历史支出"},
		}
		for i, b := range msg.bills {
			label := fmt.Sprintf("%s  %s · %s", formatCurrencyCny(b.CnyAmountCents), fallbackStr(b.Payee, b.Narration, b.Account), b.PayTime)
			hint := strings.TrimSpace(strings.Join([]string{b.Account, b.Narration}, " · "))
			options = append(options, choice{fmt.Sprintf("time.bill.pick:%d", i), label, hint})
		}
		m.choose(options, -1)
		return m, nil
	}
	m.syncTimeExtraRows()
	return m, nil
}

func (m model) handleTimeMutation(msg timeMutationMsg) (tea.Model, tea.Cmd) {
	m.busy = false
	if msg.err != nil {
		m.message = msg.err.Error()
		var e *requestError
		if errors.As(msg.err, &e) &&
			(e.uncertain || e.code == 409 || e.code == 423) {
			m.blocked = true
			m.message += " · 请按 r 刷新核对"
		}
		return m, nil
	}
	m.mode = ""
	m.fields = nil
	m.timeState.EditingPlan = nil
	m.timeState.EditingSegment = nil
	m.message = msg.message
	m.busy = true
	var cmds []tea.Cmd
	cmds = append(cmds, m.refresh())
	if m.isTimeNavView() {
		cmds = append(cmds, m.loadTimeViewCmd(m.view))
	}
	targetUUID := msg.refreshTaskDet
	if targetUUID == "" && m.detail && m.current().kind == "task" {
		targetUUID = m.current().id
	} else if targetUUID == "" && m.timeState.TaskDetailUUID != "" && m.timeState.TaskDetailUUID == m.current().id {
		targetUUID = m.timeState.TaskDetailUUID
	}
	if targetUUID != "" {
		cmds = append(cmds, m.fetchTaskCostDetailCmd(targetUUID))
	}
	return m, tea.Batch(cmds...)
}

func (m *model) syncTimeExtraRows() {
	if !m.isTimeNavView() {
		return
	}
	var out []row
	d := m.effectiveTimeDate()
	rate := currentHourlyRateCents(m.timerSnap, m.timeState.Policy)
	switch m.view {
	case "time.today":
		sub := fmt.Sprintf("时间单价 %s/h · [ 上一天 · ] 下一天 · . 今天 · , 设置", formatCurrencyCny(rate))
		if m.timeState.Daily != nil {
			dl := m.timeState.Daily
			sub = fmt.Sprintf(
				"已确认 %s (%s) · 待核对 %s · 空白 %s · 单价 %s/h",
				formatCurrencyCny(dl.ConfirmedCostCents),
				formatDurationShort(dl.CoveredSeconds),
				formatCurrencyCny(dl.ProvisionalCostCents),
				formatDurationShort(dl.UnrecordedSeconds),
				formatCurrencyCny(rate),
			)
		}
		out = append(out, row{
			kind:     "time.summary",
			id:       d,
			title:    "今日时间与有界计划 · " + d,
			subtitle: sub,
		})
		if m.timeState.Daily != nil {
			for _, sc := range m.timeState.Daily.SleepCandidates {
				st := "待确认"
				if sc.Status == "confirmed" {
					st = "已确认"
				} else if sc.Status == "dismissed" {
					st = "已忽略"
				}
				conf := ""
				if sc.HasConflict {
					conf = " · 与已有记录重叠"
				}
				out = append(out, row{
					kind:     "time.sleep_candidate",
					id:       sc.Date,
					title:    "睡眠候选 " + sc.Date + " (" + formatClockRangeMs(sc.StartMs, sc.EndMs) + ")",
					subtitle: st + " · ¥0 · 免除 6h 检查点" + conf,
				})
			}
		}
		for _, p := range m.timeState.Plans {
			budgetText := "未设额度"
			if p.CurrentBudgetCents != nil {
				budgetText = formatCurrencyCny(*p.CurrentBudgetCents)
			}
			stopText := ""
			if p.EffectiveAutoStopAtMs != nil {
				stopText = " · 截止 " + formatClockMs(*p.EffectiveAutoStopAtMs)
			} else if p.HardStopAtMs != nil {
				stopText = " · 最晚 " + formatClockMs(*p.HardStopAtMs)
			}
			remText := ""
			if p.RemainingSeconds != nil {
				remText = " / 剩 " + formatDurationShort(*p.RemainingSeconds)
			}
			scope := formatProjectAndTags(p.ProjectSnapshot, p.Tags)
			if scope != "" {
				scope = " · " + scope
			}
			out = append(out, row{
				kind:  "time.plan",
				id:    p.ID,
				title: "[" + timingPlanStatusLabel(p.Status) + "] " + p.Title,
				subtitle: fmt.Sprintf(
					"预算 %s · 已用 %s%s%s%s",
					budgetText,
					formatDurationShort(p.ConsumedSeconds),
					remText,
					stopText,
					scope,
				),
			})
		}
		if m.timeState.Daily != nil {
			for i := len(m.timeState.Daily.LocatedSegments) - 1; i >= 0; i-- {
				seg := m.timeState.Daily.LocatedSegments[i]
				costText := formatCurrencyCny(seg.ConfirmedCostCents)
				if seg.ProvisionalCostCents > 0 {
					if seg.ConfirmedCostCents > 0 {
						costText += " + 暂计 " + formatCurrencyCny(seg.ProvisionalCostCents)
					} else {
						costText = "暂计 " + formatCurrencyCny(seg.ProvisionalCostCents)
					}
				}
				if strings.EqualFold(seg.CategoryID, "sleep") {
					costText = "¥0 (睡眠)"
				}
				flags := ""
				if seg.Running {
					flags += " · 运行中"
				}
				if seg.ReviewState == "review_required" {
					flags += " · 待核对"
				} else if seg.ReviewState == "conflict" {
					flags += " · 冲突"
				}
				if seg.ExceededPlanSeconds != nil && *seg.ExceededPlanSeconds > 0 {
					flags += " · 超出安排 " + formatDurationShort(*seg.ExceededPlanSeconds)
				}
				scope := formatProjectAndTags(seg.ProjectSnapshot, seg.Tags)
				if scope != "" {
					scope = " · " + scope
				}
				out = append(out, row{
					kind:  "time.segment",
					id:    seg.ActivityID,
					title: formatClockRangeMs(seg.StartMs, seg.EndMs) + "  " + seg.Title,
					subtitle: fmt.Sprintf(
						"%s · %s%s%s",
						costText,
						formatDurationShort(seg.DurationSeconds),
						flags,
						scope,
					),
				})
			}
		}
	case "time.weekly":
		w := m.timeState.Weekly
		title := "本周项目与标签分布 · " + d
		sub := "[ 上周 · ] 下周 · . 本周"
		if w != nil {
			title = fmt.Sprintf("本周项目与标签分布 · %s ~ %s", w.WeekStartDate, w.WeekEndDate)
			sub = fmt.Sprintf(
				"已确认 %s (%s) · 待核对 %s · 空白 %s",
				formatCurrencyCny(w.ConfirmedCostCents),
				formatDurationShort(w.CoveredSeconds),
				formatCurrencyCny(w.ProvisionalCostCents),
				formatDurationShort(w.UnrecordedSeconds),
			)
		}
		out = append(out, row{kind: "time.summary", id: d, title: title, subtitle: sub})
		if w != nil {
			for _, item := range sortedDistItems(w.ByProjectSeconds, w.ByProjectCostCents, false) {
				pct := 0.0
				if w.CoveredSeconds > 0 {
					pct = (item.secs / w.CoveredSeconds) * 100
				}
				name := item.key
				if name == "__unassigned__" {
					name = "未分配项目"
				}
				out = append(out, row{
					kind:     "time.weekly_project",
					id:       item.key,
					title:    "项目 · " + name,
					subtitle: fmt.Sprintf("%s · %s · 占比 %.0f%%", formatCurrencyCny(item.costCents), formatDurationShort(item.secs), pct),
				})
			}
			for _, item := range sortedDistItems(w.ByTagSeconds, w.ByTagCostCents, true) {
				pct := 0.0
				if w.CoveredSeconds > 0 {
					pct = (item.secs / w.CoveredSeconds) * 100
				}
				name := item.key
				if name == "__untagged__" {
					name = "无标签"
				} else {
					name = "#" + name
				}
				out = append(out, row{
					kind:     "time.weekly_tag",
					id:       item.key,
					title:    "标签 · " + name,
					subtitle: fmt.Sprintf("%s · %s · 占比 %.0f%%", formatCurrencyCny(item.costCents), formatDurationShort(item.secs), pct),
				})
			}
		}
	case "time.report":
		gran, sortBy, groupBy := m.timeReportDefaults()
		granLabel := "本周"
		if gran == "month" {
			granLabel = "本月"
		}
		sortLabel := "时间成本最高"
		if sortBy == "highest_over_budget" {
			sortLabel = "超出最初预估最多"
		}
		groupLabel := "按任务"
		if groupBy == "project" {
			groupLabel = "按项目"
		}
		rep := m.timeState.Report
		title := granLabel + "成本报告（" + groupLabel + " · " + sortLabel + "）"
		sub := "w 切换周/月 · o 切换排序 · v 任务/项目 · [ / ] 翻期"
		if rep != nil {
			title = fmt.Sprintf("%s成本报告 %s ~ %s（%s）", granLabel, rep.PeriodStartDate, rep.PeriodEndDate, groupLabel)
			sub = fmt.Sprintf(
				"时间 %s · 现金 %s · 综合 %s · 暂计 %s · %s",
				formatCurrencyCny(rep.TotalPeriodConfirmedCostCents),
				formatCurrencyCny(rep.TotalCashExpenseCents),
				formatCurrencyCny(rep.TotalCombinedCostCents),
				formatCurrencyCny(rep.TotalPeriodProvisionalCents),
				sortLabel,
			)
		}
		out = append(out, row{kind: "time.summary", id: d, title: title, subtitle: sub})
		if rep != nil {
			if groupBy == "project" {
				for _, pr := range rep.ByProject {
					overText := ""
					if pr.OverInitialBudgetCents > 0 {
						overText = " · 超出 " + formatCurrencyCny(pr.OverInitialBudgetCents)
					}
					out = append(out, row{
						kind:  "time.report_project",
						id:    pr.ProjectKey,
						title: pr.ProjectName,
						subtitle: fmt.Sprintf(
							"本期 %s (%s) · 现金 %s · 综合 %s%s · %d 项",
							formatCurrencyCny(pr.PeriodCostCents),
							formatDurationShort(pr.PeriodSeconds),
							formatCurrencyCny(pr.CashExpenseCents),
							formatCurrencyCny(pr.CombinedPeriodCostCents),
							overText,
							pr.TaskCount,
						),
					})
				}
			} else {
				for _, tr := range rep.ByTask {
					budgetText := "未设预算"
					if tr.OverInitialBudgetCents > 0 {
						budgetText = "超出初预估 " + formatCurrencyCny(tr.OverInitialBudgetCents)
					} else if tr.HasBudget && tr.InitialBudgetCents != nil {
						budgetText = "初预算 " + formatCurrencyCny(*tr.InitialBudgetCents)
					}
					scope := formatProjectAndTags(tr.ProjectSnapshot, tr.Tags)
					if scope != "" {
						scope = " · " + scope
					}
					out = append(out, row{
						kind:  "time.report_task",
						id:    tr.TaskUUID,
						title: tr.Title,
						subtitle: fmt.Sprintf(
							"本期 %s · 累计 %s · 现金 %s · 综合 %s · %s%s",
							formatCurrencyCny(tr.PeriodCostCents),
							formatCurrencyCny(tr.CumulativeCostCents),
							formatCurrencyCny(tr.CashExpenseCents),
							formatCurrencyCny(tr.CombinedCumulativeCostCents),
							budgetText,
							scope,
						),
					})
				}
				for _, seg := range rep.UnassignedSegments {
					scope := formatProjectAndTags(seg.ProjectSnapshot, seg.Tags)
					if scope != "" {
						scope = " · " + scope
					}
					out = append(out, row{
						kind:  "time.report_unassigned_seg",
						id:    seg.ActivityID,
						title: "[未关联任务] " + seg.Title,
						subtitle: fmt.Sprintf(
							"%s %s · 已确认 %s · 暂计 %s%s",
							seg.Date,
							formatClockRangeMs(seg.StartMs, seg.EndMs),
							formatCurrencyCny(seg.ConfirmedCostCents),
							formatCurrencyCny(seg.ProvisionalCostCents),
							scope,
						),
					})
				}
			}
		}
	}
	m.extra = out
	m.cursor = min(m.cursor, max(0, len(m.extra)-1))
}

type distItem struct {
	key       string
	secs      float64
	costCents int64
}

func sortedDistItems(secs map[string]float64, costs map[string]int64, isTag bool) []distItem {
	seen := map[string]bool{}
	for k := range secs {
		seen[k] = true
	}
	for k := range costs {
		seen[k] = true
	}
	var out []distItem
	for k := range seen {
		s := secs[k]
		c := costs[k]
		if s <= 0 && c <= 0 {
			continue
		}
		_ = isTag
		out = append(out, distItem{key: k, secs: s, costCents: c})
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].costCents != out[j].costCents {
			return out[i].costCents > out[j].costCents
		}
		if out[i].secs != out[j].secs {
			return out[i].secs > out[j].secs
		}
		return out[i].key < out[j].key
	})
	return out
}

func (m model) findPlanByID(id string) (TimingPlan, bool) {
	for _, p := range m.timeState.Plans {
		if p.ID == id {
			return p, true
		}
	}
	if m.timeState.TaskDetail != nil {
		for _, p := range m.timeState.TaskDetail.Plans {
			if p.ID == id {
				return p, true
			}
		}
	}
	return TimingPlan{}, false
}

func (m model) findSegmentByID(id string) (LocatedSegment, bool) {
	if m.timeState.Daily != nil {
		for _, s := range m.timeState.Daily.LocatedSegments {
			if s.ActivityID == id {
				return s, true
			}
		}
	}
	if m.timeState.TaskDetail != nil {
		for _, s := range m.timeState.TaskDetail.Segments {
			if s.ActivityID == id {
				return s, true
			}
		}
	}
	return LocatedSegment{}, false
}

func (m model) renderTaskMetaTimeCost(
	t Task,
	isTiming bool,
	started bool,
	secs float64,
	secsKnown bool,
	cappedExtra float64,
) (handled bool, groups [][]styledSpan) {
	snap := m.timerSnap
	if snap == nil {
		snap = m.org.TimerSnapshot
	}
	sum, hasSummary := displayedTaskCost(snap, t.UUID, isTiming, cappedExtra)
	if !hasSummary {
		return false, nil
	}
	highlightCost := highlightTaskListCost(snap)

	durBadge := func() styledSpan {
		if !secsKnown {
			if isTiming {
				return span("▶ —", lipgloss.NewStyle().Foreground(timerColor).Bold(true))
			}
			if started {
				return span("▷ —", dim)
			}
			return span("⧖ —", dim)
		}
		if isTiming {
			return span("▶ "+formatDurationShort(secs), lipgloss.NewStyle().Foreground(timerColor).Bold(true))
		}
		if started {
			return span("▷ "+formatDurationShort(secs), lipgloss.NewStyle().Foreground(warnColor))
		}
		if secs >= 60 {
			return span("⧖ "+formatDurationShort(secs), dim)
		}
		return styledSpan{}
	}()

	var costSpan styledSpan
	hasActivityCost := sum.ConfirmedCostCents > 0 || sum.ProvisionalCostCents > 0
	if hasActivityCost {
		var costText string
		st := lipgloss.NewStyle().Foreground(ink).Bold(true)
		if sum.ConfirmedCostCents > 0 && sum.ProvisionalCostCents > 0 {
			costText = fmt.Sprintf("%s + 暂计 %s", formatCurrencyCny(sum.ConfirmedCostCents), formatCurrencyCny(sum.ProvisionalCostCents))
			if isTiming {
				st = lipgloss.NewStyle().Foreground(timerColor).Bold(true)
			}
		} else if sum.ProvisionalCostCents > 0 {
			costText = "暂计 " + formatCurrencyCny(sum.ProvisionalCostCents)
			st = lipgloss.NewStyle().Foreground(warnColor)
			if isTiming {
				st = lipgloss.NewStyle().Foreground(timerColor).Bold(true)
			}
		} else {
			costText = formatCurrencyCny(sum.ConfirmedCostCents)
		}
		if !highlightCost {
			st = dim
		}
		costSpan = span(costText, st)
	} else if sum.HasBudget && sum.CurrentBudgetCents != nil {
		costSpan = span("预算 "+formatCurrencyCny(*sum.CurrentBudgetCents), dim)
	}

	if highlightCost {
		if costSpan.text != "" {
			groups = append(groups, []styledSpan{costSpan})
		}
		if durBadge.text != "" {
			groups = append(groups, []styledSpan{durBadge})
		}
	} else {
		if durBadge.text != "" {
			groups = append(groups, []styledSpan{durBadge})
		}
		if costSpan.text != "" {
			groups = append(groups, []styledSpan{costSpan})
		}
	}

	if sum.OverInitialBudgetCents > 0 {
		groups = append(groups, []styledSpan{
			span("超出 "+formatCurrencyCny(sum.OverInitialBudgetCents), lipgloss.NewStyle().Foreground(dangerColor).Bold(true)),
		})
	} else if !sum.HasBudget && hasActivityCost {
		groups = append(groups, []styledSpan{span("未设预算", dim)})
	}
	if sum.LinkedCashCents > 0 {
		groups = append(groups, []styledSpan{
			span("现金 "+formatCurrencyCny(sum.LinkedCashCents), lipgloss.NewStyle().Foreground(inkSoft)),
		})
	}
	return true, groups
}

func (m model) inspectTaskCostSection(
	t Task,
	isTiming bool,
	canTick bool,
	extraSecs float64,
	bodyW int,
	kv func(string, string, lipgloss.AdaptiveColor),
	add func(string),
	addStyled func(lipgloss.Style, string),
	sectionRule func(string, int) string,
	lines *[]string,
) {
	if !m.isTimeMode() {
		return
	}
	snap := m.timerSnap
	if snap == nil {
		snap = m.org.TimerSnapshot
	}
	sum, ok := displayedTaskCost(snap, t.UUID, isTiming && canTick, extraSecs)
	hasDetailed := m.timeState.TaskDetail != nil && strings.EqualFold(m.timeState.TaskDetailUUID, t.UUID)
	if !ok && hasDetailed {
		sum = m.timeState.TaskDetail.Summary
		ok = true
	}
	if !ok && !hasDetailed {
		return
	}
	*lines = append(*lines, "", sectionRule("投入成本与预算", bodyW))
	if ok {
		confVal := fmt.Sprintf("%s · %s", formatCurrencyCny(sum.ConfirmedCostCents), formatDurationShort(sum.ConfirmedSeconds))
		kv("已确认", confVal, ink)
		if sum.ProvisionalCostCents > 0 || sum.ProvisionalSeconds > 0 {
			provVal := fmt.Sprintf(
				"暂计 %s (%s) · 不计入合计",
				formatCurrencyCny(sum.ProvisionalCostCents),
				formatDurationShort(sum.ProvisionalSeconds),
			)
			kv("待核对", provVal, warnColor)
		}
		if !sum.HasBudget {
			kv("预算", "未设预算", muted)
		} else {
			initTxt := "—"
			if sum.InitialBudgetCents != nil {
				initTxt = formatCurrencyCny(*sum.InitialBudgetCents)
			}
			currTxt := "—"
			if sum.CurrentBudgetCents != nil {
				currTxt = formatCurrencyCny(*sum.CurrentBudgetCents)
			}
			budgetDisplay := fmt.Sprintf("当前 %s", currTxt)
			if sum.CurrentAllowanceSeconds != nil {
				budgetDisplay += " (" + formatDurationShort(*sum.CurrentAllowanceSeconds) + ")"
			}
			if sum.AddedBudgetCents > 0 {
				budgetDisplay = fmt.Sprintf("最初 %s -> %s (+%s)", initTxt, budgetDisplay, formatCurrencyCny(sum.AddedBudgetCents))
			} else if initTxt != "—" && sum.CurrentAllowanceSeconds != nil {
				budgetDisplay = fmt.Sprintf("%s (%s)", initTxt, formatDurationShort(*sum.CurrentAllowanceSeconds))
			}
			kv("预算", budgetDisplay, inkSoft)
			if sum.OverInitialBudgetCents > 0 {
				kv("超出", "超出最初预估 "+formatCurrencyCny(sum.OverInitialBudgetCents), dangerColor)
			}
			if sum.PlannedStartAtMs != nil || sum.HardStopAtMs != nil {
				win := ""
				if sum.PlannedStartAtMs != nil {
					win += "计划 " + formatClockMs(*sum.PlannedStartAtMs)
				}
				if sum.HardStopAtMs != nil {
					if win != "" {
						win += " · "
					}
					win += "最晚 " + formatClockMs(*sum.HardStopAtMs)
				}
				kv("时间窗", win, inkSoft)
			}
		}
		if sum.LinkedCashCents > 0 {
			kv("现金账单", formatCurrencyCny(sum.LinkedCashCents), inkSoft)
			kv("综合投入", formatCurrencyCny(sum.CombinedCostCents), brand)
		}
		kv("参考单价", formatCurrencyCny(normalizeHourlyRateCents(sum.CurrentHourlyRateCents))+"/h", muted)
	}
	if !hasDetailed {
		*lines = append(*lines, dim.Render("B 设预算 · P 建计划 · $ 联账单 · c 加载明细"))
		return
	}
	det := m.timeState.TaskDetail
	if len(det.Plans) > 0 {
		*lines = append(*lines, "", sectionRule(fmt.Sprintf("有界计划 %d", len(det.Plans)), bodyW))
		for _, p := range det.Plans {
			if p.Status == "archived" {
				continue
			}
			rem := ""
			if p.RemainingSeconds != nil {
				rem = " · 剩 " + formatDurationShort(*p.RemainingSeconds)
			}
			addStyled(lipgloss.NewStyle().Foreground(inkSoft), fmt.Sprintf("• [%s] %s · 已用 %s%s", timingPlanStatusLabel(p.Status), p.Title, formatDurationShort(p.ConsumedSeconds), rem))
		}
	}
	if len(det.Segments) > 0 {
		*lines = append(*lines, "", sectionRule(fmt.Sprintf("时段明细 %d", len(det.Segments)), bodyW))
		limit := min(6, len(det.Segments))
		for i := len(det.Segments) - 1; i >= len(det.Segments)-limit; i-- {
			seg := det.Segments[i]
			costPart := formatCurrencyCny(seg.ConfirmedCostCents)
			if seg.ProvisionalCostCents > 0 {
				costPart += " + 暂计 " + formatCurrencyCny(seg.ProvisionalCostCents)
			}
			add(fmt.Sprintf("• %s · %s · %s (%s)", formatClockRangeMs(seg.StartMs, seg.EndMs), costPart, formatDurationShort(seg.DurationSeconds), seg.ReviewState))
		}
	}
	if len(det.BillLinks) > 0 {
		*lines = append(*lines, "", sectionRule(fmt.Sprintf("关联现金账单 %d", len(det.BillLinks)), bodyW))
		for _, bl := range det.BillLinks {
			add(fmt.Sprintf("• %s  %s · %s (%s)", formatCurrencyCny(bl.CnyAmountCents), fallbackStr(bl.Payee, bl.Narration, bl.Account), bl.PayTime, bl.Account))
		}
	}
}

func (m model) inspectTimeRow(
	r row,
	bodyW int,
	kv func(string, string, lipgloss.AdaptiveColor),
	add func(string),
	addStyled func(lipgloss.Style, string),
	sectionRule func(string, int) string,
	lines *[]string,
) bool {
	switch r.kind {
	case "time.summary":
		addStyled(lipgloss.NewStyle().Foreground(ink).Bold(true), r.title)
		*lines = append(*lines, "")
		add(r.subtitle)
		*lines = append(*lines, "", sectionRule("常用操作", bodyW))
		add("[ 上一期 · ] 下一期 · . 回到今天")
		add("P 新建有界计划 · , 时间单价与习惯设置")
		if m.view == "time.report" {
			add("w 切换周/月 · o 切换排序 · v 按任务/按项目")
		}
		add(": 打开全部操作菜单（补记/停止/确认）")
		return true
	case "time.sleep_candidate":
		addStyled(lipgloss.NewStyle().Foreground(ink).Bold(true), r.title)
		*lines = append(*lines, "")
		kv("性质", "轻量化睡眠标识（¥0 · 免除 6h 检查）", muted)
		add(r.subtitle)
		*lines = append(*lines, "", dim.Render("按 : 可确认或忽略睡眠候选"))
		return true
	case "time.plan":
		p, ok := m.findPlanByID(r.id)
		if !ok {
			addStyled(lipgloss.NewStyle().Foreground(ink).Bold(true), r.title)
			add(r.subtitle)
			return true
		}
		addStyled(lipgloss.NewStyle().Foreground(ink).Bold(true), p.Title)
		*lines = append(*lines, "")
		kv("状态", timingPlanStatusLabel(p.Status), brand)
		if p.CurrentBudgetCents != nil {
			kv("当前预算", formatCurrencyCny(*p.CurrentBudgetCents), ink)
		}
		if p.InitialBudgetCents != nil && p.CurrentBudgetCents != nil && *p.CurrentBudgetCents != *p.InitialBudgetCents {
			kv("最初预估", formatCurrencyCny(*p.InitialBudgetCents), muted)
		}
		kv("已用额度", formatDurationShort(p.ConsumedSeconds), inkSoft)
		if p.RemainingSeconds != nil {
			kv("剩余额度", formatDurationShort(*p.RemainingSeconds), timerColor)
		}
		if p.PlannedStartAtMs != nil {
			kv("计划开始", formatDateTimeMs(*p.PlannedStartAtMs), inkSoft)
		}
		if p.HardStopAtMs != nil {
			kv("最晚停止", formatDateTimeMs(*p.HardStopAtMs), warnColor)
		}
		if p.EffectiveAutoStopAtMs != nil {
			kv("实际自动停", formatDateTimeMs(*p.EffectiveAutoStopAtMs)+" ("+p.EffectiveAutoStopBasis+")", timerColor)
		}
		if scope := formatProjectAndTags(p.ProjectSnapshot, p.Tags); scope != "" {
			kv("项目/标签", scope, inkSoft)
		}
		if p.Note != "" {
			*lines = append(*lines, "", sectionRule("备注", bodyW))
			add(p.Note)
		}
		*lines = append(*lines, "", dim.Render(": 开始 / 暂停 / 停止 / 增加用时 / 归档"))
		return true
	case "time.segment":
		seg, ok := m.findSegmentByID(r.id)
		if !ok {
			addStyled(lipgloss.NewStyle().Foreground(ink).Bold(true), r.title)
			add(r.subtitle)
			return true
		}
		addStyled(lipgloss.NewStyle().Foreground(ink).Bold(true), seg.Title)
		*lines = append(*lines, "")
		kv("时间段", formatClockRangeMs(seg.StartMs, seg.EndMs), inkSoft)
		kv("总时长", formatDurationShort(seg.DurationSeconds), inkSoft)
		if strings.EqualFold(seg.CategoryID, "sleep") {
			kv("类型", "睡眠 ¥0（免除 6h 检查）", muted)
		} else {
			kv("已确认", fmt.Sprintf("%s (%s)", formatCurrencyCny(seg.ConfirmedCostCents), formatDurationShort(seg.ConfirmedSeconds)), ink)
			if seg.ProvisionalCostCents > 0 || seg.ProvisionalSeconds > 0 {
				kv("待核对", fmt.Sprintf("暂计 %s (%s)", formatCurrencyCny(seg.ProvisionalCostCents), formatDurationShort(seg.ProvisionalSeconds)), warnColor)
			}
			if seg.HourlyRateCents != nil {
				kv("当时单价", formatCurrencyCny(*seg.HourlyRateCents)+"/h", muted)
			}
		}
		kv("状态", seg.ReviewState, inkSoft)
		if scope := formatProjectAndTags(seg.ProjectSnapshot, seg.Tags); scope != "" {
			kv("项目/标签", scope, inkSoft)
		}
		if seg.ExceededPlanSeconds != nil && *seg.ExceededPlanSeconds > 0 {
			kv("超出安排", formatDurationShort(*seg.ExceededPlanSeconds), dangerColor)
		}
		*lines = append(*lines, "", dim.Render("c 确认这段 · : 修正时间 / 关联项目与标签 / 联账单"))
		return true
	case "time.weekly_project", "time.weekly_tag":
		addStyled(lipgloss.NewStyle().Foreground(ink).Bold(true), r.title)
		*lines = append(*lines, "")
		add(r.subtitle)
		return true
	case "time.report_task":
		if m.timeState.Report != nil {
			for _, tr := range m.timeState.Report.ByTask {
				if tr.TaskUUID == r.id {
					addStyled(lipgloss.NewStyle().Foreground(ink).Bold(true), tr.Title)
					*lines = append(*lines, "")
					kv("本期投入", fmt.Sprintf("%s (%s)", formatCurrencyCny(tr.PeriodCostCents), formatDurationShort(tr.PeriodSeconds)), ink)
					kv("任务累计", fmt.Sprintf("%s (%s)", formatCurrencyCny(tr.CumulativeCostCents), formatDurationShort(tr.CumulativeSeconds)), inkSoft)
					if tr.PeriodProvisionalCostCents > 0 || tr.CumulativeProvisionalCostCents > 0 {
						kv("待核对", fmt.Sprintf("本期暂计 %s / 累计暂计 %s", formatCurrencyCny(tr.PeriodProvisionalCostCents), formatCurrencyCny(tr.CumulativeProvisionalCostCents)), warnColor)
					}
					if tr.HasBudget && tr.InitialBudgetCents != nil {
						kv("最初预算", formatCurrencyCny(*tr.InitialBudgetCents), muted)
					} else {
						kv("最初预算", "未设预算", muted)
					}
					if tr.OverInitialBudgetCents > 0 {
						kv("超出预估", formatCurrencyCny(tr.OverInitialBudgetCents), dangerColor)
					}
					kv("关联现金", formatCurrencyCny(tr.CashExpenseCents), inkSoft)
					kv("综合投入", formatCurrencyCny(tr.CombinedCumulativeCostCents), brand)
					if len(tr.Segments) > 0 {
						*lines = append(*lines, "", sectionRule("本期时段追溯", bodyW))
						for _, s := range tr.Segments {
							add(fmt.Sprintf("• %s %s  %s (%s)", s.Date, formatClockRangeMs(s.StartMs, s.EndMs), formatCurrencyCny(s.ConfirmedCostCents), s.ReviewState))
						}
					}
					if len(tr.BillLinks) > 0 {
						*lines = append(*lines, "", sectionRule("关联账单", bodyW))
						for _, bl := range tr.BillLinks {
							add(fmt.Sprintf("• %s %s · %s", formatCurrencyCny(bl.CnyAmountCents), fallbackStr(bl.Payee, bl.Narration, bl.Account), bl.PayTime))
						}
					}
					return true
				}
			}
		}
		addStyled(lipgloss.NewStyle().Foreground(ink).Bold(true), r.title)
		add(r.subtitle)
		return true
	case "time.report_project":
		if m.timeState.Report != nil {
			for _, pr := range m.timeState.Report.ByProject {
				if pr.ProjectKey == r.id {
					addStyled(lipgloss.NewStyle().Foreground(ink).Bold(true), pr.ProjectName)
					*lines = append(*lines, "")
					kv("本期时间", fmt.Sprintf("%s (%s)", formatCurrencyCny(pr.PeriodCostCents), formatDurationShort(pr.PeriodSeconds)), ink)
					kv("关联现金", formatCurrencyCny(pr.CashExpenseCents), inkSoft)
					kv("综合投入", formatCurrencyCny(pr.CombinedPeriodCostCents), brand)
					if pr.OverInitialBudgetCents > 0 {
						kv("累计超出", formatCurrencyCny(pr.OverInitialBudgetCents), dangerColor)
					}
					kv("任务数", fmt.Sprintf("%d 项", pr.TaskCount), muted)
					if len(pr.Segments) > 0 {
						*lines = append(*lines, "", sectionRule("项目时段追溯", bodyW))
						for i, s := range pr.Segments {
							if i >= 8 {
								break
							}
							add(fmt.Sprintf("• %s %s · %s", s.Date, s.Title, formatCurrencyCny(s.ConfirmedCostCents)))
						}
					}
					return true
				}
			}
		}
		addStyled(lipgloss.NewStyle().Foreground(ink).Bold(true), r.title)
		add(r.subtitle)
		return true
	case "time.report_unassigned_seg":
		addStyled(lipgloss.NewStyle().Foreground(ink).Bold(true), r.title)
		*lines = append(*lines, "")
		add(r.subtitle)
		return true
	}
	return false
}

func (m *model) openTimeActions(add func(v, l, h string)) {
	r := m.current()
	switch r.kind {
	case "task":
		if m.isTimeMode() {
			add("task.cost_detail", "查看成本、流水与账单明细 (c)", "加载片段、有界计划与 Bill 关联")
			add("task.budget", "设置 / 追加 / 清除时间预算 (B)", "预计用时自动换算为 ¥ 成本预算")
			add("time.plan.new", "为此任务新建有界计时计划 (P)", "设置预计时长、计划开始与最晚停止")
			add("task.bill.link", "关联 Bill 现金支出 ($)", "只读检索账单，分列时间成本与现金")
			if m.timeState.TaskDetail != nil && strings.EqualFold(m.timeState.TaskDetailUUID, r.id) &&
				len(m.timeState.TaskDetail.BillLinks) > 0 {
				add("task.bill.unlink", "解除关联的 Bill 账单", "仅解除 Aster 侧引用，不改动 Bills 原账")
			}
		}
	case "time.sleep_candidate":
		add("time.sleep.confirm", "确认睡眠候选", "¥0 轻量化记录，免除 6h 检查点")
		add("time.sleep.dismiss", "忽略此次睡眠候选", "标记为已忽略")
	case "time.plan":
		if p, ok := m.findPlanByID(r.id); ok {
			if p.Status == "active" {
				add("time.plan.pause", "暂停计划计时", "保留剩余时长与最晚停止约束")
				add("time.plan.stop", "停止本次计时", "结束当前活跃片段")
			} else if p.Status != "archived" {
				add("time.plan.start", "手动开始 / 继续此计划", "自动停止 = 最早(开始+剩余, 最晚停止)")
			}
			if p.Status != "archived" {
				add("time.plan.extend", "增加用时 / 修改最晚停止", "展示本次继续的 ¥ 增量预估与上限")
				add("time.plan.archive", "归档此计划", "从今日计划列表中隐藏")
			}
		}
	case "time.segment":
		if seg, ok := m.findSegmentByID(r.id); ok {
			if seg.ProvisionalCostCents > 0 || seg.ProvisionalSeconds > 0 || seg.ReviewState == "review_required" {
				add("time.segment.confirm", "确认这段时间并入账 (c)", "将暂计金额转为正式已确认时间成本")
			}
			add("time.segment.edit", "修正起止时间 / 项目 / 标签", "支持改为估算边界或睡眠 ¥0")
			add("time.segment.bill", "关联 Bill 现金支出到此记录", "分列时间与现金综合投入")
		}
	}

	if m.isTimeMode() {
		snap := m.timerSnap
		if snap == nil {
			snap = m.org.TimerSnapshot
		}
		if snap != nil && snap.ActiveActivity != nil {
			add("time.active.confirm", "确认当前活跃计时至今", "把暂计金额入账为已确认时间成本")
			if snap.ActiveActivity.TimingPlanID != "" {
				add("time.active.pause", "暂停当前计划计时", "保留剩余时长额度")
				add("time.plan.extend_active", "为当前计划追加用时 / 改最晚停止", "计算增量 ¥ 成本与最晚停止余量")
			}
			add("time.active.stop", "停止当前计时", "停止活跃活动")
		}
		add("time.log", "补记已发生时段", "直接关联 Taskwarrior 项目与标签（无预设分类）")
		if r.kind != "task" {
			add("time.plan.new", "新建有界计时计划 (P)", "手动开始 -> 到限自动停止 -> 确认或修正")
		}
		add("time.settings", "时间单价与习惯设置 (,)", "我的时间单价 ¥/h、列表突出金额、睡眠模板与提醒")
		add("time.go.today", "打开今日时间与计划", "查看今日时间线、睡眠候选与计划")
		add("time.go.weekly", "打开本周项目与标签分布", "按 Taskwarrior 项目与标签汇总投入")
		add("time.go.report", "打开成本报告", "按周/月查看成本最高与超出初预估排序")
		if m.isTimeNavView() {
			add("time.date.prev", "查看上一天 / 上一期 ([)", "向前翻一天、一周或一月")
			add("time.date.today", "回到今天 / 本期 (.)", "重置查看日期为今天")
			add("time.date.next", "查看下一天 / 下一期 (])", "向后翻一天、一周或一月")
			add("time.date.pick", "跳转到指定日期", "输入 YYYY-MM-DD")
			if m.view == "time.report" {
				add("time.report.granularity", "切换周报 / 月报 (w)", "在 week 与 month 之间切换")
				add("time.report.sort", "切换报告排序 (o)", "时间成本最高 <-> 超出最初预估最多")
				add("time.report.group", "切换任务 / 项目视图 (v)", "按任务汇总 <-> 按项目汇总")
			}
		}
	}
}

func (m *model) openTimeSettingsForm() tea.Cmd {
	rateCents := currentHourlyRateCents(m.timerSnap, m.timeState.Policy)
	rateYuan := strconv.FormatFloat(float64(rateCents)/100, 'f', -1, 64)
	highlight := "true"
	if !highlightTaskListCost(m.timerSnap) {
		highlight = "false"
	}
	if m.timeState.Policy != nil && m.timeState.Policy.TaskListHighlightCost != nil {
		highlight = strconv.FormatBool(*m.timeState.Policy.TaskListHighlightCost)
	}
	sleepEnabled := "true"
	sleepStart := "23:30"
	sleepEnd := "07:30"
	threshHours := "6"
	remEnabled := "true"
	remTime := "21:30"
	if p := m.timeState.Policy; p != nil {
		sleepEnabled = strconv.FormatBool(p.SleepTemplate.Enabled)
		if p.SleepTemplate.StartTime != "" {
			sleepStart = p.SleepTemplate.StartTime
		}
		if p.SleepTemplate.EndTime != "" {
			sleepEnd = p.SleepTemplate.EndTime
		}
		if p.LongActivityThresholdSeconds > 0 {
			threshHours = strconv.FormatFloat(float64(p.LongActivityThresholdSeconds)/3600, 'f', -1, 64)
		}
		remEnabled = strconv.FormatBool(p.ReconcileReminder.Enabled)
		remTime = fmt.Sprintf("%02d:%02d", p.ReconcileReminder.Hour, p.ReconcileReminder.Minute)
	}
	return m.openForm(
		"time.settings",
		"时间单价与习惯设置",
		"即时换算："+formatRateConversionHint(rateCents)+" · 新单价从下一段计时生效。",
		textField("我的时间单价（¥/小时）", rateYuan, "例如 100；修改后保留历史段单价"),
		selectField("任务列表默认突出金额", highlight, yesNo()),
		selectField("启用夜间睡眠模板（¥0 · 免 6h 检查）", sleepEnabled, yesNo()),
		textField("睡眠开始时间（HH:MM）", sleepStart, "如 23:30"),
		textField("睡眠结束时间（HH:MM）", sleepEnd, "如 07:30"),
		textField("无边界长时段检查阈值（小时）", threshHours, "例如 6；有界计划不触发此提醒"),
		selectField("启用晚间核对提醒", remEnabled, yesNo()),
		textField("核对提醒时间（HH:MM）", remTime, "例如 21:30"),
	)
}

func (m *model) openTaskBudgetForm(t Task) tea.Cmd {
	rate := currentHourlyRateCents(m.timerSnap, m.timeState.Policy)
	mins := ""
	planned := ""
	hardStop := ""
	if sum, ok := lookupTaskCost(m.timerSnap, t.UUID); ok {
		if sum.CurrentAllowanceSeconds != nil && *sum.CurrentAllowanceSeconds > 0 {
			mins = strconv.Itoa(int(math.Round(*sum.CurrentAllowanceSeconds / 60)))
		}
		if sum.PlannedStartAtMs != nil {
			planned = formatClockMs(*sum.PlannedStartAtMs)
		}
		if sum.HardStopAtMs != nil {
			hardStop = formatClockMs(*sum.HardStopAtMs)
		}
	}
	return m.openForm(
		"task.budget",
		"任务时间预算 · "+clip(clean(t.Description), 30),
		fmt.Sprintf("当前单价 %s/h · 预估用时自动折算为成本预算，保留「最初预估」。", formatCurrencyCny(rate)),
		selectField("预算操作", "set", []choice{
			{"set", "设定 / 更新总预算（并保留最初预估）", ""},
			{"add", "追加预计用时", "保留最初预估并记录追加额度"},
			{"clear", "清除预算约束", "恢复为「未设预算」"},
		}),
		textField("预计用时 / 追加时长（分钟）", mins, "例如 60（设定 60 分钟或追加 30 分钟）；清除时可留空"),
		textField("计划开始（HH:MM 或 YYYY-MM-DD HH:MM）", planned, "仅展示与提醒，不自动启动"),
		textField("最晚停止（HH:MM 或 YYYY-MM-DD HH:MM）", hardStop, "本次计时不能超过的时刻"),
	)
}

func (m *model) openCreatePlanForm(t *Task) tea.Cmd {
	rate := currentHourlyRateCents(m.timerSnap, m.timeState.Policy)
	title := ""
	taskUUID := ""
	proj := ""
	tags := ""
	mins := "60"
	planned := ""
	hardStop := ""
	if t != nil && t.UUID != "" {
		title = t.Description
		taskUUID = t.UUID
		proj = t.Project
		tags = strings.Join(t.Tags, ", ")
		if sum, ok := lookupTaskCost(m.timerSnap, t.UUID); ok {
			if sum.CurrentAllowanceSeconds != nil && *sum.CurrentAllowanceSeconds > 0 {
				mins = strconv.Itoa(int(math.Round(*sum.CurrentAllowanceSeconds / 60)))
			}
			if sum.PlannedStartAtMs != nil {
				planned = formatClockMs(*sum.PlannedStartAtMs)
			}
			if sum.HardStopAtMs != nil {
				hardStop = formatClockMs(*sum.HardStopAtMs)
			}
		}
	}
	tagField := selectField("标签（逗号分隔；Enter 多选）", tags, nil)
	tagField.multi = true
	for _, tg := range m.org.Tags {
		tagField.options = append(tagField.options, choice{tg.Name, tg.Name, ""})
	}
	return m.openForm(
		"time.plan.new",
		"新建有界计时计划",
		fmt.Sprintf("单价 %s/h · 自动停止 = 「实际开始+剩余时长」与「最晚停止」中较早者。", formatCurrencyCny(rate)),
		textField("计划标题", title, "必填"),
		textField("预计时长（分钟）", mins, "例如 60 -> 自动计算预算；可留空只设最晚停止"),
		textField("计划开始（HH:MM 或 YYYY-MM-DD HH:MM）", planned, "可选，不自动启动"),
		textField("最晚停止（HH:MM 或 YYYY-MM-DD HH:MM）", hardStop, "可选，如 15:00"),
		selectField("关联项目（Taskwarrior）", proj, m.projectChoices()),
		tagField,
		textField("关联任务 UUID（可选）", taskUUID, "留空则仅挂项目与标签"),
		areaField("备注（可选）", "", ""),
	)
}

func (m *model) openExtendPlanForm(p TimingPlan) tea.Cmd {
	m.timeState.EditingPlan = &p
	rate := currentHourlyRateCents(m.timerSnap, m.timeState.Policy)
	if p.HourlyRateCents != nil && *p.HourlyRateCents > 0 {
		rate = *p.HourlyRateCents
	}
	hardStop := ""
	if p.HardStopAtMs != nil {
		hardStop = formatDateTimeMs(*p.HardStopAtMs)
	}
	prev := computeContinuationCostPreview(30*60, rate, p.HardStopAtMs, time.Now().UnixMilli())
	hint := fmt.Sprintf("再投入 30 分钟，预计增加 %s。", formatCurrencyCny(prev.AdditionalCostCents))
	if prev.Expired {
		hint = "已超过原最晚停止时刻！如需继续，请修改下方最晚停止时间。"
	} else if prev.CappedByHardStop && prev.HardStopRemainingSeconds != nil {
		hint = fmt.Sprintf(
			"距最晚停止仅剩 %s，本次最多继续 %s（预计 %s）。",
			formatDurationShort(*prev.HardStopRemainingSeconds),
			formatDurationShort(prev.EffectiveSeconds),
			formatCurrencyCny(prev.AdditionalCostCents),
		)
	}
	return m.openForm(
		"time.plan.extend",
		"增加用时 / 修改最晚停止 · "+clip(clean(p.Title), 24),
		hint,
		textField("追加时长（分钟）", "30", "可填 0 仅修改最晚停止；超过最晚停止须同步延后"),
		textField("新的最晚停止（HH:MM 或 YYYY-MM-DD HH:MM）", hardStop, "留空表示保持原设置"),
	)
}

func (m *model) openTimeLogForm(t *Task) tea.Cmd {
	d := m.effectiveTimeDate()
	now := time.Now()
	endClock := now.Format("15:04")
	startClock := now.Add(-30 * time.Minute).Format("15:04")
	title := ""
	proj := ""
	tags := ""
	if t != nil && t.UUID != "" {
		title = t.Description
		proj = t.Project
		tags = strings.Join(t.Tags, ", ")
	}
	tagField := selectField("标签（逗号分隔；Enter 多选）", tags, nil)
	tagField.multi = true
	for _, tg := range m.org.Tags {
		tagField.options = append(tagField.options, choice{tg.Name, tg.Name, ""})
	}
	return m.openForm(
		"time.log",
		"补记已发生时段",
		"直接关联 Taskwarrior 项目与标签（无预设分类）。睡眠记录记 ¥0 且免除 6h 检查点。",
		textField("活动内容", title, "必填"),
		textField("日期（YYYY-MM-DD）", d, ""),
		textField("开始时间（HH:MM）", startClock, "例如 14:00"),
		textField("结束时间（HH:MM）", endClock, "例如 14:40"),
		selectField("关联项目（Taskwarrior）", proj, m.projectChoices()),
		tagField,
		selectField("边界精确度", "exact", []choice{
			{"exact", "精确起止时间", ""},
			{"estimated_bounds", "大约起止边界（回忆估算）", ""},
		}),
		selectField("是否为睡眠（¥0 · 免 6h 检查）", "false", yesNo()),
		areaField("备注（可选）", "", ""),
	)
}

func (m *model) openSegmentEditForm(seg LocatedSegment) tea.Cmd {
	m.timeState.EditingSegment = &seg
	startStr := formatDateTimeMs(seg.StartMs)
	endStr := ""
	if seg.EndMs > 0 {
		endStr = formatDateTimeMs(seg.EndMs)
	}
	tagField := selectField("标签（逗号分隔；Enter 多选）", strings.Join(seg.Tags, ", "), nil)
	tagField.multi = true
	for _, tg := range m.org.Tags {
		tagField.options = append(tagField.options, choice{tg.Name, tg.Name, ""})
	}
	isSleep := "false"
	if strings.EqualFold(seg.CategoryID, "sleep") {
		isSleep = "true"
	}
	prec := seg.Precision
	if prec != "estimated_bounds" {
		prec = "exact"
	}
	return m.openForm(
		"time.segment.edit",
		"修正记录 · "+clip(clean(seg.Title), 26),
		"修正后若满足确认条件可同步核对入账；直接关联 TW 项目与标签。",
		textField("活动标题", seg.Title, "必填"),
		textField("开始时间（YYYY-MM-DD HH:MM）", startStr, ""),
		textField("结束时间（YYYY-MM-DD HH:MM）", endStr, "运行中留空表示仅改其他字段"),
		selectField("关联项目（Taskwarrior）", seg.ProjectSnapshot, m.projectChoices()),
		tagField,
		selectField("边界精确度", prec, []choice{
			{"exact", "精确起止时间", ""},
			{"estimated_bounds", "大约起止边界", ""},
		}),
		selectField("是否为睡眠（¥0 · 免 6h 检查）", isSleep, yesNo()),
		selectField("同时标记本段已核对（Confirm）", "true", yesNo()),
	)
}

func (m model) dynamicFormHint() string {
	rate := currentHourlyRateCents(m.timerSnap, m.timeState.Policy)
	switch m.formKind {
	case "time.settings":
		if len(m.fields) > 0 {
			if c, err := parseYuanToCents(m.fields[0].value()); err == nil {
				return "即时换算：" + formatRateConversionHint(c) + " · 新单价从下一段计时生效。"
			}
		}
	case "task.budget":
		if len(m.fields) > 1 {
			if mins, err := strconv.ParseFloat(strings.TrimSpace(m.fields[1].value()), 64); err == nil && mins > 0 {
				cost := computeDurationCostCents(mins*60, rate)
				return fmt.Sprintf("即时换算：%g 分钟 ≈ %s（按单价 %s/h），将记录最初与当前预算。", mins, formatCurrencyCny(cost), formatCurrencyCny(rate))
			}
		}
	case "time.plan.new":
		if len(m.fields) > 1 {
			if mins, err := strconv.ParseFloat(strings.TrimSpace(m.fields[1].value()), 64); err == nil && mins > 0 {
				cost := computeDurationCostCents(mins*60, rate)
				return fmt.Sprintf("预计投入：%g 分钟 · %s · 自动停止取「开始+剩余」与「最晚停止」较早者。", mins, formatCurrencyCny(cost))
			}
		}
	case "time.plan.extend":
		if m.timeState.EditingPlan != nil && len(m.fields) > 1 {
			p := *m.timeState.EditingPlan
			pRate := rate
			if p.HourlyRateCents != nil && *p.HourlyRateCents > 0 {
				pRate = *p.HourlyRateCents
			}
			hardStopMs := p.HardStopAtMs
			if hs := strings.TrimSpace(m.fields[1].value()); hs != "" {
				if parsed, err := parseDateTimeMs(hs, m.effectiveTimeDate()); err == nil {
					hardStopMs = &parsed
				}
			}
			if mins, err := strconv.ParseFloat(strings.TrimSpace(m.fields[0].value()), 64); err == nil && mins > 0 {
				prev := computeContinuationCostPreview(mins*60, pRate, hardStopMs, time.Now().UnixMilli())
				if prev.Expired {
					return "当前时间已超过所设最晚停止时刻，请延后最晚停止。"
				}
				if prev.CappedByHardStop && prev.HardStopRemainingSeconds != nil {
					return fmt.Sprintf(
						"受最晚停止限制，仅剩 %s，最多追加 %s（预计 +%s）。",
						formatDurationShort(*prev.HardStopRemainingSeconds),
						formatDurationShort(prev.EffectiveSeconds),
						formatCurrencyCny(prev.AdditionalCostCents),
					)
				}
				return fmt.Sprintf("再投入 %g 分钟，预计增加 %s。", mins, formatCurrencyCny(prev.AdditionalCostCents))
			}
		}
	case "task.new", "task.subtask", "task.edit":
		if len(m.fields) >= 12 {
			if mins, err := strconv.ParseFloat(strings.TrimSpace(m.fields[9].value()), 64); err == nil && mins > 0 {
				cost := computeDurationCostCents(mins*60, rate)
				return fmt.Sprintf("预计投入 %g 分钟 ≈ %s（按单价 %s/h）；保存后自动写入成本预算。", mins, formatCurrencyCny(cost), formatCurrencyCny(rate))
			}
		}
	}
	return m.formHint
}

func (m *model) timeAction(a string) (tea.Cmd, bool) {
	r := m.current()
	switch a {
	case "time.go.today":
		return m.navigate("time.today"), true
	case "time.go.weekly":
		return m.navigate("time.weekly"), true
	case "time.go.report":
		return m.navigate("time.report"), true
	case "time.date.prev", "time.date.next", "time.date.today":
		if !m.isTimeNavView() {
			return nil, true
		}
		cur, err := time.ParseInLocation("2006-01-02", m.effectiveTimeDate(), time.Local)
		if err != nil {
			cur = time.Now()
		}
		switch a {
		case "time.date.today":
			cur = time.Now()
		case "time.date.prev":
			if m.view == "time.weekly" || (m.view == "time.report" && m.timeState.ReportGranularity != "month") {
				cur = cur.AddDate(0, 0, -7)
			} else if m.view == "time.report" && m.timeState.ReportGranularity == "month" {
				cur = cur.AddDate(0, -1, 0)
			} else {
				cur = cur.AddDate(0, 0, -1)
			}
		case "time.date.next":
			if m.view == "time.weekly" || (m.view == "time.report" && m.timeState.ReportGranularity != "month") {
				cur = cur.AddDate(0, 0, 7)
			} else if m.view == "time.report" && m.timeState.ReportGranularity == "month" {
				cur = cur.AddDate(0, 1, 0)
			} else {
				cur = cur.AddDate(0, 0, 1)
			}
		}
		m.timeState.SelectedDate = cur.Format("2006-01-02")
		m.busy = true
		return m.loadTimeViewCmd(m.view), true
	case "time.date.pick":
		return m.openForm(
			"time.date.pick",
			"跳转日期",
			"选择时间台账 / 分布 / 报告的基准日期。",
			textField("日期（YYYY-MM-DD）", m.effectiveTimeDate(), "例如 2026-11-15"),
		), true
	case "time.report.granularity":
		if m.timeState.ReportGranularity == "month" {
			m.timeState.ReportGranularity = "week"
		} else {
			m.timeState.ReportGranularity = "month"
		}
		if m.view != "time.report" {
			return m.navigate("time.report"), true
		}
		m.busy = true
		return m.loadTimeViewCmd("time.report"), true
	case "time.report.sort":
		if m.timeState.ReportSort == "highest_over_budget" {
			m.timeState.ReportSort = "highest_cost"
		} else {
			m.timeState.ReportSort = "highest_over_budget"
		}
		if m.view != "time.report" {
			return m.navigate("time.report"), true
		}
		m.busy = true
		return m.loadTimeViewCmd("time.report"), true
	case "time.report.group":
		if m.timeState.ReportGroupBy == "project" {
			m.timeState.ReportGroupBy = "task"
		} else {
			m.timeState.ReportGroupBy = "project"
		}
		m.syncTimeExtraRows()
		return nil, true
	case "time.settings":
		m.busy = true
		return m.fetchPolicyForSettingsCmd(), true
	case "task.cost_detail":
		if r.kind != "task" {
			m.message = "请先选择任务"
			return nil, true
		}
		m.busy = true
		return m.fetchTaskCostDetailCmd(r.id), true
	case "task.budget":
		if r.kind != "task" {
			m.message = "请先选择任务"
			return nil, true
		}
		return m.openTaskBudgetForm(r.task), true
	case "time.plan.new":
		var t *Task
		if r.kind == "task" {
			cp := r.task
			t = &cp
		}
		return m.openCreatePlanForm(t), true
	case "time.plan.extend":
		if r.kind != "time.plan" {
			return nil, true
		}
		p, ok := m.findPlanByID(r.id)
		if !ok {
			m.message = "未找到该计划数据，请先刷新"
			return nil, true
		}
		return m.openExtendPlanForm(p), true
	case "time.plan.extend_active":
		snap := m.timerSnap
		if snap == nil {
			snap = m.org.TimerSnapshot
		}
		if snap == nil || snap.ActiveActivity == nil || snap.ActiveActivity.TimingPlanID == "" {
			m.message = "当前没有正在运行的有界计划"
			return nil, true
		}
		m.busy = true
		return m.fetchPlanForExtendCmd(snap.ActiveActivity.TimingPlanID), true
	case "time.plan.start":
		if r.kind != "time.plan" {
			return nil, true
		}
		m.busy = true
		return m.postTimeCmd("/api/time/plans/start", map[string]any{
			"idempotencyKey": idempotencyKey("tui-plan-start"),
			"planId":         r.id,
		}, "已开始 / 继续计时计划", ""), true
	case "time.plan.pause", "time.active.pause":
		m.busy = true
		return m.postTimeCmd("/api/time/stop", map[string]any{
			"idempotencyKey": idempotencyKey("tui-pause"),
			"pause":          true,
		}, "已暂停当前计划计时（保留剩余额度）", ""), true
	case "time.plan.stop", "time.active.stop":
		m.busy = true
		return m.postTimeCmd("/api/time/stop", map[string]any{
			"idempotencyKey": idempotencyKey("tui-stop"),
		}, "已停止当前计时", ""), true
	case "time.plan.archive":
		if r.kind != "time.plan" {
			return nil, true
		}
		p, ok := m.findPlanByID(r.id)
		if !ok {
			m.message = "未找到该计划，请先刷新"
			return nil, true
		}
		m.busy = true
		return m.postTimeCmd("/api/time/plans/update", map[string]any{
			"idempotencyKey":  idempotencyKey("tui-plan-arch"),
			"planId":          p.ID,
			"expectedVersion": p.Version,
			"archived":        true,
		}, "已归档计时计划", ""), true
	case "time.active.confirm":
		snap := m.timerSnap
		if snap == nil {
			snap = m.org.TimerSnapshot
		}
		if snap == nil || snap.ActiveActivity == nil {
			m.message = "当前没有正在进行的计时"
			return nil, true
		}
		act := snap.ActiveActivity
		m.busy = true
		return m.postTimeCmd("/api/time/confirm", map[string]any{
			"idempotencyKey":  idempotencyKey("tui-conf-act"),
			"activityId":      act.ID,
			"expectedVersion": max(1, act.Version),
		}, "已确认当前活跃计时段至今", act.TaskUUID), true
	case "time.segment.confirm":
		if r.kind != "time.segment" {
			return nil, true
		}
		seg, ok := m.findSegmentByID(r.id)
		if !ok {
			return nil, true
		}
		m.busy = true
		return m.postTimeCmd("/api/time/confirm", map[string]any{
			"idempotencyKey":  idempotencyKey("tui-conf-seg"),
			"activityId":      seg.ActivityID,
			"expectedVersion": seg.Version,
		}, "已确认时段并入账正式时间成本", seg.TaskUUID), true
	case "time.segment.edit":
		if r.kind != "time.segment" {
			return nil, true
		}
		seg, ok := m.findSegmentByID(r.id)
		if !ok {
			return nil, true
		}
		return m.openSegmentEditForm(seg), true
	case "time.log":
		var t *Task
		if r.kind == "task" {
			cp := r.task
			t = &cp
		}
		return m.openTimeLogForm(t), true
	case "time.sleep.confirm", "time.sleep.dismiss":
		if r.kind != "time.sleep_candidate" {
			return nil, true
		}
		route := "/api/time/sleep/confirm"
		msg := "已确认睡眠记录（¥0 · 免 6h 检查）"
		if a == "time.sleep.dismiss" {
			route = "/api/time/sleep/dismiss"
			msg = "已忽略该睡眠候选"
		}
		m.busy = true
		return m.postTimeCmd(route, map[string]any{
			"idempotencyKey": idempotencyKey("tui-sleep"),
			"date":           r.id,
		}, msg, ""), true
	case "task.bill.link":
		if r.kind != "task" {
			m.message = "请先选择任务"
			return nil, true
		}
		m.busy = true
		return m.fetchBillsCmd("", r.id, ""), true
	case "time.segment.bill":
		if r.kind != "time.segment" {
			return nil, true
		}
		seg, ok := m.findSegmentByID(r.id)
		if !ok {
			return nil, true
		}
		m.busy = true
		return m.fetchBillsCmd("", seg.TaskUUID, seg.ActivityID), true
	case "task.bill.unlink":
		if r.kind != "task" || m.timeState.TaskDetail == nil || !strings.EqualFold(m.timeState.TaskDetailUUID, r.id) ||
			len(m.timeState.TaskDetail.BillLinks) == 0 {
			m.message = "请先加载含关联账单的任务成本明细 (c)"
			return nil, true
		}
		m.timeState.BillUnlinkChoices = append([]BillLink{}, m.timeState.TaskDetail.BillLinks...)
		var options []choice
		for i, bl := range m.timeState.BillUnlinkChoices {
			options = append(options, choice{
				fmt.Sprintf("time.bill.unlink:%d", i),
				fmt.Sprintf("解除 %s · %s (%s)", formatCurrencyCny(bl.CnyAmountCents), fallbackStr(bl.Payee, bl.Narration, bl.Account), bl.PayTime),
				bl.Account,
			})
		}
		m.choose(options, -1)
		return nil, true
	case "time.bill.search":
		return m.openForm(
			"time.bill.search",
			"搜索 Bill 现金账单",
			"输入商户、摘要、账户或标签关键词过滤支出记录。",
			textField("关键词", m.timeState.BillQuery, "例如 硬件、快递、云主机、餐饮"),
		), true
	}

	if strings.HasPrefix(a, "time.bill.pick:") {
		idx, err := strconv.Atoi(strings.TrimPrefix(a, "time.bill.pick:"))
		if err != nil || idx < 0 || idx >= len(m.timeState.Bills) {
			return nil, true
		}
		exp := m.timeState.Bills[idx]
		payload := map[string]any{
			"txKey":          exp.TxKey,
			"source":         exp.Source,
			"txId":           exp.TxID,
			"payTime":        exp.PayTime,
			"payee":          exp.Payee,
			"narration":      exp.Narration,
			"account":        exp.Account,
			"currency":       fallbackStr(exp.Currency, "CNY", "CNY"),
			"amount":         exp.Amount,
			"cnyAmountCents": exp.CnyAmountCents,
		}
		if m.timeState.BillTargetTaskUUID != "" {
			payload["taskUuid"] = m.timeState.BillTargetTaskUUID
		}
		if m.timeState.BillTargetActivity != "" {
			payload["activityId"] = m.timeState.BillTargetActivity
		}
		m.busy = true
		return m.postTimeCmd("/api/time/bills/link", payload, "已关联 Bill 现金支出 "+formatCurrencyCny(exp.CnyAmountCents), m.timeState.BillTargetTaskUUID), true
	}

	if strings.HasPrefix(a, "time.bill.unlink:") {
		idx, err := strconv.Atoi(strings.TrimPrefix(a, "time.bill.unlink:"))
		if err != nil || idx < 0 || idx >= len(m.timeState.BillUnlinkChoices) {
			return nil, true
		}
		bl := m.timeState.BillUnlinkChoices[idx]
		m.busy = true
		return m.postTimeCmd("/api/time/bills/unlink", map[string]any{"linkId": bl.ID}, "已解除 Bill 账单关联", bl.TaskUUID), true
	}

	return nil, false
}

func (m model) postTimeCmd(route string, body map[string]any, okMsg string, taskUUID string) tea.Cmd {
	c := m.client
	return func() tea.Msg {
		if err := c.post(route, body, nil); err != nil {
			return timeMutationMsg{err: err}
		}
		return timeMutationMsg{message: okMsg, refreshTaskDet: taskUUID}
	}
}

func (m *model) submitTimeForm(v []string) (tea.Cmd, error, bool) {
	switch m.formKind {
	case "time.date.pick":
		d := strings.TrimSpace(v[0])
		if _, err := time.ParseInLocation("2006-01-02", d, time.Local); err != nil {
			return nil, fmt.Errorf("请输入 YYYY-MM-DD 日期格式"), true
		}
		m.timeState.SelectedDate = d
		m.mode = ""
		m.fields = nil
		if !m.isTimeNavView() {
			return m.navigate("time.today"), nil, true
		}
		return m.loadTimeViewCmd(m.view), nil, true

	case "time.bill.search":
		m.timeState.BillQuery = strings.TrimSpace(v[0])
		return m.fetchBillsCmd(m.timeState.BillQuery, m.timeState.BillTargetTaskUUID, m.timeState.BillTargetActivity), nil, true

	case "time.settings":
		if m.timeState.Policy == nil {
			return nil, fmt.Errorf("未读取到当前时间策略，请刷新后重试"), true
		}
		rateCents, err := parseYuanToCents(v[0])
		if err != nil {
			return nil, err, true
		}
		highlight := v[1] == "true"
		sleepEnabled := v[2] == "true"
		_, _, sleepStart, err := parseTimeInputToSpec(v[3], m.effectiveTimeDate())
		if err != nil || sleepStart == "" {
			return nil, fmt.Errorf("睡眠开始时间格式应为 HH:MM"), true
		}
		_, _, sleepEnd, err := parseTimeInputToSpec(v[4], m.effectiveTimeDate())
		if err != nil || sleepEnd == "" {
			return nil, fmt.Errorf("睡眠结束时间格式应为 HH:MM"), true
		}
		threshHours, err := strconv.ParseFloat(strings.TrimSpace(v[5]), 64)
		if err != nil || threshHours <= 0 || threshHours > 24 {
			return nil, fmt.Errorf("长时段阈值应在 0~24 小时之间"), true
		}
		remEnabled := v[6] == "true"
		_, _, remClock, err := parseTimeInputToSpec(v[7], m.effectiveTimeDate())
		if err != nil || remClock == "" {
			return nil, fmt.Errorf("核对提醒时间格式应为 HH:MM"), true
		}
		remParts := strings.Split(remClock, ":")
		remH, _ := strconv.Atoi(remParts[0])
		remM, _ := strconv.Atoi(remParts[1])
		payload := map[string]any{
			"idempotencyKey":        idempotencyKey("tui-policy"),
			"expectedPolicyVersion": m.timeState.Policy.PolicyVersion,
			"patch": map[string]any{
				"hourlyRateCents":              rateCents,
				"taskListHighlightCost":        highlight,
				"longActivityThresholdSeconds": int(math.Round(threshHours * 3600)),
				"sleepTemplate": map[string]any{
					"enabled":   sleepEnabled,
					"startTime": sleepStart,
					"endTime":   sleepEnd,
					"version":   m.timeState.Policy.SleepTemplate.Version,
				},
				"reconcileReminder": map[string]any{
					"enabled": remEnabled,
					"hour":    remH,
					"minute":  remM,
				},
			},
		}
		return m.postTimeCmd("/api/time/policy", payload, fmt.Sprintf("已更新单价 %s/h 与时间设置", formatCurrencyCny(rateCents)), ""), nil, true

	case "task.budget":
		mode := v[0]
		if mode != "set" && mode != "add" && mode != "clear" {
			mode = "set"
		}
		payload := map[string]any{
			"taskUuid": m.selected.id,
			"mode":     mode,
		}
		if mode != "clear" {
			minsStr := strings.TrimSpace(v[1])
			if mode == "add" {
				mins, err := strconv.ParseFloat(minsStr, 64)
				if err != nil || mins <= 0 {
					return nil, fmt.Errorf("追加用时必须填写大于 0 的分钟数"), true
				}
				payload["addAllowanceSeconds"] = int(math.Round(mins * 60))
			} else if minsStr != "" {
				mins, err := strconv.ParseFloat(minsStr, 64)
				if err != nil || mins <= 0 {
					return nil, fmt.Errorf("预计用时必须为大于 0 的分钟数"), true
				}
				payload["allowanceSeconds"] = int(math.Round(mins * 60))
			}
			psMs, psD, psT, err := parseTimeInputToSpec(v[2], m.effectiveTimeDate())
			if err != nil {
				return nil, err, true
			}
			if psMs != nil {
				payload["plannedStartAtMs"] = *psMs
			} else if psT != "" {
				payload["plannedStartDate"] = psD
				payload["plannedStartTime"] = psT
			} else if mode == "set" {
				payload["plannedStartAtMs"] = nil
			}
			hsMs, hsD, hsT, err := parseTimeInputToSpec(v[3], m.effectiveTimeDate())
			if err != nil {
				return nil, err, true
			}
			if hsMs != nil {
				payload["hardStopAtMs"] = *hsMs
			} else if hsT != "" {
				payload["hardStopDate"] = hsD
				payload["hardStopTime"] = hsT
			} else if mode == "set" {
				payload["hardStopAtMs"] = nil
			}
			if mode == "set" && minsStr == "" && hsMs == nil && hsT == "" && psMs == nil && psT == "" {
				return nil, fmt.Errorf("请至少填写预计用时、计划开始或最晚停止"), true
			}
		}
		return m.postTimeCmd("/api/time/task-budget", payload, "已更新任务时间预算", m.selected.id), nil, true

	case "time.plan.new":
		title := strings.TrimSpace(v[0])
		if title == "" {
			return nil, errRequired("计划标题"), true
		}
		payload := map[string]any{
			"idempotencyKey": idempotencyKey("tui-plan-new"),
			"title":          title,
		}
		if minsStr := strings.TrimSpace(v[1]); minsStr != "" {
			mins, err := strconv.ParseFloat(minsStr, 64)
			if err != nil || mins <= 0 {
				return nil, fmt.Errorf("预计时长必须大于 0 分钟"), true
			}
			payload["allowanceMinutes"] = mins
		}
		if ms, d, tm, err := parseTimeInputToSpec(v[2], m.effectiveTimeDate()); err != nil {
			return nil, err, true
		} else if ms != nil {
			payload["plannedStartAtMs"] = *ms
		} else if tm != "" {
			payload["plannedStartDate"] = d
			payload["plannedStartTime"] = tm
		}
		if ms, d, tm, err := parseTimeInputToSpec(v[3], m.effectiveTimeDate()); err != nil {
			return nil, err, true
		} else if ms != nil {
			payload["hardStopAtMs"] = *ms
		} else if tm != "" {
			payload["hardStopDate"] = d
			payload["hardStopTime"] = tm
		}
		if strings.TrimSpace(v[4]) != "" {
			payload["projectSnapshot"] = strings.TrimSpace(v[4])
		}
		if tags := splitTags(v[5]); len(tags) > 0 {
			payload["tags"] = tags
		}
		if tid := strings.TrimSpace(v[6]); tid != "" {
			payload["taskUuid"] = tid
		}
		if note := strings.TrimSpace(v[7]); note != "" {
			payload["note"] = note
		}
		taskID := strings.TrimSpace(v[6])
		return m.postTimeCmd("/api/time/plans/create", payload, "已创建有界计时计划", taskID), nil, true

	case "time.plan.extend":
		if m.timeState.EditingPlan == nil {
			return nil, fmt.Errorf("请先选择要调整的计划"), true
		}
		p := *m.timeState.EditingPlan
		payload := map[string]any{
			"idempotencyKey":  idempotencyKey("tui-plan-ext"),
			"planId":          p.ID,
			"expectedVersion": p.Version,
		}
		hasChange := false
		if minsStr := strings.TrimSpace(v[0]); minsStr != "" && minsStr != "0" {
			mins, err := strconv.ParseFloat(minsStr, 64)
			if err != nil || mins < 0 {
				return nil, fmt.Errorf("追加时长请输入非负分钟数"), true
			}
			if mins > 0 {
				payload["addAllowanceMinutes"] = mins
				hasChange = true
			}
		}
		if hsStr := strings.TrimSpace(v[1]); hsStr != "" {
			ms, d, tm, err := parseTimeInputToSpec(hsStr, m.effectiveTimeDate())
			if err != nil {
				return nil, err, true
			}
			if ms != nil {
				payload["hardStopAtMs"] = *ms
			} else if tm != "" {
				payload["hardStopDate"] = d
				payload["hardStopTime"] = tm
			}
			hasChange = true
		}
		if !hasChange {
			return nil, fmt.Errorf("请输入追加时长或新的最晚停止时间"), true
		}
		return m.postTimeCmd("/api/time/plans/update", payload, "已更新计时计划限制", p.TaskUUID), nil, true

	case "time.log":
		title := strings.TrimSpace(v[0])
		if title == "" {
			return nil, errRequired("活动内容"), true
		}
		d := strings.TrimSpace(v[1])
		if _, err := time.ParseInLocation("2006-01-02", d, time.Local); err != nil {
			return nil, fmt.Errorf("日期格式应为 YYYY-MM-DD"), true
		}
		startMs, err := parseDateTimeMs(v[2], d)
		if err != nil {
			return nil, err, true
		}
		endMs, err := parseDateTimeMs(v[3], d)
		if err != nil {
			return nil, err, true
		}
		if endMs <= startMs {
			return nil, fmt.Errorf("结束时间必须晚于开始时间"), true
		}
		payload := map[string]any{
			"idempotencyKey": idempotencyKey("tui-log"),
			"source":         "manual",
			"title":          title,
			"startMs":        startMs,
			"endMs":          endMs,
			"precision":      v[6],
			"tags":           splitTags(v[5]),
		}
		if proj := strings.TrimSpace(v[4]); proj != "" {
			payload["projectSnapshot"] = proj
		}
		if v[7] == "true" {
			payload["explicitCategoryId"] = "sleep"
		}
		if note := strings.TrimSpace(v[8]); note != "" {
			payload["note"] = note
		}
		if m.selected.kind == "task" && m.selected.id != "" {
			payload["taskUuid"] = m.selected.id
		}
		return m.postTimeCmd("/api/time/log", payload, "已补记时间段", m.selected.id), nil, true

	case "time.segment.edit":
		if m.timeState.EditingSegment == nil {
			return nil, fmt.Errorf("未选择要修正的时间段"), true
		}
		seg := *m.timeState.EditingSegment
		title := strings.TrimSpace(v[0])
		if title == "" {
			return nil, errRequired("活动标题"), true
		}
		patch := map[string]any{
			"title":     title,
			"precision": v[5],
			"tags":      splitTags(v[4]),
		}
		if proj := strings.TrimSpace(v[3]); proj != "" {
			patch["projectSnapshot"] = proj
		} else {
			patch["projectSnapshot"] = nil
		}
		if v[6] == "true" {
			patch["categoryId"] = "sleep"
		} else if strings.EqualFold(seg.CategoryID, "sleep") {
			patch["categoryId"] = "uncategorized"
		}
		if sStr := strings.TrimSpace(v[1]); sStr != "" {
			ms, err := parseDateTimeMs(sStr, m.effectiveTimeDate())
			if err != nil {
				return nil, err, true
			}
			patch["startMs"] = ms
		}
		if eStr := strings.TrimSpace(v[2]); eStr != "" {
			ms, err := parseDateTimeMs(eStr, m.effectiveTimeDate())
			if err != nil {
				return nil, err, true
			}
			patch["endMs"] = ms
		}
		if v[7] == "true" {
			patch["confirmReview"] = true
		}
		return m.postTimeCmd("/api/time/update", map[string]any{
			"idempotencyKey":  idempotencyKey("tui-seg-upd"),
			"activityId":      seg.ActivityID,
			"expectedVersion": seg.Version,
			"patch":           patch,
		}, "已修正并更新记录", seg.TaskUUID), nil, true
	}
	return nil, nil, false
}

func fallbackStr(a, b, c string) string {
	if strings.TrimSpace(a) != "" {
		return a
	}
	if strings.TrimSpace(b) != "" {
		return b
	}
	return c
}
