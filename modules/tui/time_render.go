package main

import (
	"github.com/charmbracelet/lipgloss"
	"strings"
	"time"
)

func timeRowMarker(selected bool) styledSpan {
	if selected {
		return span("▎ ", accent)
	}
	return span("  ", dim)
}

// The axis has a fixed gutter; longer titles wrap without displacing the clocks.
func renderTimelineLines(r row, width int, selected, continues bool) []string {
	parts := strings.SplitN(r.title, "  ", 2)
	if len(parts) != 2 {
		return []string{renderSpans([]styledSpan{timeRowMarker(selected), span(r.title, softText)}, width, width, selected)}
	}
	clocks := strings.SplitN(parts[0], "–", 2)
	start, end := clocks[0], ""
	if len(clocks) == 2 {
		end = clocks[1]
	}
	meta := strings.Split(r.subtitle, " · ")
	duration := ""
	if len(meta) > 1 {
		duration = meta[1]
		meta = append(meta[:1], meta[2:]...)
	}
	width = min(width, 88)
	textWidth := max(1, width-12)
	titleStyle := lipgloss.NewStyle().Foreground(ink)
	if selected {
		titleStyle = titleStyle.Foreground(selectedFG)
	}
	lines := []string{}
	// Reserve duration only when there is room for a useful title.
	right := ""
	if textWidth >= 24 {
		right = duration
	}
	titleWidth := max(1, textWidth-lipgloss.Width(right))
	if right != "" {
		titleWidth -= 2
	}
	wrapped := strings.Split(wrap(parts[1], titleWidth), "\n")
	for i, title := range wrapped {
		clock, node := "     ", "│"
		if i == 0 {
			clock = start
			node = "●"
		}
		title = strings.TrimRight(title, " ")
		spans := []styledSpan{timeRowMarker(selected), span(clock, dim), span("  "+node+"  ", lipgloss.NewStyle().Foreground(treeLine)), span(title, titleStyle)}
		if i == 0 && right != "" {
			spans = append(spans, span(strings.Repeat(" ", max(2, textWidth-lipgloss.Width(title)-lipgloss.Width(right))), dim), span(right, dim))
		}
		lines = append(lines, renderSpans(spans, width, width, selected))
	}
	if right == "" && duration != "" {
		meta = append([]string{duration}, meta...)
	}
	metaText := strings.Join(meta, " · ")
	metaLines := strings.Split(wrap(metaText, textWidth), "\n")
	for i, text := range metaLines {
		tail := "│"
		if !continues && i == len(metaLines)-1 {
			tail = "╵"
		}
		clock := "     "
		if i == 0 {
			clock = end
		}
		lines = append(lines, renderSpans([]styledSpan{timeRowMarker(selected), span(clock, dim), span("  "+tail+"  ", lipgloss.NewStyle().Foreground(treeLine)), span(strings.TrimRight(text, " "), dim)}, width, width, selected))
	}
	if continues {
		lines = append(lines, renderSpans([]styledSpan{span("         │", lipgloss.NewStyle().Foreground(treeLine))}, width, width, false))
	}
	return lines
}

