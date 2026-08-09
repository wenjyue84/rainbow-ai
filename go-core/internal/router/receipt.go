// Payment-receipt OCR gate (webchat/WhatsApp image → verify → release capsule)
// and post-check-in maintenance grounding over PMS2 MCP.
//
// Security invariants (Jay, 2026-07-19):
//   - The OCR gate ONLY releases a capsule (unit assignment). It never marks a
//     reservation confirmed — admin confirmation stays human.
//   - A capsule is released ONLY after amount + recipient + date all verify
//     against the guest's own pending reservation.
//   - Every OCR decision is logged (amount read, matched y/n) for audit.
//   - Maintenance answers state only what pelangi_list_problems returns —
//     no fabricated maintenance claims.
package router

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"rainbow-core/internal/contract"
	"rainbow-core/internal/conversation"
	"rainbow-core/internal/digiman"
)

// receiptPMS is the extended PMS surface needed by the receipt/maintenance
// flows. *digiman.Client implements it; the engine feature-detects via type
// assertion so tests can keep using the minimal workflow.PMS mock.
type receiptPMS interface {
	FindReservationByGuest(ctx context.Context, name, phone string) (*digiman.Reservation, error)
	AvailableUnits(ctx context.Context) ([]string, error)
	AssignReservationUnit(ctx context.Context, reservationID, unitNumber, note string) error
	MarkPaymentPending(ctx context.Context, reservationID string) error
	UnitProblems(ctx context.Context, unitNumber string) ([]digiman.Problem, error)
	ActiveProblemUnits(ctx context.Context) (map[string]bool, error)
	RateTotal(ctx context.Context, checkInDate, checkOutDate string) (float64, error)
	MCPConfigured() bool
}

const (
	pelangiAccountNumber = "551128652007"
	wifiNetwork          = "pelangi capsule"
	wifiPassword         = "ilovestaycapsule"
	checkinVideoURL      = "https://www.youtube.com/watch?v=6Ux11oBZaQQ"
	mayaWhatsAppLine     = "Maya (on-site staff): +60 17-670 1102 — https://wa.me/60176701102"
	maxImageBytes        = 5 * 1024 * 1024
)

// receiptOCR is the structured extraction from the vision model.
type receiptOCR struct {
	IsReceipt        bool
	Amount           float64
	Recipient        string
	RecipientAccount string
	Date             string // YYYY-MM-DD as printed on the receipt
	Time             string
	Reference        string
	Payer            string
}

const receiptPrompt = `You are an OCR extractor for Malaysian payment receipts (Touch 'n Go eWallet, DuitNow transfer, bank transfer screenshots).
Look at the image and return ONLY a JSON object with these keys:
{"is_receipt": true|false, "amount": number, "recipient": "recipient/beneficiary name shown", "recipient_account": "recipient account number if shown", "date": "YYYY-MM-DD", "time": "HH:MM", "reference": "transaction/reference number", "payer": "sender name if shown"}
Rules:
- is_receipt is true ONLY if the image is clearly a payment/transfer receipt or confirmation screen.
- amount is the transferred amount in RM as a plain number (e.g. 35.00). Use 0 if unreadable.
- date is the transaction date converted to YYYY-MM-DD. Empty string if unreadable.
- Do not guess: leave fields empty ("" or 0) when not clearly readable.`

