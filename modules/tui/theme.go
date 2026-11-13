package main

import (
	"fmt"
	"strings"
	"time"

	"github.com/charmbracelet/lipgloss"
	"github.com/charmbracelet/x/ansi"
	"github.com/muesli/termenv"
)

// Scientific low-halation adaptive palette aligned with Aster Web (Light: Soft Morning Cloud & Dusty Sapphire; Dark: Midnight Graphite & Periwinkle Mist).
var (
	ink         = lipgloss.AdaptiveColor{Light: "#232733", Dark: "#E2E5ED"}
	inkSoft     = lipgloss.AdaptiveColor{Light: "#4B5263", Dark: "#B4BBC9"}
	muted       = lipgloss.AdaptiveColor{Light: "#767D8F", Dark: "#7C8394"}
	line        = lipgloss.AdaptiveColor{Light: "#D7DCE5", Dark: "#2F3542"}
	brand       = lipgloss.AdaptiveColor{Light: "#3F63AB", Dark: "#6D8CE0"}
	selectedBG  = lipgloss.AdaptiveColor{Light: "#E8EFFB", Dark: "#222A3B"}
	selectedFG  = lipgloss.AdaptiveColor{Light: "#1F3B78", Dark: "#E8EEFF"}
	p1Color     = lipgloss.AdaptiveColor{Light: "#B83B3B", Dark: "#E27272"}
	p2Color     = lipgloss.AdaptiveColor{Light: "#B26121", Dark: "#DF9A52"}
	p3Color     = lipgloss.AdaptiveColor{Light: "#3F63AB", Dark: "#7BA4F0"}
	okColor     = lipgloss.AdaptiveColor{Light: "#2F7D56", Dark: "#62BA8A"}
	warnColor   = lipgloss.AdaptiveColor{Light: "#A66A20", Dark: "#D4A054"}
	dangerColor = lipgloss.AdaptiveColor{Light: "#B83B3B", Dark: "#E27272"}
	timerColor  = lipgloss.AdaptiveColor{Light: "#2A7A68", Dark: "#5AC8AE"}

	accent   = lipgloss.NewStyle().Foreground(brand).Bold(true)
	dim      = lipgloss.NewStyle().Foreground(muted)
	softText = lipgloss.NewStyle().Foreground(inkSoft)
)

var swatches = map[string]lipgloss.AdaptiveColor{
	"berry":  {Light: "#A33D6E", Dark: "#D978A4"},
	"red":    {Light: "#B83B3B", Dark: "#E27272"},
	"orange": {Light: "#B26121", Dark: "#DF9A52"},
	"yellow": {Light: "#A67D1A", Dark: "#D9B24C"},
	"olive":  {Light: "#6D7B2A", Dark: "#A7B85A"},
	"lime":   {Light: "#527D2C", Dark: "#8EC25E"},
	"green":  {Light: "#2F7D56", Dark: "#62BA8A"},
	"mint":   {Light: "#277A65", Dark: "#55C4A6"},
	"teal":   {Light: "#287382", Dark: "#58B8CC"},
	"blue":   {Light: "#3F63AB", Dark: "#6D8CE0"},
	"purple": {Light: "#6B51A6", Dark: "#9E84D9"},
	"gray":   muted,
}

func disableColor()               { lipgloss.SetColorProfile(termenv.Ascii) }
func clip(s string, w int) string { return ansi.Truncate(s, max(1, w), "…") }

func wrap(s string, w int) string {
	var out []string
	for _, part := range strings.Split(s, "\n") {
		out = append(
			out,
			lipgloss.NewStyle().Width(max(1, w)).Render(clean(part)),
		)
	}
	return strings.Join(out, "\n")
}

func swatchColor(name string) lipgloss.AdaptiveColor {
	if c, ok := swatches[name]; ok {
		return c
	}
	return muted
}

func panel(title, body string, width, height int, focused bool) string {
	return panelWithRight(title, "", body, width, height, focused)
}

