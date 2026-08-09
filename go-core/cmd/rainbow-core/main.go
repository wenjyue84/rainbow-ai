// Command rainbow-core is the Go business core. It receives inbound WhatsApp
// messages from the dumb Node Baileys bridge (POST /inbound), runs the message
// pipeline (classify → route → reply), and asks the bridge to send replies.
package main

import (
	"context"
	"encoding/json"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"rainbow-core/internal/admin"
	"rainbow-core/internal/ai"
	"rainbow-core/internal/bridge"
	"rainbow-core/internal/classify"
	"rainbow-core/internal/config"
	"rainbow-core/internal/contract"
	"rainbow-core/internal/conversation"
	"rainbow-core/internal/digiman"
	"rainbow-core/internal/rag"
	"rainbow-core/internal/router"
	"rainbow-core/internal/scheduler"
	"rainbow-core/internal/semantic"
	"rainbow-core/internal/store"
	"rainbow-core/internal/transcribe"
	"rainbow-core/internal/workflow"

	"os/signal"
	"syscall"
)

func env(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

// kbDirFor maps a profile id to its knowledge-base directory under kbRoot.
func kbDirFor(kbRoot, profile string) string {
	sub := map[string]string{
		"pelangi":  ".rainbow-kb",
		"southern": ".rainbow-kb-southern",
		"makan":    ".rainbow-kb-makan",
	}[profile]
	if sub == "" {
		return ""
	}
	return filepath.Join(kbRoot, sub)
}

// parseInstanceMap parses "instanceId=profile,instanceId2=profile2" into a map.
func parseInstanceMap(s string) map[string]string {
	m := map[string]string{}
	for _, pair := range strings.Split(s, ",") {
		pair = strings.TrimSpace(pair)
		if pair == "" {
			continue
		}
		if kv := strings.SplitN(pair, "=", 2); len(kv) == 2 {
			m[strings.TrimSpace(kv[0])] = strings.TrimSpace(kv[1])
		}
	}
	return m
}

func main() {
	var (
		dataDir    = env("RAINBOW_DATA_DIR", "src/assistant/data")
		dbPath     = env("SQLITE_PATH", "data/rainbow-ai.db")
		profileID  = env("RAINBOW_PROFILE", "pelangi")
		bridgeURL  = env("BRIDGE_URL", "http://127.0.0.1:8788")
		port       = env("CORE_PORT", "8090")
		typing     = env("TYPING_INDICATOR", "true") == "true"
		sidecarURL = env("SIDECAR_URL", "")       // empty = T3 disabled (T1/T2/T4 only)
		instMapEnv = env("PROFILE_INSTANCES", "") // "instanceId=profile,..."
	)

	st, err := store.Open(dbPath)
	if err != nil {
		log.Fatalf("[core] open db %q: %v", dbPath, err)
	}
	defer st.Close()

	conv := conversation.NewManager(st)
	br := bridge.New(bridgeURL)

	// Shared options across profiles.
	baseOpts := router.Options{
		TypingIndicator: typing,
		// Payment-receipt replay-protection ledger lives next to the config data
		// (persists across restarts; pruned to 30 days on load).
		ReceiptLedgerPath: filepath.Join(dataDir, "receipt-ledger.json"),
	}
	if sidecarURL != "" {
		baseOpts.Semantic = semantic.New(sidecarURL)
		log.Printf("[core] T3 semantic enabled via sidecar %s", sidecarURL)
	}
	if reg, err := workflow.Load(dataDir); err != nil {
		log.Printf("[core] workflows not loaded (workflow action → llm/handoff): %v", err)
	} else {
		baseOpts.Workflows = reg
		log.Printf("[core] workflow engine loaded")
	}
	// digiman/PMS client for pelangi_api workflow nodes (implemented actions call
	// the PMS; unimplemented ones escalate to staff) + the daily report.
	var pmsClient *digiman.Client
	if digimanURL := env("DIGIMAN_API_URL", env("PELANGI_API_URL", "")); digimanURL != "" {
		pmsClient = digiman.New(digimanURL, env("DIGIMAN_API_TOKEN", env("PELANGI_API_TOKEN", "")))
		baseOpts.PMS = pmsClient
		log.Printf("[core] digiman PMS client enabled (%s)", digimanURL)
	}
	// PMS2 MCP endpoint (reservation lookup + pending-reservation create from
	// the booking workflow). Works with or without the REST base URL.
	if mcpURL := env("PMS_MCP_URL", ""); mcpURL != "" {
		if pmsClient == nil {
			pmsClient = digiman.New("", "")
			baseOpts.PMS = pmsClient
		}
		pmsClient.SetMCP(mcpURL, env("PMS_MCP_KEY", ""))
		log.Printf("[core] PMS MCP enabled (%s)", mcpURL)
	}
	// Voice-note transcription via Groq Whisper (matches the Node app).
	if groqKey := env("GROQ_API_KEY", ""); groqKey != "" {
		baseOpts.Transcriber = transcribe.New(groqKey, env("WHISPER_MODEL", "whisper-large-v3"))
		log.Printf("[core] voice transcription enabled (Groq Whisper)")
	}

	// Determine the set of profiles to serve: default + any in the instance map.
	instanceProfile := parseInstanceMap(instMapEnv)
	needed := map[string]bool{profileID: true}
	for _, p := range instanceProfile {
		needed[p] = true
	}

	kbRoot := env("RAINBOW_KB_ROOT", ".")
	staffPhone := ""
	var defaultProf *config.Profile
	engines := map[string]*router.Engine{}
	for pid := range needed {
		prof, err := config.Load(dataDir, pid)
		if err != nil {
			log.Fatalf("[core] load profile %q from %q: %v", pid, dataDir, err)
		}
		if pid == profileID {
			defaultProf = prof
			staffPhone = prof.Staff.JayPhone
			if staffPhone == "" && len(prof.Staff.Phones) > 0 {
				staffPhone = prof.Staff.Phones[0]
			}
		}
		opts := baseOpts
		// Per-profile RAG retriever over the profile's KB markdown.
		if kbDir := kbDirFor(kbRoot, pid); kbDir != "" {
			if r, rerr := rag.LoadDir(kbDir); rerr == nil && r.Chunks() > 0 {
				opts.Retriever = r
				log.Printf("[core] RAG loaded for %s: %d chunks from %s", pid, r.Chunks(), kbDir)
			}
		}
		engines[pid] = router.NewEngine(prof, conv, br, opts)
		log.Printf("[core] profile=%s patterns=%d keywords=%d routes=%d static=%d whitelist=%d providers=%d",
			prof.ID, len(prof.Patterns), len(prof.Keywords), len(prof.Routing), len(prof.Static), len(prof.Allowed), len(prof.Providers))
	}
	hub := router.NewHub(engines, instanceProfile, profileID)
	if len(instanceProfile) > 0 {
		log.Printf("[core] instance routing: %v (default=%s)", instanceProfile, profileID)
	}

	mux := http.NewServeMux()

	// Admin API (read endpoints) + dashboard SPA under /api/rainbow/* and /.
	adm := admin.New(st, env("RAINBOW_ADMIN_KEY", ""), env("RAINBOW_PUBLIC_DIR", ""), dataDir)
	adm.SetProfiles(hub.Profiles(), profileID)
	adm.SetBridge(bridgeURL)
	if defaultProf != nil {
		classifyMgr := ai.New(defaultProf)          // T4 classify order (8B first)
		replyMgr := ai.NewReplyManager(defaultProf) // guest reply order (gemini first)
		adm.SetAI(classifyMgr)                      // generate-draft (provider fallback)
		adm.SetActiveModels(func() (map[string]any, map[string]any) {
			return activeModelInfo(classifyMgr), activeModelInfo(replyMgr)
		})
	}
	adm.SetSender(br) // staff WhatsApp sends from the live-chat tab
	adm.SetClassify(func(ctx context.Context, text string) classify.Result {
		return hub.Engine(profileID).ClassifyText(ctx, text)
	})
	adm.Register(mux)

	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, 200, map[string]any{
			"status":   "ok",
			"service":  "rainbow-core",
			"profiles": hub.Profiles(),
			"default":  profileID,
			"bridge":   bridgeURL,
			"time":     time.Now().UTC().Format(time.RFC3339),
		})
	})

	mux.HandleFunc("/inbound", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", 405)
			return
		}
		var msg contract.IncomingMessage
		if err := json.NewDecoder(r.Body).Decode(&msg); err != nil {
			writeJSON(w, 400, map[string]any{"ok": false, "error": "bad json: " + err.Error()})
			return
		}
		// Process with a bounded timeout; return the result for observability.
		ctx, cancel := context.WithTimeout(r.Context(), 90*time.Second)
		defer cancel()
		started := time.Now()
		res, err := hub.Process(ctx, msg)
		if err != nil {
			log.Printf("[inbound] from=%s type=%s len=%d ERROR after %s: %v",
				maskPhone(msg.From), msg.MessageType, len(msg.Text), time.Since(started).Round(time.Millisecond), err)
			writeJSON(w, 500, map[string]any{"ok": false, "error": err.Error()})
			return
		}
		// Every inbound message leaves exactly one line, including the ones we
		// deliberately skip. Without this, a guest reporting "the bot never
		// replied" is undiagnosable — there is no record the message existed.
		// Message bodies are never logged (PDPA); only length and the decision.
		log.Printf("[inbound] from=%s type=%s len=%d skipped=%v reason=%q intent=%s conf=%.2f src=%s action=%s lang=%s replied=%v escalated=%v took=%s",
			maskPhone(msg.From), msg.MessageType, len(msg.Text),
			res.Skipped, res.SkipReason, res.Intent, res.Confidence, res.Source,
			res.Action, res.Language, res.Reply != "", res.Escalated,
			time.Since(started).Round(time.Millisecond))
		writeJSON(w, 200, map[string]any{
			"ok":         true,
			"skipped":    res.Skipped,
			"skipReason": res.SkipReason,
			"intent":     res.Intent,
			"confidence": res.Confidence,
			"source":     res.Source,
			"action":     res.Action,
			"language":   res.Language,
		})
	})

	// Background schedulers (Go goroutines replacing Node setInterval/node-cron).
	sched := scheduler.New()
	sched.DailyAt("data-retention", 3, 0, func(ctx context.Context) {
		rep, err := scheduler.RunRetention(st, scheduler.DefaultRetention(), time.Now())
		if err != nil {
			log.Printf("[scheduler] retention failed: %v", err)
			return
		}
		log.Printf("[scheduler] retention: msgs soft=%d hard=%d, convos soft=%d hard=%d",
			rep.MessagesSoftDeleted, rep.MessagesHardDeleted, rep.ConversationsSoftDeleted, rep.ConversationsHardDeleted)
	})
	// Daily PMS status report to staff at 11:30 MYT (needs PMS + a staff phone).
	if pmsClient != nil && staffPhone != "" {
		sched.DailyAt("daily-report", 11, 30, func(ctx context.Context) {
			report, err := scheduler.BuildDailyReport(ctx, pmsClient, time.Now())
			if err != nil {
				log.Printf("[scheduler] daily report failed: %v", err)
				return
			}
			if _, err := br.SendText(ctx, staffPhone, report, ""); err != nil {
				log.Printf("[scheduler] daily report send failed: %v", err)
			}
		})
		log.Printf("[core] schedulers started (data-retention @ 03:00, daily-report @ 11:30)")
	} else {
		log.Printf("[core] schedulers started (data-retention @ 03:00)")
	}

	// widgetAdminURL is the base URL of the rainbow admin dashboard, used to build
	// the "Reply here" deep-link in new-widget-session WhatsApp notifications.
	widgetAdminURL := env("RAINBOW_ADMIN_URL", "https://rainbow.wenjyue.com")

	// Public webchat channel: synchronous request/response over HTTP, reusing the
	// full pipeline (classification, RAG, workflows) but returning the reply
	// instead of sending via the bridge.
	mux.HandleFunc("/chat", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", 405)
			return
		}
		var in struct {
			Message   string `json:"message"`
			SessionID string `json:"sessionId"`
			Profile   string `json:"profile"`
			// Image is an optional data URL ("data:image/jpeg;base64,...") for
			// payment-receipt OCR. jpeg/png only, ≤5MB decoded.
			Image string `json:"image"`
			// Test marks synthetic traffic (E2E harness, drills). When true, the
			// operator WhatsApp notify is suppressed so test loops don't flood
			// staff and blow the bridge anti-ban cold cap. Real guests never set it.
			Test bool `json:"test"`
		}
		// 8 MB body cap: 5MB image → ~6.7MB base64 + JSON overhead.
		if err := json.NewDecoder(io.LimitReader(r.Body, 8<<20)).Decode(&in); err != nil || (in.Message == "" && in.Image == "") {
			writeJSON(w, 400, map[string]any{"ok": false, "error": "message or image required"})
			return
		}
		if in.Image != "" {
			if !strings.HasPrefix(in.Image, "data:image/jpeg;base64,") && !strings.HasPrefix(in.Image, "data:image/png;base64,") {
				writeJSON(w, 400, map[string]any{"ok": false, "error": "image must be a jpeg/png base64 data URL"})
				return
			}
			if len(in.Image) > (5<<20)*4/3+64 {
				writeJSON(w, 400, map[string]any{"ok": false, "error": "image too large (max 5MB)"})
				return
			}
		}
		from := in.SessionID
		if from == "" {
			from = "webchat"
		}
		ctx, cancel := context.WithTimeout(r.Context(), 90*time.Second)
		defer cancel()

		// Detect new widget sessions: count existing messages for this phone
		// BEFORE processing so we can notify the operator on the very first message.
		// Uses both phone spellings (Go era "web:<sid>" and Node era "webchat-<sid>").
		phone := "web:" + from
		var existingMsgCount int
		st.DB.QueryRow(`SELECT COUNT(*) FROM rainbow_messages WHERE phone IN (?, ?)`,
			"web:"+from, "webchat-"+from).Scan(&existingMsgCount)
		isNewSession := existingMsgCount == 0

		msg := contract.IncomingMessage{
			From: phone, Text: in.Message, PushName: "Web Guest",
			// Empty MessageID → no dedup (synchronous channel; repeats are allowed).
			MessageType: contract.MsgText, InstanceID: "webchat",
		}
		if in.Image != "" {
			msg.MessageType = contract.MsgImage
			msg.MediaURL = in.Image
		}
		replies, res, err := hub.ProcessCapture(ctx, in.Profile, msg)
		if err != nil {
			writeJSON(w, 500, map[string]any{"ok": false, "error": err.Error()})
			return
		}

		// Notify the operator on the first message of a new widget session.
		// Best-effort: never block or fail the guest reply over a notify error.
		// Suppressed for synthetic traffic (test flag or E2E/shadow session ids):
		// otherwise a test loop firing N sessions = N real WhatsApp pings to staff,
		// which also blows the bridge cold-send anti-ban cap.
		if isNewSession && staffPhone != "" && in.Message != "" && !in.Test && !isSyntheticSession(from) {
			preview := in.Message
			if len(preview) > 200 {
				preview = preview[:200] + "…"
			}
			adminLink := widgetAdminURL + "/widget-chats?session=" + from
			alert := "🔔 *Pelangi Website Chat*\n" +
				"Guest: " + preview + "\n" +
				"Session: " + from + "\n\n" +
				"Reply here: " + adminLink
			notifyCtx, notifyCancel := context.WithTimeout(context.Background(), 10*time.Second)
			defer notifyCancel()
			if _, nerr := br.SendText(notifyCtx, staffPhone, alert, ""); nerr != nil {
				log.Printf("[chat] widget-notify to %s failed: %v", staffPhone, nerr)
			}
		}

		reply := ""
		if len(replies) > 0 {
			reply = strings.Join(replies, "\n\n")
		}
		writeJSON(w, 200, map[string]any{
			"ok": true, "reply": reply, "intent": res.Intent, "action": res.Action, "language": res.Language,
			"source": res.Source, "confidence": res.Confidence,
		})
	})

	srv := &http.Server{
		Addr:              ":" + port,
		Handler:           mux,
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      60 * time.Second,
		IdleTimeout:       120 * time.Second,
	}

	// Graceful shutdown on SIGINT/SIGTERM.
	go func() {
		sigCh := make(chan os.Signal, 1)
		signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
		<-sigCh
		log.Printf("[core] shutting down…")
		sched.Stop()
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		srv.Shutdown(ctx)
	}()

	log.Printf("[core] listening on :%s (bridge=%s, db=%s)", port, bridgeURL, dbPath)
	if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatalf("[core] server: %v", err)
	}
	log.Printf("[core] stopped")
}

