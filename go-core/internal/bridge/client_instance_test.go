package bridge

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"rainbow-core/internal/contract"
)

// Sends for a mapped instance must hit that instance's bridge, not the default.
func TestSendRoutesByInstance(t *testing.T) {
	hits := map[string]string{}
	mk := func(name string) *httptest.Server {
		return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			var req contract.SendRequest
			_ = json.NewDecoder(r.Body).Decode(&req)
			hits[name] = req.InstanceID
			w.Write([]byte(`{"ok":true}`))
		}))
	}
	def, jayson := mk("default"), mk("jayson")
	defer def.Close()
	defer jayson.Close()

	c := New(def.URL)
	c.SetInstanceURL("jayson", jayson.URL+"/")
	if _, err := c.SendText(context.Background(), "60123", "hi", "jayson"); err != nil {
		t.Fatal(err)
	}
	if _, err := c.SendText(context.Background(), "60123", "hi", "pelangi"); err != nil {
		t.Fatal(err)
	}
	if hits["jayson"] != "jayson" || hits["default"] != "pelangi" {
		t.Fatalf("misrouted: %v", hits)
	}
	if c.URLFor("unknown") != def.URL {
		t.Fatalf("unmapped instance should use default, got %s", c.URLFor("unknown"))
	}
}