func panelWithRight(
	title, rightMeta, body string,
	width, height int,
	focused bool,
) string {
	borderColor := line
	titleStyle := softText.Bold(true)
	if focused {
		borderColor = brand
		titleStyle = accent
	}
	innerW := max(1, width-4)
	headerLine := titleStyle.Render(clip(title, innerW))
	if rightMeta != "" && innerW > 12 {
		metaStyled := dim.Render(rightMeta)
		metaW := lipgloss.Width(metaStyled)
		titleMax := max(4, innerW-metaW-2)
		headerLine = titleStyle.Render(clip(title, titleMax))
		gap := max(1, innerW-lipgloss.Width(headerLine)-metaW)
		headerLine += strings.Repeat(" ", gap) + metaStyled
	}
	rule := lipgloss.NewStyle().
		Foreground(line).
		Render(strings.Repeat("─", innerW))
	content := headerLine + "\n" + rule + "\n" + body
	return lipgloss.NewStyle().
		Border(lipgloss.RoundedBorder()).
		BorderForeground(borderColor).
		Padding(0, 1).
		Width(max(1, width-2)).
		Height(max(1, height-2)).
		MaxHeight(height).
		Render(content)
}

func window(lines []string, offset, height int) string {
	offset = max(0, min(offset, max(0, len(lines)-height)))
	end := min(len(lines), offset+height)
	return strings.Join(lines[offset:end], "\n")
}

func formatDurationShort(seconds float64) string {
	total := int(seconds)
	if total < 60 {
		return fmt.Sprintf("%ds", max(0, total))
	}
	mins := total / 60
	if mins < 60 {
		return fmt.Sprintf("%dm", mins)
	}
	hours := mins / 60
	rem := mins % 60
	if rem == 0 {
		return fmt.Sprintf("%dh", hours)
	}
	return fmt.Sprintf("%dh%02dm", hours, rem)
}

func priorityColor(priority string) lipgloss.AdaptiveColor {
	switch priority {
	case "H":
		return p1Color
	case "M":
		return p2Color
	case "L":
		return p3Color
	default:
		return muted
	}
}

func priorityBadge(priority string) string {
	switch priority {
	case "H":
		return lipgloss.NewStyle().Foreground(p1Color).Bold(true).Render("P1")
	case "M":
		return lipgloss.NewStyle().Foreground(p2Color).Bold(true).Render("P2")
	case "L":
		return lipgloss.NewStyle().Foreground(p3Color).Render("P3")
	default:
		return ""
	}
}

func statusGlyph(t Task, waiting bool) string {
	if t.Status == "completed" {
		return lipgloss.NewStyle().Foreground(okColor).Render("✓")
	}
	if t.Start != "" {
		return lipgloss.NewStyle().Foreground(timerColor).Bold(true).Render("▶")
	}
	if waiting {
		return lipgloss.NewStyle().Foreground(warnColor).Render("◴")
	}
	c := priorityColor(t.Priority)
	return lipgloss.NewStyle().Foreground(c).Render("○")
}

func dueLabel(
	due time.Time,
	rawDue string,
	completed bool,
	now time.Time,
) (string, lipgloss.AdaptiveColor) {
	if due.IsZero() {
		if rawDue == "" {
			return "", muted
		}
		return shownDate(rawDue), muted
	}
	local := due.Local()
	formatted := local.Format("01-02")
	if local.Year() != now.Year() {
		formatted = local.Format("2006-01-02")
	}
	if local.Hour() != 0 || local.Minute() != 0 {
		formatted += " " + local.Format("15:04")
	}
	if completed {
		return formatted, muted
	}
	y1, m1, d1 := now.Local().Date()
	y2, m2, d2 := local.Date()
	todayStart := time.Date(y1, m1, d1, 0, 0, 0, 0, now.Local().Location())
	targetDay := time.Date(y2, m2, d2, 0, 0, 0, 0, local.Location())
	if due.Before(now) {
		return "逾期 " + formatted, dangerColor
	}
	if targetDay.Equal(todayStart) {
		return "今天 " + local.Format("15:04"), okColor
	}
	if targetDay.Equal(todayStart.AddDate(0, 0, 1)) {
		return "明天 " + local.Format("15:04"), p2Color
	}
	return formatted, muted
}

func energyMeter(remaining, maxVal float64, bars int) string {
	if maxVal <= 0 {
		return ""
	}
	ratio := remaining / maxVal
	if ratio < 0 {
		ratio = 0
	}
	if ratio > 1 {
		ratio = 1
	}
	filled := int(ratio*float64(bars) + 0.5)
	filled = max(0, min(bars, filled))
	color := okColor
	if ratio < 0.2 {
		color = dangerColor
	} else if ratio < 0.5 {
		color = warnColor
	}
	gauge := strings.Repeat("▮", filled) + strings.Repeat("▱", bars-filled)
	return lipgloss.NewStyle().Foreground(color).Bold(true).
		Render(fmt.Sprintf("⚡ %.0f/%.0f %s", remaining, maxVal, gauge))
}
