package config

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// writeBlank writes the minimal file set config.Load needs for profile id.
func writeBlank(t *testing.T, dir, id string) {
	t.Helper()
	files := map[string]string{
		"intents-" + id + ".json":         `{"categories":[]}`,
		"intent-keywords-" + id + ".json": `{"intents":[]}`,
		"knowledge-" + id + ".json":       `{}`,
		"routing-" + id + ".json":         `{}`,
	}
	for n, c := range files {
		if err := os.WriteFile(filepath.Join(dir, n), []byte(c), 0o644); err != nil {
			t.Fatal(err)
		}
	}
}

func TestLoadInheritsMaster(t *testing.T) {
	dir := t.TempDir()
	writeBlank(t, dir, "blank")
	writeBlank(t, dir, "explicit")
	os.WriteFile(filepath.Join(dir, "settings-blank.json"), []byte(`{"bot_name":"Rachel"}`), 0o644)
	os.WriteFile(filepath.Join(dir, "settings-explicit.json"), []byte(`{"reply_mode":"normal","ai":{"providers":[{"id":"own","enabled":true,"priority":1}]}}`), 0o644)
	os.WriteFile(filepath.Join(dir, MasterFile), []byte(`{"reply_mode":"intro-once","intro_message":"Hi, I'm {bot_name}.","ai":{"providers":[{"id":"m1","enabled":true,"priority":2},{"id":"m2","enabled":false}]}}`), 0o644)

	p, err := Load(dir, "blank")
	if err != nil {
		t.Fatal(err)
	}
	if p.ReplyMode != "intro-once" || p.IntroMessage != "Hi, I'm Rachel." {
		t.Fatalf("blank should inherit reply mode: %q %q", p.ReplyMode, p.IntroMessage)
	}
	if len(p.Providers) != 1 || p.Providers[0].ID != "m1" || len(p.ProviderByID) != 2 {
		t.Fatalf("blank should inherit providers: %+v", p.Providers)
	}
	if !p.Inherited["providers"] || !p.Inherited["reply_mode"] {
		t.Fatalf("inherited flags: %v", p.Inherited)
	}

	e, err := Load(dir, "explicit")
	if err != nil {
		t.Fatal(err)
	}
	if e.ReplyMode != "normal" || len(e.Providers) != 1 || e.Providers[0].ID != "own" || len(e.Inherited) != 0 {
		t.Fatalf("explicit values must win: mode=%q providers=%+v inherited=%v", e.ReplyMode, e.Providers, e.Inherited)
	}

	// No master file → nothing inherited, blank stays blank.
	os.Remove(filepath.Join(dir, MasterFile))
	n, _ := Load(dir, "blank")
	if n.ReplyMode != "" || len(n.Providers) != 0 || len(n.Inherited) != 0 {
		t.Fatalf("without master: %q %+v %v", n.ReplyMode, n.Providers, n.Inherited)
	}
}

func TestUnnamedBotUsesBusinessIntro(t *testing.T) {
	dir := t.TempDir()
	writeBlank(t, dir, "dental-world")
	writeBlank(t, dir, "kb-aircond")
	writeBlank(t, dir, "yoongmei")
	os.WriteFile(filepath.Join(dir, "settings-dental-world.json"), []byte(`{}`), 0o644)
	os.WriteFile(filepath.Join(dir, "settings-kb-aircond.json"), []byte(`{"bot_name":"  "}`), 0o644)
	os.WriteFile(filepath.Join(dir, "settings-yoongmei.json"), []byte(`{"bot_name":"Mei"}`), 0o644)
	os.WriteFile(filepath.Join(dir, "profiles.json"), []byte(`{"profiles":[{"id":"dental-world","name":"Dental World"}]}`), 0o644)
	os.WriteFile(filepath.Join(dir, MasterFile), []byte(`{"reply_mode":"intro-once","intro_message":"Hi, I'm {bot_name} from {business}."}`), 0o644)
	t.Setenv("BUSINESS_DISPLAY_NAME_KB_AIRCOND", "KB Aircond Services")

	// No bot_name + profiles.json name → default unnamed template with business.
	p, err := Load(dir, "dental-world")
	if err != nil {
		t.Fatal(err)
	}
	if p.HasBotName || p.BusinessName != "Dental World" {
		t.Fatalf("dental-world: hasBot=%v business=%q", p.HasBotName, p.BusinessName)
	}
	if want := "Hi, I'm the AI assistant of Dental World. A team member will reply to you shortly."; p.IntroMessage != want {
		t.Fatalf("unnamed intro: %q", p.IntroMessage)
	}
	// Blank bot_name + env display name.
	k, _ := Load(dir, "kb-aircond")
	if k.HasBotName || k.BusinessName != "KB Aircond Services" || !strings.Contains(k.IntroMessage, "AI assistant of KB Aircond Services") {
		t.Fatalf("kb-aircond: %v %q %q", k.HasBotName, k.BusinessName, k.IntroMessage)
	}
	// Named bot → intro_message with both placeholders; Title(id) fallback.
	y, _ := Load(dir, "yoongmei")
	if !y.HasBotName || y.IntroMessage != "Hi, I'm Mei from Yoongmei." {
		t.Fatalf("named intro: %v %q", y.HasBotName, y.IntroMessage)
	}
	// Custom unnamed template from master wins over the default.
	os.WriteFile(filepath.Join(dir, MasterFile), []byte(`{"reply_mode":"intro-once","intro_message":"x","intro_message_unnamed":"{business} bot here."}`), 0o644)
	c, _ := Load(dir, "dental-world")
	if c.IntroMessage != "Dental World bot here." {
		t.Fatalf("custom unnamed: %q", c.IntroMessage)
	}
}
