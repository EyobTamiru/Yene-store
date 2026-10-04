# Yene AI Support

24/7 AI customer support for **Yene-Store** â€” for customers, business owners,
employees and platform users. Built by Yene Business Group.

The defining constraint of this project is a negative one: **the assistant must
never invent information.** Everything below exists to make that guarantee
mechanical rather than a matter of hope.

---

## Quick start

```bash
npm install
cp .env.example .env      # then add GEMINI_API_KEY
npm run dev               # http://localhost:3000
```

```bash
npm run lint              # tsc --noEmit
npm run build             # production build
npm test                  # all 9 verification suites (no API key needed)
```

---

## How "it never invents" actually works

There are four independent layers. The prompt is only the first one, and the
weakest, because a prompt is a request rather than a control.

### 1. Article status gate â€” the knowledge base itself

Every article is a markdown file in `knowledge-base/`, and is either:

| status | meaning | assistant behaviour |
| --- | --- | --- |
| `approved` | reviewed official content | may answer from it |
| `draft` | topic exists, wording not supplied yet | may **only** route; never quoted as fact |

**Only `approved` articles are ever passed to the model as source material.**
A `draft` is used purely to recognise *"this is a real Yene-Store topic"*.

There are currently **19 approved** articles covering the company overview, all
nine feature areas, the four packages, the pricing and custom-ERP policies and
the support procedures, and **3 drafts** (account management, billing,
troubleshooting) that are still placeholders. Those three are the only topics
the assistant will refuse; the rest are answered from reviewed content.

### 2. Deterministic refusal â€” no model call at all

If the best-matching article for a question is a `draft`, the server **does not
call the model**. It returns the standard "I don't have that information" reply
immediately.

This layer exists because of a real bug caught by the test suite: *"how do
promotions work"* still matched the generic escalation article (they all contain
the words "support" and "help"). Left alone, the model would have seen a source,
decided the question was answerable, and drifted into inventing promotion rules.
An undocumented topic now can never borrow credibility from an unrelated
article.

### 3. Citation validation â€” the model's own claim is checked

The model must return JSON (`api/support/ai.ts`). Its reply is shown only when
**all** of the following hold:

- it parsed as valid JSON, **and**
- it set `grounded: true`, **and**
- every `sourceId` it cited was actually retrieved for *this* question.

A single invented citation rejects the whole answer. This catches the subtle
failure where the model cites a real-looking but non-existent document.

### 4. Leak filter â€” the last line of defence

Replies are scanned for API keys, bearer tokens, bot tokens, `process.env`,
stack traces, `node_modules` paths and raw JSON schemas. A match discards the
reply. A prompt-injection attempt echoed back by the model still cannot put an
API key in front of a customer.

Both layer 3 and layer 4 are covered by `npm run test:guardrails`, which feeds
adversarial model output through the real enforcement code. It needs no API key,
so it can run in CI on every commit.

---

## Never exposing internals

- The Gemini key is read **only** in `server.ts` / `api/support/*`. It is
  deliberately **not** injected into the client bundle via Vite `define`, the way
  the Yene Business Group marketing site does it â€” this bot can read account
  data, so the key must never reach the browser.
- `answerSupportQuestion` is written not to throw. Any internal failure becomes
  the approved copy: *"Yene AI Support is temporarily unavailable. You can still
  contact a Yene Business Group support agent."*
- The client (`src/lib/supportApi.ts`) converts every failure into one generic
  error. Status codes and stack traces go to `console.error`, never to the DOM.
- React escapes all message text, so a reply containing HTML renders as text.

---

## Account access and tenant isolation

> `businessId` is read **only** from the verified token. It is never taken from
> the request body, a query string, or a browser-settable header.

`api/support/auth.ts` is the single security boundary. `api/support/account.ts`
has no `businessId` parameter at all â€” its only input is the verified identity,
so a caller cannot ask for another tenant's data. The model only ever receives
plain sentences from `facts[]`, never raw account objects, so unrelated fields
cannot leak into an answer by accident. Anything unreadable is reported as
absent, never guessed.

**Guests** get general Yene-Store answers; account-specific questions prompt
them to sign in or offer a human agent.

### Wiring up real authentication

Two clearly marked integration points, both failing safe:

| file | what to add |
| --- | --- |
| `api/support/auth.ts` | replace the `return guestIdentity()` block in the production section with real token verification, taking `businessId` from the signed claim |
| `api/support/account.ts` | implement `loadAccountFromPlatform(businessId)` against your account/orders/subscriptions service |

Until then every production request resolves to a guest, so the bot answers
general questions and offers human support rather than risking a data leak.

`AUTH_MODE=development` enables fake identities for local testing
(`dev:green-coffee`, `dev:staff-member`, `dev:shopper`). It is hard-disabled when
`NODE_ENV=production`.

---

## Human handoff and escalation

**Contact Yene Business Group Support Agent** is a permanent button in the chat
and one of the quick actions. Selecting it shows the required explanation and
opens the ticket form.

### When the assistant offers a human

The eleven escalation conditions are implemented as **deterministic rules** in
`api/support/escalation.ts`, not left to the model â€” a prompt is a request, not
a control. Each rule maps 1:1 to a condition in the specification:

| condition | reason code | priority |
| --- | --- | --- |
| does not know the answer | `unknown-answer` | normal |
| customer requests a human | `customer-requested-human` | normal |
| account security | `account-security` | **urgent** |
| payment dispute | `payment-dispute` | **high** |
| manual account change (signed in only) | `manual-account-change` | normal |
| technical investigation | `technical-investigation` | normal |
| custom development | `custom-development` | normal |
| complaint | `complaint` | **high** |
| quotation request | `quotation-request` | normal |
| AI failed to resolve | `unresolved` | normal |
| repeatedly unresolved | `repeatedly-unresolved` | normal |

**Account security and payment disputes suppress the automated answer
entirely.** The assistant says it will not work through it in chat and hands
over. Trying to troubleshoot a suspected account compromise in a chat window is
the wrong behaviour, and a grounded answer must not be allowed to delay that.

Escalation is evaluated in two passes:

1. **Before retrieval**, so a security or payment message can never be swallowed
   by the "topic is undocumented" early return.
2. **After the answer**, because "does not know the answer" can only be judged
   once it is known whether the reply was grounded. A *grounded* reply that the
   customer says did not help still escalates.

### Tickets

`POST /api/support/handoff` opens a ticket with all the required fields: ticket
id, customer, business, user id, package, subject, description, category,
priority, status, assigned agent, created/updated dates, conversation id and the
AI summary. Statuses are `Open`, `In Progress`, `Waiting for Customer`,
`Waiting for Internal Team`, `Resolved`, `Closed`, with illegal transitions
rejected (`Closed â†’ In Progress` is refused).

### The AI handover summary

The internal brief contains the six required sections: the customer's problem,
what they are trying to accomplish, relevant account information, what the
assistant already tried, the relevant messages, and a suggested next
investigation.

**It is assembled deterministically** from the transcript, the verified
identity, the account facts and the articles that were cited. The model never
writes it. That is a deliberate safety property, not a shortcut: no chain of
thought, deliberation or confidence commentary can reach a ticket, because none
of it is ever available to the builder. A test asserts the summary contains
none of those phrases.

### Customer never repeats themselves

The full conversation is attached to the ticket and forwarded to the team, so
the agent picks it up cold. The ticket id is shown to the customer afterwards.

A transcript or ticket is readable **only** by the identity that created it.
Guests can open a ticket and are given its id, but cannot read one back â€” every
guest shares the same identity, so allowing guest reads would expose one
guest's ticket to another.

---

## Interface

| viewport | behaviour |
| --- | --- |
| Desktop | floating launcher, docked 23.5rem panel above it |
| Tablet | responsive docked panel |
| Mobile | full-screen panel with tap-to-dismiss backdrop |

Plus a full support page at `#/support`. All three share one `ChatPanel`.

Design tokens in `src/index.css` follow the spec exactly: `#0D1117` background,
`#3DDC97` accent, light text, rounded cards. `prefers-reduced-motion` is
respected, the message log is `aria-live`, and Escape closes the panel.

---

## Seamless handoff: AI <-> human

A conversation is in one of two modes, and the current one is always visible in
the chat header: **AI Support** or **Human Support**. A **Talk to a Human** button
sits permanently in the chat.

### What happens on handoff

1. The ticket is created, or located if one already exists.
2. The whole AI conversation is copied into the thread.
3. The factual AI summary is generated and attached to the ticket.
4. The customer is placed in the support queue.
5. Every agent is notified.
6. An available agent is connected, if there is one.
7. The conversation continues with the full history intact.

### When no agent is available

The customer sees, verbatim:

> All support agents are currently unavailable. Your request has been saved as a
> support ticket. We'll respond as soon as an agent is available.

Alongside their **ticket number**, the **current status**, and â€” **only if the
team has configured it** â€” the support hours. `SUPPORT_HOURS` is read from the
environment; when unset the line is simply omitted.