// activeModelInfo summarizes the provider a Manager would actually use (first
// with an API key / local), for the dashboard's classify-vs-reply model display.
func activeModelInfo(m *ai.Manager) map[string]any {
	p, available := m.Active()
	return map[string]any{
		"id": p.ID, "name": p.Name, "model": p.Model, "available": available,
	}
}

// maskPhone renders a phone/JID for logs as country code + last 4 digits
// (6588329020@s.whatsapp.net -> 65***9020). Enough to correlate a guest
// complaint with a log line without writing full numbers to disk.
func maskPhone(s string) string {
	if s == "" {
		return "unknown"
	}
	var digits []rune
	for _, r := range s {
		if r == '@' {
			break
		}
		if r >= '0' && r <= '9' {
			digits = append(digits, r)
		}
	}
	if len(digits) < 6 {
		if len(digits) == 0 {
			return "unknown"
		}
		return string(digits)
	}
	return string(digits[:2]) + "***" + string(digits[len(digits)-4:])
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

// isSyntheticSession reports whether a webchat sessionId belongs to automated
// test traffic (E2E harness, resilience probes, shadow runs) rather than a real
// guest. Used to suppress operator notifications for synthetic sessions even
// when the caller forgets to set the `test` flag. Real widget ids look like
// "web_<rand>_<ts>" (underscore) and are NOT matched here.
func isSyntheticSession(from string) bool {
	s := strings.ToLower(from)
	for _, p := range []string{"e2e-", "test-", "shadow", "webchat-test", "e2e_", "journey-"} {
		if strings.HasPrefix(s, p) {
			return true
		}
	}
	return false
}
