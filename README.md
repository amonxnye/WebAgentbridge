# WebBridge

**Agentic Web Interface Platform** — converts any website into a structured MCP endpoint consumable by AI agents.

---

## What it does

WebBridge crawls a website with a headless browser, uses Claude to semantically classify pages and extract entities and actions, then auto-generates:

- An **MCP (Model Context Protocol) endpoint** at `POST /sites/{slug}/mcp`
- A machine-readable **agent.json** discovery manifest at `GET /sites/{slug}/agent.json`
- An **OpenAPI 3.1 spec** at `GET /sites/{slug}/openapi.json`
- A public **registry** at `GET /registry`

---

## Quick start

### 1. Prerequisites

- Node.js 18+
- Docker (for PostgreSQL + Redis)
- An Anthropic API key

### 2. Install

```bash
npm install
npm run install:browsers   # installs Playwright Chromium
```

### 3. Start infrastructure

```bash
docker-compose up -d
npm run db:migrate
```

### 4. Configure

```bash
cp .env.example .env
# Edit .env — set ANTHROPIC_API_KEY at minimum
```

### 5. Register a site

```bash
# Inline (synchronous, good for development):
npm run register -- --url https://example.com --name "Example"

# Via queue (asynchronous, requires Redis):
npm run register -- --url https://example.com --queue
npm run worker   # in a separate terminal
```

### 6. Start the server

```bash
npm run dev
```

The server starts at `http://localhost:3000`.

---

## API reference

### MCP endpoint — `POST /sites/{slug}/mcp`

JSON-RPC 2.0 endpoint. Set `Content-Type: application/json`.

**Initialize:**
```json
{ "jsonrpc": "2.0", "id": 1, "method": "initialize" }
```

**List tools:**
```json
{ "jsonrpc": "2.0", "id": 2, "method": "tools/list" }
```

**Call a tool:**
```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "method": "tools/call",
  "params": {
    "name": "list_pages",
    "arguments": { "limit": 10 }
  }
}
```

**Built-in tools for every site:**

| Tool | Description |
|---|---|
| `get_site_info` | Metadata: page count, entity types, capabilities |
| `list_pages` | List all crawled pages (filterable by `page_type`) |
| `get_page` | Get full text content of a specific page by URL |
| `list_{entity_type}` | List structured entities (e.g. `list_product`) |
| `{action_name}` | Execute live search actions (if site has search) |

**List resources:**
```json
{ "jsonrpc": "2.0", "id": 4, "method": "resources/list" }
```

**Read a resource:**
```json
{
  "jsonrpc": "2.0",
  "id": 5,
  "method": "resources/read",
  "params": { "uri": "webbridge://{slug}/pages" }
}
```

### Registry — `GET /registry`

```bash
# All public sites
curl http://localhost:3000/registry

# Search
curl "http://localhost:3000/registry?q=pricing"
```

### agent.json — `GET /sites/{slug}/agent.json`

Machine-readable discovery manifest. Place a link to this at `/.well-known/agent.json` on your domain.

---

## CLI options

```
npm run register -- [options]

Options:
  -u, --url <url>          Website URL to register (required)
  -n, --name <name>        Display name (defaults to hostname)
  -d, --description <desc> Short description
  --depth <depth>          Crawl depth 1–10 (default: 3)
  --private                Hide from public registry
  --queue                  Enqueue via BullMQ instead of inline run
  --slug <slug>            Override auto-generated slug
```

---

## Architecture

```
Register URL
    │
    ▼
WebCrawler (Playwright/Chromium)
    │  crawls pages, extracts text + forms + links
    ▼
SemanticClassifier (Claude claude-sonnet-4-6)
    │  classifies page type, extracts entities + actions
    ▼
PostgreSQL (semantic model store)
    │
    ▼
Generators
    ├── OpenAPI 3.1 spec
    ├── MCP manifest (tools + resources)
    └── agent.json
    │
    ▼
Express MCP Server
    ├── POST /sites/{slug}/mcp  →  JSON-RPC 2.0 handler
    ├── GET  /sites/{slug}/agent.json
    ├── GET  /sites/{slug}/openapi.json
    └── GET  /registry
```

---

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `ANTHROPIC_API_KEY` | — | **Required.** Anthropic API key |
| `DATABASE_URL` | `postgresql://webbridge:webbridge@localhost:5432/webbridge` | PostgreSQL connection string |
| `REDIS_URL` | `redis://localhost:6379` | Redis (for BullMQ worker) |
| `PORT` | `3000` | HTTP server port |
| `PUBLIC_BASE_URL` | `http://localhost:3000` | Public URL (used in generated manifests) |
| `DEFAULT_CRAWL_DEPTH` | `3` | Default crawl depth |
| `CRAWL_DELAY_MS` | `500` | Delay between page fetches (ms) |
| `WEBBRIDGE_API_KEY` | — | If set, all MCP endpoints require this key in `X-API-Key` header |

---

## Phase 1 status

| Feature | Status |
|---|---|
| Headless crawl (Playwright) | ✅ |
| LLM semantic classification (Claude) | ✅ |
| Entity + action extraction | ✅ |
| OpenAPI 3.1 spec generation | ✅ |
| MCP tool manifest generation | ✅ |
| agent.json generation | ✅ |
| MCP JSON-RPC 2.0 endpoint | ✅ |
| Public registry API | ✅ |
| BullMQ async job queue | ✅ |
| robots.txt respect | ✅ |
| Live search proxy (Playwright) | ✅ |
| Developer dashboard | Phase 2 |
| OAuth / login-form auth | Phase 2 |
| Automatic re-crawl | Phase 2 |
| RBAC + team access | Phase 3 |
