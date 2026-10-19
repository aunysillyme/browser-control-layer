export const UNKNOWN_TRANSCRIPT = 'UNKNOWN_TRANSCRIPT';
function invalid(line, detail) {
  return Object.assign(new Error(`Claude Code transcript shape unknown at line ${line}: ${detail}`), { code:UNKNOWN_TRANSCRIPT, exitCode:4 });
}
const metadata = new Set(['user','system','summary','progress','file-history-snapshot','queue-operation','last-prompt']);
const fields = ['input_tokens','output_tokens','cache_creation_input_tokens','cache_read_input_tokens'];

export function parseTranscript(text) {
  const messages = new Map();
  let line = 0;
  for (const source of text.split('\n')) {
    line++;
    if (!source.trim()) continue;
    let event;
    try { event=JSON.parse(source); } catch { throw invalid(line,'expected JSONL'); }
    if (!event || typeof event!=='object' || typeof event.type!=='string') throw invalid(line,'expected typed record');
    if (metadata.has(event.type)) continue;
    if (event.type!=='assistant') throw invalid(line,'unrecognized record type');
    const message=event.message;
    if (!message || typeof message.id!=='string' || !message.id || !message.usage) throw invalid(line,'assistant id and usage required');
    const usage={};
    for (const field of fields) {
      const value=message.usage[field] ?? (field.startsWith('cache_') ? 0 : undefined);
      if (!Number.isSafeInteger(value) || value<0) throw invalid(line,`invalid ${field}`);
      usage[field]=value;
    }
    const previous=messages.get(message.id);
    if (previous && fields.filter(key=>key!=='output_tokens').some(key=>previous[key]!==usage[key])) throw invalid(line,'inconsistent duplicate input usage');
    // Streaming fragments share an id. The final cumulative output is counted once.
    usage.output_tokens=Math.max(usage.output_tokens,previous?.output_tokens || 0);
    messages.set(message.id,usage);
  }
  if (!messages.size) throw invalid(line,'no assistant usage records');
  return [...messages.values()].map((usage,index)=>{
    const input=usage.input_tokens+usage.cache_creation_input_tokens+usage.cache_read_input_tokens;
    return {step:index+1,input_tokens:input,output_tokens:usage.output_tokens,
      reread_tokens:usage.cache_read_input_tokens,
      reread_share:input ? usage.cache_read_input_tokens/input : 0,
      input_share:input+usage.output_tokens ? input/(input+usage.output_tokens) : 0};
  });
}
