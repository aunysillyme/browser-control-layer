export const companions = Object.freeze([
  { name: 'rtk-ai/rtk', command: 'curl -fsSL https://raw.githubusercontent.com/rtk-ai/rtk/master/install.sh | sh', url: 'https://github.com/rtk-ai/rtk#installation' },
]);
export function catalog({ skillName }) {
  return [
    { id:'claude-code', name:'Claude Code', skill:`.claude/skills/${skillName}`, runner:'.claude/agents/aun-runner-browser.md', hooks:true, tools:'Bash, mcp__playwright__*, mcp__chrome-devtools__*' },
    { id:'codex', name:'Codex', skill:`.agents/skills/${skillName}`, runner:'.agents/aun-runner-browser.md', tools:'Installed browser MCP tools and terminal' },
    { id:'gemini-cli', name:'Gemini CLI', skill:`skills/${skillName}`, runner:'.gemini/aun-runner-browser.md', context:'GEMINI.md', tools:'Installed browser tools and terminal' },
    { id:'cursor', name:'Cursor', skill:`skills/${skillName}`, runner:'.cursor/aun-runner-browser.md', context:`.cursor/rules/${skillName}.mdc`, tools:'Installed browser tools and terminal' },
    { id:'agents-md', name:'AGENTS.md', skill:`skills/${skillName}`, runner:'agents/aun-runner-browser.md', context:'AGENTS.md', tools:'Installed browser tools and terminal' },
    { id:'zero-install', name:'Zero install', tools:'Installed browser tools and terminal' },
  ];
}
export function renderRunner(template, host, command) {
  const values = {HOST_NAME:host.name,BROWSER_TOOLS:host.tools,READ_COMMAND:`${command} read`,CLEANUP_COMMAND:`${command} cleanup --session --apply`};
  const keys=[...new Set([...template.matchAll(/\{\{([^}]+)\}\}/g)].map(m=>m[1]))];
  if (keys.length!==4 || keys.some(key=>!(key in values))) throw Error('RUNNER_TEMPLATE: exactly four supported placeholders required');
  const rendered=template.replace(/\{\{([^}]+)\}\}/g,(_,key)=>values[key]);
  if (Buffer.byteLength(rendered)>4096) throw Error('RUNNER_SIZE: rendered runner exceeds 4 KB');
  return rendered;
}
