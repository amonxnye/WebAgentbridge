// ─── Core domain types ────────────────────────────────────────────────────────

export type PageType =
  | 'article'
  | 'product_listing'
  | 'dashboard'
  | 'form'
  | 'navigation'
  | 'landing'
  | 'search'
  | 'documentation'
  | 'other';

export type FieldType = 'string' | 'number' | 'boolean' | 'date' | 'url' | 'email' | 'array';

export type ActionType = 'search' | 'form_submit' | 'navigate' | 'filter' | 'pagination';

export type InputType = 'text' | 'email' | 'password' | 'select' | 'checkbox' | 'number' | 'textarea';

export type SiteStatus = 'pending' | 'crawling' | 'ready' | 'failed';

export type AuthType = 'none' | 'api_key' | 'basic_auth' | 'oauth2' | 'login_form';

// ─── Semantic model primitives ────────────────────────────────────────────────

export interface EntityField {
  name: string;
  type: FieldType;
  description: string;
  example: string | null;
  required: boolean;
}

export interface ActionInput {
  name: string;
  type: InputType;
  required: boolean;
  description: string;
  options?: string[];
}

export interface NavLink {
  label: string;
  url: string;
  isExternal: boolean;
}

// ─── DB-backed entities ───────────────────────────────────────────────────────

export interface Site {
  id: string;
  slug: string;
  url: string;
  name: string;
  description: string;
  status: SiteStatus;
  authType: AuthType;
  authCredentials: Record<string, unknown> | null;
  crawlDepth: number;
  allowedPaths: string[] | null;
  excludedPaths: string[] | null;
  respectRobotsTxt: boolean;
  lastCrawled: Date | null;
  isPublic: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface CrawledPage {
  id: string;
  siteId: string;
  url: string;
  title: string;
  pageType: PageType;
  summary: string;
  rawText: string;
  navLinks: NavLink[];
  crawledAt: Date;
}

export interface Entity {
  id: string;
  siteId: string;
  pageId: string;
  name: string;
  entityType: string;
  description: string;
  fields: EntityField[];
  sampleData?: Record<string, unknown>;
}

export interface Action {
  id: string;
  siteId: string;
  pageId: string;
  name: string;
  type: ActionType;
  description: string;
  inputs: ActionInput[];
  targetUrl?: string;
  method?: 'GET' | 'POST';
}

// ─── Semantic classification result (LLM output) ─────────────────────────────

export interface ClassificationResult {
  pageType: PageType;
  summary: string;
  entities: Array<Omit<Entity, 'id' | 'siteId' | 'pageId'>>;
  actions: Array<Omit<Action, 'id' | 'siteId' | 'pageId'>>;
}

// ─── Generated specs ──────────────────────────────────────────────────────────

export interface AgentJson {
  schema_version: string;
  name: string;
  description: string;
  mcp_endpoint: string;
  capabilities: string[];
  auth: { type: string; scopes?: string[] };
  last_crawled: string | null;
}

export interface MCPTool {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, {
      type: string;
      description: string;
      enum?: string[];
    }>;
    required: string[];
  };
}

export interface MCPResource {
  uri: string;
  name: string;
  description: string;
  mimeType: string;
}

export interface MCPManifest {
  name: string;
  version: string;
  description: string;
  tools: MCPTool[];
  resources: MCPResource[];
}

// ─── JSON-RPC 2.0 types (MCP transport) ──────────────────────────────────────

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: string | number | null;
  method: string;
  params?: unknown;
}

export interface JsonRpcSuccessResponse {
  jsonrpc: '2.0';
  id: string | number | null;
  result: unknown;
}

export interface JsonRpcErrorResponse {
  jsonrpc: '2.0';
  id: string | number | null;
  error: {
    code: number;
    message: string;
    data?: unknown;
  };
}

export type JsonRpcResponse = JsonRpcSuccessResponse | JsonRpcErrorResponse;

// ─── Job queue payload ────────────────────────────────────────────────────────

export interface CrawlJobPayload {
  siteId: string;
  siteSlug: string;
  siteUrl: string;
}
