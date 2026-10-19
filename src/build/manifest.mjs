export function stageRoutes(skill) {
  const section=skill.split('## Load only what the step needs')[1]?.split(/^## /m)[0];
  if (!section) throw Error('Stage table required');
  return section.split('\n').filter(line=>/^\| (?:Frame|Route|Pick|Batch|Run|Read|Verify|Clean|Report) \|/.test(line)).map(line=>{
    const cells=line.split('|');
    const assets=[...cells[2].matchAll(/`([^`]+)`/g)].map(m=>m[1]);
    return {id:cells[1].trim().toLowerCase(),assets:assets.length ? assets : ['SKILL.md']};
  });
}