// parseReceiptJSON decodes the model output tolerantly (numbers may arrive as
// strings; extra keys ignored).
func parseReceiptJSON(s string) (receiptOCR, error) {
	s = strings.TrimSpace(s)
	// Strip accidental code fences.
	s = strings.TrimPrefix(s, "```json")
	s = strings.TrimPrefix(s, "```")
	s = strings.TrimSuffix(s, "```")
	var m map[string]any
	if err := json.Unmarshal([]byte(strings.TrimSpace(s)), &m); err != nil {
		return receiptOCR{}, err
	}
	str := func(k string) string { v, _ := m[k].(string); return strings.TrimSpace(v) }
	num := func(k string) float64 {
		switch v := m[k].(type) {
		case float64:
			return v
		case string:
			v = strings.TrimSpace(strings.TrimPrefix(strings.ToUpper(v), "RM"))
			f, _ := strconv.ParseFloat(strings.TrimSpace(v), 64)
			return f
		}
		return 0
	}
	isReceipt, _ := m["is_receipt"].(bool)
	return receiptOCR{
		IsReceipt:        isReceipt,
		Amount:           num("amount"),
		Recipient:        str("recipient"),
		RecipientAccount: str("recipient_account"),
		Date:             str("date"),
		Time:             str("time"),
		Reference:        str("reference"),
		Payer:            str("payer"),
	}, nil
}

var mytZone = time.FixedZone("MYT", 8*3600)

// verifyReceipt checks the OCR extraction against the booking-derived expected
// amounts. candidates are legitimate totals (reservation totalAmount, its
// cents-normalized form, rate-engine total) — the receipt must match ONE of
// them exactly. Pure function for testability.
func verifyReceipt(o receiptOCR, candidates []float64, now time.Time) (ok bool, matched float64, reasons []string) {
	if !o.IsReceipt {
		reasons = append(reasons, "image does not look like a payment receipt")
	}
	// Recipient: name contains "pelangi" OR the Maybank account number matches.
	recip := strings.ToLower(o.Recipient + " " + o.RecipientAccount)
	digits := strings.Map(func(r rune) rune {
		if r >= '0' && r <= '9' {
			return r
		}
		return -1
	}, o.RecipientAccount)
	if !strings.Contains(recip, "pelangi") && !strings.Contains(digits, pelangiAccountNumber) {
		reasons = append(reasons, "recipient is not Pelangi Capsule Hostel")
	}
	valid := make([]float64, 0, len(candidates))
	for _, c := range candidates {
		if c > 0 {
			valid = append(valid, c)
		}
	}
	if len(valid) == 0 {
		reasons = append(reasons, "reservation has no amount to verify against")
	} else {
		amountOK := false
		for _, c := range valid {
			if o.Amount >= c-0.005 && o.Amount <= c+0.005 {
				amountOK, matched = true, c
				break
			}
		}
		if !amountOK {
			reasons = append(reasons, fmt.Sprintf("amount RM%.2f does not match booking total (expected RM%.2f)", o.Amount, valid[0]))
		}
	}
	// Date must be today in MYT.
	today := now.In(mytZone).Format("2006-01-02")
	if o.Date == "" {
		reasons = append(reasons, "transaction date unreadable")
	} else if o.Date != today {
		reasons = append(reasons, "transaction date "+o.Date+" is not today ("+today+")")
	}
	return len(reasons) == 0, matched, reasons
}

// loadImage resolves a media URL (data: URL from webchat, or http(s) URL from
// the WhatsApp bridge) into (mimeType, base64Data). jpeg/png only, ≤5MB.
func loadImage(ctx context.Context, mediaURL string) (string, string, error) {
	if strings.HasPrefix(mediaURL, "data:") {
		rest := strings.TrimPrefix(mediaURL, "data:")
		semi := strings.Index(rest, ";base64,")
		if semi < 0 {
			return "", "", fmt.Errorf("unsupported data URL (need base64)")
		}
		mime := rest[:semi]
		b64 := rest[semi+len(";base64,"):]
		if mime != "image/jpeg" && mime != "image/png" {
			return "", "", fmt.Errorf("unsupported image type %q (jpeg/png only)", mime)
		}
		if len(b64) > maxImageBytes*4/3+4 {
			return "", "", fmt.Errorf("image too large (max 5MB)")
		}
		if _, err := base64.StdEncoding.DecodeString(b64); err != nil {
			return "", "", fmt.Errorf("invalid base64 image")
		}
		return mime, b64, nil
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, mediaURL, nil)
	if err != nil {
		return "", "", err
	}
	resp, err := (&http.Client{Timeout: 15 * time.Second}).Do(req)
	if err != nil {
		return "", "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return "", "", fmt.Errorf("media fetch http %d", resp.StatusCode)
	}
	raw, err := io.ReadAll(io.LimitReader(resp.Body, maxImageBytes+1))
	if err != nil {
		return "", "", err
	}
	if len(raw) > maxImageBytes {
		return "", "", fmt.Errorf("image too large (max 5MB)")
	}
	mime := resp.Header.Get("Content-Type")
	if i := strings.Index(mime, ";"); i > 0 {
		mime = mime[:i]
	}
	if mime != "image/jpeg" && mime != "image/png" {
		// sniff
		mime = http.DetectContentType(raw)
	}
	if mime != "image/jpeg" && mime != "image/png" {
		return "", "", fmt.Errorf("unsupported image type %q", mime)
	}
	return mime, base64.StdEncoding.EncodeToString(raw), nil
}

