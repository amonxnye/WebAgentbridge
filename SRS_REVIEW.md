# WebBridge SRS Review
**Version Reviewed:** 1.0 Draft
**Review Date:** February 2026
**Reviewer:** Claude (claude-sonnet-4-6)
**Branch:** claude/webbridge-srs-review-52bgd

---

## Executive Summary

The WebBridge SRS is well-structured and clearly communicates the platform vision. The problem statement is compelling and the persona-driven framing is effective. However, several areas require tightening before development begins: the data model is underspecified, the proxy-vs-handoff architectural question is unresolved but load-bearing for multiple requirements, auth handling has gaps that create security risks, and several "Must Have" requirements are technically underspecified. This review organises findings into: **Critical Issues** (blockers before Phase 1 starts), **Major Gaps** (should be resolved before Phase 2), and **Minor Issues** (polish / refinements).

---

## 1. Critical Issues (Blockers)

### 1.1 Proxy vs. Hand-off Model — Unresolved Architectural Question

**Location:** Section 8.1, Open Question #2; also FR-032
**Severity:** Critical

FR-032 states the endpoint must "proxy agent requests to the original website in real time." But Section 8.1 explicitly lists this as an open question. These are mutually exclusive positions in the same document.

The choice has cascading consequences across the entire spec:

| Dimension | Proxy Model | Hand-off Model |
|---|---|---|
| Latency budget | Add WebBridge RTT on every call | Direct to origin |
| Credential exposure | WebBridge holds and replays creds forever | Creds only used at ingestion time |
| Rate limiting | WebBridge can enforce centrally (FR-033) | Must be pushed to origin |
| Origin site load | Ongoing traffic through WebBridge | Ongoing traffic direct to origin |
| Compliance | WebBridge proxies PII-containing responses | WebBridge only holds schema |
| Uptime coupling | WebBridge + origin both must be up | Only origin must be up |

**Recommendation:** Resolve this before Phase 1. The SRS currently bakes in the proxy model (FR-032, FR-033, FR-036) but the hand-off model is substantially safer from a credential and compliance standpoint. A hybrid is also possible: hand-off for read-only data, proxy only for authenticated write actions.

---

### 1.2 Semantic Model Schema Is Undefined

**Location:** Section 3.2, 4.2, 4.3
**Severity:** Critical

The SRS describes outputs of the Semantic Modeller (OpenAPI spec, MCP manifest, agent.json) but never defines the intermediate semantic model itself — the internal representation that the Interface Generator consumes.

This matters because:
- Engineers cannot implement FR-014 ("LLM identifies entities and relationships") without knowing what structure they are populating.
- The review/edit step (FR-024, FR-026) requires a UI over this model — which cannot be designed without knowing its schema.
- Resumable crawls (FR-017) need to checkpoint into this model.

**Recommendation:** Add a Section 3.4 defining the Semantic Model schema (even informally). Minimally specify: Page, Entity, Field, Action, NavLink, AuthFlow as first-class objects with their required properties. This unblocks Interface Generation and Dashboard design in parallel.

---

### 1.3 Credential Security Model Has Gaps

**Location:** FR-002, FR-003, FR-004; Section 5.3
**Severity:** Critical

The SRS mandates AES-256 at rest and references Vault/Secrets Manager, but does not specify:

1. **Key management:** Who holds the encryption key? If it is an env var, the warning in Section 5.3 is contradicted by the implementation.
2. **When credentials are accessed:** The proxy model requires credentials to be decrypted on every agent request. High-frequency access to Vault for every request is a latency and availability problem (conflicts with P95 < 3s in Section 5.1).
3. **Credential rotation:** No requirement for site owners to rotate credentials, or for the platform to detect stale/invalid creds.
4. **Scope of login simulation (FR-004):** Storing a username and password for form-based login is fundamentally more sensitive than an API key. The SRS does not differentiate these tiers, but they require different handling (short-lived session tokens vs. permanent secret).