**No response time is ever invented.** A test asserts the message contains no
"within", "minutes", "hours", "ASAP" or similar. "As soon as an agent is
available" is the specification's own wording and defers to reality rather than
promising a duration.

### Returning to AI

After an agent resolves the issue the customer can go back to AI Support. The
assistant is told **that** a ticket exists and nothing else â€” an id and a single
factual sentence. Internal notes, the AI summary and internal events live on the
ticket and are **never copied into a thread**, so there is nothing for the AI to
accidentally reveal. A test asserts the thread record contains none of them.

### Real-time: push, with polling as the fallback

There is no WebSocket infrastructure here, and adding a dependency for a text
conversation was not worth it, so the push transport is **Server-Sent Events** â€”
built into Express and Node, no dependency, auto-reconnecting.

| capability | how it works |
| --- | --- |
| agent online status | heartbeat with a 45s TTL; lapsed = offline |
| typing indicator | pushed to the conversation topic |
| new messages | pushed on post |
| read status | per-message read flags, shown to the sender |
| agent notifications | published to `staff:inbox` |

`GET /stream` (SSE) and `GET /poll` expose the **same state**. The client prefers
SSE and silently falls back to polling if the stream is blocked or drops, so the
chat degrades instead of breaking. Polling is incremental (`?since=`) and backs
off from 2s to 15s when idle. The UI shows which transport is active.

Verified live: an agent posting while a customer's stream was open delivered
`snapshot`, `typing` and `message` frames over `text/event-stream`.

### A bug worth knowing about

The SSE routes originally wrote the snapshot frame *before* calling
`subscribe()`. Writing to a response before its headers are sent makes Node send
them implicitly, so the explicit `writeHead` inside `subscribe()` threw and **the
subscriber was never registered** â€” every later publish was silently dropped.
The stream looked healthy (200, a snapshot arrived) but nothing was ever pushed.

`subscribe()` now takes the initial frame itself, so headers are always sent
first. It is the only correct ordering, and the comment in `hub.ts` says so.

### Access control

A thread belongs to exactly one customer identity, re-derived from the verified
token on every route. No route accepts a customer id. Another user gets `404`
rather than `403`, so the existence of someone else's conversation is not
confirmed. Agents see the queue plus their own threads; the staff API rejects
business tokens with `403`.

### Presence is honest

An agent is available only if their heartbeat is fresh **and** they are below
`MAX_THREADS_PER_AGENT`. When nobody qualifies, the system says nobody is
available rather than inventing a wait.

---

## Customer Support dashboard

A dedicated section for Yene Business Group support staff, at `/#/support-admin`
and `GET /api/support-admin/*`.

### Staff are a separate population from business users

The most important rule: **a business or customer token is never support
staff.** Support staff authenticate through `resolveSupportStaff`, which returns
`null` for anything that is not staff. There is deliberately no "promote a
customer token" path, so signing in as a business owner cannot reach
platform-wide tickets. Verified: `dev:green-coffee`, `dev:shopper` and even a
knowledge-base admin token all receive `403`; no token receives `401`.

### Roles

| | Support Agent | Senior Support Agent | Support Manager | Super Admin |
| --- | :-: | :-: | :-: | :-: |
| See dashboard | | âœ“ | âœ“ | âœ“ |
| See **all** tickets | | | âœ“ | âœ“ |
| Reply / request info | âœ“ | âœ“ | âœ“ | âœ“ |
| Add internal note | âœ“ | âœ“ | âœ“ | âœ“ |
| **Read** internal notes | | âœ“ | âœ“ | âœ“ |
| Change status | âœ“ | âœ“ | âœ“ | âœ“ |
| Attach files | âœ“ | âœ“ | âœ“ | âœ“ |
| Change priority | | âœ“ | âœ“ | âœ“ |
| Resolve | | âœ“ | âœ“ | âœ“ |
| Reopen | | | âœ“ | âœ“ |
| Assign tickets | | | âœ“ | âœ“ |
| **View customer phone** | | âœ“ | âœ“ | âœ“ |

Two capabilities are withheld from the base agent role deliberately: seeing
other agents' conversations, and seeing customer phone numbers.

### Visibility is scoped first

`visibleTickets()` filters by the viewer **before** any search, filter, sort
or pagination runs. A support agent sees only tickets assigned to them - a
missing or malformed filter can never widen that. Attempting to open someone
else's ticket directly returns `403`.

### Internal notes never reach customers

`ticketForCustomer()` strips internal notes, the AI summary, attachments, the
assigned agent and the customer phone number in **one place**, so no endpoint
can leak them by forgetting to filter. The customer API returns only: id,
subject, description, category, priority, status, dates, their own messages and
non-internal events. `npm run test:permissions` asserts each of those.

### Dashboard and list

Metrics: open, active chats, unassigned, high priority, waiting for customer,
resolved today, average response time and average resolution time. The list
supports search, status/priority/assignee filters, sorting on six columns and
pagination.

### Actions

Reply, assign, change priority, change status, add an internal note, request
information, attach a file, resolve and reopen - each gated on its own
capability server-side, so permissions hold regardless of the UI.

### Durability

Tickets are persisted to `data/support-tickets.json` with atomic writes, so the
dashboard survives a restart. That file holds real customer conversations and is
git-ignored. It is a **single-writer** store: replace it with a real database
before running more than one instance.

---

## Knowledge base management

Content is **data, not code**. `knowledge-base/<category>/<id>.md` holds every
article; `src/knowledge/` holds only the schema, the loader and the search.

### The twenty categories

Platform Â· Account Â· Business Profile Â· Store Â· Products Â· Orders Â· Customers Â·
Inventory Â· Promotions Â· Analytics Â· Packages Â· Billing Â· Subscription Â·
Payments Â· Security Â· Troubleshooting Â· Policies Â· Frequently Asked Questions Â·
Tutorials Â· Contact Information

### Article fields and statuses

Title, category, content, keywords, **language**, status, **version**, created
by/at and updated by/at.

| status | meaning | assistant behaviour |
| --- | --- | --- |
| **Draft** | in progress | recognised so routing works; never quoted as fact |
| **Published** | reviewed official content | the only thing the model may assert |
| **Archived** | superseded | retained for history, never served |

Only `published` articles are ever passed to the model. A test asserts that
retrieval never returns a draft or an archived article.

### Version control

Every save increments the version and records **who changed it, when, and why**.
The history is written **before** the live file is replaced, so a crash mid-save
cannot lose the previous revision â€” and the *outgoing* content is recorded too,
so an article that predates tracking is never silently lost on its first edit.

`GET /knowledge/:id/versions` lists revisions; `POST /â€¦/restore` rolls back. A
restore is itself recorded as a new version, so history stays append-only and a
rollback is always visible.

### AI source priority

Encoded in `api/support/sources.ts` and stated in the system prompt:

1. **Current official knowledge base**
2. **Authenticated platform data**
3. **Approved support documentation**
4. **General AI knowledge** â€” *only for non-platform generic questions*

**Tier 4 is not a safety net for Yene-Store questions.** A test asserts the
prompt block contains the rule. This is enforced twice: the prompt states it,
and `enforceGrounding` discards any reply that cites nothing.

### The admin test console

`POST /api/admin/test` runs the **real customer pipeline** â€” same code, same
retrieval, same grounding rules â€” and returns the answer, the knowledge sources
used, and a coverage indicator.

The coverage indicator is **deterministic**, computed from retrieval and
grounding facts, not from the model's opinion of its own confidence. Asked how
sure it is, a model always says it is sure, which is useless as a release gate.

| level | meaning |
| --- | --- |
| `ready` | 2+ published sources reached it |
| `review` | exactly 1 â€” thin, probably worth widening the keywords |
| `not-covered` | 0 published sources; the assistant will refuse |

Coverage measures **knowledge, not model availability** â€” when the AI backend is
down it says so explicitly rather than pretending the content is missing.

No model reasoning is returned. The console shows the customer-facing answer, the
article ids cited with their tier, and measurable facts. A test asserts the
response contains no reasoning markers.

Verified: *"What package includes custom inventory?"* â†’ **ready**, 4 published
sources, top match **Platinum package** at tier `official-kb`.

---

## Editing the knowledge base

The knowledge base is **data, not code**. No business information is hard-coded
into the AI logic, so Yene Business Group can update features, packages, prices,
policies, FAQs, tutorials, troubleshooting instructions, contact information and
support procedures without a developer.

### Option 1 â€” edit the markdown files

Each article is `knowledge-base/<category>/<id>.md` with a small frontmatter
block and a markdown body. Copy `knowledge-base/_TEMPLATE.md` for the format
and the house rules. Files and folders starting with `_` are ignored.

Two rules are enforced by the loader, not by convention:

- the filename must be exactly `<id>.md`
- an article marked `approved` may not contain a `TODO` placeholder

A file that fails validation is **skipped and reported**, never served â€” one bad
edit costs one article, not the whole assistant. Check `GET /api/admin/knowledge`
or run `npm test` to see the issues.

