import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { randomUUID } from 'node:crypto';
import { cert, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
const env = parseEnv(readFileSync(new URL('../.env.local', import.meta.url),'utf8'));
const base='https://savatar.vercel.app';
const credential=cert({projectId:env.FIREBASE_PROJECT_ID,clientEmail:env.FIREBASE_CLIENT_EMAIL,privateKey:env.FIREBASE_PRIVATE_KEY.replace(/\\n/g,'\n')});
initializeApp({credential});
const db=getFirestore(), auth=getAuth();
const rows=[], created=[];
const check=(name,ok,detail='')=>{ rows.push({name,ok,detail}); console.log(JSON.stringify(rows.at(-1))); };
async function request(path,body,token,origin=base){
 const r=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',Origin:origin,...(token?{Authorization:`Bearer ${token}`}:{})},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(25000)});
 let json;try{json=await r.json()}catch{json={}}return {status:r.status,json};
}
async function identity(method,body){const r=await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:${method}?key=${env.NEXT_PUBLIC_FIREBASE_API_KEY}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const j=await r.json(); if(!r.ok)throw Error(j.error?.message);return j;}
function fields(o){return Object.fromEntries(Object.entries(o).map(([k,v])=>[k,typeof v==='string'?{stringValue:v}:typeof v==='number'?{integerValue:String(v)}:Array.isArray(v)?{arrayValue:{values:[]}}:{mapValue:{fields:fields(v)}}]));}
async function firestore(path,method,token,body){const r=await fetch(`https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents/${path}`,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});return r.status;}
try {
 for(const path of ['/api/debug','/api/admin']){const r=await request(path,path==='/api/admin'?{}:undefined);check(path+' public access denied',[401,404].includes(r.status),String(r.status));}
 for(const path of ['/api/realtime-token','/api/streaming/room','/api/streaming/end','/api/payment/initiate','/api/feed']){const r=await request(path,{});check(path+' requires auth',r.status===401,String(r.status));}
 const cors=await request('/api/feed',{},undefined,'https://example.com');check('Cross-origin mutation denied',cors.status===403,String(cors.status));
 const webhook=await request('/api/payment/webhook',{event:'charge.success',data:{reference:'audit-invalid'}});check('Unsigned payment webhook denied',[400,401,403].includes(webhook.status),String(webhook.status));
 const email=`savatar-audit-${Date.now()}@example.com`,password=randomUUID()+'aA1!';
 const signup=await identity('signUp',{email,password,returnSecureToken:true});created.push(signup.localId);let token=signup.idToken;const uid=signup.localId;
 check('Email/password signup',!!uid);
 const profile={uid,email,displayName:'Disposable audit test',photoURL:'',createdAt:new Date().toISOString(),plan:'starter',wallet:{balanceSeconds:0,totalPurchased:0,totalUsed:0},promoUsed:[]};
 const status=await firestore(`users/${uid}`,'PATCH',token,{fields:fields(profile)});check('New account profile allowed by live rules',status===200,String(status));
 const denied=await firestore(`users/${uid}?updateMask.fieldPaths=wallet.balanceSeconds`,'PATCH',token,{fields:fields({wallet:{balanceSeconds:9999}})});check('Client cannot grant itself credits',denied===403,String(denied));
 check('Private stream sessions cannot be listed',await firestore('streamSessions','GET',token)===403);
 const unverified=await request('/api/realtime-token',{model:'lucy-2.5'},token);check('Unverified email cannot stream',unverified.status===403,String(unverified.status));
 await auth.updateUser(uid,{emailVerified:true});token=(await identity('signInWithPassword',{email,password,returnSecureToken:true})).idToken;check('Password login works',!!token);
 const admin=await request('/api/admin',{},token);check('Non-admin denied admin API',admin.status===403,String(admin.status));
 const empty=await request('/api/realtime-token',{model:'lucy-2.5'},token);check('Empty wallet cannot stream',empty.status===402,JSON.stringify(empty));
 const room=await request('/api/streaming/room',{},token);check('Room creation works',room.status===200,JSON.stringify(room));
 const repeat=await request('/api/streaming/room',{},token);check('Room creation is stable',repeat.json.roomId===room.json.roomId);
 const payment=await request('/api/payment/initiate',{packId:'audit-invalid'},token);check('Invalid payment pack rejected',payment.status===400,JSON.stringify(payment));
 await db.doc(`users/${uid}`).update({'wallet.balanceSeconds':120,'wallet.totalPurchased':120});
 const reserve=await request('/api/realtime-token',{model:'lucy-2.5'},token);check('Provider ticket issued',reserve.status===200, reserve.status===200?'credential withheld':JSON.stringify(reserve));
 if(reserve.status===200){
  check('Provider credential hidden behind proxy ticket', /^[0-9a-f-]{36}\.[0-9a-f]{64}$/.test(reserve.json.apiKey));
  const sid=reserve.json.sessionId;const balance=async()=> (await db.doc(`users/${uid}`).get()).data().wallet.balanceSeconds;
  check('Credit reservation deducted',await balance()===0);
  const end=await request('/api/streaming/end',{sessionId:sid,usedSeconds:0},token);check('Unused unconnected reservation refunded',end.status===200 && await balance()===120,JSON.stringify(end));
  const again=await request('/api/streaming/end',{sessionId:sid},token);check('Refund idempotency',again.json.alreadyProcessed===true && await balance()===120);
 }
 const checkout=await request('/api/payment/initiate',{packId:'starter'},token);check('Paystack checkout initializes',checkout.status===200,checkout.status===200?'No payment submitted':JSON.stringify(checkout));
 const html=await (await fetch(base+'/dashboard')).text();
 const sources=[...html.matchAll(/src="([^" ]+\.js[^" ]*)"/g)].map(m=>m[1]);
 const chunks=await Promise.all(sources.map(async src=>await (await fetch(new URL(src,base))).text()));
 const endpoints=[...new Set(chunks.flatMap(s=>s.match(/https:\/\/[^"'\s\x60<>]+/g)||[]).filter(s=>/railway|render\.com|fly\.dev|ngrok|savatar.*(server|backend)/.test(s)))];
 console.log('Backend candidates '+JSON.stringify(endpoints));
 const healthUrl=env.NEXT_PUBLIC_SIGNALING_URL || endpoints.find(s=>/railway|render\.com|fly\.dev/.test(s));
 if(healthUrl){const r=await fetch(healthUrl+'/health',{signal:AbortSignal.timeout(25000)});check('Signaling backend health',r.status===200,healthUrl+' '+r.status);}
 const access=(await credential.getAccessToken()).access_token;
 const release=await fetch(`https://firebaserules.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/releases/cloud.firestore`,{headers:{Authorization:`Bearer ${access}`}});
 if(release.ok){const j=await release.json();const rules=await fetch(`https://firebaserules.googleapis.com/v1/${j.rulesetName}`,{headers:{Authorization:`Bearer ${access}`}});const data=await rules.json();if(data.source?.files?.[0]?.content)readFileSync; if(data.source?.files?.[0]?.content) { const {writeFileSync}=await import('node:fs');writeFileSync(new URL('../.deployed-firestore.rules',import.meta.url),data.source.files[0].content); } check('Deployed Firestore rules match local',data.source?.files?.some(f=>f.content.replace(/\r\n/g,'\n').trim()===readFileSync(new URL('../../firestore.rules',import.meta.url),'utf8').replace(/\r\n/g,'\n').trim()));}else check('Read deployed rules configuration',false,String(release.status));
} catch(e){check('Audit execution',false,e.message)} finally {
 for(const uid of created){
  for(const collection of ['streamSessions','transactions','payments']){const snap=await db.collection(collection).where('userId','==',uid).get();for(const d of snap.docs)await d.ref.delete();}
  await db.doc(`users/${uid}`).delete();await auth.deleteUser(uid);
 }
 console.log('SUMMARY '+JSON.stringify({passed:rows.filter(r=>r.ok).length,failed:rows.filter(r=>!r.ok).length,temporaryAccountsRemoved:created.length}));
}
