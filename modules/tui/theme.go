package main

import (
	"fmt"
	"strings"
	"time"

	"github.com/charmbracelet/lipgloss"
	"github.com/charmbracelet/x/ansi"
	"github.com/muesli/termenv"
)

// Neutral warm-balanced surfaces paired with softened eye-comfort Todoist task semantics and swatches.
var (
	ink           = lipgloss.AdaptiveColor{Light: "#202022", Dark: "#EBEAE6"}
	inkSoft       = lipgloss.AdaptiveColor{Light: "#4D4C48", Dark: "#B8B6B0"}
	muted         = lipgloss.AdaptiveColor{Light: "#76746E", Dark: "#8B8983"}
	line          = lipgloss.AdaptiveColor{Light: "#DBD9D2", Dark: "#333336"}
	treeLine      = lipgloss.AdaptiveColor{Light: "#CFCDC6", Dark: "#424246"}
	brand         = lipgloss.AdaptiveColor{Light: "#3F4146", Dark: "#C9C7C0"}
	selectedBG    = lipgloss.AdaptiveColor{Light: "#EDEBE5", Dark: "#2C2C30"}
	selectedFG    = lipgloss.AdaptiveColor{Light: "#1B1B1D", Dark: "#F3F2EE"}
	p1Color       = lipgloss.AdaptiveColor{Light: "#C9443B", Dark: "#EB6F66"}
	p2Color       = lipgloss.AdaptiveColor{Light: "#D17A15", Dark: "#E69530"}
	p3Color       = lipgloss.AdaptiveColor{Light: "#366DB8", Dark: "#6598E0"}
	okColor       = lipgloss.AdaptiveColor{Light: "#1E7E40", Dark: "#43B366"}
	tomorrowColor = lipgloss.AdaptiveColor{Light: "#B56712", Dark: "#E69530"}
	warnColor     = lipgloss.AdaptiveColor{Light: "#B56712", Dark: "#E69530"}
	dangerColor   = lipgloss.AdaptiveColor{Light: "#C9443B", Dark: "#EB6F66"}
	timerColor    = lipgloss.AdaptiveColor{Light: "#1B829C", Dark: "#3DAEC9"}

	accent   = lipgloss.NewStyle().Foreground(brand).Bold(true)
	dim      = lipgloss.NewStyle().Foreground(muted)
	softText = lipgloss.NewStyle().Foreground(inkSoft)
)

var swatches = map[string]lipgloss.AdaptiveColor{
	"berry":  {Light: "#B52D6E", Dark: "#DE5B97"},
	"red":    {Light: "#C9443B", Dark: "#EB6F66"},
	"orange": {Light: "#D67814", Dark: "#ED9536"},
	"yellow": {Light: "#BD8D08", Dark: "#E6C232"},
	"olive":  {Light: "#7A8724", Dark: "#A6B348"},
	"lime":   {Light: "#55942C", Dark: "#7EC252"},
	"green":  {Light: "#1E7E40", Dark: "#43B366"},
	"mint":   {Light: "#2C9484", Dark: "#5FC2B2"},
	"teal":   {Light: "#1B829C", Dark: "#3DAEC9"},
	"blue":   {Light: "#366DB8", Dark: "#6598E0"},
	"purple": {Light: "#6D46B8", Dark: "#A67FE3"},
	"gray":   {Light: "#7D7B76", Dark: "#888681"},
}

func disableColor()               { lipgloss.SetColorProfile(termenv.Ascii) }
func clip(s string, w int) string { return ansi.Truncate(s, max(1, w), "…") }

func wrap(s string, w int) string {
	normalized := strings.ReplaceAll(strings.ReplaceAll(s, "\r\n", "\n"), "\r", "\n")
	var out []string
	for _, part := range strings.Split(normalized, "\n") {
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

func priorityCode(priority string) string {
	switch priority {
	case "H":
		return "P1"
	case "M":
		return "P2"
	case "L":
		return "P3"
	default:
		return ""
	}
}

func priorityStyle(priority string, mutedTone bool) lipgloss.Style {
	if mutedTone {
		return lipgloss.NewStyle().Foreground(muted)
	}
	return lipgloss.NewStyle().
		Foreground(priorityColor(priority)).
		Bold(priority == "H" || priority == "M")
}

// statusMeta resolves the single-cell task status glyph, color, and bold weight shared by list, board, and inspector views.
func statusMeta(t Task, waiting bool) (string, lipgloss.AdaptiveColor, bool) {
	if t.Status == "completed" {
		return "✓", okColor, false
	}
	if t.Start != "" {
		return "▶", timerColor, true
	}
	if waiting {
		return "◴", warnColor, false
	}
	return "○", priorityColor(t.Priority), false
}

func statusGlyph(t Task, waiting bool) string {
	glyph, col, bold := statusMeta(t, waiting)
	st := lipgloss.NewStyle().Foreground(col)
	if bold {
		st = st.Bold(true)
	}
	return st.Render(glyph)
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
		if local.Hour() != 0 || local.Minute() != 0 {
			return "今天 " + local.Format("15:04"), okColor
		}
		return "今天", okColor
	}
	if targetDay.Equal(todayStart.AddDate(0, 0, 1)) {
		if local.Hour() != 0 || local.Minute() != 0 {
			return "明天 " + local.Format("15:04"), tomorrowColor
		}
		return "明天", tomorrowColor
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

type styledSpan struct {
	text  string
	style lipgloss.Style
}

func span(text string, style lipgloss.Style) styledSpan {
	return styledSpan{text: text, style: style}
}

func clipSpans(spans []styledSpan, maxWidth int) ([]styledSpan, int) {
	maxWidth = max(1, maxWidth)
	out := make([]styledSpan, 0, len(spans))
	used := 0
	for _, sp := range spans {
		if sp.text == "" {
			continue
		}
		w := lipgloss.Width(sp.text)
		if used+w <= maxWidth {
			out = append(out, sp)
			used += w
			continue
		}
		rem := maxWidth - used
		if rem > 0 {
			tr := ansi.Truncate(sp.text, rem, "…")
			if tr != "" {
				out = append(out, styledSpan{text: tr, style: sp.style})
				used += lipgloss.Width(tr)
			}
		}
		break
	}
	return out, used
}

// renderSpans joins spans within maxWidth, paints continuous selection background across every segment and padding cell, and pads to totalWidth.
func renderSpans(spans []styledSpan, maxWidth, totalWidth int, selected bool) string {
	totalWidth = max(1, totalWidth)
	clipped, used := clipSpans(spans, min(max(1, maxWidth), totalWidth))
	var b strings.Builder
	for _, sp := range clipped {
		st := sp.style
		if selected {
			st = st.Background(selectedBG)
		}
		b.WriteString(st.Render(sp.text))
	}
	if pad := max(0, totalWidth-used); pad > 0 {
		padStyle := lipgloss.NewStyle()
		if selected {
			padStyle = padStyle.Background(selectedBG)
		}
		b.WriteString(padStyle.Render(strings.Repeat(" ", pad)))
	}
	return b.String()
}

func sectionRule(title string, width int) string {
	if title == "" {
		return lipgloss.NewStyle().Foreground(line).Render(strings.Repeat("─", max(1, width)))
	}
	t := accent.Render(title)
	tw := lipgloss.Width(t)
	ruleW := width - tw - 1
	if ruleW < 3 {
		return t
	}
	return t + " " + lipgloss.NewStyle().Foreground(line).Render(strings.Repeat("─", ruleW))
}
