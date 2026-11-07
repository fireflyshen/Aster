package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"
	"regexp"
	"strings"
	"time"
)

type Note struct {
	Entry       string `json:"entry"`
	Description string `json:"description"`
}
type Task struct {
	Parent      string   `json:"parent"`
	Wait        string   `json:"wait"`
	End         string   `json:"end"`
	Recur       string   `json:"recur"`
	Until       string   `json:"until"`
	Scheduled   string   `json:"scheduled"`
	Depends     any      `json:"depends"`
	UUID        string   `json:"uuid"`
	Description string   `json:"description"`
	Project     string   `json:"project"`
	Status      string   `json:"status"`
	Due         string   `json:"due"`
	Priority    string   `json:"priority"`
	Tags        []string `json:"tags"`
	Start       string   `json:"start"`
	Annotations []Note   `json:"annotations"`
}
type Project struct {
	Color       string `json:"color"`
	Description string `json:"description"`
	Name        string `json:"name"`
	Status      string `json:"status"`
	Outcome     string `json:"outcome"`
	NextTask    string `json:"nextTask"`
}
type Column struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}
type SavedItem struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description"`
	Expression  string `json:"expression"`
	Color       string `json:"color"`
	Favorite    bool   `json:"favorite"`
	Count       int    `json:"count"`
}
type Placement struct {
	UUID     string `json:"uuid"`
	ColumnID string `json:"columnId"`
}
type Organization struct {
	Filters       []SavedItem    `json:"filters"`
	Tags          []SavedItem    `json:"tags"`
	ProjectCounts map[string]int `json:"projectCounts"`
	Energy        *struct {
		Remaining           float64 `json:"remaining"`
		Max                 float64 `json:"max"`
		ActiveCount         int     `json:"activeCount"`
		TrackedSecondsToday float64 `json:"trackedSecondsToday"`
	} `json:"energy"`
	Timing *struct {
		Available bool   `json:"available"`
		Error     string `json:"error"`
	} `json:"timing"`
	Revision int       `json:"revision"`
	Projects []Project `json:"projects"`
	Board    struct {
		Columns    []Column    `json:"columns"`
		Placements []Placement `json:"placements"`
		Order      []string    `json:"order"`
	} `json:"board"`
}
type Client struct{ Host, TaskCommand, Taskrc, Node, Socket string }
type requestError struct {
	message   string
	uncertain bool
	code      int
}

func (e *requestError) Error() string { return e.message }
func quote(s string) string           { return "'" + strings.ReplaceAll(s, "'", "'\"'\"'") + "'" }
func (c Client) validate() error {
	if !regexp.MustCompile(`^[a-zA-Z0-9_][a-zA-Z0-9_.@:\[\]-]*$`).MatchString(c.Host) {
		return fmt.Errorf("invalid SSH target")
	}
	for _, p := range []string{c.TaskCommand, c.Node, c.Socket} {
		if !strings.HasPrefix(p, "/") || strings.ContainsAny(p, "\x00\r\n") {
			return fmt.Errorf("command and socket paths must be absolute")
		}
	}
	if c.Taskrc != "" && (!strings.HasPrefix(c.Taskrc, "/") || strings.ContainsAny(c.Taskrc, "\x00\r\n")) {
		return fmt.Errorf("taskrc must be absolute")
	}
	return nil
}
func (c Client) identity() string {
	b, _ := json.Marshal([]string{"local", "", c.TaskCommand, c.Taskrc, ""})
	h := sha256.Sum256(b)
	return hex.EncodeToString(h[:])
}
func (c Client) run(command string, write bool) ([]byte, error) {
	return c.runInput(command, write, nil)
}
func (c Client) runInput(command string, write bool, input []byte) ([]byte, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, "ssh", "-oBatchMode=yes", "-oConnectTimeout=8", c.Host, command)
	cmd.Stdin = bytes.NewReader(input)
	var stderr strings.Builder
	cmd.Stderr = &stderr
	b, err := cmd.Output()
	if err != nil {
		return nil, &requestError{message: fmt.Sprintf("SSH failed: %v %s", err, stderr.String()), uncertain: write}
	}
	return b, nil
}

