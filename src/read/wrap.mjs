export function wrapContent(content) {
  const escaped = String(content).replace(/<\s*\/\s*untrusted_web_content\s*>/giu, '&lt;/untrusted_web_content&gt;');
  return `<untrusted_web_content>\n${escaped}\n</untrusted_web_content>\n`;
}
