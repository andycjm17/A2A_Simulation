import {readFile} from 'node:fs/promises';
import {api} from './agent-runner.mjs';
const base='https://a2a.andycui.com',token=(await readFile('private/admin-token.txt','utf8')).trim(),id='open-practice-01';
try{await api(base,`/api/markets/${id}`);console.log('Existing open practice lobby preserved.');}
catch(e){if(e.status!==404)throw e;await api(base,'/api/admin/markets',{token,data:{id,name:'开放练习场 · 带上你的 Agent',practice:true,capacity:50,rounds:30,roundMs:60000}});console.log('Created public practice lobby. Organizer starts it when participants are ready.');}
