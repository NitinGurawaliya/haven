# Bug Report — Vocera / Sunno Call Engine

**Project:** `sunno-repo` (Vocera AI voice agent platform)  
**Scope reviewed:** `call-engine/src/*.ts` with supporting checks in `call-engine/tsconfig.json`, `call-engine/package.json`, `call-engine/.env.example`, and product spec notes in `README.md`  
**Date:** 2026-07-10  
**Status:** Static code review of the current `call-engine` server-side pipeline

---

## Executive Summary

The current `call-engine/src` code is no longer the same prototype described by the older report. The server now owns the Deepgram connection, per-socket LLM history is correctly threaded through the pipeline, the TypeScript `rootDir` is fixed, and the TTS step includes a transliteration pass before calling Sarvam.

The main remaining issues in the reviewed scope are around **error handling, backpressure/concurrency behavior, incomplete session lifecycle handling, and gaps versus the README MVP architecture**.

| Severity | Count |
|----------|-------|
| Critical | 0 |
| High     | 3 |
| Medium   | 5 |
| Low      | 4 |

---

## Findings Invalidated From The Previous Report

These earlier findings are **not accurate for the current code under `call-engine/src`**:

- **Old BUG-002 (global LLM history leak)** — no longer valid. `call-engine/src/index.ts` creates a per-connection `history` array, and `call-engine/src/llm.ts` now appends to the passed-in `history` instead of a module-global store.
- **Old BUG-003 (TypeScript build broken due to `rootDir`)** — no longer valid. `call-engine/tsconfig.json` already uses `"rootDir": "src"`.
- **Old BUG-006 (Deepgram timeout never cleared)** — no longer valid. `call-engine/src/stt.ts` stores the timeout handle and clears it on successful connection and on pre-open error.
- **Old BUG-007 (server-side STT imported but unused)** — no longer valid. `call-engine/src/index.ts` actively calls `createDeepgramStream(...)` inside the WebSocket connection handler.
- **Old BUG-008 (no TTS audio existence check)** — no longer valid. `call-engine/src/tts.ts` checks `response.data?.audios?.[0]` and throws `Sarvam TTS returned no audio` if absent.
- **Old BUG-009 / BUG-010 (prompt/spec mismatch and missing transliteration)** — no longer valid as written. The prompt now asks for Roman Hinglish / English based on customer language, and `call-engine/src/tts.ts` performs a Sarvam `/transliterate` call before TTS.
- **Old BUG-014 (missing `.env.example`)** — no longer valid. `call-engine/.env.example` exists and documents `STT_KEY`, `GROQ_KEY`, and `SARVAM_KEY`.
- **Old BUG-015 (`console.log("hello")`)** — no longer valid. That debug log is not present in the current server entrypoint.

The old report also included several client-side findings in `call-engine/public/index.html`, but this review request was specifically to analyze **`call-engine/src`**. Those browser-side findings should be kept separate unless they are revalidated against the current frontend file.

---

## High Severity Bugs

### BUG-001 — Binary frame handling can crash or corrupt audio forwarding in some `ws` runtimes

**File:** `call-engine/src/index.ts` (message handler)

**Description:** The server assumes WebSocket binary messages arrive as a Node `Buffer`:

```ts
socket.on("message", (data: Buffer, isBinary: boolean) => {
  if (!isBinary) return;
  if (deepgram.socket.readyState === WebSocket.OPEN) {
    deepgram.socket.send(data);
  }
});
```

In `ws`, `data` may be a `Buffer`, `ArrayBuffer`, or `Buffer[]` depending on runtime/path. The explicit `Buffer` annotation is compile-time only and does not guarantee the runtime shape. Passing an unexpected binary shape straight through to Deepgram risks malformed audio frames or runtime issues if later code starts using Buffer-only methods.

**Impact:**
- Audio streaming may break intermittently depending on message type/runtime behavior
- Failures will be hard to diagnose because the problem sits at the raw media transport layer
- This is in the hot path for the entire call pipeline

**Expected:** Normalize incoming binary payloads before forwarding, e.g. convert `ArrayBuffer` / `Buffer[]` to a single `Buffer` and reject unexpected types explicitly.

---

### BUG-002 — Fire-and-forget transcript callback allows overlapping pipeline executions despite `processing` flag

**Files:** `call-engine/src/index.ts`, `call-engine/src/stt.ts`

**Description:** `stt.ts` invokes the transcript callback synchronously and does not await it:

```ts
if (transcript?.trim() && parsed.is_final) {
  onTranscript(transcript);
}
```