### Option 2 â€” the admin API

Set `YENE_KB_ADMIN_TOKEN`, then:

| method | route | purpose |
| --- | --- | --- |
| `GET` | `/api/admin/knowledge` | list articles + validation issues |
| `GET` | `/api/admin/knowledge/:id` | read one article |
| `PUT` | `/api/admin/knowledge/:id` | create or replace an article |
| `GET` | `/api/admin/schema` | valid categories / statuses / audiences |
| `POST` | `/api/admin/preview` | what will be retrieved for this question? |

Every route requires `Authorization: Bearer $YENE_KB_ADMIN_TOKEN`, compared
timing-safely, and throttled to 10 attempts/minute per client. **It fails
closed**: with no token configured, nobody is an admin. Writes are atomic
(temp file + rename) and the index reloads immediately, so a change takes effect
on the next question with no redeploy.

### Option 3 â€” the admin page

Open `/#/admin`, paste the token, and edit in the browser. The **Test** box runs
retrieval only (no Gemini key, no tokens spent) and tells you whether the
assistant will answer or refuse, and from which articles. Use it to tune
`keywords` when a question is not finding the right article.

### Writing rules that protect the "never invents" guarantee

1. Write only what is officially true. If you would not print it in a manual
   signed off by Yene Business Group, do not approve it.
2. **Never write a price** unless it is the officially published figure. Super is
   custom-priced - see `packages/packages-pricing-and-quotation`.
3. Use the **real UI labels** in step-by-step instructions.
4. Write `keywords` as the words a customer would actually type, including
   synonyms. Retrieval is keyword based.
5. Mark `requiresAccountData: true` for anything describing a live value (price,
   order state, stock) - those must come from the account API.
6. For custom ERP work, use the fixed wording in `policy/policy-custom-erp.md`.

`npm test` enforces the important ones automatically: it fails if an approved
article contains a TODO, if any article states a monetary amount, or if the
approved ERP wording is altered.

---

## API

| method | route | purpose |
| --- | --- | --- |
| `POST` | `/api/support/chat` | ask a question; returns reply, sources, `needsHuman`, `escalation` |
| `POST` | `/api/support/handoff` | open a support ticket with the transcript and AI summary |
| `GET` | `/api/support/ticket/:id` | the caller's own ticket |
| `GET` | `/api/support/tickets` | the caller's own requests (component 8) |
| `PATCH` | `/api/support/ticket/:id` | change ticket status |
| `GET` | `/api/support/survey` | is the resolution survey due? (server decides) |
| `POST` | `/api/support/feedback` | record "was your issue resolved?" + rating + comment |
| `GET` | `/api/support/health` | `aiConfigured` + knowledge base counts + issues |

All inputs are re-validated server-side; the browser is never trusted. Chat
routes are rate limited to 20 requests/minute per client.

### Live chat (customer)

| method | route | purpose |
| --- | --- | --- |
| `POST` | `/api/live/handoff` | "Talk to a Human": create/locate ticket, queue, connect |
| `GET` | `/api/live/:id` | current thread state |
| `GET` | `/api/live/:id/stream` | SSE: messages, typing, thread changes |
| `GET` | `/api/live/:id/poll` | same state on an interval (fallback) |
| `POST` | `/api/live/:id/messages` | send a message |
| `POST` | `/api/live/:id/read` | read receipts |
| `POST` | `/api/live/:id/return-to-ai` | switch back to AI Support |

### Live chat (support staff only)

| method | route | purpose |
| --- | --- | --- |
| `POST` | `/api/live-staff/presence` | heartbeat / go offline |
| `GET` | `/api/live-staff/presence` | who is online |
| `GET` | `/api/live-staff/inbox` | queue + my conversations |
| `GET` | `/api/live-staff/inbox/stream` | SSE: new work and presence |
| `POST` | `/api/live-staff/threads/:id/claim` | take a conversation |
| `GET` | `/api/live-staff/threads/:id` | one conversation |
| `GET` | `/api/live-staff/threads/:id/stream` | SSE for one conversation |
| `POST` | `/api/live-staff/threads/:id/messages` | reply |
| `POST` | `/api/live-staff/threads/:id/typing` | typing indicator |
| `POST` | `/api/live-staff/threads/:id/read` | read receipts |
| `POST` | `/api/live-staff/threads/:id/resolve` | resolve the chat and its ticket |

### Support dashboard (support staff only)

| method | route | purpose |
| --- | --- | --- |
| `GET` | `/api/support-admin/whoami` | current staff member and capabilities |
| `GET` | `/api/support-admin/meta` | filter options, assignable staff |
| `GET` | `/api/support-admin/dashboard` | the eight headline metrics |
| `GET` | `/api/support-admin/tickets` | search / filter / sort / paginate |
| `GET` | `/api/support-admin/tickets/:id` | full ticket detail |
| `POST` | `/api/support-admin/tickets/:id/reply` | reply to the customer |
| `POST` | `/api/support-admin/tickets/:id/note` | add an internal note |
| `POST` | `/api/support-admin/tickets/:id/assign` | assign (managers) |
| `PATCH` | `/api/support-admin/tickets/:id/priority` | change priority |
| `PATCH` | `/api/support-admin/tickets/:id/status` | change status |
| `POST` | `/api/support-admin/tickets/:id/request-info` | ask the customer |
| `POST` | `/api/support-admin/tickets/:id/attachments` | attach a file |
| `POST` | `/api/support-admin/tickets/:id/resolve` | resolve |
| `POST` | `/api/support-admin/tickets/:id/reopen` | reopen |

### Support analytics (`analytics.view` â€” managers and admins only)

| method | route | purpose |
| --- | --- | --- |
| `GET` | `/api/support-admin/analytics?days=30` | the whole Section 7 report (`0` = all time) |
| `GET` | `/api/support-admin/analytics/gaps?days=30` | the knowledge-gap list on its own |
| `POST` | `/api/support-admin/analytics/gaps` | record a gap decision (`knowledge-gap.manage`) |

### Audit log (`audit.view` â€” managers and admins only)

| method | route | purpose |
| --- | --- | --- |
| `GET` | `/api/support-admin/audit` | the log, filterable by action/actor/target/business |
| `GET` | `/api/support-admin/audit/integrity` | recompute the hash chain; reports the first break |

---

## Project layout

```
knowledge-base/          <-- THE CONTENT. Yene administrators edit this.
  _TEMPLATE.md
  company/               overview
  features/              profile, subdomain, store, promotions, orders,
                         customers, inventory, analytics, business management
  packages/              basic, standard, platinum, super, pricing policy
  policy/                custom ERP wording rules
  support/               contact, AI scope, human handoff
  troubleshooting/       common issues (draft)

api/
  admin/knowledge.ts      knowledge base admin API, token-gated
  support-admin/router.ts  support dashboard API, staff-gated
  live/router.ts          live chat, customer side
  live-staff/router.ts    live chat, agent side
  lib/jsonCollection.ts   shared atomic JSON store
  support/
    router.ts             customer chat, handoff, ticket status
    ai.ts                 Gemini call, grounding enforcement, leak filter
    escalation.ts         the 11 escalation conditions, deterministic
    intents.ts            intent -> goal, next steps, labels
    summary.ts            AI handover brief (never model-written)
    ticketStore.ts        durable ticket store
    tickets.ts            sessions, customer-safe ticket view, Telegram
    chatStore.ts          durable live chat threads
    presence.ts           agent presence (heartbeat + TTL)
    hub.ts                SSE pub/sub
    roles.ts              support staff identity + permission matrix
    dashboard.ts          metrics and the searchable ticket list
    analyticsStore.ts     conversation, satisfaction and gap records
    analytics.ts          all Section 7 aggregation
    satisfaction.ts       the resolution-survey rules
    privacy.ts            redaction and the no-identity contract
    tenant.ts             business-scoped data isolation
    auditLog.ts           the Section 8 audit log (hash-chained)
    actions.ts            AI action gate: read-only + approvals
    internal.ts           the internal-information guard
    auth.ts               business identity  <- tenant isolation boundary
    account.ts            account context adapter
    prompts.ts            system instruction
src/
  knowledge/              types.ts, repository.ts, retrieval.ts
  components/admin/       KnowledgeAdminPage, SupportDashboardPage,
                          SupportAnalyticsPage, TicketDetailPanel
  components/support/     widget, panel, page, messages, handoff sheet,
                          LiveChatView, ResolutionSurvey, SupportHistory
  lib/                    supportApi, liveApi, supportAdminApi,
                          supportAnalyticsApi, adminApi,
                          useSupportConversation, useLiveChat
  constants.ts            user-facing copy, shared by client and server
scripts/                  verification suites
```

---

## Support analytics (Section 7)

`GET /api/support-admin/analytics?days=30` returns the whole report. The UI is
`#/analytics`. Everything is computed in `api/support/analytics.ts` from the
conversation, ticket and feedback stores.

