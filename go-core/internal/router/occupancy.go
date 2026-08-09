package router

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
	"sync"
	"time"
)

const (
	occThreshold   = 90.0
	occCooldown    = 6 * time.Hour
	occGroupJID    = "120363424593650200@g.us"
	occPMSBase     = "http://127.0.0.1:5002"
	occPMSEmail    = "claude-code@pelangicapsulehostel.com"
	occPMSPassword = "REDACTED_PMS_SERVICE_PASSWORD"
)

var (
	occMu        sync.Mutex
	occLastAlert time.Time
)

type occData struct {
	Total         int     `json:"total"`
	Occupied      int     `json:"occupied"`
	Available     int     `json:"available"`
	OccupancyRate float64 `json:"occupancyRate"`
}

func fetchOccupancy() (*occData, error) {
	// CSRF
	csrfRes, err := http.Get(occPMSBase + "/api/csrf-token")
	if err != nil {
		return nil, fmt.Errorf("csrf: %w", err)
	}
	defer csrfRes.Body.Close()
	var csrfBody struct {
		CsrfToken string `json:"csrfToken"`
	}
	if err = json.NewDecoder(csrfRes.Body).Decode(&csrfBody); err != nil {
		return nil, fmt.Errorf("csrf parse: %w", err)
	}

	// Login
	loginPayload := strings.NewReader(`{"email":"` + occPMSEmail + `","password":"` + occPMSPassword + `"}`)
	req, _ := http.NewRequestWithContext(context.Background(), http.MethodPost, occPMSBase+"/api/auth/login", loginPayload)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-CSRF-Token", csrfBody.CsrfToken)
	loginRes, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("login: %w", err)
	}
	defer loginRes.Body.Close()
	var loginBody struct {
		Token string `json:"token"`
		Data  struct {
			Token string `json:"token"`
		} `json:"data"`
	}
	_ = json.NewDecoder(loginRes.Body).Decode(&loginBody)
	token := loginBody.Token
	if token == "" {
		token = loginBody.Data.Token
	}
	if token == "" {
		return nil, fmt.Errorf("PMS login: no token returned")
	}

	// Occupancy
	occReq, _ := http.NewRequestWithContext(context.Background(), http.MethodGet, occPMSBase+"/api/occupancy", nil)
	occReq.Header.Set("Authorization", "Bearer "+token)
	occRes, err := http.DefaultClient.Do(occReq)
	if err != nil {
		return nil, fmt.Errorf("occupancy GET: %w", err)
	}
	defer occRes.Body.Close()
	raw, _ := io.ReadAll(occRes.Body)
	var occ occData
	if err = json.Unmarshal(raw, &occ); err != nil {
		return nil, fmt.Errorf("occupancy parse: %w", err)
	}
	if occ.OccupancyRate == 0 && occ.Total > 0 {
		occ.OccupancyRate = float64(occ.Occupied) / float64(occ.Total) * 100
	}
	return &occ, nil
}

// checkOccupancyAlert is called (as a goroutine) after checkin_full completes.
// Sends a group alert if occupancy >= 90% and the 6h cooldown has expired.
func (e *Engine) checkOccupancyAlert(instanceID string) {
	occMu.Lock()
	if time.Since(occLastAlert) < occCooldown {
		occMu.Unlock()
		log.Printf("[occupancy] cooldown active — skip")
		return
	}
	occMu.Unlock()

	occ, err := fetchOccupancy()
	if err != nil {
		log.Printf("[occupancy] fetch error: %v", err)
		return
	}
	rate := occ.OccupancyRate
	log.Printf("[occupancy] post-checkin: %d/%d = %.0f%% (threshold %.0f%%)", occ.Occupied, occ.Total, rate, occThreshold)

	if rate < occThreshold {
		return
	}

	msg := fmt.Sprintf(
		"🏨 *Pelangi Occupancy Alert*\n\nCurrent occupancy: *%.0f%%* (%d/%d capsules)\nAvailable: %d capsule(s)\n\nReached %.0f%% threshold — consider adjusting pricing or preparing for full house.",
		rate, occ.Occupied, occ.Total, occ.Available, occThreshold,
	)
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	if _, err := e.send.SendText(ctx, occGroupJID, msg, instanceID); err != nil {
		log.Printf("[occupancy] send error: %v", err)
		return
	}

	occMu.Lock()
	occLastAlert = time.Now()
	occMu.Unlock()
	log.Printf("[occupancy] alert sent to group (%.0f%%)", rate)
}
