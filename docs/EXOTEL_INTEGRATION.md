# Exotel Integration Guide — Vocera Call Engine

This document explains how to connect **Exotel telephony** to the Vocera/Sunno voice agent pipeline. It is the implementation guide for **Week 3** of the MVP plan described in the main [README](../README.md).

**Current state:** `call-engine/` runs a browser mic → Deepgram → Groq → Sarvam pipeline over WebSocket.  
**Target state:** Real phone callers hit an Exotel number → Exotel streams audio to `call-engine` → same AI pipeline → audio played back to the caller.

---

## Table of Contents

1. [What Exotel Does in Our Stack](#1-what-exotel-does-in-our-stack)
2. [Prerequisites](#2-prerequisites)
3. [Architecture](#3-architecture)
4. [Exotel Dashboard Setup](#4-exotel-dashboard-setup)
5. [WebSocket Protocol (Voicebot Applet)](#5-websocket-protocol-voicebot-applet)
6. [Audio Format Requirements](#6-audio-format-requirements)
7. [Adapting `call-engine` for Exotel](#7-adapting-call-engine-for-exotel)
8. [Local Development with ngrok](#8-local-development-with-ngrok)
9. [Multi-Tenant Routing (Per Company)](#9-multi-tenant-routing-per-company)
10. [Outbound Calls](#10-outbound-calls)
11. [Call End & Passthru Webhook](#11-call-end--passthru-webhook)
12. [Environment Variables](#12-environment-variables)
13. [Security](#13-security)
14. [Testing Checklist](#14-testing-checklist)
15. [Troubleshooting](#15-troubleshooting)
16. [Official References](#16-official-references)

---

## 1. What Exotel Does in Our Stack

Exotel is the **telephony layer**. It owns the Indian phone number, receives PSTN calls, and bridges caller audio to our server over a **bidirectional WebSocket**.

```
Customer dials ExoPhone
        ↓
Exotel Call Flow (App Bazaar)
        ↓
Voicebot Applet opens WSS to call-engine
        ↓
call-engine: STT → LLM → TTS
        ↓
Audio sent back over same WebSocket
        ↓
Exotel plays audio to caller
```

Exotel does **not** provide STT or TTS. We handle all AI on our side (Deepgram + Groq + Sarvam), exactly as the browser test harness does today.

| Component | Provider | Role |
|-----------|----------|------|
| Phone number & PSTN | Exotel | Inbound/outbound calls |
| Real-time audio bridge | Exotel Voicebot Applet | Bidirectional WebSocket |
| Speech-to-text | Deepgram | Hindi/Hinglish STT |
| LLM | Groq (Llama 3.3 70B) | Agent responses (+ RAG later) |
| Text-to-speech | Sarvam AI (`bulbul:v2`) | Hindi voice output |

**Cost:** ~₹3 per 3-minute call for Exotel telephony (see main README cost table).

---

## 2. Prerequisites

Before integrating, you need:

- [ ] **Exotel account** with KYC completed — [exotel.com](https://exotel.com)
- [ ] **Virtual number (ExoPhone)** purchased and active
- [ ] **API credentials** from Exotel Dashboard → API Settings:
  - Account SID
  - API Key
  - API Token
- [ ] **Public HTTPS/WSS endpoint** for `call-engine` (use ngrok locally, EC2/DigitalOcean in production)
- [ ] Existing API keys in `call-engine/.env`:
  - `STT_KEY` (Deepgram)
  - `GROQ_KEY`
  - `SARVAM_KEY`

> **Note:** Use the **Voicebot Applet** (bidirectional), not the **Stream Applet** (unidirectional). Voicebot lets us send audio back to the caller.

---

## 3. Architecture

### Inbound call flow

```
┌──────────┐     PSTN      ┌─────────────┐    WSS (JSON)    ┌──────────────┐
│  Caller  │ ────────────► │   Exotel    │ ◄──────────────► │ call-engine  │
│ (phone)  │ ◄──────────── │  Voicebot   │   audio in/out   │  (Node.js)   │
└──────────┘               └─────────────┘                  └──────┬───────┘
                                                                   │
                              ┌────────────────────────────────────┼────────┐
                              ▼                    ▼               ▼            │
                         Deepgram STT          Groq LLM      Sarvam TTS      │
                              └────────────────────────────────────┘        │
```

### Recommended Exotel call flow (App Bazaar)

```
Incoming Call
     ↓
[Voicebot Applet]  →  wss://your-server.com/exotel
     ↓
[Passthru Applet]  →  https://your-server.com/exotel/callback  (call metadata, recording URL)
     ↓
[Hangup Applet]
```

**Why Passthru after Voicebot:** When the WebSocket closes, Exotel moves to the next applet. Passthru POSTs call disposition, `CallSid`, recording URL, and custom fields to your server — useful for saving calls to the database later.

---

## 4. Exotel Dashboard Setup

### Step 1 — Create a Call Flow (App)

1. Log in to [Exotel Dashboard](https://my.exotel.com)
2. Go to **App Bazaar** → **Create New App**
3. Name it e.g. `Vocera AI Agent`

### Step 2 — Add Voicebot Applet

Drag the **Voicebot** applet into the flow and configure:

| Field | Value | Notes |
|-------|-------|-------|
| **URL** | `wss://your-domain.com/exotel` | Must be publicly reachable `wss://` |
| **Sample rate** | `?sample-rate=8000` | 8 kHz is default PSTN quality; use 16000 for better quality |
| **Record** | ✅ Enable (recommended) | Recording URL available in Passthru after call |
| **Custom params** | `companyId=xxx` (optional, max 3) | Passed in `start` event for multi-tenant routing |

**URL options:**

- **Static:** Same WSS URL for every call  
  `wss://call.yourdomain.com/exotel?sample-rate=8000`

- **Dynamic:** HTTPS URL that returns a WSS URL per call (for multi-tenant)  
  `https://call.yourdomain.com/exotel/resolve`  
  Response: `{ "url": "wss://call.yourdomain.com/exotel?companyId=abc&sample-rate=8000" }`

### Step 3 — Add Passthru Applet (after Voicebot)

Configure Passthru to hit your callback endpoint:

```
https://call.yourdomain.com/exotel/callback
```

This receives call metadata when the Voicebot session ends.

### Step 4 — Add Hangup Applet

Add a **Hangup** applet at the end to cleanly terminate calls.

### Step 5 — Assign ExoPhone to the flow

1. Go to **ExoPhones** → select your virtual number
2. Set **App** to `Vocera AI Agent` (the flow you created)
3. Save

### Step 6 — Test by calling the number

Dial your ExoPhone from a mobile phone. Exotel should open a WebSocket to your server.

---

## 5. WebSocket Protocol (Voicebot Applet)

All messages are **JSON strings** over WebSocket.

### Events from Exotel → your server

#### `connected`
Sent once when the WebSocket handshake completes.

```json
{ "event": "connected" }
```

#### `start`
Sent once after `connected`. Contains call metadata.

```json
{
  "event": "start",
  "sequence_number": "1",
  "stream_sid": "XP123abc",
  "start": {
    "stream_sid": "XP123abc",
    "call_sid": "CA456def",
    "account_sid": "AC789",
    "from": "09876543210",
    "to": "08012345678",
    "custom_parameters": {
      "companyId": "zayka-001"
    },
    "media_format": {
      "encoding": "raw",
      "sample_rate": "8000",
      "bit_rate": "128000"
    }
  }
}
```

Store `stream_sid`, `call_sid`, `from`, and `custom_parameters` — you need `stream_sid` when sending audio back.

#### `media`
Repeated audio chunks from the caller.

```json
{
  "event": "media",
  "sequence_number": "3",
  "stream_sid": "XP123abc",
  "media": {
    "chunk": "2",
    "timestamp": "320",
    "payload": "<base64-encoded PCM audio>"
  }
}
```

#### `dtmf`
Caller pressed a phone keypad digit.

```json
{
  "event": "dtmf",
  "stream_sid": "XP123abc",
  "dtmf": { "digit": "5", "duration": "200" }
}
```

#### `stop`
Call ended or stream stopped.

```json
{
  "event": "stop",
  "stream_sid": "XP123abc",
  "stop": {
    "call_sid": "CA456def",
    "account_sid": "AC789",
    "reason": "callended"
  }
}
```

### Events from your server → Exotel

#### `media` (play audio to caller)

```json
{
  "event": "media",
  "stream_sid": "XP123abc",
  "media": {
    "payload": "<base64-encoded PCM audio>"
  }
}
```

#### `mark` (optional — track playback completion)

```json
{
  "event": "mark",
  "stream_sid": "XP123abc",
  "mark": { "name": "response-1" }
}
```

Exotel echoes back a `mark` event when that audio has been played.

#### `clear` (optional — interrupt queued audio for barge-in)

```json
{
  "event": "clear",
  "stream_sid": "XP123abc"
}
```

Use `clear` when the caller interrupts mid-response (barge-in).

### Session lifecycle

1. Exotel opens WSS → sends `connected`
2. Exotel sends `start` with call metadata
3. Exotel streams `media` events continuously while caller speaks
4. Your server sends `media` events back with TTS audio
5. On hangup or when your bot ends the conversation → **close the WebSocket**
6. Exotel automatically advances to the next applet (Passthru)

> There is no explicit "stop" message from bot to Exotel. **Close the WebSocket** to end the Voicebot session.

---

## 6. Audio Format Requirements

This is the most important integration detail.

| Property | Exotel requirement | Current browser test |
|----------|-------------------|----------------------|
| Encoding | Raw PCM (slin), 16-bit signed | WebM/Opus |
| Channels | Mono | Mono |
| Sample rate | 8 kHz (default), 16 kHz, or 24 kHz | 48 kHz |
| Byte order | Little-endian | N/A |
| Transport | Base64 in JSON `media.payload` | Raw binary WebSocket |

### Inbound (Exotel → Deepgram)

Exotel sends **PCM 16-bit mono** at the negotiated sample rate (usually 8 kHz). Deepgram accepts raw PCM if you specify encoding parameters:

```
wss://api.deepgram.com/v1/listen
  ?model=nova-2
  &language=hi
  &encoding=linear16
  &sample_rate=8000
  &channels=1
```

Decode Exotel's base64 payload → forward raw PCM bytes to Deepgram.

### Outbound (Sarvam TTS → Exotel)

Sarvam returns audio (typically WAV/MP3). You must:

1. Decode Sarvam output to raw PCM
2. Resample to match Exotel's sample rate (8 kHz for PSTN)
3. Base64-encode
4. Send in `media` JSON chunks

### Chunk size rules (Exotel → your server when sending audio back)

| Rule | Value |
|------|-------|
| Minimum chunk | ~3.2 KB (~100 ms of audio) |
| Maximum chunk | 100 KB |
| Chunk alignment | Must be a multiple of **320 bytes** |

Send audio in ~100 ms frames. Sending one giant blob can cause timeouts or playback gaps.

---

## 7. Adapting `call-engine` for Exotel

The current `call-engine/src/index.ts` handles **browser WebSocket** connections (binary WebM audio). For Exotel, add a **separate WebSocket route** with a different message handler.

### Suggested file structure

```
call-engine/src/
  index.ts              ← HTTP server + route both WS endpoints
  exotel/
    handler.ts          ← Exotel WSS connection logic
    audio.ts            ← PCM encode/decode, resampling, chunking
    types.ts            ← Exotel event TypeScript types
  stt.ts                ← Add linear16/8000 support for Exotel PCM
  llm.ts                ← Unchanged
  tts.ts                ← Add PCM output conversion for Exotel
```

### Pseudocode — Exotel handler

```typescript
// POST /exotel/resolve — dynamic WSS URL (optional, multi-tenant)
app.post("/exotel/resolve", (req, res) => {
  const { companyId } = req.body;
  res.json({
    url: `wss://call.yourdomain.com/exotel?companyId=${companyId}&sample-rate=8000`,
  });
});

// WebSocket /exotel — Exotel Voicebot connection
wss.on("connection", (socket, req) => {
  const session = {
    streamSid: "",
    callSid: "",
    companyId: "",
    sampleRate: 8000,
    history: [],
    deepgram: null,
  };

  socket.on("message", async (raw) => {
    const msg = JSON.parse(raw.toString());

    switch (msg.event) {
      case "connected":
        // Acknowledge — no action needed
        break;

      case "start":
        session.streamSid = msg.start.stream_sid;
        session.callSid = msg.start.call_sid;
        session.companyId = msg.start.custom_parameters?.companyId;
        session.sampleRate = parseInt(msg.start.media_format?.sample_rate || "8000");
        session.deepgram = await createDeepgramStream(session.sampleRate, onTranscript);
        // Optionally play greeting TTS immediately
        break;

      case "media":
        const pcm = Buffer.from(msg.media.payload, "base64");
        session.deepgram.socket.send(pcm);
        break;

      case "stop":
        session.deepgram?.disconnect();
        break;
    }
  });

  async function onTranscript(text: string) {
    const agentText = await getAgentResponse(text, session.history);
    const pcmChunks = await textToSpeechPcm(agentText, session.sampleRate);
    for (const chunk of pcmChunks) {
      socket.send(JSON.stringify({
        event: "media",
        stream_sid: session.streamSid,
        media: { payload: chunk.toString("base64") },
      }));
    }
  }
});
```

### Key differences from browser mode

| Browser test (`/`) | Exotel (`/exotel`) |
|--------------------|-------------------|
| Binary WebM chunks | JSON with base64 PCM |
| No call metadata | `start` event has `call_sid`, `from`, `to` |
| Single user session | Many concurrent calls (one WSS per call) |
| No audio format conversion | PCM resampling required |
| Dev only | Needs public WSS + billing gate |

### Billing gate (from README)

Before starting the AI pipeline, check the company's subscription status:

```typescript
if (!company.isActive || company.paidUntil < new Date()) {
  // Play a pre-recorded "service unavailable" message and close WS
  return;
}
```

Look up `companyId` from `start.custom_parameters` or map `to` (ExoPhone) → company in the database.

---

## 8. Local Development with ngrok

`call-engine` runs on `localhost:8000`. Exotel needs a **public `wss://` URL**.

### Setup

```bash
# Terminal 1 — start call-engine
cd call-engine
npm run dev

# Terminal 2 — expose via ngrok
ngrok http 8000
```

Copy the ngrok HTTPS URL and convert to WSS:

```
https://abc123.ngrok-free.app  →  wss://abc123.ngrok-free.app/exotel
```

Paste that into the Exotel Voicebot Applet URL field (with `?sample-rate=8000`).

### Verify connection

1. Call your ExoPhone number
2. Watch `call-engine` logs for:
   ```
   Exotel connected
   Exotel start: call_sid=CA..., from=09...
   Transcript: namaste
   Agent: Namaste! Main Priya bol rahi hoon...
   ```

If you see `connected` but no `start`, check that the Voicebot applet URL is correct and ngrok is running.

---

## 9. Multi-Tenant Routing (Per Company)

Each Vocera client gets their own ExoPhone and agent config. Route calls using one of these methods:

### Option A — One ExoPhone per company (simplest for MVP)

- Each company has a dedicated virtual number
- Map `to` number from the `start` event → `Company` record in Postgres
- No custom parameters needed

### Option B — Custom parameters in Voicebot URL

```
wss://call.yourdomain.com/exotel?companyId=clx_abc123&sample-rate=8000
```

Read `companyId` from `start.custom_parameters`.

**Limit:** Max 3 custom params, total length ≤ 256 characters.

### Option C — Dynamic HTTPS resolver (best for scale)

Voicebot applet URL:

```
https://call.yourdomain.com/exotel/resolve
```

Your server inspects the incoming call (via Exotel's POST body) and returns:

```json
{
  "url": "wss://call.yourdomain.com/exotel?companyId=clx_abc123&sample-rate=8000"
}
```

This lets one call flow serve many tenants with different agent configs.

---

## 10. Outbound Calls

For Phase 2 outbound (AI calls leads), use Exotel's **Make-a-Call API**.

Exotel calls the target number first; once they answer, it connects them to your App Bazaar flow (which contains the Voicebot applet).

```bash
curl -X POST "https://api.exotel.com/v1/Accounts/{sid}/Calls/connect.json" \
  -u "{api_key}:{api_token}" \
  -d "From=09876543210" \
  -d "CallerId=08012345678" \
  -d "Url=http://my.exotel.com/{sid}/exoml/start_voice/{app_id}" \
  -d "StatusCallback=https://call.yourdomain.com/exotel/status"
```

| Parameter | Description |
|-----------|-------------|
| `From` | Number to call (lead/restaurant owner) |
| `CallerId` | Your ExoPhone (what shows on their phone) |
| `Url` | ExoML URL pointing to your call flow with Voicebot applet |
| `StatusCallback` | Webhook for `completed`, `failed`, `busy`, `no-answer` |

The outbound callee then enters the same Voicebot → AI pipeline as inbound callers.

---

## 11. Call End & Passthru Webhook

### When the WebSocket closes

Exotel moves to the **Passthru Applet** and POSTs call data to your callback URL. Use this to save the call record to the database.

Expected fields (varies by config):

| Field | Use |
|-------|-----|
| `CallSid` | Unique call ID — primary key for `Call` table |
| `From` / `To` | Caller and ExoPhone numbers |
| `DialCallStatus` | `completed`, `failed`, etc. |
| `RecordingUrl` | If recording was enabled on Voicebot applet |
| Custom params | Your `companyId`, campaign tags, etc. |

### What to save per call (MVP schema)

```typescript
{
  callSid: string,
  companyId: string,
  from: string,
  to: string,
  transcript: Message[],      // accumulated during the call
  duration: number,
  recordingUrl: string,
  resolved: boolean,        // filled by post-call worker
  intent: string,             // filled by post-call worker
  sentiment: string,          // filled by post-call worker
}
```

---

## 12. Environment Variables

Add these to `call-engine/.env` alongside existing keys:

```env
# Existing AI keys
STT_KEY=your_deepgram_api_key
GROQ_KEY=your_groq_api_key
SARVAM_KEY=your_sarvam_api_key

# Exotel credentials
EXOTEL_SID=your_account_sid
EXOTEL_API_KEY=your_api_key
EXOTEL_API_TOKEN=your_api_token
EXOTEL_SUBDOMAIN=your_subdomain          # e.g. "api" or your account subdomain

# Server
PORT=8000
PUBLIC_WSS_URL=wss://call.yourdomain.com  # used in dynamic resolver responses

# Optional — Basic auth for WSS (see Security section)
EXOTEL_WSS_USER=your_wss_username
EXOTEL_WSS_PASS=your_wss_password
```

---

## 13. Security

### Never expose telephony credentials in the browser

API keys stay server-side only. The browser test page must not contain Exotel credentials (same rule we applied to Deepgram).

### WSS authentication options

Exotel supports:

1. **IP whitelisting** — Ask Exotel support (hello@exotel.com) for their outbound IP ranges; allowlist on your firewall/load balancer.
2. **Basic auth in WSS URL** — Configure as:
   ```
   wss://API_KEY:API_TOKEN@call.yourdomain.com/exotel
   ```
   Exotel sends `Authorization: Basic ...` in the WebSocket handshake.

### Validate Passthru webhooks

Verify that Passthru callbacks originate from Exotel (IP allowlist or shared secret in query param).

### Encrypt stored credentials

When saving client API tokens for live data lookups (post-MVP), encrypt at rest (AES-256-CBC) per main README security rules.

---

## 14. Testing Checklist

### Phase 1 — Connection

- [ ] ngrok running, WSS URL in Voicebot applet
- [ ] Call ExoPhone → server logs show `connected` + `start`
- [ ] `call_sid`, `from`, `to` logged correctly

### Phase 2 — Audio in (STT)

- [ ] Speak in Hindi → Deepgram receives PCM (not WebM)
- [ ] Final transcript logged within ~1 second of silence
- [ ] Transcript is sensible for Indian accent/Hinglish

### Phase 3 — Audio out (TTS)

- [ ] Agent response generated by Groq
- [ ] Sarvam TTS converted to PCM at correct sample rate
- [ ] Caller hears Priya's voice on the phone
- [ ] Audio chunks are ~100 ms, multiples of 320 bytes

### Phase 4 — Conversation

- [ ] Multi-turn conversation maintains context per call
- [ ] Concurrent calls from different numbers do not share history
- [ ] Call end → WebSocket closes → Passthru callback received

### Phase 5 — Production readiness

- [ ] Public WSS on EC2/DigitalOcean (not ngrok)
- [ ] HTTPS/WSS TLS certificate valid
- [ ] Billing gate rejects inactive companies
- [ ] Call records saved to database
- [ ] Recording URL stored when enabled

---

## 15. Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| Call connects but silence | WSS URL wrong or server not reachable | Check ngrok, firewall, URL in applet |
| `connected` but no `start` | Applet misconfigured | Verify Voicebot (not Stream) applet |
| Caller hears garbled audio | Wrong sample rate or encoding | Match 8 kHz linear16 PCM; resample TTS output |
| STT returns empty | Sending WebM to Deepgram instead of PCM | Decode Exotel base64 → raw PCM before STT |
| Audio gaps / stutter | Chunks too small or not 320-byte aligned | Send ~3.2 KB chunks, align to 320 bytes |
| Agent responds to wrong context | Shared global LLM history | Use per-call `history` array (see `llm.ts`) |
| WebSocket closes immediately | Server crash on first message | Check logs; validate JSON parsing |
| No recording URL | Record checkbox off or Passthru missing | Enable Record on Voicebot; add Passthru after |

---

## 16. Official References

| Resource | URL |
|----------|-----|
| Voicebot Applet docs | [docs.exotel.com/exotel-agentstream/voicebot-applet](https://docs.exotel.com/exotel-agentstream/voicebot-applet) |
| Stream & Voicebot guide | [support.exotel.com — Stream and Voicebot Applet](https://support.exotel.com/support/solutions/articles/3000108630-working-with-the-stream-and-voicebot-applet) |
| AgentStream sample code | [github.com/exotel/Agent-Stream](https://github.com/exotel/Agent-Stream) |
| Echo bot sample | [github.com/exotel/Agent-Stream-echobot](https://github.com/exotel/Agent-Stream-echobot) |
| Exotel blog — realtime voice assistant | [exotel.com/blog — AgentStream + OpenAI Realtime](https://exotel.com/blog/build-a-real-time-speech-to-speech-ai-voice-assistant-on-exotel-agentstream-bidirectional-with-openai-realtime-python/) |
| Make-a-Call API | Exotel Dashboard → API Docs → Calls |

---

## Implementation Order (Suggested)

1. Add `/exotel` WebSocket route with event parsing (`connected`, `start`, `media`, `stop`)
2. Decode Exotel PCM → forward to Deepgram with `encoding=linear16&sample_rate=8000`
3. Convert Sarvam TTS output → PCM chunks → send back as Exotel `media` events
4. Test inbound call end-to-end via ngrok
5. Add Passthru callback endpoint to log call metadata
6. Map ExoPhone → `Company` for multi-tenant agent config
7. Add billing gate (`isActive` / `paidUntil`)
8. Save transcript + call record to Postgres
9. Outbound Make-a-Call API (Phase 2)

---

*This guide is part of the Vocera/Sunno project. For product context, architecture, and MVP scope, see the main [README](../README.md).*