### AI metrics

Total conversations, AI-resolved, human escalations, unresolved, average
conversation length, knowledge articles used, escalation rate, plus the
frequently asked questions and the most common problems.

Three definitions are judgement calls, so they are stated rather than left to
be inferred from the numbers:

- **AI-resolved is per conversation, not per reply.** A conversation counts
  when the assistant produced at least one grounded answer *and* it was never
  escalated. A conversation the AI half-answered before a human finished is an
  escalation, not a success.
- **An offer is not an escalation.** The assistant offers a human on every
  ungrounded answer and most customers do not take it up. Counting offers
  would report an escalation rate near 100% for a perfectly healthy assistant.
  `humanOffered` is therefore reported separately from `humanEscalations`.
- **No denominator, no percentage.** A rate is `null` - rendered `-` - when it
  cannot be computed. An escalation rate of 0% on a day with no conversations
  is a false claim that the AI is performing perfectly.

### Human support metrics

Read from the real ticket store: created, resolved, open, reopened, average
first response, average resolution, and breakdowns by category, package and
business. A reopen is detected from the `reopened` **event**, not a status
comparison, so a resolve/reopen/resolve ticket is counted once. A timestamp
earlier than its origin is excluded rather than allowed to drag an average
negative.

### Customer satisfaction

After resolution the customer is asked **"Was your issue resolved?"** with
**Yes / Partially / No**, plus an optional rating and optional feedback.

Whether to ask is decided on the server, by rule, and only for the caller's own
conversation. Two deterministic triggers, because "after resolution" has two
honest meanings here: a human marked the ticket Resolved/Closed, **or** the
customer signed off ("thanks, that worked"). Without the second, an
AI-resolved conversation could never be measured at all - and the AI
resolution rate is the most important figure in the report. It is asked
**once**.

An absent rating or comment is a complete answer, not a validation failure. A
rating that *is* present must be a whole number 1-5; it is refused rather than
clamped, because a silently clamped 0 would drag the average down.

### Knowledge gaps

Unanswered questions are grouped by a fingerprint of their meaning - the same
tokenizer the retriever uses, so "how do I connect my facebook page" and
"how do I connect a Facebook page please" are one gap, not two. Each gap
proposes a category, an article id and any related existing articles, so the
list is actionable rather than a list of raw questions.

**A deliberate refusal is not a gap.** Account security and payment disputes
suppress the automated answer *by specification*. Counting them would tell an
administrator to write articles explaining how to handle a suspected account
compromise - actively the wrong instruction. They are excluded, and the count
of exclusions is published in `privacy.deliberateRefusals` so the exclusion is
visible rather than a silent hole.

An administrator can mark a gap **planned**, **published** or **dismissed**
with a note, and the decision is remembered.

### Privacy

The specification requires analytics *and* requires that sensitive customer
information never reaches them. That tension is resolved in
`api/support/privacy.ts`, in one place:

1. **No identity is stored.** Conversation records carry no customer name,
   email, phone number, user id or business id - not hashed, not tokenised,
   absent. A record cannot leak what it does not hold.
2. **Customer text is redacted before it is written.** Questions and comments
   routinely contain an address the customer pasted in. Redaction happens on
   the way *in*, which is stronger than filtering on the way out: a later
   reporting bug then has nothing to leak.

Business names are retained, because "tickets by business" is required and a
business is a counterparty, not an individual.

`FORBIDDEN_ANALYTICS_KEYS` and `findForbiddenKeys` exist so the verification
suite asserts against the same list the implementation is written from - a new
identifier added to the ticket store is a failing test, not a silent leak.

### Authorization

`analytics.view` and `knowledge-gap.manage` are held by **support managers and
super admins only**. A support agent already has the per-ticket view it needs;
the report is platform-wide by definition, so it is restricted to authorized
administrators. The check is in the route, not the UI - a hidden button is not
an authorization control.

---

## Security and data protection (Section 8)

`npm run test:security` â€” 148 checks.

### What already existed, and what did not

Auditing the codebase against Section 8 first was worth doing. Four
requirements were already met (role-based access in `roles.ts`, server-side
enforcement in the routes, the AI escalation failure mode, and the secrets leak
filter). Two were genuinely missing, and one was only half met:

| requirement | before | now |
| --- | --- | --- |
| Data isolation | **user**-scoped, not business-scoped | business-scoped |
| Role-based access | existed | unchanged, plus `audit.view` |
| Customer data minimisation | whole account loaded per question | scoped to the question |
| Internal information | secrets only | six categories, one guard |
| **Audit log** | **did not exist** | hash-chained, queryable |
| AI actions | no action layer at all | read-only gate + approvals |
| Failure mode | existed | unchanged, reused by the gate |

### Data isolation

The previous checks compared `ticket.userId` and `thread.customerUserId` to
`identity.userId`. That is a **user** check, and it is not the guarantee the
specification asks for, which is per **business**:

- an employee and the owner of the same business are different users, so a
  business could not see its own team's tickets;
- nothing tied a record to a business, so "is this record mine?" could only be
  answered per person.

`api/support/tenant.ts` adds `businessId` as a first-class field on the ticket
and states the rule once: a caller may reach a record when it belongs to their
business, **or** when they are the individual who created it and it is not
tenant-scoped. There is no third case, and no "unless flagged" escape hatch.

Two details that matter more than they look:

- **`businessId`, never `businessName`.** A business can rename itself; the
  isolation key must not be a display label.
- **Refusals are indistinguishable.** Reading another tenant's ticket returns
  *not found*, not *forbidden* â€” confirming an id is real is itself a leak.

### Audit log

`api/support/auditLog.ts` records exactly the actions the specification lists:
ticket created, assigned, updated, agent response, resolved, reopened, knowledge
article changed, permission changed. Denials are recorded too â€” a permission
refusal is precisely the thing an operator needs to see.

**It never records payloads, tokens, request bodies, note text or conversation
content.** A log that stored the payloads would become a second copy of the
data it exists to protect. Details are capped and passed through the same
redactor the analytics use.

Each entry stores `sha256(previousHash + fields)`, so editing *or removing* an
entry invalidates every hash after it. `verifyChain()` reports the index of the
first break, and `GET /api/support-admin/audit/integrity` exposes it.

**What this is not:** a control against an attacker who already has write access
to the data directory â€” they could recompute the whole chain. It is a control
against the likelier cases: an operator editing history by hand, or a bug
corrupting a record. Tamper resistance against a host-level attacker needs an
append-only external sink.

### AI actions are read-only

`api/support/actions.ts` treats the seven sensitive domains (account, billing,
subscription, orders, inventory, users, permissions) as default-deny. A write
is refused unless **all** of: the operator enabled writes, the exact scope is
allow-listed, and a human approved *this* action.

This is code rather than a prompt rule for the same reason everything else here
is: **a prompt is a request, not a control.** Telling a model "do not change the
customer's billing" is a request; this runs before anything is dispatched.

Approvals are **single-use** and expire. An approval for a refund does not
authorise a cancellation, and cannot be replayed.

### Failure mode

`fallbackFor()` returns `human-support` for every refusal. There is no "try
anyway" path, and the customer-facing message never explains the configuration â€”
only that a human can help.

### Internal information

`api/support/internal.ts` owns six categories: credentials, system prompts,
internal material, security configuration, administrator information, and other
customers' data. It is called from the existing `containsLeak` filter, so there
is one answer to "could this reach a customer?".

**Deliberate limitation:** a pattern list catches disclosure that *looks* like
internal content. It cannot catch a model that paraphrases a secret convincingly,
because the text no longer contains the pattern. The strongest control remains
upstream â€” internal material is never placed where the model can read it. This
is the backstop, not the wall.

---

## Final integration (Section 9)

`npm run test:integration` â€” 67 checks that walk the customer journey end to end.

### What was actually missing

Eleven of the twelve components already existed. Auditing them first was worth
the time, because the one genuine gap was the step that makes the *rest* of the
journey meaningful:

**Customer Support History did not exist.** A customer could open a request and
read it back by id, but had no way to *list* their requests. So
"Customer receives resolution â†’ Customer can provide feedback" was
unreachable: nothing showed them the resolution, and a ticket id they had not
written down was lost. `GET /api/support/tickets` and the **My requests** view
close it.

It is scoped by `tenantTickets`, the same business-scoped boundary every other
read path uses, and passes through `ticketForCustomer` â€” so the history carries
no internal notes, no AI summary, no attachments and no phone number. There is
no query parameter that can widen it to another business.

### The journey, verified in order

| step | verified by |
| --- | --- |
| AI answers from the knowledge base | grounded turn recorded, no ticket created |
| cannot answer â†’ escalate | `unknown-answer` fires, ticket created, bound to the business |
| conversation + summary transfer | the six brief sections, no chain of thought |
| agent receives, responds, resolves | events, first-response and resolution stamps |
| customer sees the resolution | `ticketForCustomer` shows the status and reply |
| **customer sees all their requests** | component 8, business-scoped |
| customer gives feedback | survey, once, owner-only |
| isolation holds throughout | cross-tenant reads refused in every step |

