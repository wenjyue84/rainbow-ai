// Guest webchat page: GET /chat/{profileId} serves a self-contained chat UI
// that talks to the existing POST /chat pipeline (classify graph → route →
// reply). GET /chat/{profileId}/poll returns staff replies so a human takeover
// from the dashboard's live-chat tab reaches the guest.
package admin

import (
	"encoding/json"
	"html"
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

// knownProfile reports whether id is one of the hub-served profiles.
func (h *Handler) knownProfile(id string) bool {
	for _, p := range h.profileIDs {
		if p == id {
			return true
		}
	}
	return false
}

// profileDataFile resolves name.ext for a profile: the -<profile> variant if it
// exists, else the global file for the DEFAULT profile only (a non-default
// profile never reads the default's data — same isolation rule as serveJSONFile).
func (h *Handler) profileDataFile(profile, name string) []byte {
	if h.dataDir == "" {
		return nil
	}
	def := h.defaultProfile
	if def == "" {
		def = "pelangi"
	}
	if profile != def {
		b, err := os.ReadFile(filepath.Join(h.dataDir, profileVariant(name, profile)))
		if err != nil {
			return nil
		}
		return b
	}
	b, err := os.ReadFile(filepath.Join(h.dataDir, name))
	if err != nil {
		return nil
	}
	return b
}

// chatPageMeta extracts display name + greeting for the chat page.
func (h *Handler) chatPageMeta(profile string) (displayName, botName string, greeting map[string]string) {
	displayName = titleProfile(profile)
	suffix := strings.ToUpper(strings.ReplaceAll(profile, "-", "_"))
	if v := os.Getenv("BUSINESS_DISPLAY_NAME_" + suffix); v != "" {
		displayName = v
	}
	botName = "Assistant"
	if b := h.profileDataFile(profile, "settings.json"); b != nil {
		var s struct {
			StaffName string `json:"staffName"`
		}
		if json.Unmarshal(b, &s) == nil && s.StaffName != "" {
			botName = s.StaffName
		}
	}
	greeting = map[string]string{}
	if b := h.profileDataFile(profile, "knowledge.json"); b != nil {
		var k struct {
			Static []struct {
				Intent   string            `json:"intent"`
				Response map[string]string `json:"response"`
			} `json:"static"`
		}
		if json.Unmarshal(b, &k) == nil {
			for _, s := range k.Static {
				if s.Intent == "greeting" {
					greeting = s.Response
					break
				}
			}
		}
	}
	return
}

// chatPage multiplexes /chat/{profileId} (page) and /chat/{profileId}/poll.
func (h *Handler) chatPage(w http.ResponseWriter, r *http.Request) {
	rest := strings.TrimPrefix(r.URL.Path, "/chat/")
	parts := strings.SplitN(strings.Trim(rest, "/"), "/", 2)
	profile := strings.ToLower(strings.TrimSpace(parts[0]))
	if profile == "" || !profileIDRe.MatchString(profile) || !h.knownProfile(profile) {
		http.NotFound(w, r)
		return
	}
	if len(parts) == 2 && parts[1] == "poll" {
		h.chatPoll(w, r)
		return
	}
	if len(parts) != 1 || r.Method != http.MethodGet {
		http.NotFound(w, r)
		return
	}

	displayName, botName, greeting := h.chatPageMeta(profile)
	cfg, _ := json.Marshal(map[string]any{
		"profile":  profile,
		"name":     displayName,
		"botName":  botName,
		"greeting": greeting,
	})

	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-cache")
	page := strings.Replace(chatPageHTML, "__CFG__", string(cfg), 1)
	page = strings.Replace(page, "__TITLE__", html.EscapeString(displayName), 1)
	w.Write([]byte(page))
}

// chatPoll serves GET /chat/{profile}/poll?session=<sid>&after=<ISO ts>:
// staff messages for the session newer than `after`. Public (the session id is
// the credential), so it returns ONLY staff rows — never other sessions.
func (h *Handler) chatPoll(w http.ResponseWriter, r *http.Request) {
	sid := strings.TrimSpace(r.URL.Query().Get("session"))
	if sid == "" || len(sid) > 128 {
		writeJSON(w, 400, map[string]any{"error": "session required"})
		return
	}
	after := r.URL.Query().Get("after")
	if after == "" {
		after = "1970-01-01T00:00:00.000Z"
	}
	staffCol := "'Staff'"
	if h.hasStaffNameCol() {
		staffCol = "COALESCE(staff_name, 'Staff')"
	}
	rows, err := h.st.DB.Query(
		`SELECT content, CAST(timestamp AS TEXT), `+staffCol+`
		 FROM rainbow_messages
		 WHERE phone IN (?, ?) AND role='staff' AND CAST(timestamp AS TEXT) > ?
		 ORDER BY CAST(timestamp AS TEXT) ASC LIMIT 50`,
		"web:"+sid, "webchat-"+sid, after)
	if err != nil {
		writeJSON(w, 500, map[string]any{"error": err.Error()})
		return
	}
	defer rows.Close()
	msgs := []map[string]any{}
	for rows.Next() {
		var content, ts, staff string
		if rows.Scan(&content, &ts, &staff) == nil {
			msgs = append(msgs, map[string]any{"content": content, "timestamp": ts, "staffName": staff})
		}
	}
	writeJSON(w, 200, map[string]any{"ok": true, "messages": msgs})
}

// chatPageHTML is the self-contained guest chat UI. __CFG__ and __TITLE__ are
// replaced at serve time.
const chatPageHTML = `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>__TITLE__ — Chat</title>
<style>
:root{--bg:#f1f5f9;--card:#fff;--brand:#0ea5e9;--brand2:#0284c7;--ink:#0f172a;--mut:#64748b}
*{box-sizing:border-box}body{margin:0;font-family:system-ui,-apple-system,sans-serif;background:var(--bg);display:flex;justify-content:center;min-height:100vh}
.app{width:100%;max-width:560px;display:flex;flex-direction:column;height:100vh;background:var(--card);box-shadow:0 0 40px rgba(2,132,199,.08)}
header{background:linear-gradient(135deg,var(--brand),var(--brand2));color:#fff;padding:14px 18px;display:flex;align-items:center;gap:10px}
header .dot{width:10px;height:10px;border-radius:50%;background:#4ade80}
header h1{font-size:16px;margin:0}header p{font-size:12px;margin:0;opacity:.85}
#log{flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:10px}
.msg{max-width:82%;padding:10px 14px;border-radius:16px;font-size:14px;line-height:1.45;white-space:pre-wrap;word-wrap:break-word}
.bot{background:#e2e8f0;color:var(--ink);border-bottom-left-radius:4px;align-self:flex-start}
.staff{background:#fef3c7;color:#78350f;border-bottom-left-radius:4px;align-self:flex-start}
.me{background:var(--brand);color:#fff;border-bottom-right-radius:4px;align-self:flex-end}
.tag{font-size:11px;color:var(--mut);margin:-4px 0 0 6px;align-self:flex-start}
.typing{font-size:12px;color:var(--mut);padding:0 6px}
footer{display:flex;gap:8px;padding:12px;border-top:1px solid #e2e8f0}
input{flex:1;padding:11px 14px;border-radius:22px;border:1px solid #cbd5e1;font-size:14px;outline:none}
input:focus{border-color:var(--brand)}
button{border:0;background:var(--brand);color:#fff;border-radius:50%;width:42px;height:42px;font-size:17px;cursor:pointer}
button:disabled{opacity:.5}
</style></head><body>
<div class="app">
<header><div class="dot"></div><div><h1 id="hname"></h1><p>AI assistant — replies in seconds</p></div></header>
<div id="log"></div>
<div class="typing" id="typing" style="display:none">typing…</div>
<footer><input id="in" placeholder="Type your message…" autocomplete="off"><button id="send">➤</button></footer>
</div>
<script>
var CFG=__CFG__;
document.getElementById('hname').textContent=CFG.name;document.title=CFG.name+' — Chat';
var log=document.getElementById('log'),input=document.getElementById('in'),btn=document.getElementById('send');
var key='rw_chat_'+CFG.profile,sid=null;
try{sid=localStorage.getItem(key);}catch(e){}
if(!sid){sid='web_'+Math.random().toString(36).slice(2,10)+'_'+Date.now();try{localStorage.setItem(key,sid);}catch(e){}}
var lastPoll=new Date().toISOString();
function add(cls,text,tag){var d=document.createElement('div');d.className='msg '+cls;d.textContent=text;log.appendChild(d);
if(tag){var t=document.createElement('div');t.className='tag';t.textContent=tag;log.appendChild(t);}
log.scrollTop=log.scrollHeight;}
var greet=CFG.greeting||{};var lang=(navigator.language||'en').slice(0,2);
add('bot',greet[lang]||greet.en||('Hello! Welcome to '+CFG.name+'. How can I help you today?'),CFG.botName);
function setBusy(b){btn.disabled=b;document.getElementById('typing').style.display=b?'block':'none';}
async function send(){var text=input.value.trim();if(!text||btn.disabled)return;
input.value='';add('me',text);setBusy(true);
try{var res=await fetch('/chat',{method:'POST',headers:{'Content-Type':'application/json'},
body:JSON.stringify({message:text,sessionId:sid,profile:CFG.profile})});
var j=await res.json();
if(j.ok&&j.reply){add('bot',j.reply,CFG.botName);}
else{add('bot','Sorry, something went wrong. Please try again in a moment.',CFG.botName);}}
catch(e){add('bot','Connection problem — please check your internet and try again.',CFG.botName);}
setBusy(false);input.focus();}
btn.addEventListener('click',send);
input.addEventListener('keydown',function(e){if(e.key==='Enter')send();});
async function poll(){try{
var res=await fetch('/chat/'+CFG.profile+'/poll?session='+encodeURIComponent(sid)+'&after='+encodeURIComponent(lastPoll));
var j=await res.json();
if(j.ok&&j.messages&&j.messages.length){j.messages.forEach(function(m){add('staff',m.content,m.staffName||'Staff');
if(m.timestamp>lastPoll)lastPoll=m.timestamp;});}}catch(e){}}
setInterval(poll,6000);
input.focus();
</script></body></html>`