const bridge = `const http=require('node:http');const p=JSON.parse(require('node:fs').readFileSync(0,'utf8'));const b=p.data?JSON.stringify(p.data):'';const q=http.request({socketPath:p.socket,path:p.route,method:b?'POST':'GET',headers:{'Content-Type':'application/json','X-Aster-Source':p.identity}},r=>{let s='';r.on('data',c=>s+=c);r.on('end',()=>console.log(JSON.stringify({status:r.statusCode,body:JSON.parse(s)})))});q.setTimeout(20000,()=>q.destroy(new Error('Workspace timeout')));q.on('error',e=>{console.error(e.message);process.exitCode=1});q.end(b);`

func (c Client) request(route string, data any, out any) error {
	p, _ := json.Marshal(map[string]any{"socket": c.Socket, "identity": c.identity(), "route": route, "data": data})
	b, err := c.runInput(quote(c.Node)+" -e "+quote(bridge), data != nil, p)
	if err != nil {
		return err
	}
	var reply struct {
		Status int             `json:"status"`
		Body   json.RawMessage `json:"body"`
	}
	if err = json.Unmarshal(b, &reply); err != nil {
		return &requestError{message: "Invalid workspace response", uncertain: data != nil}
	}
	if reply.Status != 200 {
		var failure struct {
			Error   string
			Outcome string
		}
		_ = json.Unmarshal(reply.Body, &failure)
		return &requestError{message: fmt.Sprintf("Workspace: %s (%d)", failure.Error, reply.Status), uncertain: failure.Outcome == "unknown" || data != nil && reply.Status >= 500, code: reply.Status}
	}
	if out != nil {
		if err = json.Unmarshal(reply.Body, out); err != nil {
			return &requestError{message: "Invalid workspace payload", uncertain: data != nil}
		}
	}
	return nil
}
func (c Client) workspace() (Organization, error) {
	var snap struct {
		Identity     string       `json:"identity"`
		Organization Organization `json:"organization"`
	}
	err := c.request("/api/workspace", nil, &snap)
	if err == nil && snap.Identity != c.identity() {
		err = fmt.Errorf("Taskwarrior source mismatch; check --task and --taskrc")
	}
	return snap.Organization, err
}
func (c Client) tasks() ([]Task, error) {
	var result struct {
		Tasks []Task `json:"tasks"`
	}
	err := c.request("/api/tasks", nil, &result)
	if err == nil {
		if result.Tasks == nil {
			return nil, fmt.Errorf("Invalid task list response; update the workspace service")
		}
		return result.Tasks, nil
	}
	if e, ok := err.(*requestError); !ok || e.code != 404 {
		return nil, err
	}
	return c.legacyTasks()
}
func (c Client) legacyTasks() ([]Task, error) {
	args := []string{c.TaskCommand}
	if c.Taskrc != "" {
		args = append(args, "rc:"+c.Taskrc)
	}
	args = append(args, "rc.json.array=on", "rc.color=off", "rc.verbose=nothing", "rc.gc=off", "rc.hooks=off", "(", "status:pending", "or", "status:waiting", "or", "status:completed", ")", "export")
	for i := range args {
		args[i] = quote(args[i])
	}
	b, err := c.run(strings.Join(args, " "), false)
	if err != nil {
		return nil, err
	}
	var tasks []Task
	err = json.Unmarshal(b, &tasks)
	return tasks, err
}

// Verify identity before every mutation; all metadata writes stay in the server revision queue.
func (c Client) mutate(route string, data any) error {
	if _, err := c.workspace(); err != nil {
		return err
	}
	return c.request(route, data, nil)
}

func (c Client) read(route string, out any) error {
	if _, err := c.workspace(); err != nil {
		return err
	}
	return c.request(route, nil, out)
}
func writePrivateFile(path string, data []byte) error {
	f, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		return err
	}
	_, werr := io.Copy(f, bytes.NewReader(data))
	cerr := f.Close()
	if werr != nil {
		return werr
	}
	return cerr
}