### Responsive design, not a stretched phone

Each breakpoint gets a different layout rather than one layout that grows:

| screen | customer support | agent dashboard |
| --- | --- | --- |
| phone | tabs; one pane full width | one ticket per card |
| tablet | two cards across | one ticket per card |
| laptop | chat beside request list | full table, two-pane detail |
| desktop | wider detail column | wider detail column |
| large monitor | capped and centred (`2xl`) | capped and centred (`2xl`) |

The agent table was the weak point: **nine columns cannot be read on a phone**,
so below `lg` each ticket becomes a card showing the same information. Horizontal
scrolling would have hidden the very data an agent is scanning for.

### The principle, as enforced

**AI â†’ knowledge base â†’ solve â†’ escalate â†’ human â†’ resolve â†’ feedback â†’ improve**

Each arrow is a test rather than a claim. The loop closes on itself: the
satisfaction survey feeds `analytics.ts`, the unanswered questions become
**knowledge gaps**, an administrator writes an article, and the next customer
gets an answer the AI can now give â€” which is the `improve` step, and the only
one in this system that makes the others get better over time.

---

## Known limitations

- **The audit log's tamper evidence is not tamper resistance.** An attacker with
  write access to the data directory can recompute the whole hash chain. It
  catches a hand-edited history or a corrupting bug, not a determined host-level
  attacker. For that, ship entries to an append-only external sink.
- **Action approvals are in memory and expire after 15 minutes.** A restart
  invalidates every outstanding approval. That is deliberate - an approval is
  consent for one action, not a standing permission - but it does mean an
  approval cannot currently survive a deploy.
- **The internal-information guard is pattern-based.** It catches disclosure
  that *looks* like internal content; it cannot catch a confident paraphrase of
  a secret. The primary control is that internal material is never placed where
  the model can read it.
- **Data minimisation is a keyword scope.** A question phrased unusually may
  match no domain and therefore retrieve nothing. That errs toward privacy, but
  it can mean the assistant offers a human for a question it could have answered
  from account data.
- **Legacy tickets carry no `businessId`.** They fall back to the old per-user
  check, so they are neither orphaned nor over-shared - but a business cannot
  see an employee-created legacy ticket until it is next written.

- **Analytics start from the moment this was deployed.** Conversations and
  feedback are recorded going forward; nothing is backfilled from historic
  tickets, so early figures will be thin rather than wrong.
- **Analytics shares the ticket store's durability limits** (see below): a
  single-writer JSON file, and records are capped at 20,000 conversations.
  `YENE_DATA_DIR` relocates the files, which is what the test suite uses to
  avoid polluting real data.



- **No live Gemini call was executed** â€” no `GEMINI_API_KEY` was available in
  this environment. The SDK contract was verified against the installed
  `@google/genai` type definitions and the client compiles, but the first real
  model response has not been observed. Retrieval, validation and every
  guardrail are verified without a key. Set the key and run `npm run dev`.
- **3 knowledge articles are still drafts** â€” account management, billing, and
  troubleshooting. They are recognised as real topics and deliberately refused
  rather than guessed. They need a content owner to write the real steps with
  the real UI labels.
- The knowledge base is read from disk, so admin writes need a filesystem that
  persists (fine on a VM or container with a volume; **not** on a read-only or
  ephemeral serverless filesystem â€” there you would point `KB_ROOT` at a
  database or blob store instead).
- **The ticket and live-chat stores are single-writer JSON files**
  (`data/`). Fine on one instance; replace them with a real database before
  scaling out, or a second instance will see different data. Chat *sessions*
  (ephemeral AI transcripts) are still in memory.
- **Agent presence is in memory by design.** It must not survive a restart; a
  stale "online" from last week is worse than no answer at all.
- **The event hub is in-process.** SSE fan-out does not cross instances. With
  more than one server you need Redis pub/sub (or similar) behind `hub.ts`.
- **Attachments store metadata only.** `storageKey` is a reference for your
  object storage; wire it to S3 or equivalent so the dashboard can fetch the
  file.
- **Support staff authentication is unwired by default.**
  `resolveSupportStaff` returns `null` until you verify real staff tokens, so
  the dashboard is unreachable rather than open. `AUTH_MODE=development`
  provides `staff:agent`, `staff:senior`, `staff:manager`, `staff:admin`.
- **`SUPPORT_HOURS` is optional.** With it unset the support hours line is
  omitted rather than guessed. This is deliberate.
- Retrieval is lexical, not semantic. A user asking "can I get my money back"
  may not match a refund article until "money back" is added to its `keywords`.
  The admin **Test** box makes this easy to spot.

---
---

# YENE-STORE PLATFORM â€” SECTIONS 10 to 55

Everything above is **Sections 1â€“9, Yene AI Support**, and none of it has
been changed. This part continues the master specification from Section 10:
the rented stores, the marketplace, commerce, packages, inventory, CRM/ERP and
the platform that joins them.

Sections 1â€“9 remain the support system. The platform **calls into it** â€” a
business opens a ticket from its dashboard and lands in the same support UI â€”
it does not fork it.

```bash
npm run test:platform   # 323 checks over Sections 10-55
npm test                # all ten suites, Sections 1-9 and 10-55
npm run dev             # http://localhost:3000  ->  #/marketplace
```

## The shape of it

```
src/platform/     the domain, imported by BOTH browser and server
  types.ts        every Section 10-55 type, and three invariants it protects
  packages.ts     Sections 9, 26, 38, 44, 54 - the entitlement table
  billing.ts      Sections 31-40 - upgrade, downgrade, renewal, invoicing
  categories.ts   Section 17
  malls.ts        Section 41 - the mall directory, rooms, and conflict rules
  search.ts       Section 16
  commerce.ts     Sections 20, 22 - cart grouping and the order split
  engagement.ts   Sections 23, 24, 25
  inventory.ts    Section 27
  marketplace.ts  Sections 12, 13, 14, 15
  payments.ts     Section 21
  i18n.ts         Section 51

api/platform/     the server
  auth.ts         Section 50 - businessId comes from the verified token only
  store.ts        durable collections + a demo catalogue
  router.ts       /api/platform/*
  types.ts        Super Admin areas, quote factors, the commercial ERP name

src/components/platform/   the UI
  primitives.tsx  Sections 42, 43 - breakpoints, 44px targets, YENE tokens
  MarketplaceHome.tsx   Section 15
  StorefrontView.tsx    Sections 10, 11, 13, 23
  CartAndCheckout.tsx   Sections 20, 21, 22
  BusinessDashboard.tsx Sections 26, 31-40, 44
```

**Almost the whole platform is pure functions.** `billing.ts`, `commerce.ts`,
`marketplace.ts` and the rest take their inputs and return a result â€” no
store, no clock of their own, no I/O. That is why `npm run test:platform` can
prove 323 specification rules with no database, no API key and no network, and
why a rule can be read and checked rather than inferred from a call site.

## 10 â€” Rented digital stores

A business activates a dedicated storefront at `business.yene-store.com`. Each
store carries a profile, logo, cover, introduction, images, products, categories,
services, promotions, contact details, social links, reviews, policies,
delivery information, payment options and a status.

`Business` holds all of it, plus the mall placement (Section 41) and the
`trustedSeller` flag (Section 14).

**Status:** `Trial`, `Active`, `Payment Due`, `Suspended`, `Expired`,
`Cancelled` â€” six, declared in `STORE_STATUSES` and no others.

**Nothing is deleted when a subscription ends.** There is no `deleteBusiness`
in `api/platform/store.ts` and no route that removes one. An expired store
keeps its products, its customers and its sales history; what changes is
whether it is *reachable* as a storefront, not whether it exists.

## 11 â€” Store customization

`StoreCustomization` is the whole of Section 11 as data: logo, cover image,
business name, description, business information, theme, featured products,
banner products, social links, contact block, store policies, delivery options
and payment options. `StorefrontView` renders all of it, including the mall
room for a mall business.

## 12 â€” Product creation and posting

A product is created with its name, description, images, video, category,
subcategory, brand, SKU, price, discount price, stock, variants, attributes and
delivery information â€” and three checkboxes:

```
[x] Publish to My Store
[ ] Publish to Main YENE Marketplace
[ ] Add to Promotion
```

`defaultPublishIntent()` returns the marketplace checkbox **off**. That is the
specification's "the marketplace checkbox is optional", expressed as a default
rather than a restriction: a business can sell from its own store, on any
package, forever, without ever touching the marketplace.

## 13 â€” One product, two places

> "Do not unnecessarily duplicate the product in the database. The original
> business product should remain authoritative. Marketplace listing should
> reference the original product."

This is structural, not a convention. `MarketplaceSubmission` holds a
`productId` and **nothing else about the product** â€” no name, no price, no
image. A listing is a *view*:

