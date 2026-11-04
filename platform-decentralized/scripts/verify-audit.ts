import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { verifyAudit } from '../worker/audit-verify';
export { verifyAudit };
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href){
  const [file,attestor,head]=process.argv.slice(2);
  if(!file||!attestor)throw new Error('Usage: tsx scripts/verify-audit.ts audit.json TRUSTED_ATTESTOR [EXPECTED_RECEIPT_HEAD]');
  const result=await verifyAudit(JSON.parse(await readFile(file,'utf8')),attestor,head);
  console.log(JSON.stringify(result,null,2));
}