func slotStr(state *conversation.State, key string) string {
	if state.Slots == nil {
		return ""
	}
	s, _ := state.Slots[key].(string)
	return strings.TrimSpace(s)
}

// tryPaymentReceipt handles an inbound image as a possible payment receipt.
// handled=false → caller falls through to the normal pipeline (media ack).
func (e *Engine) tryPaymentReceipt(ctx context.Context, state *conversation.State, msg contract.IncomingMessage) (Result, bool) {
	rpms, okPMS := e.pms.(receiptPMS)
	if !okPMS || !rpms.MCPConfigured() || !e.aiMgr.VisionAvailable() {
		return Result{}, false
	}
	lang := state.Language
	if lang == "" {
		lang = "en"
	}
	mime, b64, err := loadImage(ctx, msg.MediaURL)
	if err != nil {
		log.Printf("[receipt-ocr] %s: image load failed: %v", state.Phone, err)
		return Result{}, false
	}
	res, err := e.aiMgr.VisionJSON(ctx, receiptPrompt, mime, b64, 1024)
	if err != nil {
		log.Printf("[receipt-ocr] %s: vision call failed: %v", state.Phone, err)
		return Result{}, false
	}
	ocr, err := parseReceiptJSON(res.Content)
	if err != nil {
		log.Printf("[receipt-ocr] %s: bad OCR JSON: %v (raw=%q)", state.Phone, err, res.Content)
		return Result{}, false
	}
	if !ocr.IsReceipt {
		log.Printf("[receipt-ocr] %s: image is not a receipt — falling through to media ack", state.Phone)
		return Result{}, false
	}

	// Reservation lookup from session context (booking workflow persists
	// guest_name/guest_phone into Slots on completion) or the WhatsApp phone.
	guestName := slotStr(state, "guest_name")
	guestPhone := slotStr(state, "guest_phone")
	if guestPhone == "" {
		guestPhone = state.Phone
	}
	reservation, lerr := rpms.FindReservationByGuest(ctx, guestName, guestPhone)
	var candidates []float64
	resID, confNo := "", ""
	if reservation != nil {
		resID = reservation.ID
		confNo = reservation.ConfirmationNumber
		if reservation.TotalAmount > 0 {
			candidates = append(candidates, reservation.TotalAmount)
			// Deployed PMS2 create route stores auto-priced totals in CENTS
			// ("4500" for RM45.00, observed 2026-07-19) — accept the
			// normalized form too so real ringgit receipts still verify.
			if reservation.TotalAmount >= 1000 {
				candidates = append(candidates, reservation.TotalAmount/100)
			}
		}
		// Rate-engine total: authoritative when the reservation has no amount,
		// and a legitimate alternative when the stored total is corrupted.
		if reservation.CheckInDate != "" && reservation.CheckOutDate != "" {
			if amt, rerr := rpms.RateTotal(ctx, reservation.CheckInDate, reservation.CheckOutDate); rerr == nil && amt > 0 {
				candidates = append(candidates, amt)
			}
		}
	}

	ok, matchedAmt, reasons := verifyReceipt(ocr, candidates, time.Now())
	if reservation == nil {
		ok = false
		reasons = append(reasons, "no reservation found for this chat session")
	}
	// AUDIT LOG — every OCR decision, matched or not.
	log.Printf("[receipt-ocr] session=%s guest=%q amountRead=%.2f recipient=%q ref=%q date=%s expectedCandidates=%v matchedAmount=%.2f reservation=%s matched=%v reasons=%v lookupErr=%v",
		state.Phone, guestName, ocr.Amount, ocr.Recipient, ocr.Reference, ocr.Date, candidates, matchedAmt, confNo, ok, reasons, lerr)

	_ = e.conv.AddMessageMeta(state.Phone, "user", "[image: payment receipt]", e.prof.ID, &conversation.MsgMeta{Intent: "payment_receipt", MessageType: "image"})

	var reply string
	result := Result{Intent: "payment_receipt", Language: lang}
	if ok {
		// Replay protection: a verified receipt may release a capsule ONCE.
		// Same-reservation re-sends are allowed (retry ≠ abuse); a receipt
		// already used for a DIFFERENT reservation is rejected, and a receipt
		// with no derivable identity (no ref, no amount+date+payer fallback)
		// is routed to Maya instead of released.
		ledgerKey, keyOK := receiptLedgerKey(ocr)
		if !keyOK {
			log.Printf("[receipt-ocr] %s: verified but receipt identity unreadable (no ref / fallback) — NOT releasing, routing to staff", state.Phone)
			ok = false // handled below as a distinct branch, not the generic reject
			reply = receiptNoRefMsg(lang)
			result.Action = "receipt_unverifiable_identity"
			result.Escalated = true
			e.notifyStaff(ctx, state.Phone, msg.PushName,
				fmt.Sprintf("Payment receipt matched booking %s (RM%.2f) but the reference number is unreadable, so I did NOT auto-release a capsule (replay protection). Please verify manually.", confNo, ocr.Amount),
				"payment_receipt_manual", msg.InstanceID)
		} else if prior := e.ledger.Lookup(ledgerKey); prior != nil && prior.ReservationID != resID {
			log.Printf("[receipt-ocr] %s: REPLAY REJECTED key=%s ref=%q previously used for reservation=%s (%s) at %d — this reservation=%s",
				state.Phone, ledgerKey, ocr.Reference, prior.ReservationID, prior.Confirmation, prior.UsedAtMs, resID)
			ok = false
			reply = receiptReusedMsg(lang)
			result.Action = "receipt_reused"
			result.Escalated = true
			e.notifyStaff(ctx, state.Phone, msg.PushName,
				fmt.Sprintf("🚨 Payment receipt REUSED — ref %s (RM%.2f, %s) was already used for reservation %s and is now being presented for reservation %s. Capsule NOT released.",
					ocr.Reference, ocr.Amount, ocr.Date, prior.Confirmation, confNo),
				"payment_receipt_replay", msg.InstanceID)
		} else {
			// Mark the receipt as spent for THIS reservation before releasing —
			// an assign retry for the same reservation stays allowed.
			if lerr := e.ledger.Record(ledgerEntry{
				Key: ledgerKey, Reference: ocr.Reference, Amount: ocr.Amount, Date: ocr.Date,
				Payer: ocr.Payer, ReservationID: resID, Confirmation: confNo, Session: state.Phone,
			}); lerr != nil {
				log.Printf("[receipt-ocr] %s: ledger persist failed (continuing): %v", state.Phone, lerr)
			}
		}
	}
	if ok {
		unit := reservation.UnitNumber
		if unit == "" {
			units, uerr := rpms.AvailableUnits(ctx)
			if uerr != nil || len(units) == 0 {
				log.Printf("[receipt-ocr] %s: verified but no unit available (err=%v)", state.Phone, uerr)
				reply = receiptVerifiedNoUnitMsg(lang)
				result.Action = "receipt_verified_no_unit"
				result.Escalated = true
				e.notifyStaff(ctx, state.Phone, msg.PushName,
					fmt.Sprintf("Payment receipt VERIFIED (RM%.2f, ref %s, %s) for reservation %s but NO free unit to auto-assign — please assign manually.", ocr.Amount, ocr.Reference, confNo, resID),
					"payment_receipt_verified", msg.InstanceID)
			} else {
				// Never auto-assign a capsule with an open maintenance problem.
				blocked, perr := rpms.ActiveProblemUnits(ctx)
				if perr != nil {
					// Availability worked but the problems list didn't — log and
					// fall back to the unfiltered pick (old behavior) rather than
					// blocking every release on a transient MCP error.
					log.Printf("[receipt-ocr] %s: problems lookup failed, picking unfiltered: %v", state.Phone, perr)
					blocked = nil
				}
				unit = pickUnit(units, blocked)
				if unit == "" {
					log.Printf("[receipt-ocr] %s: verified but ALL %d free units have open problems %v — not auto-assigning", state.Phone, len(units), blocked)
					reply = receiptVerifiedNoUnitMsg(lang)
					result.Action = "receipt_verified_units_blocked"
					result.Escalated = true
					e.notifyStaff(ctx, state.Phone, msg.PushName,
						fmt.Sprintf("Payment receipt VERIFIED (RM%.2f, ref %s) for reservation %s but every free unit (%s) has an open maintenance problem — NOT auto-assigned, please pick a unit manually.",
							ocr.Amount, ocr.Reference, confNo, strings.Join(units, ", ")),
						"payment_receipt_verified", msg.InstanceID)
				}
			}
		}
		if unit != "" && result.Action == "" {
			note := fmt.Sprintf("Capsule %s released after AI receipt verification %s: RM%.2f to %s, ref %s, date %s. Reservation still pending admin confirmation.",
				unit, time.Now().In(mytZone).Format("2006-01-02 15:04"), ocr.Amount, ocr.Recipient, ocr.Reference, ocr.Date)
			if aerr := rpms.AssignReservationUnit(ctx, resID, unit, note); aerr != nil {
				log.Printf("[receipt-ocr] %s: unit assign failed: %v", state.Phone, aerr)
				reply = receiptVerifiedNoUnitMsg(lang)
				result.Action = "receipt_verified_assign_failed"
				result.Escalated = true
				e.notifyStaff(ctx, state.Phone, msg.PushName,
					fmt.Sprintf("Payment receipt VERIFIED (RM%.2f, ref %s) for reservation %s but unit assignment failed (%v) — please assign manually.", ocr.Amount, ocr.Reference, confNo, aerr),
					"payment_receipt_verified", msg.InstanceID)
			} else {
				reply = receiptVerifiedMsg(lang, ocr.Amount, unit)
				result.Action = "capsule_released"
				if state.Slots == nil {
					state.Slots = map[string]any{}
				}
				state.Slots["unitNumber"] = unit
				state.Slots["receipt_verified"] = "true"
				// Mark payment pending confirmation in PMS (best-effort).
				if mpErr := rpms.MarkPaymentPending(ctx, resID); mpErr != nil {
					log.Printf("[receipt-ocr] %s: mark payment pending failed: %v", state.Phone, mpErr)
				}
				e.notifyAllPaymentStaff(ctx, state.Phone, msg.PushName,
					fmt.Sprintf("✅ Payment receipt auto-verified: RM%.2f to %q ref %s (%s). Capsule %s released to guest %s (reservation %s).\n\n⏳ Please confirm payment in PMS dashboard.",
						ocr.Amount, ocr.Recipient, ocr.Reference, ocr.Date, unit, guestName, confNo),
					"payment_receipt_verified", msg.InstanceID)
			}
		}
	} else if result.Action == "" { // generic verification failure (replay/identity branches already replied)
		reply = receiptFailedMsg(lang)
		result.Action = "receipt_rejected"
		result.Escalated = true
		e.notifyStaff(ctx, state.Phone, msg.PushName,
			fmt.Sprintf("⚠️ Payment receipt could NOT be auto-verified — capsule NOT released.\nRead: RM%.2f to %q ref %s date %s\nExpected: %v (reservation %s)\nReasons: %s",
				ocr.Amount, ocr.Recipient, ocr.Reference, ocr.Date, candidates, confNo, strings.Join(reasons, "; ")),
			"payment_receipt_failed", msg.InstanceID)
	}

	if reply != "" {
		_, _ = e.send.SendText(ctx, state.Phone, reply, msg.InstanceID)
		_ = e.conv.AddMessageMeta(state.Phone, "assistant", reply, e.prof.ID, &conversation.MsgMeta{Intent: "payment_receipt", RoutedAction: result.Action})
	}
	state.LastIntent = "payment_receipt"
	_ = e.conv.Save(state)
	result.Reply = reply
	return result, true
}