In `index.ts`, that callback is `async` and uses a `processing` guard:

```ts
deepgram = await createDeepgramStream(async (transcript) => {
  if (processing) return;
  processing = true;
  // LLM + TTS pipeline
});
```

This drops any new final transcript received while the agent is already processing a previous one. There is no queue, cancellation model, acknowledgment back to STT, or buffering. The result is not just degraded UX; it is lossy conversation handling under normal rapid speech.

**Impact:**
- Caller utterances can be silently ignored while a previous response is being generated
- Conversation history becomes incomplete and semantically inconsistent
- Production phone support behavior would be unreliable under interruptions or fast back-to-back speech

**Expected:** Use a queue/session state machine, or explicitly pause/stop audio intake while the agent turn is in flight. At minimum, log and surface that an utterance was dropped.

---

### BUG-003 — No cleanup on Deepgram post-connect error can leave dead sessions hanging

**Files:** `call-engine/src/index.ts`, `call-engine/src/stt.ts`

**Description:** `createDeepgramStream()` only rejects startup errors that happen before the socket is marked settled/open. After connection succeeds, later Deepgram failures are only logged inside `stt.ts`:

```ts
dgSocket.on("error", (err) => {
  console.error("Deepgram error:", err.message);
  if (!settled) {
    settled = true;
    clearTimeout(timeout);
    reject(err);
  }
});
```

Once `resolve(...)` has happened, there is no path that informs `index.ts` that the STT stream is no longer healthy. The browser WebSocket remains open, but audio frames may continue being sent into a failed/closed upstream STT socket.

**Impact:**
- Session appears alive from the browser/server perspective while transcription is dead
- Users may keep speaking and receive no response with no clear recovery path
- Stale sockets can accumulate until the client manually reconnects

**Expected:** Propagate post-connect STT failure/close events back to the session layer so the server can send an error, tear down the call, or attempt controlled recovery.

---

## Medium Severity Bugs

### BUG-004 — `getAgentResponse()` does not validate missing `GROQ_KEY` up front

**File:** `call-engine/src/llm.ts`

**Description:** The module creates the Groq client at import time:

```ts
const groq = new Groq({ apiKey: process.env.GROQ_KEY });
```

Unlike `stt.ts` and `tts.ts`, there is no explicit guard that throws a clear configuration error when `GROQ_KEY` is missing. Failure behavior is deferred to the SDK request path.

**Impact:**
- Misconfiguration produces less actionable runtime errors
- Onboarding/debugging is slower than necessary

**Expected:** Fail fast with a descriptive message such as `GROQ_KEY is not set in .env` before issuing requests.

---

### BUG-005 — Transliteration failures are silently swallowed, degrading TTS quality without observability

**File:** `call-engine/src/tts.ts`

**Description:** `toDevanagari()` catches all transliteration errors and silently falls back to the original text:

```ts
} catch {
  return text;
}
```

The README explicitly notes that Roman Hinglish sent directly to Sarvam TTS is pronounced poorly. Silent fallback therefore masks a material output-quality failure.

**Impact:**
- Call quality degrades without any logs or alerts
- Operators cannot distinguish TTS-model issues from transliteration failures

**Expected:** Log transliteration failures with request/session context and decide whether fallback is acceptable or whether the turn should fail loudly.

---

### BUG-006 — No transcript persistence or structured call state despite README MVP requirement

**Files:** `call-engine/src/index.ts`, `call-engine/src/llm.ts`

**Description:** The runtime keeps history only in an in-memory array local to each WebSocket connection:

```ts
const history: { role: "user" | "assistant"; content: string }[] = [];
```

This means the system loses the entire call transcript and agent outputs as soon as the socket closes. The README Week 3/MVP architecture explicitly requires full call saving and transcript logging.

**Impact:**
- No audit trail for support conversations
- No post-call analytics, QA, gap detection, or escalation review
- Prevents the call engine from satisfying a core documented MVP requirement

**Expected:** Persist per-call transcript/events to a database or durable event log keyed by call/session ID.

---

### BUG-007 — No session identity beyond socket instance blocks alignment with per-call architecture

**File:** `call-engine/src/index.ts`

**Description:** Sessions are tracked implicitly by closure state inside each WebSocket connection, but there is no explicit `callId`, `sessionId`, or `companyId` associated with a connection.

**Impact:**
- Hard to correlate logs across STT, LLM, and TTS
- Impossible to implement the README’s `Map<callId, CallSession>` style architecture cleanly
- Prevents future persistence, monitoring, and multi-tenant isolation work from being added incrementally

