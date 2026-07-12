// Command rainbow-core is the Go business core. It receives inbound WhatsApp
// messages from the dumb Node Baileys bridge (POST /inbound), runs the message
// pipeline (classify → route → reply), and asks the bridge to send replies.
package main

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"rainbow-core/internal/admin"
	"rainbow-core/internal/bridge"
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
	baseOpts := router.Options{TypingIndicator: typing}
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
	engines := map[string]*router.Engine{}
	for pid := range needed {
		prof, err := config.Load(dataDir, pid)
		if err != nil {
			log.Fatalf("[core] load profile %q from %q: %v", pid, dataDir, err)
		}
		if pid == profileID {
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
		res, err := hub.Process(ctx, msg)
		if err != nil {
			log.Printf("[core] process %s: %v", msg.From, err)
			writeJSON(w, 500, map[string]any{"ok": false, "error": err.Error()})
			return
		}
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
		}
		if err := json.NewDecoder(r.Body).Decode(&in); err != nil || in.Message == "" {
			writeJSON(w, 400, map[string]any{"ok": false, "error": "message required"})
			return
		}
		from := in.SessionID
		if from == "" {
			from = "webchat"
		}
		ctx, cancel := context.WithTimeout(r.Context(), 90*time.Second)
		defer cancel()
		msg := contract.IncomingMessage{
			From: "web:" + from, Text: in.Message, PushName: "Web Guest",
			// Empty MessageID → no dedup (synchronous channel; repeats are allowed).
			MessageType: contract.MsgText, InstanceID: "webchat",
		}
		replies, res, err := hub.ProcessCapture(ctx, in.Profile, msg)
		if err != nil {
			writeJSON(w, 500, map[string]any{"ok": false, "error": err.Error()})
			return
		}
		reply := ""
		if len(replies) > 0 {
			reply = strings.Join(replies, "\n\n")
		}
		writeJSON(w, 200, map[string]any{
			"ok": true, "reply": reply, "intent": res.Intent, "action": res.Action, "language": res.Language,
		})
	})

	srv := &http.Server{
		Addr:              ":" + port,
		Handler:           mux,
		ReadHeaderTimeout: 10 * time.Second,
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

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