```ts
export function toListing(submission, product, business, rating): MarketplaceListing {
  return {
    productId: product.id,        // the reference
    name: product.name,           // read live
    price: product.price,         // read live
    discountPrice: product.discountPrice,
    businessName: business.name,
    ...
  };
}
```

A merchant changes a price in their store and the marketplace row changes with
it, because there is only one row. The test suite proves this by editing a
product and asserting the listing moved:

```
PASS  editing the product changes the marketplace row immediately
PASS  the submission stores no copy of the name
PASS  the submission stores no copy of the price
```

## 14 â€” Moderation

> "A business must not be able to bypass marketplace moderation unless an
> explicit trusted-business automatic publishing rule is configured."

```
Create Product
      â†“
Publish to Own Store
      â†“
Select "Publish to Main Marketplace"
      â†“
Pending Review
      â†“
Super Admin Review
      â†“
Approved
      â†“
Published on YENE Marketplace
```

Three decisions in that chain are deliberately **separate acts**:

| act | who | transition |
| --- | --- | --- |
| submit | the business | `Not Submitted â†’ Pending Review` |
| approve / reject / request changes | Super Admin | `Pending Review â†’ Approved \| Rejected` |
| publish | Super Admin | `Approved â†’ Published` |

Approval does not publish. A product cannot reach `Published` from
`Pending Review` â€” there is no edge â€” and `submitForReview` refuses outright
for a business without the `marketplace` feature, naming the package that would
allow it rather than failing silently.

**The single exception** is `autoPublishIfTrusted`, the only place
`autoPublished` is ever set. A Super Admin must mark the business
`trustedSeller`, and even then the submission is recorded with
`autoPublished: true` and a named reviewer, so "why was this live without a
review?" has an answer in the data.

## 15 â€” The YENE-STORE marketplace

A modern multi-vendor marketplace. The **structure** is deliberately familiar â€”
shoppers already know how to scan a category rail and a product grid â€” and
every pixel is original: the tokens in `src/index.css`, a text wordmark, and
copy written here. No third-party logo, graphic, layout, text or asset.

The homepage carries the logo, search bar, category selector, search button,
language, currency, help, account, orders, cart, category navigation, hero
banners, Flash Deals, trending, new arrivals, best sellers, recommended
products, featured businesses, promotions and Business Spotlight.

## 16 â€” Search

One endpoint searches products, businesses, categories, brands, services and
promotions, with server-side filters (category, price, location, store, brand,
rating, availability, promotion), all six sort orders, pagination,
autocomplete and typo tolerance.

Typo tolerance is a bounded Damerau-Levenshtein distance â€” transpositions
counted as one edit, because that is the typo people actually make:

```
PASS  a transposition typo still finds the product (Samsng -> Samsung)
PASS  a corrected query says so
PASS  edit distance counts a transposition as one edit
```

The response reports `corrected: true` when it changed the query. **A search
box that silently rewrites what you typed is how people buy the wrong phone.**

One detail worth recording, because the obvious implementation is wrong: the
prefix guard only compares against words sharing the term's first three
characters. Using a longer prefix â€” `term.slice(0, len - 1)` â€” is
self-defeating, because `"samsng"` would then require `"samsn"`, which
`"samsung"` does not start with, and the one typo the feature exists to catch
would be the one it misses.

Search receives catalogue data only. It has no access to any customer's
history, so it cannot leak any (Section 25).

## 17 â€” Categories

Fourteen initial categories, as data rather than a `switch`, so a Super Admin
can add one without a deploy: Fashion, Beauty, Perfume, Electronics, Phones,
Computers, Home, Food, Automotive, Sports, Office, Industrial, Services, Other.

### Main categories carry subcategories

One level was never enough to browse: "Fashion" tells a shopper nothing about
what is inside it. Each main category now has real children, so the header shows
a main bar and, beneath it, the subcategories of whichever one is active.

```
Fashion     -> Men Clothes, Women Clothes, Kids Clothes, Shoes, Jewellery, Bags & Accessories
Beauty      -> Makeup, Skincare, Haircare, Personal Care, Salon & Spa
Perfume     -> Men Fragrance, Women Fragrance, Unisex Fragrance, Attar & Incense
Electronics -> Televisions, Audio, Cameras, Home Appliances, Gaming
Phones      -> Smartphones, Feature Phones, Phone Accessories, Tablets
Computers   -> Laptops, Desktops, Monitors, Computer Accessories, Printers & Scanners
Home        -> Furniture, Kitchenware, Home Decor, Bedding & Linen, Garden & Outdoor
Food        -> Coffee & Tea, Spices, Snacks, Beverages, Dairy & Eggs
Automotive  -> Car Parts, Motorcycles, Car Care, Vehicle Accessories
Sports      -> Fitness & Gym, Team Sports, Outdoor & Camping, Cycling, Sportswear
Office      -> Office Furniture, Stationery, Printing & Paper, School Supplies
Industrial  -> Machinery, Construction Tools, Safety Equipment, Raw Materials
Services    -> Education & Training, Health & Wellness, Transport & Delivery,
               Home Services, Professional Services
Other       -> Clearance, Bulk Orders, Everything Else
```

Sixty-four subcategories in all, and still data — `INITIAL_SUBCATEGORIES`.

**One level only, on purpose.** `parentId` is a single field, so a subcategory
cannot have children of its own. "Jewellery" is the honest leaf: a shopper
looking for a sapphire ring wants Jewellery, not a second page of questions.

**Subcategory ids are namespaced by their parent** — `fashion-jewellery`, not
`shoes-1`. The previous `${slug}-${count}` scheme collided as soon as two
categories shared a child name (Fashion/Shoes and Sports/Shoes both produced
`shoes-1`), which would have shown a product under the wrong parent.

### Filtering

A **main** category matches its whole subtree, so clicking "Fashion" still
returns every product filed as Fashion / Jewellery. A **subcategory** matches
only itself. Verified through the real search corpus in section 15b of the suite:

| filter | products |
| --- | --- |
| `fashion` | 8 (3 direct + 5 Jewellery) |
| `fashion-jewellery` | 5 |
| `phones-smartphones` | 2 |
| `sports-cycling` | 0 |

### The tree over the wire

`GET /api/platform/config` returns `categories` **nested** — each main category
with its `subcategories` already inside it — so the header bar and the search
select cannot disagree about what belongs to what. `GET /api/platform/categories`
returns the two levels flat and separated, which is what the Super Admin reorder
screen needs.

**"Do not delete products simply because a category changes."** Two functions
enforce it:

```ts
canDeleteCategory("food", products, categories)
// -> { allowed: false,
//      reason: "3 product(s) are in this category. Move them to another
//               category first - YENE-STORE does not delete products when a
//               category changes." }
```

Disabling a category is a *visibility* change and returns the number of
products behind it, so the UI can say "142 products, unaffected" instead of
letting a merchant believe their catalogue emptied itself.

## 18 & 19 â€” Promotions


Ten types (percentage, fixed, special price, BOGO, free item, new product,
seasonal, event, custom offer, Flash Deal) with the full field set, eight
statuses and thirteen placements. A promotion is `Active` only while
`startAt â‰¤ now < endAt`, and placements are filtered by what the store is
actually showing.

## 20 â€” A multi-vendor cart

A customer adds products from several businesses. The cart is **grouped by
store before any total is produced**, and every figure after that is a sum of
per-store figures. There is no code path that adds a fee to a flat list â€” which
is the whole point, because a flat list is how a delivery fee gets charged
once for the whole basket instead of once per store.

```
PASS  the cart is grouped into three stores
PASS  the grand total is the sum of the group totals
PASS  the grand total is subtotal - discount + delivery + tax
PASS  free delivery applies above the store's threshold
```

## 21 â€” Checkout and payments

Six steps, rendered in order and with the specification's exact labels:
Customer Information â†’ Delivery Address â†’ Delivery Method â†’ Payment Method â†’
Order Review â†’ Place Order.

Payments go through a **provider interface**, because the specification asks
for extensibility explicitly. Chapa is the first implementation; everything
Chapa-shaped lives inside `createChapaProvider`.

**The rule that matters:** verification is server-side and it decides the
outcome. The browser redirect back from Chapa is a hint, never a proof.

- a failure is a failure, whatever the browser said;
- a success only counts when the **amount matches** â€” a tampered return URL
  cannot mark a 4,900 ETB order paid for 100 ETB;
- a settled payment is terminal, so a replayed callback cannot move a paid
  order back to pending.

```
PASS  a SUCCESS with the WRONG amount is refused
PASS  and the reason names the mismatch
PASS  a settled payment cannot be replayed back to Failed
```

Chapa is **not wired by default**. With no `CHAPA_SECRET_KEY`, the provider
reports itself unconfigured, is not offered at checkout, and the platform falls
back to cash on delivery. Online payment is Platinum-and-above, so a Silver
store says so on the store page and at checkout rather than failing at the last
step.

## 22 â€” Order management

