import { basename } from 'node:path';
import drivers from '../../bench/drivers.json' with { type: 'json' };

const events = new Set(['PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'Stop', 'SubagentStop', 'SessionStart', 'UserPromptSubmit', 'SessionEnd']);
const object = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const text = value => typeof value === 'string' ? value : '';

export function normalizeEvent(payload, { eventName } = {}) {
  const raw = object(payload);
  const event = eventName || text(raw.hook_event_name);
  const sessionId = text(raw.parent_session_id) || text(raw.session_id);
  if (!events.has(event) || !sessionId) throw new Error('HOOK_EVENT: supported event and session_id are required');
  const agentId = text(raw.agent_id);
  return {
    host: 'claude-code', event, sessionId, agentId,
    sessionKey: `claude-code:${JSON.stringify([sessionId, agentId || null])}`,
    parentSessionKey: `claude-code:${JSON.stringify([sessionId, null])}`,
    tool: text(raw.tool_name), input: object(raw.tool_input),
    response: raw.tool_response, error: raw.error,
    stopHookActive: raw.stop_hook_active === true,
    hostPid: Number.isInteger(raw.host_pid) && raw.host_pid > 0 ? raw.host_pid : null,
    toolUseId: text(raw.tool_use_id)
  };
}

// Tokenize a single command without evaluating expansions, operators or redirects.
export function commandWords(command) {
  if (typeof command !== 'string' || /[\n\r\0]/.test(command)) return null;
  const words = [];
  let word = '', quote = '', active = false;
  for (let i = 0; i < command.length; i++) {
    const char = command[i];
    if (char === '`' || char === '$') return null;
    if (quote) {
      if (char === quote) quote = '';
      else if (char === '\\' && quote === '"') { if (++i >= command.length) return null; word += command[i]; }
      else word += char;
      continue;
    }
    if (char === '"' || char === "'") { quote = char; active = true; }
    else if (char === '\\') { if (++i >= command.length) return null; word += command[i]; active = true; }
    else if (/\s/.test(char)) { if (active) { words.push(word); word = ''; active = false; } }
    else if (/[;&|<>()]/.test(char)) return null;
    else { word += char; active = true; }
  }
  if (quote) return null;
  if (active) words.push(word);
  return words;
}

export function browserTool(event, catalog = drivers.drivers) {
  if (event.tool === 'Bash') {
    const command = text(event.input.command).trimStart();
    const words = commandWords(command);
    const first = words?.[0] || command.match(/^["']?([^\s"';|&]+)/)?.[1];
    const driver = catalog.find(row => (row.cliCommands || []).includes(basename(first || '')));
    let action = '';
    for (let index = 1; index < (words?.length || 0); index++) {
      if (/^--(?:session|profile|cdp|browser|channel|user-data-dir|userDataDir|headers|executable-path)$/.test(words[index])) { index++; continue; }
      if (!words[index].startsWith('-')) { action = words[index]; break; }
    }
    return driver ? { driverId: driver.id, action, args: words, valid: Boolean(words), transport: 'cli' } : null;
  }
  const match = /^mcp__([^_]+(?:_[^_]+)*)__([\w-]+)$/.exec(event.tool);
  if (!match) return null;
  const server = match[1].replaceAll('_', '-');
  const action = match[2];
  if (/^(?:playwright|playwright-mcp|browser)$/.test(server) && action.startsWith('browser_')) return { driverId: 'playwright-mcp', action, args: null, valid: true, transport: 'mcp' };
  if (/^(?:chrome-devtools|chrome-devtools-mcp)$/.test(server)) return { driverId: 'chrome-devtools-mcp', action, args: null, valid: true, transport: 'mcp' };
  return null;
}

export function deny(event, reason) {
  if (event.event === 'PreToolUse') return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } };
  if (event.event === 'Stop' || event.event === 'SubagentStop') return { decision: 'block', reason };
  return {};
}

export function context(event, message) {
  if (!message) return {};
  if (['PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'SessionStart', 'UserPromptSubmit'].includes(event.event)) return { hookSpecificOutput: { hookEventName: event.event, additionalContext: message } };
  return { systemMessage: message };
}
