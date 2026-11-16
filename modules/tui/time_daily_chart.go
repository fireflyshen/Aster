package main

import (
	"strings"

	"github.com/NimbleMarkets/ntcharts/barchart"
	"github.com/charmbracelet/lipgloss"
)

// One chronological chart reveals daily variation; exact values remain selectable below.
func (m model) renderDailyColumns(rows []row, width int) []string {
	var days []row
	maximum := 0.0
	for _, r := range rows {
		if r.kind == "time.day" {
			days = append(days, r)
			maximum = max(maximum, r.chartValue)
		}
	}
	if len(days) < 2 || width < 24 {
		return nil
	}
	if maximum == 0 {
		return []string{dim.Render("  暂无已确认记录"), ""}
	}
	width = min(72, width-2)
	stride := min(6, width/len(days))
	if stride < 2 {
		return nil
	} // Small monthly views retain the exact-value table.
	chartWidth := len(days)*stride - 1
	barWidth := min(2, stride-1)
	chart := barchart.New(
		chartWidth,
		4,
		barchart.WithNoAxis(),
		barchart.WithNoAutoMaxValue(),
		barchart.WithMaxValue(max(1, maximum)),
		barchart.WithNoAutoBarWidth(),
		barchart.WithBarWidth(barWidth),
		barchart.WithBarGap(stride-barWidth),
	)
	for _, day := range days {
		chart.Push(
			barchart.BarData{
				Values: []barchart.BarValue{
					{
						Value: day.chartValue,
						Style: lipgloss.NewStyle().Foreground(muted),
					},
				},
			},
		)
	}
	chart.Draw()
	label := "每日时长"
	maxLabel := formatDurationShort(maximum)
	if m.timeState.ChartMetric == "cost" {
		label = "每日时间成本"
		maxLabel = formatCurrencyCny(int64(maximum))
	}
	out := []string{dim.Render("  " + label + " · 最高 " + maxLabel)}
	for _, line := range strings.Split(chart.View(), "\n") {
		out = append(out, "  "+line)
	}
	ticks := make([]rune, chartWidth)
	for i := range ticks {
		ticks[i] = ' '
	}
	interval := 1
	if stride < 4 {
		interval = 7
	}
	for i, day := range days {
		if i%interval != 0 {
			continue
		}
		date := []rune(day.id)
		if len(date) < 2 {
			continue
		}
		text := date[len(date)-2:]
		pos := i * stride
		for j, r := range text {
			if pos+j < len(ticks) {
				ticks[pos+j] = r
			}
		}
	}
	out = append(out, dim.Render("  "+string(ticks)), "")
	return out
}

func (m model) statisticLegend(rows []row) string {
	for _, r := range rows {
		if !r.chart {
			continue
		}
		if r.kind == "time.day" {
			if m.timeState.ChartMetric == "cost" {
				return "日期          时间成本         时长"
			}
			return "日期              时长     时间成本"
		}
		if m.reportOverrunChart(r) {
			return "排行 · 条形表示超出预算金额 · 数值：超出 / 本期时间成本"
		}
		if m.timeState.ChartMetric == "cost" {
			return "横向比较 · 数值：时间成本 / 时长"
		}
		return "横向比较 · 数值：时长 / 时间成本"
	}
	return ""
}
