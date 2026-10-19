import { posix } from 'node:path';
import { owned, read } from './bundle.mjs';
function visibleMarkdown(text) {
  let fence = null;
  return text.split('\n').map(line => {
    const m = line.match(/^\s*(`{3,}|~{3,})/);
    if (m) {
      if (!fence) fence = m[1];
      else if (m[1][0] === fence[0] && m[1].length >= fence.length) fence = null;
      return '';
    }
    return fence ? '' : line.replace(/`[^`]*`/g, '');
  }).join('\n');
}

// Fenced blocks, closed the way a Markdown reader closes them: same marker, at least as
// long, indented up to three spaces. Returns each block's body.
export function fenced(text) {
  const blocks = [];
  let marker = null, body = [];
  for (const line of text.replace(/\r\n/g, '\n').split('\n')) {
    const open = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (!marker) { if (open) { marker = open[1]; body = []; } continue; }
    if (open && open[1][0] === marker[0] && open[1].length >= marker.length && !line.slice(line.indexOf(open[1]) + open[1].length).trim()) { blocks.push(body.join('\n')); marker = null; continue; }
    body.push(line);
  }
  return blocks;
}

function anchors(text) {
  const result = new Set(), counts = new Map();
  for (const match of visibleMarkdown(text).matchAll(/^#{1,6}\s+(.+?)\s*#*$/gm)) {
    const base = match[1].toLowerCase().replace(/<[^>]*>/g, '').replace(/[^\p{L}\p{N}_\-\s]/gu, '').replace(/ /g, '-');
    const count = counts.get(base) || 0;
    result.add(count ? `${base}-${count}` : base); counts.set(base, count + 1);
  }
  for (const m of text.matchAll(/\b(?:id|name)=["']([^"']+)["']/g)) result.add(m[1]);
  return result;
}

export function linkIssues(root, name, text) {
  const body = visibleMarkdown(text), urls = [], issues = [], refs = new Map();
  for (const m of body.matchAll(/^\s*\[([^\]]+)\]:\s*(<[^>]+>|\S+)/gm)) refs.set(m[1].toLowerCase(), m[2].replace(/^<|>$/g, ''));
  for (const m of body.matchAll(/!?\[[^\]\n]*\]\(\s*(<[^>]+>|[^\s)]+)(?:\s+["'][^\n]*?["'])?\s*\)/g)) urls.push(m[1].replace(/^<|>$/g, ''));
  for (const m of body.matchAll(/!?\[([^\]\n]+)\]\[([^\]\n]*)\]/g)) {
    const key = (m[2] || m[1]).toLowerCase();
    if (!refs.has(key)) issues.push(`LINK:${name}:undefined reference ${key}`);
    else urls.push(refs.get(key));
  }
  for (const m of body.matchAll(/(?:href|src)=["']([^"']+)["']/g)) urls.push(m[1]);
  urls.push(...refs.values());
  for (const url of urls) {
    if (/^(?:https?:|mailto:|data:|\/\/)/i.test(url)) continue;
    if (/^[a-z][a-z0-9+.-]*:/i.test(url)) { issues.push(`LINK:${name}:unsupported URI`); continue; }
    try {
      const [pathQuery, fragment] = url.split('#'), path = decodeURIComponent(pathQuery.split('?')[0]);
      const target = path ? (path.startsWith('/') ? path.slice(1) : posix.normalize(posix.join(posix.dirname(name), path))) : name;
      owned(root, target);
      if (fragment && target.endsWith('.md') && !anchors(read(root, target)).has(decodeURIComponent(fragment))) throw Error('missing heading');
    } catch { issues.push(`LINK:${name}:unresolved ${url}`); }
  }
  return issues;
}

const PINNED_VERSIONS = {
  'actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1': 'v7.0.1',
  'actions/setup-node@820762786026740c76f36085b0efc47a31fe5020': 'v7.0.0',
};

export function workflowIssues(name, text) {
  const issues = [];
  let workflow;
  try { workflow = JSON.parse(text); }
  catch { return [`WORKFLOW_FORMAT:${name}:use the JSON subset of YAML for structural validation`]; }
  // One exception, as narrow as it can be written: npm trusted publishing exchanges an OIDC
  // token for a short-lived credential, so the publish job of the release workflow needs
  // id-token: write. No other workflow, no other job, and no other permission value.
  const publisher = name === '.github/workflows/release.yml';
  const checkPermissions = (permissions, location, job) => {
    if (!permissions || typeof permissions !== 'object' || Array.isArray(permissions)) issues.push(`WORKFLOW_PERMISSIONS:${location}`);
    else for (const [key, value] of Object.entries(permissions)) {
      if (key === 'contents' && value === 'read') continue;
      if (value === 'none') continue;
      if (publisher && job === 'publish' && key === 'id-token' && value === 'write') continue;
      issues.push(`WORKFLOW_PERMISSIONS:${location}:${key}`);
    }
  };
  checkPermissions(workflow.permissions, name);
  if (!workflow.concurrency || workflow.concurrency['cancel-in-progress'] !== true) issues.push(`WORKFLOW_CONCURRENCY:${name}`);
  // A trigger can be written as an object, a bare string or an array. Checking only the
  // object form let `on: pull_request_target` through as a string.
  const triggers = workflow.on === undefined ? []
    : typeof workflow.on === 'string' ? [workflow.on]
    : Array.isArray(workflow.on) ? workflow.on.filter(t => typeof t === 'string')
    : Object.keys(workflow.on);
  const forbiddenTriggers = ['pull_request_target', 'workflow_run', 'issue_comment'];
  for (const trigger of triggers) if (forbiddenTriggers.includes(trigger)) issues.push(`WORKFLOW_TRIGGER:${name}:${trigger}`);
  // Attacker-controlled event data interpolated straight into a shell is command injection.
  // The safe form passes the value through `env:` and reads it as a variable.
  const injectable = /\$\{\{\s*(?:github\.event\b|github\.head_ref\b|inputs\.|github\.actor\b)[^}]*\}\}/;
  const visitRun = obj => {
    if (!obj || typeof obj !== 'object') return;
    for (const [key, value] of Object.entries(obj)) {
      if (key === 'run' && typeof value === 'string' && injectable.test(value)) issues.push(`WORKFLOW_INJECTION:${name}`);
      visitRun(value);
    }
  };
  visitRun(workflow);
  const visitUses = obj => {
    if (!obj || typeof obj !== 'object') return;
    for (const [key, value] of Object.entries(obj)) {
      if (key === 'uses' && (typeof value !== 'string' || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_./-]+@[a-f0-9]{40}$/.test(value))) issues.push(`ACTION_PIN:${name}`);
      if (key === 'uses' && typeof value === 'string' && value.startsWith('actions/checkout@') && obj.with?.['persist-credentials'] !== false) issues.push(`WORKFLOW_CREDENTIALS:${name}`);
      // A step name that quotes a version must quote the version actually pinned. Dependabot
      // moves the SHA and leaves the label, so without this the workflow lies after every bump.
      if (key === 'uses' && typeof value === 'string' && typeof obj.name === 'string') {
        const labelled = obj.name.match(/\bv\d+(?:\.\d+)*\b/);
        const action = value.split('@')[0].split('/').pop();
        if (labelled && !obj.name.includes(`${action} ${labelled[0]}`)) issues.push(`ACTION_LABEL:${name}:${obj.name}`);
        if (labelled && !PINNED_VERSIONS[value]) issues.push(`ACTION_LABEL:${name}:unverified pin ${value}`);
        else if (labelled && PINNED_VERSIONS[value] !== labelled[0]) issues.push(`ACTION_LABEL:${name}:${obj.name} pins ${PINNED_VERSIONS[value]}`);
      }
      visitUses(value);
    }
  };
  visitUses(workflow);
  for (const [jobName, job] of Object.entries(workflow.jobs || {})) {
    if (job.permissions !== undefined) checkPermissions(job.permissions, `${name}:${jobName}`, jobName);
    if (!job['timeout-minutes']) issues.push(`WORKFLOW_TIMEOUT:${name}:${jobName}`);
  }
  return issues;
}

