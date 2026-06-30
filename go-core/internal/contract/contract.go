// Package contract defines the wire types shared between the dumb Node Baileys
// bridge and the Go core. Field names mirror the existing Node IncomingMessage
// (src/assistant/types.ts) so the bridge can forward verbatim JSON.
package contract

// MessageType mirrors the Node MessageType union.
type MessageType string

const (
	MsgText     MessageType = "text"
	MsgImage    MessageType = "image"
	MsgAudio    MessageType = "audio"
	MsgVideo    MessageType = "video"
	MsgSticker  MessageType = "sticker"
	MsgDocument MessageType = "document"
	MsgContact  MessageType = "contact"
	MsgLocation MessageType = "location"
)

// MediaMetadata mirrors Node MediaMetadata.
type MediaMetadata struct {
	MimeType string `json:"mimeType"`
	FileSize int64  `json:"fileSize,omitempty"`
	FileName string `json:"fileName,omitempty"`
}

// ReferralData mirrors Node ReferralData (US-910 CTWA attribution).
type ReferralData struct {
	CtwaClid     string `json:"ctwaClid,omitempty"`
	SourceID     string `json:"sourceId,omitempty"`
	SourceType   string `json:"sourceType,omitempty"`
	SourceURL    string `json:"sourceUrl,omitempty"`
	Headline     string `json:"headline,omitempty"`
	Body         string `json:"body,omitempty"`
	MediaType    string `json:"mediaType,omitempty"`
	ThumbnailURL string `json:"thumbnailUrl,omitempty"`
}

// IncomingMessage is the bridge → core inbound payload. Mirrors Node
// IncomingMessage, minus rawMessage (Baileys proto) which the bridge resolves
// into mediaUrl before forwarding — the Go core never touches Baileys.
type IncomingMessage struct {
	From          string         `json:"from"` // phone (no @s.whatsapp.net) or BSUID
	Text          string         `json:"text"`
	PushName      string         `json:"pushName"`
	MessageID     string         `json:"messageId"`
	IsGroup       bool           `json:"isGroup"`
	Timestamp     int64          `json:"timestamp"` // unix seconds
	MessageType   MessageType    `json:"messageType"`
	InstanceID    string         `json:"instanceId,omitempty"`
	Transcribed   bool           `json:"transcribed,omitempty"`
	Bsuid         string         `json:"bsuid,omitempty"`
	MediaMetadata *MediaMetadata `json:"mediaMetadata,omitempty"`
	ReferralData  *ReferralData  `json:"referralData,omitempty"`
	MediaURL      string         `json:"mediaUrl,omitempty"` // bridge-downloaded media (replaces rawMessage)
}

// SendOp is the core → bridge outbound operation.
type SendOp string

const (
	OpText        SendOp = "send_text"
	OpMedia       SendOp = "send_media"
	OpInteractive SendOp = "send_interactive"
	OpTyping      SendOp = "send_typing"
	OpPaused      SendOp = "send_paused"
)

// SendRequest is the core → bridge POST /send body.
type SendRequest struct {
	Op         SendOp `json:"op"`
	Phone      string `json:"phone"`
	InstanceID string `json:"instanceId,omitempty"`
	Text       string `json:"text,omitempty"`
	// media
	MediaURL string `json:"mediaUrl,omitempty"` // bridge fetches + sends
	MimeType string `json:"mimetype,omitempty"`
	FileName string `json:"fileName,omitempty"`
	Caption  string `json:"caption,omitempty"`
	// interactive: raw Baileys AnyMessageContent, passed through opaque
	Payload map[string]any `json:"payload,omitempty"`
}

// SendResult is the bridge → core response to POST /send.
type SendResult struct {
	OK     bool   `json:"ok"`
	Error  string `json:"error,omitempty"`
	Sent   bool   `json:"sent,omitempty"`
	Reason string `json:"reason,omitempty"` // e.g. "opted_out", "no_instance"
}