// pickUnit chooses the released capsule deterministically: the first available
// unit that has NO open maintenance problem. blocked is the set of units with
// active/unresolved problems (nil = no filter). Returns "" when every free
// unit is blocked — the caller must then escalate instead of auto-assigning.
func pickUnit(units []string, blocked map[string]bool) string {
	for _, u := range units {
		if !blocked[strings.ToUpper(strings.TrimSpace(u))] && !blocked[u] {
			return u
		}
	}
	return ""
}

func receiptVerifiedMsg(lang string, amount float64, unit string) string {
	base := map[string]string{
		"en": "✅ Payment received — RM%.2f verified. Thank you!\n\nYour capsule: *%s*\n🚪 Door access: Scan the QR board at the hostel entrance for entry instructions.\n📶 WiFi: \"%s\" / password: %s\n🎬 Check-in video guide: %s\n\nOur admin will finalise your booking record shortly. Need help on site? %s",
		"ms": "✅ Pembayaran diterima — RM%.2f disahkan. Terima kasih!\n\nKapsul anda: *%s*\n🚪 Akses pintu: Imbas papan QR di pintu masuk hostel untuk arahan masuk.\n📶 WiFi: \"%s\" / kata laluan: %s\n🎬 Video panduan check-in: %s\n\nAdmin kami akan muktamadkan rekod tempahan anda tidak lama lagi. Perlukan bantuan di lokasi? %s",
		"zh": "✅ 已收到付款 — RM%.2f 核实成功，谢谢！\n\n您的胶囊：*%s*\n🚪 门禁：请扫描入口处的二维码看板以获取进入指引。\n📶 WiFi：\"%s\" / 密码：%s\n🎬 入住指南视频：%s\n\n我们的管理员稍后会为您完成预订记录。现场需要帮助？%s",
	}
	t, okL := base[lang]
	if !okL {
		t = base["en"]
	}
	return fmt.Sprintf(t, amount, unit, wifiNetwork, wifiPassword, checkinVideoURL, mayaWhatsAppLine)
}

