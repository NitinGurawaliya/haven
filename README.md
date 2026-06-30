# Vocera — AI Voice Agent Platform for Indian Businesses

> Working name. Replace once finalized.

A SaaS platform that lets any Indian business spin up an AI voice agent — for inbound customer support and (later) outbound sales calls — without hiring a support/BDE team. The agent understands natural Hindi/Hinglish (English later), answers from the company's own documents (RAG), looks up live account-specific data (orders, bookings, refunds) via API integrations, and logs every call for analytics.

---

## 1. The Core Idea

### Why this, why now

India's IT/services economy runs on **revenue = headcount**. AI breaks that equation — work can now be done by AI instead of people, which means service businesses can sell finished output at software margins instead of billing for hours.

This product is the **infrastructure layer underneath that shift**, specifically for voice-based customer interactions:

- **Inbound** — replace/augment a BPO-style support team. Customer calls, AI resolves common queries, escalates only what it can't handle.
- **Outbound** (Phase 2) — AI calls leads, pitches, qualifies, sends follow-up automatically.

### Why inbound first, not outbound

| | Inbound | Outbound |
|---|---|---|
| Caller mindset | Already wants help | Defensive, didn't ask for the call |
| AI-sounding tolerance | High — people just want resolution | Low — people hang up fast |
| Conversation complexity | Mostly SOP / finite paths | Needs real reasoning, objection handling |
| Build complexity | Medium | High |
| Build first | **Yes** | No — build after inbound foundation is solid |

### Why Hindi/Hinglish first, not English

| | Hindi/Hinglish | English |
|---|---|---|
| Cost per 3-min call | ₹6–8 | ₹20–25 (ElevenLabs TTS is the expensive part) |
| TTS quality available | Sarvam AI (Indian, excellent, cheap) | ElevenLabs (good but 15-20x costlier) |
| Best target customer | SMB owners (restaurants, EdTech, etc.) | Startup customers (more AI-skeptical, higher bar) |
| Competition | Low | Higher (global players exist) |

**Decision: Build Hindi/Hinglish inbound support first. English and outbound come later, layered on the same platform.**

---

## 2. Target Market & Positioning

### The gap in the market

```
                    ENTERPRISE (Kore.ai, Yellow.ai, Ozonetel)
                    ₹10L+/year, 6-12 month sales cycles
                              │
                    Sarvam Agents, Exotel AI features
                    (going upmarket, not self-serve SMB)
                              │
                    ──────── 👉 US 👈 ────────
                    SMB / early-stage startups, ₹15-60K/month
                    Self-serve, fast onboarding, India-first
                              │
                    Nobody building here
                    Solopreneurs / very small biz
```

### Known competitors (for reference, not exhaustive)

- **Bland.ai, Vapi, Retell AI** (US) — USD pricing, no Hindi, no Indian telephony. Not a real threat to the Indian SMB segment.
- **Sarvam Agents** (India) — biggest potential threat long-term; best-in-class Hindi tech, well-funded, but going enterprise/developer-facing, not self-serve SMB.
- **Kore.ai, Yellow.ai, Ozonetel** (India) — enterprise-only, high ticket, slow sales cycles. Ignore the SMB segment entirely.
- **Exotel** (our own telephony vendor) — building basic AI/IVR features; medium risk since they already have SMB distribution.
- Old-school IVR ("press 1 for Hindi") — not a real competitor, just the broken status quo we're replacing.

### Target verticals (in priority order)

1. **EdTech** (own market — sells courses currently, knows the domain, knows the questions students ask)
2. **D2C brands** — young founders, high call volume, identical repetitive queries (order status, returns, refunds)
3. **Quick commerce / hyperlocal delivery** — high volume, high error rate, founders obsess over unit economics
4. **Real estate / co-living / PG** — lead qualification gold, good outbound fit later
5. **Clinics / diagnostic chains** — appointment booking is highly automatable
6. **Fintech/NBFC lending** (later — regulated, needs care, but pays well)