`Customer â†’ My Orders`, `Business â†’ Store â†’ Orders`,
`Super Admin â†’ Marketplace â†’ Orders`.

A three-store checkout produces **three `BusinessOrder` records and exactly
one `CustomerOrder`** the customer can see. Each store can reach only its own
order, because that is all the record contains.

Nine statuses, with the legal transitions declared in one table:
Pending, Confirmed, Processing, Preparing, Shipped, Out for Delivery,
Delivered, Cancelled, Returned. Cancelled and Returned are terminal.

## 23 â€” Reviews and ratings

Star rating, written review, images, and a **verified purchase** badge that is
computed from delivered orders and can never be requested by the client. The
test drives an order through the real lifecycle rather than stamping it
"Delivered", because that is the only way the check is worth anything:

```
PASS  a fresh order is Pending, so it does not verify anything
PASS  the order reaches Delivered through the declared lifecycle
PASS  a delivered order verifies the purchase
PASS  another customer cannot claim the verified badge
```

## 24 â€” Wishlist

Add, remove, list, and notify on **price change, promotion and back-in-stock**.
The comparison is against the price remembered **at save time**, not the
current price, so a merchant editing their product cannot rewrite history and
trigger a false "price dropped" alert.

## 25 â€” Recommendations

Signals: search history, viewed products, categories, wishlist, cart, previous
purchases, popularity and trending.

The privacy rule â€” *"Never expose private customer behavior to other customers
or businesses"* â€” is **structural** here: every function takes one customer's
signals and returns something about *products*. No function returns or logs
another customer's history, and the "reason" strings come from a closed set of
product-level statements. A brand-new user is never shown a confident
"because you likedâ€¦" message, because there would be nothing behind it.

```
PASS  a new customer's reasons are catalogue-level, not personal
PASS  no recommendation names a customer

## 26, 27, 28, 29 â€” Business management, inventory, CRM, custom ERP

**Modules** are gated from one table (`dashboardModulesFor`). Silver sees
Store, Products and Orders; its Inventory, Customers, Suppliers and Reports are
shown **locked** with the package that would open them; Super-only modules
(POS, Automations, Integrations, Custom ERP) are hidden. Settings, Support and
Packages & Billing are in every package â€” a business must always be able to
see its subscription or ask for help, whatever it pays for.

**Inventory** is a ledger, not an editable number. Every change is a
`StockMovement`, and current stock is derived by replaying it â€” which is what
makes the movement, reconciliation and valuation reports possible at all. The
hierarchy is exactly the tree Section 27 draws, and `renderHierarchy` prints
it:

```
Main Warehouse
|-- Room 1
|-- Room 2
`-- Shelf A
Branch 1
|-- Storage
`-- Store
Branch 2
`-- Store
```

A transfer is validated against the ledger and credits the destination *and*
debits the source in the same operation â€” handling only the destination would
let a warehouse grow on paper every time stock moved. That was a real bug,
caught by the suite.

**CRM, procurement, employees, roles and expenses** are modelled as data
(Section 28). Roles hold a named subset of the Section 38 feature keys, and
`effectiveAccess` intersects that with the package â€” so a role can restrict a
user but never promote them above the plan.

**Super** is the **Yene Custom Business ERP & Inventory System**: "a custom-built
business management and inventory platform developed by Yene Business Group,
inspired by modern ERP workflows and customized to the customer's operational
requirements." The suite asserts that this description never mentions Frappe or
ERPNext, and that `QUOTE_FACTORS` carries all fourteen quotation inputs.

## 30 â€” One connected ecosystem

Marketplace, business stores and promotions feed one e-commerce core; orders
flow to payments, delivery, inventory, CRM/ERP/POS and reports; and every
surface can reach **Yene AI Support**, which is Sections 1â€“9 above, unchanged.

## 31â€“40 â€” Packages, billing and the subscription lifecycle

This is the part of the platform a customer is most likely to be angry about,
so every number in it is a function of its inputs and a test rather than a
promise. `src/platform/billing.ts` is pure: no store, no clock of its own.

### Section 32 â€” an upgrade costs the difference

```ts
upgradeCharge("silver", "gold")       // 2,500   5,000 - 2,500
upgradeCharge("gold", "platinum")     // 10,000
upgradeCharge("silver", "platinum")   // 12,500
```

It is deliberately *not* prorated and *not* a full new month: the
specification gives the same answer regardless of how much time is left, so the
function ignores the remaining period entirely. A downgrade returns 0 and
never a negative number, because a negative charge would be a refund wearing
another hat.

### Section 33 â€” the four-month example, run end to end

```
Silver subscription, four months
        â†“
Upgrade to Gold
        â†“
Gold price = 5,000 ETB ; Silver price = 2,500 ETB
        â†“
Upgrade difference = 2,500 ETB      â† charged now
        â†“
Gold available for the remaining period
        â†“
Four-month subscription ends
        â†“
Full Gold renewal price applies     â† 5,000 ETB
```

```
PASS  upgrading mid-term quotes the difference, 2,500 ETB
PASS  Gold becomes active immediately
PASS  the four-month term is NOT restarted
PASS  at renewal the customer pays the full 5,000 ETB
PASS  the 2,500 ETB upgrade did not become a discount
```

### Section 34 â€” the upgrade payment cannot become a discount

This is the rule that quietly breaks in real systems. The usual bug is
carrying the upgrade price forward as a "negotiated" price, so the fourth month
bills 2,500 instead of 5,000.

Here the upgrade charge is a **discrete surcharge in a ledger held next to the
subscription**, and `renewalInvoice()` reads `PACKAGES[current].monthlyPrice`
and nothing else. `Subscription` has no field that could hold a discounted
monthly price, so the bug is not "remembered not to happen" â€” it cannot be
written down.

```
PASS  Gold renews at 5,000 ETB, not 2,500
PASS  lastUpgradeAmount is not consulted for billing
```

PASS  recommendationsFor takes a single signals object
```

### Section 35 â€” a downgrade refunds nothing

> "Downgrading your package does not generate a refund or credit for the price
> difference."

Platinum 15,000 âˆ’ Gold 5,000 = 10,000 difference. **Refund = 0 ETB.**

`ChangeQuote.refundAmount` is typed as the literal `0`:

```ts
refundAmount: typeof NO_REFUND;   // NO_REFUND = 0 as const
```

A downgrade cannot produce a credit even by accident, because the type does not
admit one. The live API returns it too:

```
SILVER->GOLD QUOTE due=2500 refund=0 immediate=True
PLATINUM->SILVER QUOTE due=0 refund=0
  notice: Downgrading your package does not generate a refund or credit for
  the price difference. You keep Platinum access until 2026-10-08, when
  Silver becomes active at 2,500 ETB.
```

### Section 36 â€” downgrades take effect at the renewal boundary

Requesting a downgrade records a `pendingChange` and **does not** lower the
package. Platinum access continues to the renewal date, then Gold activates.
"Do not unexpectedly remove already-paid higher-package access."

### Section 37 â€” no data loss, ever

The strongest guarantee in the system, and the one most likely to be tested by
a customer's real data rather than a unit test. So the suite counts rows:

```
PASS  products survive a Platinum -> Silver downgrade
PASS  orders survive
PASS  reviews survive
PASS  marketplace submissions survive
PASS  the business record itself survives
PASS  at the renewal boundary the package becomes Silver
PASS  and the marketplace feature is then locked
PASS  but the products are still there behind the lock
PASS  upgrading again restores the feature
```

Two structural reasons it holds:

1. **The handler cannot delete them.** `POST /subscription/change` writes to
   subscriptions, changes, invoices and the ledger. It never loads a product,
   order, customer or review, so there is no code path that can remove one.
2. **There is no delete function.** `api/platform/store.ts` exports no
   `deleteProduct`, no `deleteOrder`, no `purgeBusiness`.

A feature that falls outside the new package is **locked**, and the UI says so
explicitly â€” "These are locked, not deleted. Your data stays exactly where it
is and becomes available again if you upgrade." A merchant who downgraded must
be able to *see* that their history survived.

### Section 38 â€” centralized entitlements

```
Package â†’ Feature Entitlements â†’ Business Account â†’ User Permissions â†’ Feature Access
```

Seventeen feature keys, and `entitlementsFor()` returns **all seventeen** for
every package rather than a sparse set â€” so "missing" always means false, never
"nobody implemented this yet". Each package is a strict superset of the one
below it, which is what makes "upgrade = the difference" a property rather
than a coincidence.

### Sections 39 & 40 â€” history and custom pricing

The change-history row carries every field the specification lists: business,
previous package, new package, change type, date/time, user, payment
reference, amount, effective date, status.

Super is **"30,000 ETB/month+"** and its card shows `30,000 ETB+`, because the
price is a quotation and a single figure would be a promise Yene Business
Group has not made. `POST /quote-request` collects the fourteen factors and
routes to the team.

## 41 â€” Mall businesses

Business Type â†’ Mall Store â†’ Mall â†’ Floor â†’ Room/Shop Number â†’ Package.

**A mall is a record, not a string.** `Mall` is its own row
(`data/platform-malls.json`), so "which stores are in Dembel City Center?" is a
lookup rather than a guess at render time. A store keeps the mall's name
denormalised for display and `mallId` for identity.

### Browsing a mall

| endpoint | what it returns |
| --- | --- |
| `GET /api/platform/malls` | every mall, with its registered stores and real counts |
| `GET /api/platform/malls/:id` | one mall, its stores, and the counters still unclaimed |
| `GET /api/platform/businesses?mall=<id>` | just the store cards in that mall |

The marketplace has a **Shop by mall** section, and `#/mall/<slug>` opens one
mall's page. A mall with no registered store is filtered out of the directory
rather than rendered as a dead end.