**Expected:** Generate or accept a session/call identifier and thread it through logging, state, and persistence.

---

### BUG-008 — No health endpoint for service monitoring or orchestrator checks

**File:** `call-engine/src/index.ts`

**Description:** The HTTP server serves only `/` and `/index.html`; all other routes return 404.

**Impact:**
- No readiness/liveness endpoint for deployments
- Harder to monitor service health independently from the WebSocket/browser flow

**Expected:** Add a lightweight `/health` route that returns 200 and basic dependency/config status.

---

## Low Severity Issues

### BUG-009 — `express` dependency appears unused in the current server implementation

**File:** `call-engine/package.json`

**Description:** `index.ts` uses Node’s built-in `http` module; there is no Express usage in the reviewed `src` files.

**Impact:**
- Unnecessary dependency and type packages increase install size and maintenance surface

---

### BUG-010 — `@deepgram/sdk` dependency appears unused in the current `src` implementation

**File:** `call-engine/package.json`

**Description:** `stt.ts` connects to Deepgram using raw `ws`; the reviewed code does not import `@deepgram/sdk`.

**Impact:**
- Adds unused dependency weight and potential version-management overhead

---

### BUG-011 — Test script is still a placeholder and no automated tests cover the pipeline

**File:** `call-engine/package.json`

**Description:**

```json
"test": "echo \"Error: no test specified\" && exit 1"
```

There are no automated tests for STT framing, LLM history handling, TTS response parsing, or WebSocket session lifecycle.

**Impact:**
- Regression risk is high for a stateful realtime pipeline

---

### BUG-012 — Synchronous `readFileSync` in request handler is acceptable for prototype use but suboptimal

**File:** `call-engine/src/index.ts`

**Description:** The server reads `../public/index.html` synchronously on every page request:

```ts
res.end(fs.readFileSync(path.join(__dirname, "../public/index.html")));
```

**Impact:**
- Blocks the event loop for each page load
- Low impact now, but not ideal in the same process that handles realtime audio sessions

**Expected:** Preload the file once at startup or use async I/O.

---

## Architecture Gaps Relative To The README (Not Strict `src` Bugs, But Still Important)

These are missing or only partially represented relative to the documented Week 3/MVP call-engine design:

| Feature | README expectation | Current `call-engine/src` state |
|---------|-------------------|---------------------------------|
| Exotel telephony webhooks | Required for real phone calls | Not implemented in reviewed files |
| Explicit `Map<callId, CallSession>` session model | Recommended for isolated call state | Per-socket closure state only |
| RAG context injection | LLM should use client docs | Hardcoded Zayka support prompt only |
| Transcript/call persistence | Save every call | No persistence layer |
| Filler audio / latency masking | Recommended UX optimization | Not implemented |
| Partial-STT early processing | Recommended latency optimization | Only final transcripts processed |

---

## Recommended Fix Priority

1. **BUG-002** — Replace lossy `processing` gate with queued or stateful turn handling
2. **BUG-003** — Propagate Deepgram post-connect failures to the session layer and close/recover cleanly
3. **BUG-001** — Normalize binary audio frames before forwarding to STT
4. **BUG-004, BUG-005** — Tighten configuration/error observability around Groq and transliteration
5. **BUG-006, BUG-007** — Introduce explicit call/session IDs and durable transcript persistence
6. **BUG-008** — Add `/health` and basic service status reporting

---

## Environment / Evidence Reviewed

- **OS:** Windows 10
- **Reviewed source files:**
  - `call-engine/src/index.ts`
  - `call-engine/src/llm.ts`
  - `call-engine/src/stt.ts`
  - `call-engine/src/tts.ts`
- **Supporting files checked:**
  - `call-engine/tsconfig.json`
  - `call-engine/package.json`
  - `call-engine/.env.example`
  - `README.md`

---

## Verification Notes

This report is based on **static review of the current repository contents**. It intentionally supersedes outdated findings in the previous `bugreport.md` where the code has already changed.

If you want, the next useful step would be to validate these findings with runtime checks such as:

```bash
cd call-engine
npm run build
npm run dev
```

and then exercise:

- repeated/rapid binary audio messages
- interrupted speech while a response is generating
- forced Deepgram disconnect/error scenarios
- missing `GROQ_KEY` / `SARVAM_KEY` / `STT_KEY` startup cases

---

*Generated from static review of the current `call-engine/src/*.ts` implementation and adjacent project configuration/spec files.*
