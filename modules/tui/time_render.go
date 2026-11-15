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

func (m model) renderStatisticLines(r row, width int, selected bool) []string {
	primary, secondary := formatDurationShort(r.chartSeconds), formatCurrencyCny(r.chartCost)
	if m.timeState.ChartMetric == "cost" {
		primary, secondary = secondary, primary
	}
	valueWidth := max(10, lipgloss.Width(primary))
	labelWidth := max(1, width-valueWidth-4)
	labelText := r.title
	if r.kind == "time.day" {
		if date, err := time.Parse("2006-01-02", r.id); err == nil {
			labelText = date.Format("01-02") + "  " + []string{"日", "一", "二", "三", "四", "五", "六"}[date.Weekday()]
		}
	}
	label := clip(clean(labelText), labelWidth)
	style := softText
	if selected {
		style = lipgloss.NewStyle().Foreground(selectedFG)
	}
	first := renderSpans([]styledSpan{timeRowMarker(selected), span(label, style), span(strings.Repeat(" ", max(1, width-2-lipgloss.Width(label)-lipgloss.Width(primary))), dim), span(primary, lipgloss.NewStyle().Foreground(ink))}, width, width, selected)
	// A quiet bounded chart prevents a large terminal becoming a wall of ink.
	barWidth := max(1, min(40, width-valueWidth-4))
	bar := renderStatisticBar(r.chartValue, r.chartMax, barWidth)
	second := renderSpans([]styledSpan{timeRowMarker(selected), span(bar, dim), span(strings.Repeat(" ", max(1, width-2-barWidth-lipgloss.Width(secondary))), dim), span(secondary, dim)}, width, width, selected)
	lines := []string{first, second}
	if strings.HasPrefix(r.kind, "time.report_") {
		// Budget and cash facts stay in the list as well as the inspector.
		for _, fact := range strings.Split(r.subtitle, " · ") {
			if strings.HasPrefix(fact, "超出") || strings.HasPrefix(fact, "现金 ") && fact != "现金 ¥0" {
				lines = append(lines, renderSpans([]styledSpan{timeRowMarker(selected), span(fact, dim)}, width, width, selected))
			}
		}
	}
	return lines
}

func renderTimeSummaryLines(r row, width int, selected bool) []string {
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
