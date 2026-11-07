package main

import (
	"flag"
	"fmt"
	"os"

	tea "github.com/charmbracelet/bubbletea"
)

func main() {
	c := Client{}
	flag.StringVar(&c.Host, "ssh", "rn", "SSH host alias")
	flag.StringVar(&c.TaskCommand, "task", "/usr/local/bin/task", "remote Taskwarrior command")
	flag.StringVar(&c.Taskrc, "taskrc", "/etc/taskwarrior/taskrc", "remote taskrc")
	flag.StringVar(&c.Node, "node", "/opt/aster/runtime/node", "remote Node runtime")
	flag.StringVar(&c.Socket, "socket", "/opt/aster/data/workspace.sock", "remote workspace socket")
	noColor := flag.Bool("no-color", false, "disable terminal colors")
	flag.Parse()
	if err := c.validate(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	if *noColor {
		disableColor()
	}
	if _, err := tea.NewProgram(newModel(c), tea.WithAltScreen(), tea.WithMouseCellMotion()).Run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
