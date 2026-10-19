import { config } from '../config.mjs';
import { read } from './bundle.mjs';

export function generateDrivers(root) {
  const { core }=config(root), data=JSON.parse(read(root,'bench/drivers.json'));
  const rows=[...data.drivers,data.browser];
  const cell=value=>String(value).replaceAll('|','&#124;').replace(/[\r\n]/g,' ');
  const body='# Installed browser drivers\n\nGenerated from `bench/drivers.json`. The benchmark detects installed tools and prints vendor install commands. Pins are test conditions; the registry verification label is `'+data.verification+'`.\n\n| Driver | Pin | Source |\n|---|---|---|\n'+rows.map(row=>`| ${cell(row.package)} | ${cell(row.version)} | [Vendor](${cell(row.source)}) |`).join('\n')+'\n';
  return {[`${core}/references/drivers.md`]:body};
}