func receiptVerifiedNoUnitMsg(lang string) string {
	m := map[string]string{
		"en": "✅ Your payment receipt is verified — thank you! Our staff will assign your capsule and send the details shortly. " + mayaWhatsAppLine,
		"ms": "✅ Resit pembayaran anda telah disahkan — terima kasih! Staf kami akan tetapkan kapsul anda dan hantar butiran sebentar lagi. " + mayaWhatsAppLine,
		"zh": "✅ 您的付款凭证已核实 — 谢谢！我们的员工会尽快为您安排胶囊并发送详情。" + mayaWhatsAppLine,
	}
	if v, okL := m[lang]; okL {
		return v
	}
	return m["en"]
}

func receiptReusedMsg(lang string) string {
	m := map[string]string{
		"en": "This payment receipt has already been used for another booking, so I can't accept it again. If you believe this is a mistake, please contact our on-site staff — " + mayaWhatsAppLine + ". 🙏",
		"ms": "Resit pembayaran ini telah pun digunakan untuk tempahan lain, jadi saya tidak boleh menerimanya semula. Jika anda rasa ini satu kesilapan, sila hubungi staf kami — " + mayaWhatsAppLine + ". 🙏",
		"zh": "这张付款凭证已用于另一个预订，无法再次使用。如果您认为这是误判，请联系现场员工 — " + mayaWhatsAppLine + "。🙏",
	}
	if v, okL := m[lang]; okL {
		return v
	}
	return m["en"]
}

