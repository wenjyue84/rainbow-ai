package admin

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// Runtime WhatsApp instance registry (2026-09-23, setup wizard).
//
// Instances wired from env (PROFILE_INSTANCES / BRIDGE_INSTANCE_URLS /
// BRIDGE_QR_TOKEN_<INSTANCE>) only exist until the next edit of
// run-core-prod.sh. A number paired from the dashboard must survive a restart
// without anyone touching the server, so it is written to
// <dataDir>/instances.json and merged AFTER the env registry at boot (the file
// wins for the same id — it is the newer source).
//
//	{"instances":[{"id":"demo","profile":"demo","url":"http://127.0.0.1:8800/i/demo",
//	               "token":"<bridge qr token>","createdAt":"2026-09-23T02:00:00Z"}]}

const instanceStoreFile = "instances.json"

type storedInstance struct {
	ID        string `json:"id"`
	Profile   string `json:"profile"`
	URL       string `json:"url"`
	Token     string `json:"token,omitempty"`
	CreatedAt string `json:"createdAt,omitempty"`
}

type instanceStore struct {
	Instances []storedInstance `json:"instances"`
}

func readInstanceStore(dataDir string) instanceStore {
	var st instanceStore
	if dataDir == "" {
		return st
	}
	b, err := os.ReadFile(filepath.Join(dataDir, instanceStoreFile))
	if err != nil {
		return st
	}
	_ = json.Unmarshal(b, &st)
	return st
}

// StoredInstances returns the dashboard-created instances as a registry map so
// main can merge them over the env-derived one.
func StoredInstances(dataDir string) map[string]InstanceBridge {
	out := map[string]InstanceBridge{}
	for _, si := range readInstanceStore(dataDir).Instances {
		id := strings.TrimSpace(si.ID)
		if id == "" || si.URL == "" {
			continue
		}
		out[id] = InstanceBridge{URL: si.URL, Token: si.Token, Profile: si.Profile}
	}
	return out
}

// persistInstance upserts one entry in <dataDir>/instances.json.
func (h *Handler) persistInstance(id string, ib InstanceBridge) error {
	if h.dataDir == "" {
		return nil
	}
	st := readInstanceStore(h.dataDir)
	entry := storedInstance{ID: id, Profile: ib.Profile, URL: ib.URL, Token: ib.Token, CreatedAt: time.Now().UTC().Format(time.RFC3339)}
	replaced := false
	for i := range st.Instances {
		if st.Instances[i].ID == id {
			if st.Instances[i].CreatedAt != "" {
				entry.CreatedAt = st.Instances[i].CreatedAt
			}
			st.Instances[i] = entry
			replaced = true
			break
		}
	}
	if !replaced {
		st.Instances = append(st.Instances, entry)
	}
	return h.writeDataJSON(instanceStoreFile, st)
}
