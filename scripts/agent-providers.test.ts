import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  MASKED_SECRET,
  buildSettingsConfig,
  claudeUnmanagedKeys,
  extractFormValues,
  isClaudeManagedKey,
} from '../src/renderer/lib/agentProviders.ts';

const claude = (env: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({ name: 'P', settingsConfig: { ...extra, env } });

test('a Claude Code key read from ANTHROPIC_API_KEY is written back there, masked or not', () => {
  const source = claude({ ANTHROPIC_API_KEY: MASKED_SECRET, ANTHROPIC_BASE_URL: 'https://a' });
  const form = extractFormValues('claude-code', source);
  assert.equal(form.apiKey, MASKED_SECRET);
  const env = buildSettingsConfig('claude-code', form, source).env as Record<string, unknown>;
  assert.equal(env.ANTHROPIC_API_KEY, MASKED_SECRET);
  assert.equal(env.ANTHROPIC_AUTH_TOKEN, undefined);
});

test('new Claude Code profiles and ones with an auth token use ANTHROPIC_AUTH_TOKEN', () => {
  const fresh = buildSettingsConfig('claude-code', { ...extractFormValues('claude-code'), apiKey: 'sk' }).env as Record<string, unknown>;
  assert.deepEqual(fresh, { ANTHROPIC_AUTH_TOKEN: 'sk' });
  const both = claude({ ANTHROPIC_AUTH_TOKEN: 'a', ANTHROPIC_API_KEY: 'b' });
  const env = buildSettingsConfig('claude-code', { ...extractFormValues('claude-code', both), apiKey: 'c' }, both).env as Record<string, unknown>;
  assert.equal(env.ANTHROPIC_AUTH_TOKEN, 'c');
  assert.equal(env.ANTHROPIC_API_KEY, 'b');
});

test('clearing Claude Code form fields removes their env keys', () => {
  const source = claude({ ANTHROPIC_BASE_URL: 'https://a', ANTHROPIC_API_KEY: 'k', ANTHROPIC_MODEL: 'm', OTHER: '1' }, { permissions: {} });
  const form = { ...extractFormValues('claude-code', source), baseUrl: ' ', apiKey: '', model: '' };
  assert.deepEqual(buildSettingsConfig('claude-code', form, source), { permissions: {}, env: { OTHER: '1' } });
});

test('Claude Code managed keys match the backend list', () => {
  for (const name of ['ANTHROPIC_BASE_URL', 'ANTHROPIC_SMALL_FAST_MODEL', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'CLAUDE_CODE_USE_FOUNDRY']) {
    assert.equal(isClaudeManagedKey('env', name), true, name);
  }
  assert.equal(isClaudeManagedKey('env', 'CLAUDE_CODE_MAX_OUTPUT_TOKENS'), false);
  assert.equal(isClaudeManagedKey('top', 'model'), true);
  assert.equal(isClaudeManagedKey('top', 'apiKeyHelper'), true);
  assert.equal(isClaudeManagedKey('top', 'permissions'), false);
  assert.deepEqual(
    claudeUnmanagedKeys({ model: 'x', permissions: {}, env: { ANTHROPIC_MODEL: 'm', HTTP_PROXY: 'p' } }),
    ['permissions', 'env.HTTP_PROXY'],
  );
});

const codexConfig = `model_provider = "gw"
model = "gpt-5"
model_reasoning_effort = "high"
model_context_window = 272000
approval_policy = "never"

[model_providers.gw]
name = "Gateway"
base_url = "https://gw/v1"
model_context_window = 1
`;

test('Codex effort and context window round-trip through the form', () => {
  const source = { name: 'Gateway', settingsConfig: { auth: { OPENAI_API_KEY: MASKED_SECRET }, config: codexConfig } };
  const form = extractFormValues('codex', source);
  assert.equal(form.reasoningEffort, 'high');
  assert.equal(form.contextWindow, '272000');
  const config = buildSettingsConfig('codex', { ...form, reasoningEffort: 'xhigh', contextWindow: '1048576' }, source).config as string;
  assert.match(config, /^model_reasoning_effort = "xhigh"$/m);
  assert.match(config, /^model_context_window = 1048576$/m);
  assert.match(config, /^approval_policy = "never"$/m);
});

test('clearing Codex effort and context window drops only the top-level keys', () => {
  const source = { name: 'Gateway', settingsConfig: { auth: {}, config: codexConfig } };
  const form = { ...extractFormValues('codex', source), reasoningEffort: '', contextWindow: ' ' };
  const config = buildSettingsConfig('codex', form, source).config as string;
  assert.doesNotMatch(config, /model_reasoning_effort/);
  assert.doesNotMatch(config, /^model_context_window = 272000$/m);
  // A same-named key inside a table is not the top-level setting.
  assert.match(config, /^model_context_window = 1$/m);
  assert.match(config, /^base_url = "https:\/\/gw\/v1"$/m);
});