**Recommendation:** Add requirements covering: key management hierarchy, credential access pattern (cache session tokens, don't call Vault per request), and a credential health-check mechanism.

---

### 1.4 MCP Protocol Version Pinning

**Location:** Section 3.3, FR-021, FR-031
**Severity:** Critical

The SRS references MCP throughout but never specifies which version of the MCP specification the platform targets. Section 8.2 acknowledges "MCP standard is evolving" as a risk but the mitigation ("abstract MCP layer") is vague.

MCP as of early 2026 has multiple transport options (HTTP with SSE, stdio, WebSocket) and its tool-calling schema has changed across versions. Without pinning a version:
- The generated MCP manifests may not be consumable by any specific client.
- The "human-readable documentation" (FR-025) cannot be produced with meaningful accuracy.

**Recommendation:** Pin a minimum target MCP spec version. Define which transport(s) are supported in v1.0. Add a compatibility matrix as an appendix.

---

## 2. Major Gaps

### 2.1 Change Detection Deferred but Proxy Model Depends on It

**Location:** Section 1.4 (Out of Scope), Section 7 Phase 4
**Severity:** Major

The SRS defers automatic re-crawl to v1.1. In a hand-off model, a stale schema causes structured but incorrect responses. In the proxy model, a stale schema causes the endpoint to return responses that no longer reflect the origin site.

FR-052 allows manual re-crawl, but there is no requirement to surface schema staleness to consumers. An agent querying a 6-month-old model for a site that has since redesigned will receive confidently-wrong structured responses.

**Recommendation:** Even without automated change detection, add a requirement to:
- Surface `last_crawled` prominently in every API response header (not just agent.json).
- Allow consumers to query the staleness date programmatically.
- Add a `schema_confidence` or `last_validated` field to the registry entry.

---

### 2.2 GDPR Compliance Requirement Is Underspecified

**Location:** Section 5.5
**Severity:** Major

"The platform must comply with GDPR for any EU user data processed during crawl" is a single bullet point for what is a substantial engineering and legal obligation.

Gaps include:
- **Data subject rights:** If a crawled page contains personal data (e.g. a public user profile, a staff directory), who is the data controller? WebBridge? The site owner?
- **Retention policy:** "Crawled content must not be retained beyond what is needed to serve the generated model" — what does "serve the generated model" mean? The raw HTML? Extracted entities? Both? For how long?
- **Lawful basis:** What is the lawful basis for processing crawled data? Legitimate interest? Consent?
- **Data residency:** No mention of EU data residency requirements. Using AWS without specifying region may violate GDPR.

**Recommendation:** Engage legal counsel before Phase 1. At minimum, add requirements for: data retention periods, deletion on site deregistration, data processing agreement (DPA) template for site owners, and EU-region infrastructure option.

---

### 2.3 No Error Model Defined for MCP Endpoints

**Location:** FR-035, Section 4.4
**Severity:** Major

FR-035 requires "structured JSON responses conforming to the generated schema" — but there is no requirement defining error responses.

Agents calling the MCP endpoint will encounter:
- Origin site is down
- Auth credentials have expired
- Crawl model is stale (element no longer exists)
- Rate limit exceeded (FR-033)
- Action fails (e.g. form submission rejected)

Without a standardised error schema, every consumer must handle errors ad hoc. This undermines the core value proposition of a "standardised interface."

**Recommendation:** Define an error response schema as part of the generated interface. Minimally: `error_code`, `message`, `retryable` (bool), `suggested_action`. Add a requirement (FR-036 extension) that all error events are logged with the full request context.

---

### 2.4 Consumer Authentication Model Is Thin

**Location:** FR-034
**Severity:** Major

FR-034 says consumers authenticate via API key. That is the entirety of the consumer auth spec. Missing:

- **Key issuance:** How does a consumer obtain a key? Self-serve registration? Manual approval? Both?
- **Key scopes:** Can a key be scoped to specific endpoints or specific operations (read vs. write)?
- **Key rotation:** Consumer key rotation policy.
- **Key revocation propagation:** FR-054 allows owners to revoke keys — what is the propagation delay? Immediate? Eventually consistent?
- **Anonymous/public endpoints:** FR-033/FR-034 imply all endpoints require auth. But FR-040 describes a "public registry." Can public endpoints exist without consumer keys?

**Recommendation:** Add a Section 4.4a defining the consumer identity model: registration flow, key scopes, rotation, revocation SLA, and whether unauthenticated read access is ever permitted.

---

### 2.5 robots.txt Handling Has a Conflict

**Location:** FR-016, FR-018
**Severity:** Major

FR-016: "The engine must respect robots.txt directives by default, with a site-owner override option."

This creates a legal and ethical conflict. The site owner registering their own site on WebBridge can override robots.txt for their own site — acceptable. But if a site owner registers a third-party site (which is not prevented by the SRS), they can override another site's robots.txt directives. This is the legal risk identified in Open Question #1 but is not mitigated at the requirements level.

**Recommendation:** Add a requirement that the robots.txt override is only available when the site owner can demonstrate domain ownership (e.g. DNS TXT record verification or placing a verification file at `/.well-known/webbridge-verify.txt`). This also resolves Open Question #1 partially.

---

### 2.6 Paginated Content Handling Is Underspecified

**Location:** FR-015
**Severity:** Major

FR-015 says the engine must "detect paginated content and model it as a queryable list resource." This is one line for what is a complex problem:

- How is pagination detected? (URL params like `?page=2`, Link headers, infinite scroll, "Load more" buttons?)
- What is the query interface for the generated list resource? Offset? Cursor? Page number?
- What is the depth limit for paginated crawl? A 10,000-page catalogue should not be crawled in full on ingestion.
- How does pagination interact with the crawl depth limit (FR-011)?

**Recommendation:** Expand FR-015 into sub-requirements covering: detection heuristics, maximum pages crawled per paginated resource (configurable, default: 5), and the query interface (cursor-based is recommended for agent compatibility).

---

## 3. Minor Issues

### 3.1 agent.json Schema Lacks Versioning Validation

**Location:** Section 3.3
**Severity:** Minor

The example agent.json includes `"schema_version": "1.0"` but there is no requirement specifying what happens when a consumer encounters an unrecognised schema version. Add a requirement that the platform rejects or degrades gracefully on version mismatch.

---

### 3.2 Performance Targets Mix P50/P95 Inconsistently

**Location:** Section 5.1
**Severity:** Minor

MCP endpoint latency has both P50 and P95 targets. All other metrics (registry search, dashboard load) have only a single target with no percentile specified. Clarify whether these are P50, P95, or mean. For user-facing SLOs, P95 is the appropriate measure.

---

### 3.3 "100+ concurrent ingestion jobs" Is Not Measurable

**Location:** Section 5.2
**Severity:** Minor

"100+" is not an SLA. Define a specific target (e.g. 200 concurrent jobs) and specify what degradation is acceptable when the limit is reached: queuing with position feedback, rejection with 429, or silent delay.

---

### 3.4 Phase 1 Has No Database in Stack

**Location:** Section 7, Phase 1; Section 6
**Severity:** Minor

Phase 1 goal is "end-to-end pipeline working for a single site." The recommended stack includes PostgreSQL, but Phase 1 makes no mention of database setup. If Phase 1 stores a semantic model (needed to generate the MCP endpoint), the data layer must be defined in Phase 1 scope, not implied.

---

### 3.5 Dashboard RBAC Roles Are Undefined

**Location:** FR-053
**Severity:** Minor

FR-053 references roles: owner, editor, viewer — but does not specify what permissions each role has. Before implementing RBAC, a permissions matrix is needed. At minimum: which roles can trigger re-crawl, revoke consumer keys, edit schema, and view analytics.

---

### 3.6 llms.txt Consideration (Open Question #5)

**Location:** Section 8.1
**Severity:** Minor (informational)

The `llms.txt` standard (a proposed convention for LLM-readable site summaries) is a complement to rather than a replacement for agent.json. WebBridge could auto-generate `llms.txt` content as a lightweight alternative discovery mechanism that does not require MCP. This is low-effort and high-visibility in the LLM developer community. Recommend adding as a Phase 2 feature.

---

## 4. Requirement Completeness Analysis

### Missing Requirements (should be added)

| ID (proposed) | Requirement | Priority |
|---|---|---|
| FR-007b | The platform must send a notification when a crawl fails, with error reason. | Must Have |
| FR-032b | Credential access during proxy must use short-lived session tokens, refreshed transparently. | Must Have |
| FR-060 | The platform must provide a domain ownership verification mechanism before allowing robots.txt override. | Must Have |
| FR-061 | All MCP responses must include a `X-WebBridge-Last-Crawled` header with the ISO 8601 timestamp of the last ingestion. | Must Have |
| FR-062 | Consumers must be able to register and self-issue API keys via a public registration flow. | Must Have |
| FR-063 | The platform must define and document a standard error response schema for all MCP endpoints. | Must Have |
| FR-064 | Crawled raw HTML/content must be deleted within 24 hours of ingestion completing; only the semantic model is retained. | Must Have |
| FR-065 | The platform must support cursor-based pagination for generated list resources. | Should Have |

---

## 5. Open Questions — Recommended Resolutions

| # | Question | Recommended Resolution |
|---|---|---|
| 1 | Legal status of third-party crawling | Require domain ownership verification (DNS or file-based) for all registrations. Sites not owned by the registrant can only be crawled with explicit permission (ToS acknowledgement + verification). |
| 2 | Proxy vs. hand-off model | Adopt hybrid: hand-off for unauthenticated read resources, proxy only for authenticated or write actions. This limits the blast radius of credential compromise. |
| 3 | CAPTCHA / bot detection | Do not support CAPTCHA solving services in v1.0 — ethical and legal risk is too high. Surface a clear error to site owners when bot detection blocks crawl, document as a known limitation. |
| 4 | Pricing model | Per-site subscription for site owners (predictable revenue) + per-request metering for consumers above a free tier (usage-based). Defer final model to commercial team but design data model to support both from day one. |
| 5 | llms.txt support | Add as Phase 2 feature — auto-generate from semantic model. Low effort, good developer community signal. |

---

## 6. Technical Stack Review

The recommended stack in Section 6 is generally sound. A few observations:

**Playwright:** Good choice for SPA rendering. Be aware that Playwright's headless mode is detectable by advanced bot-protection systems (Cloudflare, Akamai). If anti-scraping evasion becomes a requirement, Playwright's `playwright-extra` with stealth plugins addresses this — but requires legal/ethical review first.

**BullMQ (Redis-backed):** Appropriate for Phase 1 scale. At 100+ concurrent jobs with Chromium instances, memory pressure on the queue worker nodes will be significant. Chromium can consume 200–500MB per instance. Specify resource limits per crawl job container in the infra requirements.

**Claude API (claude-sonnet-4-6):** Appropriate model choice for semantic classification. LLM calls per page will be the dominant cost driver. The SRS should include a cost model: estimate LLM tokens per page × average pages per site × number of registered sites to validate unit economics before committing to this architecture.

**PostgreSQL with JSONB:** Correct choice for the semantic model. However, consider that full-text search on the registry (FR-041) requires either `pg_trgm`/`tsvector` indices or a separate search index (e.g. Typesense, Meilisearch). Clarify which approach is used — the chosen stack does not mention a search layer.

**Auth0 / Clerk:** Both appropriate. Note that enterprise SSO (SAML/OIDC for the Enterprise persona, Persona C) requires Auth0's enterprise tier or a Clerk add-on. Validate pricing assumptions match the target customer segment.

---

## 7. Summary Scorecard

| Area | Status | Notes |
|---|---|---|
| Problem statement | Ready | Clear, well-motivated |
| Vision & scope | Ready | Scope boundaries are clear |
| User personas | Ready | Three distinct, realistic personas |
| Architecture overview | Needs work | Proxy vs. hand-off unresolved; semantic model undefined |
| Functional requirements | Needs work | Several Must Have requirements underspecified |
| Non-functional requirements | Needs work | Percentile targets inconsistent; compliance underspecified |
| Security model | Needs work | Credential access pattern gaps; key management undefined |
| Delivery roadmap | Acceptable | Phase 1 feasible; Phase 3/4 timelines optimistic |
| Open questions | Needs work | Q1 and Q2 are blockers, not optionals |
| Technical stack | Acceptable | Missing search layer; cost model absent |

---

*This review was produced as part of the WebBridge internal SRS review process. All findings should be triaged with the engineering lead and product owner before the Phase 1 kickoff.*