func receiptNoRefMsg(lang string) string {
	m := map[string]string{
		"en": "Thanks for your receipt — the payment details look right, but I couldn't read the transaction reference number clearly, so our staff will verify it manually before releasing your capsule. Please contact " + mayaWhatsAppLine + " and she'll sort you out right away. 🙏",
		"ms": "Terima kasih atas resit anda — butiran pembayaran nampak betul, tetapi saya tidak dapat baca nombor rujukan transaksi dengan jelas, jadi staf kami akan sahkan secara manual sebelum kapsul anda diberikan. Sila hubungi " + mayaWhatsAppLine + ". 🙏",
		"zh": "感谢您发送凭证 — 付款信息看起来正确，但我无法清晰读取交易参考编号，因此需要员工人工核实后才能释放您的胶囊。请联系 " + mayaWhatsAppLine + "，她会立即为您处理。🙏",
	}
	if v, okL := m[lang]; okL {
		return v
	}
	return m["en"]
}

func receiptFailedMsg(lang string) string {
	m := map[string]string{
		"en": "Thanks for sending your receipt, but I couldn't verify the payment automatically (the amount, recipient or date didn't match your booking, or the image was unclear). Please re-send a clearer screenshot of the full receipt, or contact our on-site staff — " + mayaWhatsAppLine + ". Your capsule will be released as soon as payment is verified. 🙏",
		"ms": "Terima kasih atas resit anda, tetapi saya tidak dapat sahkan pembayaran secara automatik (jumlah, penerima atau tarikh tidak sepadan dengan tempahan anda, atau imej kurang jelas). Sila hantar semula tangkapan skrin resit penuh yang lebih jelas, atau hubungi staf kami — " + mayaWhatsAppLine + ". Kapsul anda akan diberikan sebaik sahaja pembayaran disahkan. 🙏",
		"zh": "感谢您发送凭证，但我无法自动核实这笔付款（金额、收款人或日期与您的预订不符，或图片不清晰）。请重新发送更清晰的完整凭证截图，或联系现场员工 — " + mayaWhatsAppLine + "。付款核实后即会为您释放胶囊。🙏",
	}
	if v, okL := m[lang]; okL {
		return v
	}
	return m["en"]
}

