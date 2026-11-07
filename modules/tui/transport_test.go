package main

import (
	"encoding/json"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func TestRealNodeBridgeOverPrivateSocket(t *testing.T) {
	if os.Getenv("ASTER_TRANSPORT_INTEGRATION") != "1" {
		t.Skip("set ASTER_TRANSPORT_INTEGRATION=1 for Node/socket integration")
	}
	node, e := exec.LookPath("node")
	if e != nil {
		t.Fatal(e)
	}
	dir, e := os.MkdirTemp("/private/tmp", "atui-")
	if e != nil {
		t.Fatal(e)
	}
	defer os.RemoveAll(dir)
	socket := filepath.Join(dir, "w.sock")
	listener, e := net.Listen("unix", socket)
	if e != nil {
		t.Fatal(e)
	}
	c := Client{"rn", "/usr/local/bin/task", "/etc/taskwarrior/taskrc", node, socket}
	received := make(chan map[string]any, 1)
	server := &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.Header.Get("X-Aster-Source") != c.identity() {
			w.WriteHeader(409)
			json.NewEncoder(w).Encode(map[string]string{"error": "source"})
			return
		}
		switch r.URL.Path {
		case "/api/workspace":
			json.NewEncoder(w).Encode(map[string]any{"identity": c.identity(), "organization": Organization{Revision: 4, Projects: []Project{}}})
		case "/api/tasks":
			json.NewEncoder(w).Encode(map[string]any{"tasks": []Task{{UUID: "task", Description: "中文任务", Status: "pending", Due: "2026-11-07T12:00:37.000Z"}}})
		default:
			var payload map[string]any
			if e := json.NewDecoder(r.Body).Decode(&payload); e != nil {
				t.Error(e)
			}
			received <- payload
			json.NewEncoder(w).Encode(map[string]any{"ok": true})
		}
	})}
	go server.Serve(listener)
	defer server.Close()
	stub := "#!/bin/sh\nfor arg; do :; done\nexec /bin/sh -c \"$arg\"\n"
	if e = os.WriteFile(filepath.Join(dir, "ssh"), []byte(stub), 0700); e != nil {
		t.Fatal(e)
	}
	t.Setenv("PATH", dir+string(os.PathListSeparator)+os.Getenv("PATH"))
	org, e := c.workspace()
	if e != nil || org.Revision != 4 {
		t.Fatal(org, e)
	}
	ts, e := c.tasks()
	if e != nil || len(ts) != 1 || compact(ts[0].Due) != "20261107T120037Z" {
		t.Fatal(ts, e)
	}
	literal := strings.Repeat("中文 ' $(never-run) ; ", 40000)
	if e = c.mutate("/api/action", map[string]any{"description": literal, "uuid": "task", "action": "edit"}); e != nil {
		t.Fatal(e)
	}
	if (<-received)["description"] != literal {
		t.Fatal("stdin payload corrupted")
	}
}
