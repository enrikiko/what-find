import 'dotenv/config';
import express from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { create } from '@open-wa/wa-automate';
const root=path.dirname(fileURLToPath(import.meta.url)), dataDir=path.join(root,'data'), statePath=path.join(dataDir,'state.json');
const defaults={enabled:false,countryCode:process.env.COUNTRY_CODE||'34',intervalSeconds:60,nextNumber:600000000,generated:[]};
let state={...defaults},timer=null,waClient=null,waStatus='not_connected',busy=false;
async function save(){await fs.writeFile(statePath,JSON.stringify(state,null,2))}
async function load(){await fs.mkdir(dataDir,{recursive:true});try{state={...defaults,...JSON.parse(await fs.readFile(statePath,'utf8'))}}catch{await save()}}
async function connect(){if(waClient||waStatus==='connecting')return;waStatus='connecting';try{waClient=await create({sessionId:process.env.OPENWA_SESSION_ID||'number-automation'});waStatus='connected'}catch(e){waStatus='error';console.error('OpenWA:',e.message)}}
function nextNumber(){const n=state.nextNumber;state.nextNumber=n>=699999999?600000000:n+1;return String(n)}
async function runOnce(){if(!state.enabled||busy)return;busy=true;const number=nextNumber(),jid=`${state.countryCode}${number}@c.us`,record={number,jid,message:'Hi',status:'queued',createdAt:new Date().toISOString()};state.generated.unshift(record);state.generated=state.generated.slice(0,100);await save();try{await connect();if(!waClient)throw Error('OpenWA is not connected. Scan the QR code in the OpenWA session.');record.status='sent';record.messageId=await waClient.sendText(jid,'Hi')}catch(e){record.status='failed';record.error=e.message}finally{await save();busy=false}}
function schedule(){if(timer)clearInterval(timer);timer=state.enabled?setInterval(runOnce,state.intervalSeconds*1000):null}
const app=express();app.use(express.json());app.use(express.static(path.join(root,'public')));
app.get('/api/status',(_q,res)=>res.json({...state,openwa:waStatus,busy}));
app.post('/api/automation',async(req,res)=>{const enabled=Boolean(req.body.enabled),intervalSeconds=Math.max(10,Math.min(86400,Number(req.body.intervalSeconds)||state.intervalSeconds)),countryCode=String(req.body.countryCode??state.countryCode).replace(/\D/g,'').slice(0,4);if(!countryCode)return res.status(400).json({error:'Country code is required.'});state={...state,enabled,intervalSeconds,countryCode};await save();schedule();if(enabled)connect();res.json({...state,openwa:waStatus,busy})});
app.post('/api/run-once',async(_q,res)=>{if(busy)return res.status(409).json({error:'A run is already in progress.'});const wasEnabled=state.enabled;state.enabled=true;await runOnce();state.enabled=wasEnabled;await save();res.json({...state,openwa:waStatus,busy})});
await load();schedule();const port=Number(process.env.PORT||3000);app.listen(port,()=>console.log(`Admin dashboard: http://localhost:${port}`));process.on('SIGINT',async()=>{if(waClient)await waClient.stop();process.exit(0)});