// Data columns stay together regardless of terminal width.
func (m model) renderStatisticLines(r row, width int, selected bool) []string {
	width = min(width, 88)
	primary, secondary := formatDurationShort(r.chartSeconds), formatCurrencyCny(r.chartCost)
	if m.timeState.ChartMetric == "cost" {
		primary, secondary = secondary, primary
	}
	if m.reportOverrunChart(r) {
		primary, secondary = formatCurrencyCny(r.chartOver), formatCurrencyCny(r.chartCost)
	}
	labelText := r.title
	if r.kind == "time.day" {
		if date, err := time.Parse("2006-01-02", r.id); err == nil {
			labelText = date.Format("01-02") + "  " + []string{"日", "一", "二", "三", "四", "五", "六"}[date.Weekday()]
		}
		// Daily values are a compact table beneath the chronological column chart.
		values := "  " + padTimeValue(primary, 10) + "  " + padTimeValue(secondary, 12)
		if width < 38 {
			values = "  " + primary + " · " + secondary
		}
		spans := []styledSpan{timeRowMarker(selected), span(labelText, softText), span(values, dim)}
		return []string{renderSpans(spans, width, width, selected)}
	}
	valueWidth := max(10, lipgloss.Width(primary), lipgloss.Width(secondary))
	labelWidth := min(28, max(8, width/3))
	label := clip(clean(labelText), labelWidth)
	style := softText
	if selected {
		style = lipgloss.NewStyle().Foreground(selectedFG)
	}
	lines := []string{}
	if width >= 56 {
		barWidth := max(1, width-labelWidth-valueWidth*2-8)
		value := r.chartValue
		maximum := r.chartMax
		if m.reportOverrunChart(r) {
			value = float64(r.chartOver)
			maximum = r.chartOverMax
		}
		spans := []styledSpan{timeRowMarker(selected), span(label+strings.Repeat(" ", max(1, labelWidth-lipgloss.Width(label)+2)), style), span(renderStatisticBar(value, maximum, barWidth), dim), span("  "+padTimeValue(primary, valueWidth), lipgloss.NewStyle().Foreground(ink)), span("  "+padTimeValue(secondary, valueWidth), dim)}
		lines = append(lines, renderSpans(spans, width, width, selected))
	} else {
		label = clip(clean(labelText), max(1, width-lipgloss.Width(primary)-4))
		lines = append(lines, renderSpans([]styledSpan{timeRowMarker(selected), span(label, style), span("  "+primary, dim)}, width, width, selected))
		value, maximum := r.chartValue, r.chartMax
		if m.reportOverrunChart(r) {
			value = float64(r.chartOver)
			maximum = r.chartOverMax
		}
		barWidth := max(1, width-lipgloss.Width(secondary)-4)
		lines = append(lines, renderSpans([]styledSpan{timeRowMarker(selected), span(renderStatisticBar(value, maximum, barWidth), dim), span("  "+secondary, dim)}, width, width, selected))
	}
	if strings.HasPrefix(r.kind, "time.report_") {
		for _, fact := range strings.Split(r.subtitle, " · ") {
			if strings.HasPrefix(fact, "超出") || strings.HasPrefix(fact, "现金 ") && fact != "现金 ¥0" {
				lines = append(lines, renderSpans([]styledSpan{timeRowMarker(selected), span(fact, dim)}, width, width, selected))
			}
		}
	}
	return lines
}

func padTimeValue(value string, width int) string {
	return strings.Repeat(" ", max(0, width-lipgloss.Width(value))) + value
}
func (m model) reportOverrunChart(r row) bool {
	return m.view == "time.report" && m.timeState.ReportSort == "highest_over_budget" && (r.kind == "time.report_task" || r.kind == "time.report_project")
}

func renderTimeSummaryLines(r row, width int, selected bool) []string {
	width = min(width, 88)
	title := r.title
	title = strings.ReplaceAll(title, "本周项目与标签分布 · ", "")
	title = strings.ReplaceAll(title, "今日时间线 · ", "")
	// Keyboard help belongs once beneath the totals, never in every data row.
	subtitle := strings.Split(r.subtitle, " · v ")[0]
	result := []string{renderSpans([]styledSpan{timeRowMarker(selected), span(title, softText)}, width, width, selected)}
	for _, text := range strings.Split(wrap(subtitle, max(1, width-2)), "\n") {
		result = append(result, renderSpans([]styledSpan{timeRowMarker(selected), span(strings.TrimRight(text, " "), dim)}, width, width, selected))
	}
	if strings.Contains(r.subtitle, " · v ") {
		hint := "v 维度   m 指标   [ ] 翻期"
		if strings.Contains(r.title, "每日") {
			hint += "   Enter 时间线"
		}
		result = append(result, renderSpans([]styledSpan{span("  "+hint, dim)}, width, width, false))
	}
	return append(result, "")
}