// ─── Task C: maintenance grounding ───────────────────────────────────────────

// maintenanceIntents are in-stay problem reports where the guest's unit history
// in the PMS is relevant.
func isMaintenanceIntent(intent string) bool {
	switch intent {
	case "facility_malfunction", "climate_control_complaint", "cleanliness_complaint",
		"general_complaint_in_stay", "noise_complaint", "card_locked":
		return true
	}
	return false
}

// tryMaintenanceReply answers an in-stay problem report grounded in the unit's
// actual PMS maintenance records. handled=false when we don't know the guest's
// unit or the PMS is unreachable (caller falls through to the complaint
// workflow, which escalates to staff — no behavior regression).
func (e *Engine) tryMaintenanceReply(ctx context.Context, state *conversation.State, msg contract.IncomingMessage, intent, lang, text string) (Result, bool) {
	rpms, okPMS := e.pms.(receiptPMS)
	if !okPMS || !rpms.MCPConfigured() {
		return Result{}, false
	}
	unit := slotStr(state, "unitNumber")
	if unit == "" {
		// Try the guest's reservation for an assigned unit.
		name := slotStr(state, "guest_name")
		phone := slotStr(state, "guest_phone")
		if phone == "" {
			phone = state.Phone
		}
		if r, err := rpms.FindReservationByGuest(ctx, name, phone); err == nil && r != nil && r.UnitNumber != "" {
			unit = r.UnitNumber
		}
	}
	if unit == "" {
		return Result{}, false
	}
	problems, err := rpms.UnitProblems(ctx, unit)
	if err != nil {
		log.Printf("[maintenance] %s: problems lookup failed for unit %s: %v", state.Phone, unit, err)
		return Result{}, false
	}
	var reply string
	if len(problems) > 0 {
		reply = maintenanceKnownMsg(lang, unit, problems)
	} else {
		reply = maintenanceUnknownMsg(lang, unit)
	}
	// Always alert staff — a guest reporting a problem needs a human follow-up.
	e.notifyStaff(ctx, state.Phone, msg.PushName,
		fmt.Sprintf("Guest in capsule %s reports: %s (known active problems in PMS: %d)", unit, text, len(problems)),
		intent, msg.InstanceID)
	_, _ = e.send.SendText(ctx, state.Phone, reply, msg.InstanceID)
	_ = e.conv.AddMessageMeta(state.Phone, "assistant", reply, e.prof.ID, &conversation.MsgMeta{Intent: intent, RoutedAction: "maintenance_lookup"})
	state.LastIntent = intent
	_ = e.conv.Save(state)
	log.Printf("[maintenance] %s unit=%s intent=%s knownProblems=%d", state.Phone, unit, intent, len(problems))
	return Result{Intent: intent, Action: "maintenance_lookup", Reply: reply, Escalated: true, Language: lang}, true
}

