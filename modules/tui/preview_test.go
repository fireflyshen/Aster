package main

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/charmbracelet/lipgloss"
	"github.com/muesli/termenv"
)

func TestPreviewArtifacts(t *testing.T) {
	dir := os.Getenv("ASTER_PREVIEW_DIR")
	if dir == "" {
		t.Skip("set ASTER_PREVIEW_DIR to render sample screens")
	}
	lipgloss.SetColorProfile(termenv.TrueColor)
	lipgloss.SetHasDarkBackground(true)
	defer lipgloss.SetColorProfile(termenv.Ascii)
	m := sampleModel()
	m.client.Host = "rn"
	m.message = "已连接 rn"
	m.width = 140
	m.height = 36
	m.cursor = 5
	for _, name := range []string{"list", "board", "form"} {
		m.mode = ""
		m.board = false
		if name == "board" {
			m.board = true
			m.boardColumn = 2
		}
		if name == "form" {
			m.selected = m.current()
			m.openTaskForm("task.edit", m.current().task)
		}
		if e := os.WriteFile(
			filepath.Join(dir, name+".ansi"),
			[]byte(m.View()),
			0600,
		); e != nil {
			t.Fatal(e)
		}
	}
}
