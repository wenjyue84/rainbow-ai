package admin

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func TestBotsDefaultTeamAndLiveState(t *testing.T) {
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(`{"status":"ok","whatsapp":"open","instanceId":"jayson"}`))
	}))
	defer up.Close()
	t.Setenv("RAINBOW_WA_NUMBER_JAYSON_PA", "6075710390")
	t.Setenv("BRIDGE_URL_JAYSON_PA", up.URL)
	t.Setenv("RAINBOW_WA_NUMBER", "60103084289")
	t.Setenv("BRIDGE_URL_PELANGI", "")
	t.Setenv("RAINBOW_WA_NUMBER_SENAI_APP", "60103341058")
	t.Setenv("BRIDGE_URL_SENAI_APP", "http://127.0.0.1:1") // unreachable → offline
	t.Setenv("RAINBOW_WA_NUMBER_SOUTHERN", "")
	t.Setenv("BRIDGE_URL_SOUTHERN", "")

	h := New(nil, "", "", t.TempDir())
	h.SetProfiles([]string{"pelangi", "senai-app", "jayson-pa"}, "pelangi")
	h.SetBridge("http://127.0.0.1:1") // pelangi bridge unreachable → offline
	rec := httptest.NewRecorder()
	h.bots(rec, httptest.NewRequest(http.MethodGet, "/api/rainbow/bots", nil))
	if rec.Code != 200 {
		t.Fatalf("status %d", rec.Code)
	}
	var out struct{ Bots []Bot }
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatal(err)
	}
	byID := map[string]Bot{}
	for _, b := range out.Bots {
		byID[b.ID] = b
	}
	if len(byID) != 4 {
		t.Fatalf("want 4 bots, got %d", len(byID))
	}
	if r := byID["rainbow"]; r.Phone != "60103084289" || r.State != "offline" || r.Business != "Pelangi Capsule Hostel" {
		t.Fatalf("rainbow: %+v", r)
	}
	if r := byID["jayson"]; r.Phone != "6075710390" || r.State != "open" || r.InstanceID != "jayson" || r.Profile != "jayson-pa" {
		t.Fatalf("jayson: %+v", r)
	}
	if r := byID["ramli"]; r.Phone != "60103341058" || r.State != "offline" || r.Profile != "senai-app" {
		t.Fatalf("ramli: %+v", r)
	}
	if r := byID["rachel"]; r.Configured || r.State != "not_set" || r.Business != "Southern Homestay" {
		t.Fatalf("rachel should be not_set: %+v", r)
	}
}

func TestBotsFileOverride(t *testing.T) {
	dir := t.TempDir()
	os.WriteFile(filepath.Join(dir, botsFile), []byte(`[{"id":"x","name":"X","role":"r","business":"b","profile":"pelangi","phone":"601"}]`), 0o644)
	h := New(nil, "", "", dir)
	bots := h.loadBots()
	if len(bots) != 1 || bots[0].Name != "X" || bots[0].Phone != "601" {
		t.Fatalf("override not applied: %+v", bots)
	}
}
