// In-memory stand-in for the todex-agentd transport used by the demo preview.
// REST paths answer from ./fixtures; the socket opens at once, backfills
// subscriptions and plays a canned turn for every prompt, so the real session
// reducers build the timeline, running state and usage exactly as they would.
import type {
  SecureRequest,
  SecureResponse,
  SecureSocket,
  SecureSocketOptions,
  SecureStreamResponse,
  SecureTransport,
} from '@todex/protocol/secureTransport';
import type { ConversationEvent, ConversationManifest, ProviderKind } from '@todex/protocol/v2';
import * as fixtures from './fixtures';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

type Journal = { manifest: ConversationManifest; events: ConversationEvent[] };

// Mutable copies so prompts, renames and kanban edits persist for the tab.
const journals = new Map<string, Journal>(
  fixtures.demoJournals.map((journal) => [journal.manifest.id, { manifest: { ...journal.manifest }, events: [...journal.events] }]),
);
let workspaces = [...fixtures.demoWorkspaces];
let kanbanTasks = [...fixtures.demoKanbanTasks];
const sockets = new Set<DemoSocket>();

function json(value: unknown, status = 200): SecureResponse {
  return { status, headers: { 'content-type': 'application/json' }, body: encoder.encode(JSON.stringify(value)) };
}

function notFound(method: string, path: string): SecureResponse {
  console.info(`[demo] ${method} ${path} is not part of the preview`);
  return json({ error: { code: 'NOT_FOUND', message: `${path} is not available in the demo preview` } }, 404);
}

