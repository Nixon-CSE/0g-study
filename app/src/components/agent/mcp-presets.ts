/**
 * Curated catalogue of commonly-used MCP servers. Used by both the
 * Create Agent modal and the agent profile MCP tab so users can one-click
 * add a known-good server instead of looking up its package name.
 *
 * Selection criteria:
 *  - Installable via `npx` only — the agent's runtime Docker image
 *    (`node:20-bookworm-slim`) does not bundle `uv`/`uvx`, so Python-based
 *    servers (Fetch, Time, Git, official SQLite) are intentionally excluded.
 *  - Either actively maintained, or archived-but-still-published packages
 *    that continue to work. Archived servers are flagged so the UI can
 *    surface that fact to the user.
 *  - Top 6 by likely hackathon relevance.
 *
 * Verified against upstream docs (modelcontextprotocol/servers README,
 * brave/brave-search-mcp-server, archived package manifests) on 2026-05-15.
 *
 * `args` and `envHints` are shaped exactly like the form fields:
 *  - `args`: space-separated tokens
 *  - `envHints`: newline-separated KEY=VALUE; leave the value blank so
 *    the user must fill in a real secret.
 */
export interface McpPreset {
  id: string;
  name: string;
  description: string;
  command: string;
  args: string;
  /** Pre-filled env keys with empty values for the user to complete. */
  envHints?: string;
  /** True when the user must edit args (e.g. supply a path / connection string). */
  needsArgEdit?: boolean;
  /**
   * Archived/unmaintained packages still work but the upstream repo has
   * moved or been archived. Surfaced as a small label in the UI.
   */
  archived?: boolean;
}

export const MCP_PRESETS: McpPreset[] = [
  {
    id: 'filesystem',
    name: 'Filesystem',
    description: 'Read and write local files within a sandboxed directory. Replace /tmp with the path you want the agent to access.',
    command: 'npx',
    args: '-y @modelcontextprotocol/server-filesystem /tmp',
    needsArgEdit: true,
  },
  {
    id: 'memory',
    name: 'Memory',
    description: 'Persistent knowledge-graph memory that survives across conversations. No API key required.',
    command: 'npx',
    args: '-y @modelcontextprotocol/server-memory',
  },
  {
    id: 'brave-search',
    name: 'Brave Search',
    description: 'Live web search via the Brave Search API. Get a free key at api-dashboard.search.brave.com.',
    command: 'npx',
    args: '-y @brave/brave-search-mcp-server --transport stdio',
    envHints: 'BRAVE_API_KEY=',
  },
  {
    id: 'github',
    name: 'GitHub',
    description: 'Browse repos, issues, and PRs via the GitHub API. Create a personal access token at github.com/settings/tokens.',
    command: 'npx',
    args: '-y @modelcontextprotocol/server-github',
    envHints: 'GITHUB_PERSONAL_ACCESS_TOKEN=',
    archived: true,
  },
  {
    id: 'sequential-thinking',
    name: 'Sequential Thinking',
    description: 'Step-by-step reasoning scaffold for complex tasks. No setup required.',
    command: 'npx',
    args: '-y @modelcontextprotocol/server-sequential-thinking',
  },
  {
    id: 'postgres',
    name: 'Postgres',
    description: 'Read-only SQL queries against a Postgres database. Replace the connection string with your own.',
    command: 'npx',
    args: '-y @modelcontextprotocol/server-postgres postgresql://localhost/db',
    needsArgEdit: true,
    archived: true,
  },
];