func maintenanceKnownMsg(lang, unit string, problems []digiman.Problem) string {
	var list strings.Builder
	for i, p := range problems {
		if i >= 3 {
			break
		}
		date := p.ReportedAt
		if len(date) >= 10 {
			date = date[:10]
		}
		list.WriteString(fmt.Sprintf("• %s (reported %s, not yet resolved)\n", p.Description, date))
	}
	m := map[string]string{
		"en": "I'm sorry about the trouble. 😔 I checked our maintenance records for capsule %s and we do have this on file:\n%s\nOur team is aware and I've alerted staff again about your report. For immediate help on site please contact %s",
		"ms": "Maaf atas masalah ini. 😔 Saya semak rekod penyelenggaraan untuk kapsul %s dan memang ada laporan:\n%s\nPasukan kami sedar tentangnya dan saya sudah maklumkan staf semula. Untuk bantuan segera di lokasi sila hubungi %s",
		"zh": "非常抱歉给您带来不便。😔 我查了胶囊 %s 的维修记录，确实有以下报告：\n%s\n我们的团队已知晓，我也再次通知了员工。如需现场即时帮助请联系 %s",
	}
	t, okL := m[lang]
	if !okL {
		t = m["en"]
	}
	return fmt.Sprintf(t, unit, list.String(), mayaWhatsAppLine)
}

func maintenanceUnknownMsg(lang, unit string) string {
	m := map[string]string{
		"en": "I'm sorry about the trouble. 😔 I checked our maintenance records for capsule %s and there's no open issue logged yet, so I've reported this to our staff right away. For immediate help on site please contact %s",
		"ms": "Maaf atas masalah ini. 😔 Saya semak rekod penyelenggaraan untuk kapsul %s dan belum ada isu direkodkan, jadi saya terus laporkan kepada staf kami. Untuk bantuan segera di lokasi sila hubungi %s",
		"zh": "非常抱歉给您带来不便。😔 我查了胶囊 %s 的维修记录，目前没有已登记的问题，我已立即上报给我们的员工。如需现场即时帮助请联系 %s",
	}
	t, okL := m[lang]
	if !okL {
		t = m["en"]
	}
	return fmt.Sprintf(t, unit, mayaWhatsAppLine)
}
