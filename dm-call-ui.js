/* YAPPATHON call UI v8
   In-page call stage for channels, group DMs, and 1-1 DMs. Shows ringing
   status per member and lets the viewer join if they're not already in the
   call. Drives voice.js's actual WebRTC engine via window.YappathonVoice.
*/
(()=>{
'use strict';
const C=()=>window.YappathonVoiceContext||{};
const $=id=>document.getElementById(id);
const FIREBASE='https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
const V=()=>window.YappathonVoice||null;
let timer=null,heartbeat=null,stopCall=null,stopInvites=null,stopPresence=null,currentKey='',currentCall=null;
let ringing=new Set(),online=new Set();

function css(){
 if($('yap-call-v8-style'))return;
 const s=document.createElement('style');s.id='yap-call-v8-style';s.textContent=`
 .voice-dm-stage{position:absolute!important;left:0;right:0;top:56px;height:310px;z-index:30;background:var(--bg-alt);border-bottom:1px solid var(--border);display:flex;flex-direction:column;overflow:hidden;box-shadow:0 14px 40px rgba(0,0,0,.18)}
 .voice-dm-stage[hidden]{display:none!important}.voice-dm-head{display:flex;align-items:center;gap:9px;padding:11px 15px;border-bottom:1px solid var(--border);flex:0 0 auto}.voice-dm-dot{width:8px;height:8px;border-radius:50%;background:#61e294;box-shadow:0 0 12px #61e294}.voice-dm-title{font-weight:800;font-size:13px}.voice-dm-sub{margin-left:auto;font-size:11px;color:var(--text-muted)}
 .voice-dm-join{margin-left:auto;border:1px solid var(--accent);background:var(--accent);color:var(--accent-contrast);border-radius:8px;padding:6px 12px;font-size:12px;font-weight:800;cursor:pointer}.voice-dm-join:hover{filter:brightness(1.06)}
 .voice-dm-grid{flex:1;min-height:0;display:grid;grid-template-columns:repeat(auto-fit,minmax(145px,1fr));gap:10px;padding:12px 15px;overflow:auto}.voice-dm-tile{position:relative;min-height:125px;border:1px solid var(--border);border-radius:14px;background:var(--bg-elevated);display:flex;align-items:center;justify-content:center;overflow:hidden;transition:.2s}.voice-dm-tile.me{border-color:var(--accent)}.voice-dm-tile.notjoined{opacity:.55}.voice-dm-tile.ringing{border-color:#f6c85f;animation:yapCallRing 900ms ease-in-out infinite}.voice-dm-avatar{width:62px;height:62px;border-radius:50%;object-fit:cover;background:var(--accent);display:grid;place-items:center;color:#fff;font-weight:800;font-size:19px}.voice-dm-label{position:absolute;bottom:8px;left:8px;right:8px;padding:6px 8px;border-radius:8px;background:rgba(0,0,0,.52);color:#fff;font-size:11px;font-weight:700;display:flex;align-items:center;gap:6px;backdrop-filter:blur(5px)}.voice-dm-status{margin-left:auto;color:#8ff0bd;font-size:10px}.voice-dm-status.ringing{color:#ffd36b;font-weight:900;animation:yapRingText 900ms ease-in-out infinite}.voice-dm-status.notjoined{color:var(--text-muted)}.voice-dm-ring-icon{display:inline-block;animation:yapRingIcon 700ms ease-in-out infinite;transform-origin:50% 50%}.voice-dm-controls{display:flex;justify-content:center;gap:8px;padding:9px;border-top:1px solid var(--border);flex:0 0 auto}.voice-dm-controls button{border:1px solid var(--border);background:var(--bg-input);color:var(--text);border-radius:9px;padding:8px 13px;font-weight:700;cursor:pointer}.voice-dm-controls .leave{background:var(--danger);color:#fff;border-color:var(--danger)}
 @keyframes yapCallRing{0%,100%{transform:scale(1);box-shadow:0 0 0 0 rgba(246,200,95,.08)}50%{transform:scale(1.028);box-shadow:0 0 0 9px rgba(246,200,95,.24),0 0 30px rgba(246,200,95,.2)}}@keyframes yapRingText{0%,100%{opacity:.7}50%{opacity:1}}@keyframes yapRingIcon{0%,100%{transform:rotate(0) scale(1)}25%{transform:rotate(-16deg) scale(1.12)}75%{transform:rotate(16deg) scale(1.12)}}
 .main.voice-dm-active .messages{padding-top:320px}@media(max-width:860px){.voice-dm-stage{top:52px;height:270px}.main.voice-dm-active .messages{padding-top:280px}}@media(max-width:600px){.voice-dm-stage{height:240px}.main.voice-dm-active .messages{padding-top:250px}.voice-dm-grid{gap:6px;padding:7px}.voice-dm-tile{min-height:92px}.voice-dm-avatar{width:45px;height:45px;font-size:15px}}
 `;document.head.appendChild(s);
}
function convo(){const c=C();if(c.currentConvoType==='channel'&&c.currentChannel)return{type:'channel',id:c.currentChannel,name:'#'+c.currentChannel,members:[]};if(c.currentConvoType==='dm'&&c.currentDmId){const d=c.dmCache?.[c.currentDmId];if(!d)return null;return{type:d.type==='group'?'group':'dm',id:c.currentDmId,name:d.name||null,members:Array.isArray(d.members)?d.members:[]};}return null;}
const callId=c=>(c.type==='channel'?'channel_':'call_')+c.id;
function stage(){const main=document.querySelector('.main');if(!main)return null;let x=$('voice-dm-stage');if(!x){x=document.createElement('section');x.id='voice-dm-stage';x.className='voice-dm-stage';x.hidden=true;x.innerHTML='<div class="voice-dm-head"><span class="voice-dm-dot"></span><span id="voice-dm-title" class="voice-dm-title">Voice Call</span><span id="voice-dm-sub" class="voice-dm-sub">Connected</span></div><div id="voice-dm-grid" class="voice-dm-grid"></div><div class="voice-dm-controls"><button id="voice-dm-mute">🎙 Mute</button><button id="voice-dm-deafen">🔊</button><button id="voice-dm-leave" class="leave">☎ Leave Call</button></div>';main.appendChild(x);$('voice-dm-mute').onclick=()=>{const m=V()?.toggleMute();const b=$('voice-dm-mute');if(b)b.textContent=m?'🔇 Unmute':'🎙 Mute';};$('voice-dm-leave').onclick=()=>V()?.leave();$('voice-dm-deafen').onclick=()=>{const a=[...document.querySelectorAll('audio[data-yv]')];const m=!a.every(x=>x.muted);a.forEach(x=>x.muted=m);$('voice-dm-deafen').textContent=m?'🔇':'🔊';};}return x;}
function user(uid){return C().userCache?.[uid]||{uid,username:uid===C().currentUser?.uid?(C().profile?.username||'You'):'Member'};}
function avatar(u){if(u?.photoBase64){const i=document.createElement('img');i.className='voice-dm-avatar';i.src=u.photoBase64;i.alt='';return i;}const d=document.createElement('div');d.className='voice-dm-avatar';d.textContent=(u?.username||u?.name||'?').trim().slice(0,2).toUpperCase();return d;}
function tile(u,status,isMe=false){const t=document.createElement('div');t.className='voice-dm-tile'+(isMe?' me':'')+(status==='ringing'?' ringing':'')+(status==='notjoined'?' notjoined':'');t.appendChild(avatar(u));const l=document.createElement('div');l.className='voice-dm-label';const n=document.createElement('span');n.textContent=isMe?(C().profile?.username||'You'):(u?.username||'Member');const st=document.createElement('span');st.className='voice-dm-status'+(status==='ringing'?' ringing':'')+(status==='notjoined'?' notjoined':'');st.innerHTML=status==='ringing'?'<span class="voice-dm-ring-icon">🔔</span> Ringing':status==='connected'?'Connected':status==='notjoined'?'Not joined':'Waiting';l.append(n,st);t.appendChild(l);return t;}
async function ensureRingingInvites(c,call){if(c.type==='channel'||!call||call.active!==true||call.createdBy!==C().currentUser?.uid)return;const members=(c.members||[]).filter(x=>x!==C().currentUser?.uid);if(!members.length)return;try{const {doc,getDoc,setDoc,serverTimestamp}=await import(FIREBASE);for(const uid of members){const ref=doc(C().db,'voiceCalls',callId(c),'invites',uid);const snap=await getDoc(ref);if(!snap.exists())await setDoc(ref,{uid,status:'ringing',from:call.createdBy,createdAt:serverTimestamp()});}}catch(e){console.warn('ringing invite sync failed',e);}}
function keepAlive(c){if(heartbeat)clearInterval(heartbeat);heartbeat=setInterval(async()=>{if(!currentCall||currentCall.active!==true||!C().db||!C().currentUser)return;try{const {doc,updateDoc,serverTimestamp}=await import(FIREBASE);await updateDoc(doc(C().db,'voiceCalls',callId(c)),{updatedAt:serverTimestamp(),active:true});}catch(e){}},10000);}
async function subscribe(c){const db=C().db;if(!db)return;const key=callId(c);if(key===currentKey)return;if(stopCall)stopCall();if(stopInvites)stopInvites();if(stopPresence)stopPresence();if(heartbeat)clearInterval(heartbeat);stopCall=stopInvites=stopPresence=null;currentKey=key;currentCall=null;ringing.clear();online.clear();try{const {doc,onSnapshot,collection}=await import(FIREBASE);stopCall=onSnapshot(doc(db,'voiceCalls',key),snap=>{if(!snap.exists()||snap.data()?.active!==true){currentCall=null;render(c);return;}currentCall=snap.data();ensureRingingInvites(c,currentCall);keepAlive(c);render(c);},()=>{});if(c.type!=='channel')stopInvites=onSnapshot(collection(db,'voiceCalls',key,'invites'),snap=>{ringing.clear();snap.forEach(d=>{const v=d.data()||{};if(v.status==='ringing')ringing.add(d.id);});render(c);},()=>{});stopPresence=onSnapshot(collection(db,'voiceCalls',key,'presence'),snap=>{online.clear();snap.forEach(d=>online.add(d.id));render(c);},()=>{});}catch(e){console.warn('call UI listener failed',e);}}
function render(c){
  const s=stage(),g=$('voice-dm-grid');if(!s||!g)return;
  if(!currentCall||currentCall.active!==true){s.hidden=true;document.querySelector('.main')?.classList.remove('voice-dm-active');return;}
  s.hidden=false;document.querySelector('.main')?.classList.add('voice-dm-active');
  const key=callId(c),joined=!!V()?.isInCall(key),uid=C().currentUser?.uid;
  $('voice-dm-title').textContent=c.type==='channel'?`${c.name} Voice`:c.type==='group'?(c.name||'Group Voice'):'Voice Call';
  $('voice-dm-sub').textContent=`${Math.max(online.size,1)} connected`;
  const head=s.querySelector('.voice-dm-head');let joinBtn=$('voice-dm-join');
  if(!joined){
    if(!joinBtn){joinBtn=document.createElement('button');joinBtn.id='voice-dm-join';joinBtn.className='voice-dm-join';joinBtn.textContent='🎙 Join';head.appendChild(joinBtn);}
    joinBtn.onclick=async()=>{joinBtn.disabled=true;joinBtn.textContent='Joining…';try{await V()?.join(key,c);}finally{joinBtn.disabled=false;joinBtn.textContent='🎙 Join';}};
  }else if(joinBtn){joinBtn.remove();}
  s.querySelector('.voice-dm-controls').style.display=joined?'':'none';
  g.innerHTML='';
  g.appendChild(tile({uid,username:C().profile?.username||'You',photoBase64:C().profile?.photoBase64},joined?'connected':'notjoined',true));
  if(c.type==='channel')online.forEach(x=>{if(x!==uid)g.appendChild(tile(user(x),'connected'));});
  else c.members.filter(x=>x!==uid).forEach(x=>g.appendChild(tile(user(x),ringing.has(x)?'ringing':online.has(x)?'connected':'waiting')));
}
function update(){css();const c=convo(),s=stage();if(!s)return;if(!c){s.hidden=true;document.querySelector('.main')?.classList.remove('voice-dm-active');return;}subscribe(c);render(c);}
function start(){if(timer)return;update();timer=setInterval(update,750);}if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();