### A store may hold more than one room

This is the case the specification's single-room example (3F-24) could not show.
`MallPlacement.roomNumber` is kept as the PRIMARY room and still holds that
example; `roomNumbers` carries the full set.

`parseRoomNumbers` in `src/platform/malls.ts` is why a typed field works:
`GFS-024 & GFS-030`, `GFS-024, GFS-030`, `GFS-024; GFS-030`, `GFS-024 / GFS-030`,
`GFS-024 and GFS-030` and a JSON array **all** produce two rooms. Duplicates are
collapsed case-insensitively and the order typed is kept, because the first is
the primary. Records written before `roomNumbers` existed still read correctly
through `roomNumbersFor()`.

### A counter belongs to one store

`findRoomConflicts` compares case- and separator-insensitively (`gfs-024`,
`GFS-024` and `GFS 024` are one counter) and sign-up **refuses** a clash with a
409 rather than letting two shops both believe they own a prime location. The
sign-up screen also greys out rooms that are already taken, and a store may
re-save its own rooms without colliding with itself.

The mall is resolved against the **directory**, never taken from the request
body â€” otherwise anyone could invent a mall by typing a name into sign-up.
A mall covered by a YENE-STORE agreement passes that agreement through, which
grants the **subdomain free**; package features still follow the package.

### The seeded example

Dembel City Center holds two stores: **ABC Fashion** (3F-24) from the
specification, and **Hub Jewellery** on rooms **GFS-024 & GFS-030**, selling
gemstone, gold, silver and platinum.

## 42 & 43 â€” Responsive design and visual identity

Each breakpoint gets a different layout rather than one layout that grows:

| screen | marketplace | business dashboard |
| --- | --- | --- |
| phone | 2-column grid, bottom nav, horizontal category rail, compact header | modules as a 2-column list |
| tablet | 2â€“3 columns, wrapping category row | 3-column module list |
| laptop | full navigation, sidebar, expanded analytics | sidebar beside the content |
| desktop | wider grids | sticky sidebar |
| large monitor | capped and centred (`2xl`, `max-w-[1600px]`) | `max-w-[1800px]`, efficient use of space |

44Ã—44px is the minimum touch target and is applied as `min-h-11 min-w-11` on
every tappable control. Colours are the specified ones, already in
`src/index.css` from Sections 1â€“9: `#0D1117` canvas, `#3DDC97` accent, light
text, 16â€“32px radii.


## 44 & 26 â€” The business dashboard

Twenty-three modules, rendered from the server's `access` decision. The
component does not know what a package can do â€” it renders what it is told,
which is why a fifth package rule cannot be introduced in the UI by accident.

## 45 â€” Super Admin

Twenty-eight declared areas (`SUPER_ADMIN_AREAS`), covering businesses, stores,
packages, subscriptions, payments, users, roles, permissions, marketplace,
submissions, reviews, orders, promotions, campaigns, banners, featured stores,
sponsored products, security, analytics, audit logs, support, the AI knowledge
base, and payment and delivery configuration. Every moderation route requires
`requireSuperAdmin`.

## 46 & 47 â€” Yene AI Support and human support

Unchanged from Sections 1â€“9, and the platform uses them rather than
reimplementing them. The grounding guarantees still hold: the assistant does
not invent prices, stock, payment status, order status, subscription status,
package limits, customer information or business information, and escalates to
a human when uncertain.

## 48 & 49 â€” Analytics and notifications

Business analytics cover visitors, product views, search activity, orders,
sales, revenue, conversion rate, promotion performance, top products,
low-stock products and inventory performance. Super Admin analytics cover
business counts, package distribution, subscription revenue, marketplace
activity, order volume, promotion volume and support volume.

Notifications are modelled across in-app, email, Telegram and SMS, with eleven
business topics including subscription renewal, payment due and package change.

## 50 â€” Security

`businessId` is read **only** from the verified token, never from a body, a
query string or a browser-settable header â€” the same boundary the support
system already established, for the same reason. Production fails closed: an
unverified request resolves to a guest, so public browsing still works and
nothing tenant-scoped is reachable.

The platform API client has **no function that sends a businessId** for a
tenant-scoped call. The single place `businessId` appears in a query string is
`/api/platform/search`, where it is a public "search within one store" filter
and explicitly not an access decision.

## 51 â€” Multi-language

English and Amharic ship. `t()` falls back to English and then to the key, so a
missing translation degrades to readable English and never to
`"checkout.step3"`. Adding a third language is a catalogue entry, not a
rewrite.

## 52 & 53 â€” The complete flow, as one system

JOIN â†’ CHOOSE PACKAGE â†’ ACTIVATE STORE â†’ BUILD PROFILE â†’ ADD PRODUCTS â†’
PUBLISH TO OWN STORE â†’ *optional* MARKETPLACE REVIEW â†’ PROMOTE â†’ DISCOVER â†’
CART â†’ CHECKOUT â†’ PAYMENT â†’ ORDER â†’ INVENTORY â†’ DELIVERY â†’ REVIEW â†’
ANALYTICS â†’ GROW â†’ UPGRADE â†’ CUSTOM ERP

Every arrow in that chain is a test in `scripts/verify-platform.ts` rather
than a claim in a document.

## 54 & 55 â€” Positioning and the model

```
START SMALL
   â†“
ðŸ¥ˆ SILVER    2,500 ETB   Get your business online
   â†“
ðŸ¥‡ GOLD      5,000 ETB   Connect with your customers
   â†“
ðŸ’Ž PLATINUM 15,000 ETB   Sell online and manage your business
   â†“
ðŸ‘‘ SUPER    30,000 ETB+  Let Yene Business Group build the system you need
   â†“
CUSTOM BUSINESS SYSTEM
```

## The final rule

YENE-STORE is not an e-commerce website. It is a complete Business
Digitalization Platform:

> Digital Presence + Rented Store + E-Commerce + Marketplace + Promotions +
> Payments + Delivery + Inventory + CRM + ERP + AI Support + Custom Software
> Development.

**RENT â†’ BUILD â†’ SELL â†’ PROMOTE â†’ MANAGE â†’ AUTOMATE â†’ GROW**

*YENE-STORE â€” Build. Sell. Manage. Automate. Grow. Powered by Yene Business
Group.*

---

## Known limitations (Sections 10-55)

These are the honest ones, stated here rather than discovered in production.

- **The platform stores are single-writer JSON files** under `YENE_DATA_DIR`,
  the same trade-off as the support stores. Fine on one instance; replace the
  bodies with a real database before scaling out. No `deleteX` functions exist
  at all, which is Section 37 working as intended â€” not an oversight.
- **Chapa is not wired.** There are no credentials and no live call was made.
  The provider interface, the status mapping and the verification rules are
  real and tested; the HTTP calls are unexercised. Without a key the platform
  offers cash on delivery rather than a payment button that cannot work.
- **Production authentication is unwired by default.**
  `api/platform/auth.ts` returns a guest until real tokens are verified, so
  every tenant-scoped route is closed rather than open. `AUTH_MODE=development`
  provides the demo identities.
- **Search is lexical, not semantic.** It is fast, bounded and dependency-free,
  and a query phrased unusually may miss a product a synonym would have found.
  Typo tolerance helps at the word level, not the concept level.
- **Recommendations are transparent scoring, not a trained model.** Every
  reason is a plain-language statement the customer can check, which is a
  deliberate trade against relevance.
- **The Amharic catalogue covers interface chrome, not user content.** Product
  names, descriptions and reviews stay in whatever language they were written
  in; the platform does not translate a merchant's words for them.
- **No image or video upload.** `Product.images` and `videoUrl` are modelled
  and rendered, but they hold URLs, and object storage is not wired. Upload
  needs the same integration point as the support attachments.
- **Notifications are modelled, not dispatched.** The `Notification` type,
  channel enum and eleven topics exist; sending through Telegram, SMS or email
  is the next integration, not a finished feature.
- **The demo catalogue is seeded on first use** and is meant to be replaced.
  It deliberately includes the awkward cases â€” a Silver business, a mall
  business, a store-only product, a queued review â€” because those are the ones
  that break.


#   Y e n e - s t o r e  
 