Avoid: large banks/insurance (slow sales cycles), government, healthcare diagnosis (liability), crypto.

### Validation strategy

Use **Zayka** (existing restaurant client) as the live testbed before pitching anyone else:
- Build the outbound-calling-restaurant-owners version first (Hindi pitch for Zayka itself) to prove the tech works on real Indian phone numbers/accents.
- Then build inbound for Zayka's own customer queries.
- Use real call recordings + resolution numbers as the case study that closes the first external client.

---

## 3. How The Core Tech Works (Plain Explanation)

A voice agent call is five things happening in a pipeline:

```
CALLER SPEAKS
     ↓
[1] Exotel captures audio, streams it to our server
     ↓
[2] Deepgram converts speech → text (STT)
     ↓
[3] Groq/Llama (LLM) decides what to say — using RAG + live data lookups if needed
     ↓
[4] Sarvam AI converts text → speech (TTS)
     ↓
CALLER HEARS RESPONSE
```

### Per-call cost breakdown

| Component | Hindi/Hinglish | English |
|---|---|---|
| Exotel (telephony) | ₹3 | ₹3 |
| Deepgram (STT) | ₹1.1 | ₹1.1 |
| Groq (LLM) | ₹0.5 | ₹0.5 |
| TTS (Sarvam vs ElevenLabs) | ₹1–1.5 | ₹18 (raw) → ₹7-8 (with pre-rendered cache) |
| **Total (3 min call)** | **~₹6** | **~₹23 raw / ₹12-13 optimized** |

**Why Hindi is so much cheaper:** Sarvam AI is India-focused and has optimized specifically for Hindi TTS. ElevenLabs (best English TTS) is a US company — English is their core market, Hindi is an afterthought (and vice versa cost-wise). This asymmetry is structural, not a temporary pricing thing.