function readBody(request: SecureRequest): Record<string, unknown> {
  if (!request.body) return {};
  try {
    const text = typeof request.body === 'string' ? request.body : decoder.decode(request.body);
    const value = JSON.parse(text) as unknown;
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function readQuery(request: SecureRequest, url: URL): URLSearchParams {
  const { query } = request;
  if (!query) return url.searchParams;
  if (typeof query === 'string') return new URLSearchParams(query.startsWith('?') ? query.slice(1) : query);
  return new URLSearchParams(query);
}

function replay(journal: Journal, query: URLSearchParams) {
  const limit = Number(query.get('limit')) || 200;
  const before = query.get('beforeSequence');
  if (before !== null) {
    const events = journal.events.filter((event) => event.sequence <= Number(before)).slice(-limit);
    const first = events[0]?.sequence ?? Number(before) + 1;
    return { conversationId: journal.manifest.id, fromSequence: first, nextSequence: (events.at(-1)?.sequence ?? Number(before)) + 1, hasMore: first > 1, events };
  }
  const after = Number(query.get('afterSequence')) || 0;
  const events = journal.events.filter((event) => event.sequence > after).slice(0, limit);
  // An empty page leaves the cursor where it was; it is not a gap.
  const last = events.at(-1)?.sequence ?? after;
  return { conversationId: journal.manifest.id, fromSequence: after + 1, nextSequence: last + 1, hasMore: last < journal.events.length, events };
}

function route(request: SecureRequest): SecureResponse {
  const method = request.method.toUpperCase();
  const url = new URL(request.path, fixtures.DEMO_SERVER_URL);
  const path = url.pathname;
  const query = readQuery(request, url);
  const provider = (query.get('provider') ?? 'claude-code') as ProviderKind;
  const now = new Date().toISOString();

  if (method === 'GET') {
    switch (path) {
      case '/health':
        return json({ status: 'ok' });
      case '/v2/transport-policy':
        return json({ requiredProtocol: 'none' });
      case '/v2/version':
        return json({ name: 'todex-agentd', version: '2.2.0', data_dir: '/home/demo/.todex-agent', workspace_root: fixtures.DEMO_ROOT });
      case '/v2/providers':
        return json({ providers: fixtures.demoProviders });
      case '/v2/providers/models':
        return json({ provider, models: fixtures.demoModels[provider] ?? [], source: 'demo', fetchedAt: now });
      case '/v2/providers/image-input':
        return json({ provider, imageInput: true, source: 'demo' });
      case '/v2/providers/commands':
        return json({
          provider,
          source: 'demo',
          fetchedAt: now,
          commands: [
            { name: 'review', description: '审查当前改动', source: 'builtin', invocation: '/review' },
            { name: 'compact', description: '压缩上下文', source: 'builtin', invocation: '/compact' },
          ],
        });
      case '/v2/providers/quota':
        return json(fixtures.demoQuota);
      case '/v2/providers/versions':
        return json(fixtures.demoCliVersions);
      case '/v2/agent-providers':
        return json(fixtures.demoAgentProviders);
      case '/v2/catalog/skills':
        return json(fixtures.demoSkills(provider));
      case '/v2/catalog/mcp':
        return json(fixtures.demoMcp(provider));
      case '/v2/workspaces':
        return json({ workspaces });
      case '/v2/conversations':
        return json({ conversations: [...journals.values()].map((journal) => journal.manifest) });
      case '/v2/kanban/tasks':
        return json({ tasks: kanbanTasks });
      case '/v2/git/workspace':
        return json(fixtures.demoGitWorkspace(query.get('workspacePath') ?? ''));
      case '/v2/git/status':
        return json(fixtures.demoGitStatus(query.get('workspacePath') ?? ''));
      case '/v2/git/scan':
        return json(fixtures.demoGitScan(query.get('workspacePath') ?? ''));
      default:
        break;
    }
    const conversation = path.match(/^\/v2\/conversations\/([^/]+)(\/events)?$/);
    const journal = conversation ? journals.get(decodeURIComponent(conversation[1])) : undefined;
    if (journal) return json(conversation?.[2] ? replay(journal, query) : journal.manifest);
    const live = path.match(/^\/v2\/agent-providers\/([^/]+)\/live$/);
    if (live) {
      const bucket = fixtures.demoAgentProviders.agents[live[1] as keyof typeof fixtures.demoAgentProviders.agents];
      return bucket ? json(bucket.live) : notFound(method, path);
    }
    const skill = path.match(/^\/v2\/catalog\/skills\/(.+)$/);
    if (skill) return json({ resourceId: decodeURIComponent(skill[1]), content: '# 示例 Skill\n\n演示数据，不会发送到任何后端。' });
    return notFound(method, path);
  }

  const body = readBody(request);
  if (path === '/v2/workspaces' && method === 'PUT') {
    if (Array.isArray(body.workspaces)) workspaces = body.workspaces as typeof workspaces;
    return json({ workspaces });
  }
  if (path === '/v2/kanban/tasks' && method === 'PUT') {
    if (Array.isArray(body.tasks)) kanbanTasks = body.tasks as typeof kanbanTasks;
    return json({ tasks: kanbanTasks });
  }
  if (path === '/v2/conversations' && method === 'POST') {
    const id = crypto.randomUUID();
    const manifest: ConversationManifest = {
      schemaVersion: 2,
      id,
      provider: (typeof body.provider === 'string' ? body.provider : 'claude-code') as ProviderKind,
      ownerId: 'local',
      workspace: typeof body.workspace === 'string' ? body.workspace : fixtures.demoWorkspaces[0].path,
      ...(typeof body.workspaceId === 'string' ? { workspaceId: body.workspaceId } : {}),
      title: typeof body.title === 'string' ? body.title : '新对话',
      status: 'idle',
      lastSequence: 0,
      createdAt: now,
      updatedAt: now,
    };
    journals.set(id, { manifest, events: [] });
    return json(manifest);
  }
  const conversation = path.match(/^\/v2\/conversations\/([^/]+)$/);
  const journal = conversation ? journals.get(decodeURIComponent(conversation[1])) : undefined;
  if (journal && method === 'PATCH') {
    if (typeof body.title === 'string') journal.manifest.title = body.title;
    if (body.archived === true) journal.manifest.archivedAt = now;
    if (body.archived === false) delete journal.manifest.archivedAt;
    return json(journal.manifest);
  }
  if (journal && method === 'DELETE') {
    journals.delete(journal.manifest.id);
    return json({ deleted: true });
  }
  const cli = path.match(/^\/v2\/providers\/([^/]+)\/(upgrade|install)$/);
  if (cli) {
    return json({ id: `op-${Date.now()}`, provider: cli[1], action: cli[2], status: 'succeeded', startedAt: now, finishedAt: now });
  }
  return notFound(method, path);
}

// --- Socket -------------------------------------------------------------------

class DemoSocket implements SecureSocket {
  readonly encrypted = false;
  ready = true;
  closed = false;

  constructor(private readonly handlers: SecureSocketOptions) {
    sockets.add(this);
    // The session only accepts onOpen once openSocket has returned.
    setTimeout(() => {
      if (!this.closed) this.handlers.onOpen?.();
    }, 50);
  }

  send(text: string): void {
    let message: { id?: string; type?: string; payload?: Record<string, unknown> };
    try {
      message = JSON.parse(text) as typeof message;
    } catch {
      return;
    }
    const payload = message.payload ?? {};
    let result: Record<string, unknown> = {};
    if (message.type === 'conversation.subscribe') {
      const journal = journals.get(String(payload.conversationId));
      if (journal) {
        const backfill = replay(journal, new URLSearchParams({ afterSequence: String(payload.afterSequence ?? 0), limit: String(payload.limit ?? 200) }));
        for (const event of backfill.events) this.emit({ type: 'conversation.event', payload: event });
        result = { conversationId: journal.manifest.id, nextSequence: backfill.nextSequence, hasMore: backfill.hasMore };
      }
    } else if (message.type === 'conversation.prompt') {
      const journal = journals.get(String(payload.conversationId));
      if (journal) result = { conversationId: journal.manifest.id, turnId: playCannedTurn(journal, String(payload.text ?? '')) };
    }
    if (message.id) this.emit({ type: 'server.result', id: message.id, payload: result });
  }

  close(code = 1000, reason = ''): void {
    if (this.closed) return;
    this.closed = true;
    this.ready = false;
    sockets.delete(this);
    setTimeout(() => this.handlers.onClose?.({ code, reason }), 0);
  }

  emit(message: unknown): void {
    if (!this.closed) this.handlers.onMessage?.(JSON.stringify(message));
  }
}

function broadcast(event: ConversationEvent) {
  for (const socket of sockets) socket.emit({ type: 'conversation.event', payload: event });
}

/** Streams a short scripted turn so prompts typed in the preview get an answer. */
function playCannedTurn(journal: Journal, text: string): string {
  const turnId = `${journal.manifest.id}-live-${Date.now()}`;
  const toolCallId = `${turnId}-call`;
  const steps: Array<[number, string, Record<string, unknown>]> = [
    [0, 'message.created', { role: 'user', content: text }],
    [150, 'turn.started', { status: 'running' }],
    [700, 'thought.delta', { thinking: '这是演示预览：后端是内存中的模拟数据，下面的步骤和回复都是预设的。' }],
    [1400, 'tool.started', { toolCallId, toolName: 'Read', arguments: { file_path: 'README.md' } }],
    [2600, 'tool.completed', { toolCallId, toolName: 'Read', arguments: { file_path: 'README.md' }, result: '# Lumen\n\n演示项目说明……', isError: false }],
    [3800, 'message.completed', {
      role: 'assistant',
      message: { role: 'assistant', content: [{ type: 'text', text: `收到：「${text.slice(0, 60)}」\n\n这是演示模式的预设回复，用来预览对话流、工具卡片和完成状态的样式。真实对话请在连接后端的正常模式下进行。` }] },
      block: { category: 'assistant_final', id: `${turnId}-answer`, turnId, phase: 'completed' },
    }],
    [3900, 'usage.updated', { model: 'opus', contextWindow: 200_000, usage: { last: { input: 9_800, output: 640, cacheRead: 52_000, cacheWrite: 1_200, total: 10_440 } } }],
    [4000, 'turn.completed', { status: 'completed' }],
  ];
  for (const [delay, type, payload] of steps) {
    setTimeout(() => {
      const event: ConversationEvent = {
        schemaVersion: 2,
        eventId: `${turnId}-${type}`,
        conversationId: journal.manifest.id,
        sequence: journal.events.length + 1,
        time: new Date().toISOString(),
        type,
        provider: journal.manifest.provider,
        payload: { turnId, ...payload },
      };
      journal.events.push(event);
      journal.manifest.lastSequence = event.sequence;
      journal.manifest.updatedAt = event.time;
      journal.manifest.status = type === 'turn.completed' ? 'idle' : 'running';
      broadcast(event);
    }, delay);
  }
  return turnId;
}

export const demoTransport: SecureTransport = {
  mode: 'plaintext',
  fetch: async (request) => route(request),
  fetchStream: async (request): Promise<SecureStreamResponse> => {
    const response = route(request);
    return { status: response.status, headers: response.headers, body: (async function* () { yield response.body; })() };
  },
  openSocket: (options = {}) => new DemoSocket(options),
};

/** Answers the two calls that use `window.fetch` directly (health polling and
 * the transport policy probe) from the same routes. */
export function installDemoFetch(): void {
  const realFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, window.location.href);
    if (url.origin !== new URL(fixtures.DEMO_SERVER_URL).origin) return realFetch(input, init);
    const response = route({ method: init?.method ?? 'GET', path: url.pathname, query: url.search });
    return new Response(decoder.decode(response.body), { status: response.status, headers: response.headers });
  };
}