**Token cost nuance:** Devanagari Hindi text uses 2-3x more LLM/embedding tokens than the same meaning in Roman Hinglish. This is why the agent should generate responses in **Roman Hinglish internally**, and only convert to Devanagari right before the TTS step (where it's needed for correct pronunciation).

### Why latency matters and how to control it

Anything over ~1.2 seconds of silence after the caller stops speaking feels like the call dropped. Target: under 800ms perceived latency.

Techniques (in order of impact):
1. **Stream LLM output to TTS sentence-by-sentence** instead of waiting for the full response — biggest single latency win.
2. **Play a pre-rendered filler ("hmm...", "ek second...") instantly** while the real LLM response generates in the background — biggest *perceived* latency win.
3. Start processing partial STT transcripts early rather than waiting for full silence detection.

### Making Hindi TTS sound human, not robotic

Plain Sarvam output, even in correct Devanagari, sounds AI-ish. Seven layers fix this, roughly in order of effort vs payoff:

1. **Write human-sounding script text** — fillers ("haan", "dekhiye"), dashes for pauses, incomplete sentences, no formal Hindi. (~15% improvement, low effort)
2. **SSML breaks/emphasis/prosody tags** — `<break time="300ms"/>`, `<prosody rate="slow">`, `<emphasis>`. (~10%, low effort)
3. **Randomized filler injection** based on conversation context (thinking, acknowledging, objection-handling). (~20%, medium effort) — **biggest single ROI improvement**
4. **Breath simulation** — small 100-150ms breaks at natural breath points. (~5%, low effort)
5. **Pace variation** — slow down for important info (price), speed up for casual transitions. (~10%, medium effort)
6. **Hybrid real-human audio** — record a real person saying 25-30 common phrases once, use those audio files directly; only use TTS for dynamic/unique content. (~25%, high effort, **highest ceiling**)
7. **Conversation rhythm** — vary energy/pace across opening vs explaining vs closing phases of the call. (~8%, medium effort)

**Important reframe:** the goal isn't 100% human, it's "human enough that the caller doesn't hang up in the first 10 seconds." That opening line should get disproportionate polish.

### Important Sarvam API note (from testing)

- Use `target_language_code: "hi-IN"` (not `bn-IN` — easy mistake, that's Bengali).
- Valid `bulbul:v2` speakers: `anushka`, `abhilash`, `manisha`, `vidya`, `arya`, `karun`, `hitesh`.
- **Write text in Devanagari script, not Roman Hinglish**, when sending to TTS — Roman Hinglish text gets read with an English accent regardless of `target_language_code`. Since the LLM generates Roman Hinglish, add a **transliteration step** (Sarvam has a `/transliterate` endpoint) between LLM output and TTS input.
- `enable_preprocessing: true` helps handle stray English words inside Hindi sentences.

---

## 4. RAG — How The Agent Knows What To Say

Every client uploads their own documents during onboarding (FAQ, policy docs, pricing sheets, SOPs). This becomes their private knowledge base.

```
Client uploads PDF/Word/Excel doc
        ↓
Extract text → chunk it (~500 chars, 50 char overlap)
        ↓
Embed each chunk (convert to vector)
        ↓
Store in vector DB, namespaced per client (pgvector, isolated by companyId)
        ↓
On every customer query:
  → embed the query
  → search only that client's namespace for similar chunks
  → feed matched chunks to LLM as context
  → LLM answers ONLY from that context (never invents answers)
  → if nothing relevant found → agent says "let me connect you to our team"
```

This grounding is what prevents the AI from making up wrong policy info (e.g., wrong refund window).

---

## 5. Live Data Lookups — Function Calling (Beyond Static Docs)

RAG over documents only solves **policy questions** ("what's your refund policy"). It does NOT solve **account-specific questions** ("where is MY order #1234", "what's MY PNR's boarding point"). That needs live lookups against the client's actual system.

### The mechanism

This uses LLM **function/tool calling** — the LLM can choose to "call a function" instead of just generating text, when the conversation needs live data.

```
Customer: "mera order kahan hai, ID 12345"
        ↓
LLM recognizes intent → decides to call lookup_order_status(orderId="12345")
        ↓
Our backend executes an authenticated API call to the client's system
        ↓
Client's API returns JSON (e.g., { status: "out_for_delivery", eta: "25 min" })
        ↓
That JSON is fed back to the LLM as a "tool result"
        ↓
LLM converts it into a natural spoken sentence
```

### How the LLM picks the right function among many

Each function definition has a `description` field written in plain language (e.g., *"Use this ONLY when customer explicitly asks for the driver's phone number"*). The LLM matches the customer's message against these descriptions semantically — this is **not code logic**, it's the LLM reading and choosing, the same way it picks words in a sentence. Specific, non-overlapping descriptions avoid wrong picks; vague descriptions cause confusion.

If a required parameter (e.g., PNR, order ID) is missing from the conversation, the LLM will ask the customer for it before attempting to call any function — this happens naturally from the parameter being marked `required`.

### How different clients connect their data — 3 methods, depending on what they have

| Method | When to use | How |
|---|---|---|
| **Client has a REST API** (best case) | Modern startups, redBus-type clients | Store base URL + auth token (encrypted) + endpoint templates per client in DB |
| **Client gives DB access** | Smaller companies without clean APIs | **Always insist on read-only credentials.** Never write/delete access. |
| **Google Sheet sync** | No tech team at all (e.g. smaller D2C, restaurants) | Poll their sheet every ~5 min, upsert into our own `ClientRecord` table, agent reads from our synced copy |

### Frontend vs backend split for this feature

- **"Frontend"** here means an **Integrations page in the client's dashboard** — a form where they configure: function name, trigger description (when to use it), required parameter, API endpoint, auth token. This is pure CRUD that saves JSON config to our DB. It is configured once, before any call happens — there's no frontend involved during an actual live call.
- **Backend** does the real work live, during the call: load that company's saved integrations from DB → convert to the LLM's `tools` array format → pass to LLM → if LLM calls a function, execute the actual `fetch()` to the client's API using their stored encrypted token → feed result back to LLM → LLM speaks the answer.
- Critically: **the executor code is generic and identical for every client.** It's entirely data-driven from a `DataIntegration` table — redBus's bus-lookup function and a clothing brand's order-lookup function run through the exact same code path, just with different stored config.

### Security non-negotiables

- API tokens and DB passwords are **always encrypted at rest** (AES-256-CBC or similar) — never stored in plain text.
- Database integrations are **always read-only**.
- A "Test Connection" feature in onboarding lets the client verify with a real ID before going live.

### Build sequencing decision: AFTER MVP, not before

Do not build the generic dashboard UI for this speculatively. Reasoning:
- First 3-5 clients (restaurants, small EdTechs) mostly need policy/FAQ answers — RAG-only handles this fine.
- A client like redBus (needing real API integration) is realistically a Month 4-6 conversation, not a Month 1 one — they have engineering teams, procurement, security review.
- **Build it manually/hardcoded for the first 1-2 clients who actually need it.** Only generalize into a polished self-serve dashboard form once the real pattern is clear from 2-3 real implementations — guessing the schema upfront wastes effort.

---

## 6. Full MVP Scope

### What MVP must do (end to end)

> Company signs up → uploads docs → gets a virtual phone number → forwards their support number to it → customers call → AI agent answers using RAG over their docs → dashboard shows every call, transcript, and AI-generated analysis.

### Tech stack

| Layer | Choice | Why |
|---|---|---|
| Frontend (dashboard) | Next.js + Tailwind | Existing strength |
| Backend API | Node.js / Express (within Next.js API routes for dashboard CRUD) | — |
| Real-time call engine | **Separate Node.js service** (NOT Next.js serverless) | Calls need persistent WebSocket connections; Next.js serverless functions timeout at 30s, would kill a 3-5 min call |
| Database | PostgreSQL + Prisma | — |
| Vector store | **pgvector** (inside Postgres) | No need for separate Pinecone — simpler architecture, one less service to manage at MVP stage |
| File storage | AWS S3 / Cloudflare R2 | Uploaded client documents |
| Auth | NextAuth.js | — |
| Telephony | Exotel | Indian numbers, local support, webhook-friendly |
| STT | Deepgram (Nova 2) | Best Indian-accent handling, streaming support |
| TTS | Sarvam AI (`bulbul:v2`) | Best/cheapest Hindi; ElevenLabs reserved for English later |
| LLM | Groq + Llama 3.3 70B | Fast inference (low latency), already familiar from past projects |
| Payments (later) | Razorpay | — |
| Hosting | Vercel (web) + AWS EC2/DigitalOcean (call-server, worker) | — |

### Repo architecture: Monorepo (Turborepo), NOT microservices

```
vocera/
  apps/
    web/            ← Next.js — dashboard, auth, onboarding, REST APIs, billing pages
    call-server/     ← Node.js — Exotel webhooks, WebSocket audio streaming, STT/LLM/TTS pipeline
    worker/          ← Node.js — doc processing, post-call analysis, weekly reports, WhatsApp follow-ups, cron jobs
  packages/
    database/        ← shared Prisma schema + client
    types/           ← shared TypeScript types
    utils/           ← shared helpers (encryption, billing helpers, etc.)
```

**Why not microservices:** too much DevOps overhead for a 1-2 person team at this stage; massive deployment/debugging complexity for no real benefit until much larger scale.

**Why not pure Next.js:** serverless functions can't hold a persistent WebSocket connection for the duration of a phone call — need a real long-running server process for the call engine specifically.

### Database schema (core models)

- `Company` — name, industry, plan, virtual number, agent config (name/language/gender), call usage counters
- `User` — belongs to a Company, auth
- `Document` — uploaded file metadata, processing status
- `KnowledgeChunk` — chunked + embedded text per company (pgvector column)
- `Call` — full call record: transcript (JSON), AI summary, intent, sentiment, resolved/escalated flags, unanswered query, WhatsApp-sent flag
- `DataIntegration` (post-MVP) — per-client function-calling config (API endpoint, encrypted auth token, trigger description)
- `ClientRecord` (post-MVP, sheet-sync method) — synced rows from a client's Google Sheet

### Module build order (6 modules, ~6 weeks)

**Week 1 — Foundation:** project setup, Prisma schema, auth (signup/login), company creation, empty dashboard shell

**Week 2 — Onboarding wizard (3 steps):**
1. Upload documents → S3 → background text extraction → chunking → embedding → pgvector
2. Configure agent (name, language, voice gender, escalation rules, business hours)
3. Get assigned a virtual Exotel number → instructions to forward their existing support line

**Week 3 — Call engine:**
- Exotel webhook for incoming calls
- WebSocket handler streaming audio
- Deepgram STT stream → Groq LLM (with RAG context) → Sarvam TTS → back to caller
- Full call saved to DB with transcript

**Week 4 — Dashboard core:**
- Calls list page (searchable/filterable)
- Individual call detail page (transcript, AI summary, intent, sentiment, docs used)
- Top-level stats (total calls, resolution rate, escalation rate, avg duration)

**Week 5 — Intelligence layer:**
- Post-call AI analysis: intent classification, sentiment, resolved/escalated, unanswered-query detection
- Analytics page (resolution rate over time, top intents, sentiment breakdown, peak hours, escalation reasons)
- Knowledge Base management page — shows uploaded docs + **"Gaps" section**: queries the agent couldn't answer, with a quick "Add Quick Answer" feature (type a Q&A pair directly without a full doc re-upload)

**Week 6 — Polish + first client:**
- Weekly auto-generated email report (AI-written plain-English summary sent to client admin)
- Settings page
- Manual admin panel for activating/pausing clients (see Billing below)
- Onboard first real client (Zayka or first EdTech pilot)

### Key retention mechanism — "Gap Detection"

Every unanswered query gets logged. The dashboard surfaces these weekly: *"Your agent couldn't answer these 5 questions — update your docs to fix it."* Client uploads a doc or adds a quick answer → resolution rate visibly climbs (65% → 72% → 80%) week over week. This is the single most important retention feature — clients watching their own product improve from their own actions are unlikely to churn.

### What MVP deliberately does NOT include

- No automated Razorpay billing (see Billing section — manual/UPI until 7-10+ clients)
- No live API/function-calling integrations (RAG-only; add per-client after MVP proves out)
- No English support (Hindi/Hinglish only)
- No outbound calling (inbound only)
- No multi-server load balancing (one server comfortably handles 50-80 concurrent calls)

---

## 7. Concurrency & Scaling

- Node.js handles concurrent calls naturally — each call is an isolated WebSocket session with its own conversation state (`Map<callId, CallSession>`), event-driven and non-blocking.
- **One server (~₹2,000-3,000/month EC2) comfortably handles 50-80 concurrent calls** — sufficient for the first 20-30 clients. Real bottlenecks (if any) would be Groq/Deepgram/Sarvam rate limits on paid tiers, not the Node server itself.
- **Don't build a load balancer for MVP.** Only add one (AWS ALB + 2-3 call-server instances) once consistently seeing 80+ concurrent calls — which implies 20+ large clients and revenue to justify the infra work.

---

## 8. Billing Strategy — Deliberately Manual Until Scale

**Principle: billing infrastructure does not get you clients — a working product and trust does. Don't build it prematurely.**

| Stage | Client count | How payment is collected | Engineering required |
|---|---|---|---|
| Now | 0-3 | Personal UPI, manual WhatsApp summary + ask | **Zero** |
| Next | 3-7 | Razorpay Payment Links (created manually in dashboard, no code) | Zero |
| Then | 7-15 | Razorpay "Pay Now" button inside our dashboard | ~1 day (checkout + webhook verify) |
| Later | 15+ | Full Razorpay Subscriptions (auto-debit) + GST invoicing (Zoho Invoice free tier until then) | ~1-2 weeks |

### MVP billing implementation (the only piece to build now)

- Add `isActive`, `paidUntil`, `trialEndsAt` fields to `Company`.
- Build a simple **internal admin panel** (`/admin`, access restricted to founder) listing companies with an "Activate" button — clicked manually after confirming a UPI payment.
- Gate every incoming call behind a check: `if (!company.isActive || company.paidUntil < now) → reject call with a polite message`.
- Usage tracking for the first 5 clients: a manual SQL query run once a month per client (no dashboard needed yet), numbers pasted into a WhatsApp summary message sent to the client along with the payment ask.

### Suggested first-client pricing

- Flat **₹15,000/month**, no tiers, no call limits, for the first 5 clients. Simple enough that a founder says yes without internal approval; covers infra costs with margin.
- Offer a **free 2-week pilot with zero risk** before asking for any payment — convert using real call-volume/resolution numbers from that pilot, not a sales pitch.
- Always open a **current account** (not personal savings) early — needed for Razorpay payouts later and looks more professional to clients paying via UPI.

---

## 9. Unit Economics — 10 Client Model (English, optimized cost basis)

Using ₹13/call optimized English cost and three client tiers:

| Tier | Profile | Calls/month | Charge | Cost | Margin |
|---|---|---|---|---|---|
| Small | 15-30 employees | 1,500 | ₹35,000 | ₹19,500 | 44% |
| Mid | 30-80 employees | 4,000 | ₹85,000 | ₹52,000 | 39% |
| Large | 80-200 employees | 9,000 | ₹2,00,000 | ₹1,17,000 | 41% |

**Realistic mix of 10 clients (4 small + 4 mid + 2 large):** ~₹8.8L/month revenue, ~₹3.4L/month net profit after fixed infra costs (~₹16,500/month) → roughly **₹1 Cr ARR**, achievable on a realistic 9-10 month ramp.

**Pricing framing for sales conversations:** never quote a price list cold. Ask about their current support team size and salary cost first, then frame the offer as "we replace 60-70% of that cost" rather than as an abstract subscription fee.

**Upsell levers beyond base plan:** one-time setup fee (₹15-25K), extra call packs beyond plan limit, WhatsApp-channel agent add-on, outbound campaign add-on, premium analytics, custom voice clone.

---

## 10. Sales & Go-To-Market

### What actually closes deals (ranked by effectiveness)

1. **Live demo on the prospect's own data** — scrape their FAQ before the meeting, build a quick RAG on it, let them call and test it live during the meeting. Single highest-converting move.
2. **Risk reversal offer** — free 2-week pilot, zero payment, cancel anytime, no commitment.
3. **The math conversation** — reframe as cost savings vs their current support team salary, not as "buying AI."
4. **Case study with real recordings** — once Zayka (or first client) has run for 2 weeks, play actual call recordings in sales meetings.

### First-client targeting profile

15-50 employees, 30-150 support calls/day, 2-4 person support team, founder under 35 (decides directly, no procurement), Bangalore/Delhi/Mumbai, seed-funded (has budget, moves fast), EdTech/D2C/quick-commerce.

### Where to find them

In-person: HSR Layout startup offices (walk-in, same approach used for Zayka restaurant outreach), coworking spaces (91springboard, WeWork). Online: LinkedIn DMs to founders, Twitter/X replies on support-cost complaints, founder WhatsApp groups. Warm intros: existing network, current course-sales contacts, Zayka's restaurant client network.

### Build-in-public content strategy (parallel to outreach, not instead of it)

Post real building/selling progress on X — wins, failures, technical breakdowns, India-specific insights, contrarian takes. Don't wait for an audience before selling; do direct outreach simultaneously. Lead post idea: *"Built an AI voice agent for a restaurant in HSR Layout — handles X calls/day automatically. Here's how."*

---

## 11. Full Future Roadmap (Post-MVP, Roughly Sequenced)

### Phase 2 — Function calling / live data integration
Build manually for the first 1-2 clients who need it (e.g. a D2C brand needing order lookup); generalize into a self-serve dashboard "Integrations" page only once the pattern is clear from real implementations.

### Phase 3 — English language support
Layer on top of the same platform once Hindi is proven and 5+ clients are live. Requires the pre-rendering/audio-caching strategy to keep ElevenLabs costs viable (60-70% of common phrases pre-recorded, only dynamic content hits live TTS).

### Phase 4 — Outbound calling agent
Built on the same call infrastructure, but needs a meaningfully smarter agent brain — a conversation state machine handling objection trees (price, trust, timing, competitor objections) rather than SOP lookup. Monetized per-qualified-lead (₹250-500/lead for Hindi, ₹500-800 for English) rather than flat subscription, since it's revenue-generating for the client rather than cost-saving.

### Phase 5 — WhatsApp channel agent
Same RAG/knowledge base, different channel — upsell add-on (~₹10,000/month) for clients already on the platform. Also a hedge against the long-term risk of voice support shrinking in favor of WhatsApp-based support in India.

### Phase 6 — Full automated billing
Razorpay Subscriptions with webhook handling, usage metering with automatic overage billing, GST invoice automation, dunning (failed payment retry logic) — build only once manually managing 15+ clients becomes the bottleneck.

### Phase 7 — Multi-server scaling
AWS load balancer + multiple call-server instances — build only once consistently seeing 80+ concurrent calls.

### Longer-term differentiation / moat
- Vertical-specific RAG templates built from accumulated real call data across clients (e.g., "here are the 50 most common questions in EdTech support, we already know how to answer them" — used as a sales accelerant for new clients in an already-served vertical).
- A growing proprietary dataset of real Indian customer-support conversations across verticals — useful for future fine-tuning and as a structural moat global competitors (Bland.ai etc.) cannot replicate without India-specific data and distribution.

---

## 12. Key Risks To Watch

- **Sarvam AI going downmarket/self-serve** — they have the best Hindi tech and funding; if they launch a self-serve SMB product, this is the single biggest competitive threat.
- **Exotel bundling AI features** for their existing 6000+ business customers — distribution risk since many target clients may already be Exotel customers.
- **WhatsApp-based AI support from Meta** shrinking the voice-support category over time in India — hedge via Phase 5 (WhatsApp channel) rather than ignoring it.
- **Another technical founder building the same thing** — the RFS/idea is publicly discoverable (YC Summer 2026 RFS, "AI-Native Service Companies"); speed of execution and distribution matter more than the idea itself.
- **AI-sounding voice causing hang-ups in the first 10 seconds** — this is the single highest-leverage quality bar; disproportionate effort should go into polishing the opening line and first 10 seconds of every call type before anything else.

---

## 13. Immediate Next Actions (As Of This Plan)

1. Set up Exotel, Deepgram, Sarvam AI, Groq, and Twilio (WhatsApp sandbox) accounts — all have sufficient free tiers for MVP testing.
2. Build the Zayka validation MVP first (single hardcoded campaign, ~20-30 real restaurant leads, Hindi/Hinglish outbound pitch) to get real call data and a case study before approaching any external client.
3. Open a business current account.
4. Build Week 1-6 MVP per the module plan above, in order — do not skip ahead to billing automation or function-calling integrations before the core RAG-based inbound product is working and sold to at least 2-3 real clients.
