/* YAPPATHON call UI v6
   Visual-only layer. It NEVER ends/leaves a voice call.
   - Removes the legacy floating corner panel, including panels injected by voice.js.
   - Keeps calls in the conversation.
   - Creates missing group/DM ringing invites for the caller.
   - Shows live ringing animation per participant.
   - Never tears down the voice engine when the conversation UI changes.
*/
(()=>{
'use strict';
const C=()=>window.YappathonVoiceContext||{};
const $=id=>document.getElementById(id);
const FIREBASE='https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
let timer=null,stopCall=null,stopInvites=null,stopPresence=null,currentKey='',currentCall=null;
let ringing=new Set(),online=new Set(),inviteTimer=null;

function hideLegacyCorner(){
  // voice.js creates the old panel dynamically. Do not remove it and do not
  // click its controls. Hiding it only prevents the visual panel from
  // interfering with the in-chat UI.
  const candidates=document.querySelectorAll('*');
  for(const e of candidates){
    if(!e || e.id==='voice-incoming' || e.closest('#voice-incoming') || e.id==='voice-dm-stage') continue;
    const id=(e.id||'').toLowerCase(), cls=typeof e.className==='string'?e.className.toLowerCase():'';
    const looksVoice=(id.includes('voice')||cls.includes('voice'));
    if(!looksVoice) continue;
    const r=e.getBoundingClientRect();
    const fixed=getComputedStyle(e).position==='fixed';
    if(fixed && r.width>120 && r.height>60 && r.right>innerWidth-500 && r.bottom>innerHeight-500){
      e.style.setProperty('display','none','important');
      e.style.setProperty('visibility','hidden','important');
      e.style.setProperty('pointer-events','none','important');
    }
  }
  ['voice-panel','voiceCallPanel','voice-status-panel','voice-status','voice-connected'].forEach(id=>{
    const e=$(id);if(e){e.style.setProperty('display','none','important');e.style.setProperty('visibility','hidden','important');e.style.setProperty('pointer-events','none','important');}
  });
}

function css(){
 if($('yap-call-v6-style'))return;
 const s=document.createElement('style');s.id='yap-call-v6-style';
 s.textContent=`
 #voice-panel,.voice-panel,#voiceCallPanel,[data-voice-panel]{display:none!important;visibility:hidden!important;pointer-events:none!important}
 .voice-dm-stage{position:absolute!important;left:0;right:0;top:56px;height:310px;z-index:30;background:var(--bg-alt);border-bottom:1px solid var(--border);display:flex;flex-direction:column;overflow:hidden;box-shadow:0 14px 40px rgba(0,0,0,.18)}
 .voice-dm-stage[hidden]{display:none!important}
 .voice-dm-head{display:flex;align-items:center;gap:9px;padding:11px 15px;border-bottom:1px solid var(--border);flex:0 0 auto}
 .voice-dm-dot{width:8px;height:8px;border-radius:50%;background:#61e294;box-shadow:0 0 12px #61e294}.voice-dm-title{font-weight:800;font-size:13px}.voice-dm-sub{margin-left:auto;font-size:11px;color:var(--text-muted)}
 .voice-dm-grid{flex:1;min-height:0;display:grid;grid-template-columns:repeat(auto-fit,minmax(145px,1fr));gap:10px;padding:12px 15px;overflow:auto}
 .voice-dm-tile{position:relative;min-height:125px;border:1px solid var(--border);border-radius:14px;background:var(--bg-elevated);display:flex;align-items:center;justify-content:center;overflow:hidden;transition:.2s}
 .voice-dm-tile.me{border-color:var(--accent)}
 .voice-dm-tile.ringing{border-color:#f6c85f;animation:yapCallRing 900ms ease-in-out infinite}
 .voice-dm-avatar{width:62px;height:62px;border-radius:50%;object-fit:cover;background:var(--accent);display:grid;place-items:center;color:#fff;font-weight:800;font-size:19px}
 .voice-dm-label{position:absolute;bottom:8px;left:8px;right:8px;padding:6px 8px;border-radius:8px;background:rgba(0,0,0,.52);color:#fff;font-size:11px;font-weight:700;display:flex;align-items:center;gap:6px;backdrop-filter:blur(5px)}
 .voice-dm-status{margin-left:auto;color:#8ff0bd;font-size:10px}.voice-dm-status.ringing{color:#ffd36b;font-weight:900;animation:yapRingText 900ms ease-in-out infinite}
 .voice-dm-ring-icon{display:inline-block;animation:yapRingIcon 700ms ease-in-out infinite;transform-origin:50% 50%}
 .voice-dm-controls{display:flex;justify-content:center;gap:8px;padding:9px;border-top:1px solid var(--border);flex:0 0 auto}.voice-dm-controls button{border:1px solid var(--border);background:var(--bg-input);color:var(--text);border-radius:9px;padding:8px 13px;font-weight:700;cursor:pointer}.voice-dm-controls .leave{background:var(--danger);color:#fff;border-color:var(--danger)}
 @keyframes yapCallRing{0%,100%{transform:scale(1);box-shadow:0 0 0 0 rgba(246,200,95,.08)}50%{transform:scale(1.028);box-shadow:0 0 0 9px rgba(246,200,95,.24),0 0 30px rgba(246,200,95,.2)}}
 @keyframes yapRingText{0%,100%{opacity:.7}50%{opacity:1}}
 @keyframes yapRingIcon{0%,100%{transform:rotate(0) scale(1)}25%{transform:rotate(-16deg) scale(1.12)}75%{transform:rotate(16deg) scale(1.12)}}
 .main.voice-dm-active .messages{padding-top:320px}
 @media(max-width:860px){.voice-dm-stage{top:52px;height:270px}.main.voice-dm-active .messages{padding-top:280px}}
 @media(max-width:600px){.voice-dm-stage{height:240px}.main.voice-dm-active .messages{padding-top:250px}.voice-dm-grid{gap:6px;padding:7px}.voice-dm-tile{min-height:92px}.voice-dm-avatar{width:45px;height:45px;font-size:15px}}
 `;
 document.head.appendChild(s);
}

function convo(){
 const c=C();
 if(c.currentConvoType==='channel'&&c.currentChannel)return{type:'channel',id:c.currentChannel,name:'#'+c.currentChannel,members:[]};
 if(c.currentConvoType==='dm'&&c.currentDmId){const d=c.dmCache?.[c.currentDmId];if(!d)return null;return{type:d.type==='group'?'group':'dm',id:c.currentDmId,name:d.name||null,members:Array.isArray(d.members)?d.members:[]};}
 return null;
}
const makeCallId=c=>(c.type==='channel'?'channel_':'call_')+c.id;

function stage(){
 const main=document.querySelector('.main');if(!main)return null;
 let x=$('voice-dm-stage');
 if(!x){
  x=document.createElement('section');x.id='voice-dm-stage';x.className='voice-dm-stage';x.hidden=true;
  x.innerHTML=`<div class="voice-dm-head"><span class="voice-dm-dot"></span><span id="voice-dm-title" class="voice-dm-title">Voice Call</span><span id="voice-dm-sub" class="voice-dm-sub">Connected</span></div><div id="voice-dm-grid" class="voice-dm-grid"></div><div class="voice-dm-controls"><button id="voice-dm-mute">🎙 Mute</button><button id="voice-dm-deafen">🔊</button><button id="voice-dm-leave" class="leave">☎ Leave Call</button></div>`;
  main.appendChild(x);
  // These buttons deliberately call the real voice controls. The UI layer
  // never calls leave() on its own.
  $('voice-dm-mute').onclick=()=>$('voice-mute')?.click();
  $('voice-dm-leave').onclick=()=>$('voice-leave')?.click();
  $('voice-dm-deafen').onclick=()=>{const a=[...document.querySelectorAll('audio[data-yv]')];const m=!a.every(x=>x.muted);a.forEach(x=>x.muted=m);$('voice-dm-deafen').textContent=m?'🔇':'🔊';};
 }
 return x;
}

function user(uid){return C().userCache?.[uid]||{uid,username:uid===C().currentUser?.uid?(C().profile?.username||'You'):'Member'};}
function avatar(u){
 if(u?.photoBase64){const i=document.createElement('img');i.className='voice-dm-avatar';i.src=u.photoBase64;i.alt='';return i;}
 const d=document.createElement('div');d.className='voice-dm-avatar';d.textContent=(u?.username||u?.name||'?').trim().slice(0,2).toUpperCase();return d;
}
function tile(u,status,isMe=false){
 const t=document.createElement('div');t.className='voice-dm-tile'+(isMe?' me':'')+(status==='ringing'?' ringing':'');t.appendChild(avatar(u));
 const l=document.createElement('div');l.className='voice-dm-label';const n=document.createElement('span');n.textContent=isMe?(C().profile?.username||'You'):(u?.username||'Member');const st=document.createElement('span');st.className='voice-dm-status'+(status==='ringing'?' ringing':'');st.innerHTML=status==='ringing'?'<span class="voice-dm-ring-icon">🔔</span> Ringing':status==='connected'?'Connected':'Waiting';l.append(n,st);t.appendChild(l);return t;
}

async function ensureRingingInvites(c,call){
 if(c.type==='channel'||!call||call.active!==true||call.createdBy!==C().currentUser?.uid)return;
 const members=(c.members||[]).filter(x=>x!==C().currentUser?.uid);
 if(!members.length)return;
 try{
  const {doc,getDoc,setDoc,serverTimestamp}=await import(FIREBASE);
  for(const uid of members){
   const ref=doc(C().db,'voiceCalls',makeCallId(c),'invites',uid);
   const snap=await getDoc(ref);
   if(!snap.exists())await setDoc(ref,{uid,status:'ringing',from:call.createdBy,createdAt:serverTimestamp()});
  }
 }catch(e){console.warn('ringing invite sync failed',e);}
}

async function subscribe(c){
 const db=C().db;if(!db)return;
 const key=makeCallId(c);if(key===currentKey)return;
 if(stopCall)stopCall();if(stopInvites)stopInvites();if(stopPresence)stopPresence();stopCall=stopInvites=stopPresence=null;currentKey=key;currentCall=null;ringing.clear();online.clear();
 try{
  const {doc,onSnapshot,collection}=await import(FIREBASE);
  stopCall=onSnapshot(doc(db,'voiceCalls',key),snap=>{
   if(!snap.exists()||snap.data()?.active!==true){currentCall=null;render(c);return;}
   currentCall=snap.data();ensureRingingInvites(c,currentCall);render(c);
  },()=>{});
  if(c.type!=='channel'){
   stopInvites=onSnapshot(collection(db,'voiceCalls',key,'invites'),snap=>{ringing.clear();snap.forEach(d=>{const v=d.data()||{};if(v.status==='ringing')ringing.add(d.id);});render(c);},()=>{});
  }
  stopPresence=onSnapshot(collection(db,'voiceCalls',key,'presence'),snap=>{online.clear();snap.forEach(d=>online.add(d.id));render(c);},()=>{});
 }catch(e){console.warn('call UI listener failed',e);}
}

function render(c){
 const s=stage(),g=$('voice-dm-grid');if(!s||!g)return;
 if(!currentCall||currentCall.active!==true){s.hidden=true;document.querySelector('.main')?.classList.remove('voice-dm-active');return;}
 s.hidden=false;document.querySelector('.main')?.classList.add('voice-dm-active');
 $('voice-dm-title').textContent=c.type==='channel'?`${c.name} Voice`:c.type==='group'?(c.name||'Group Voice'):'Voice Call';
 $('voice-dm-sub').textContent=`${Math.max(online.size,1)} connected`;
 g.innerHTML='';const uid=C().currentUser?.uid;g.appendChild(tile({uid,username:C().profile?.username||'You',photoBase64:C().profile?.photoBase64},'connected',true));
 if(c.type==='channel')online.forEach(x=>{if(x!==uid)g.appendChild(tile(user(x),'connected'));});
 else c.members.filter(x=>x!==uid).forEach(x=>g.appendChild(tile(user(x),ringing.has(x)?'ringing':online.has(x)?'connected':'waiting')));
}

function update(){
 css();hideLegacyCorner();
 const c=convo(),s=stage();if(!s)return;
 if(!c){s.hidden=true;document.querySelector('.main')?.classList.remove('voice-dm-active');return;}
 // IMPORTANT: leaving a conversation must not tear down voice subscriptions
 // or end the call. The voice engine owns the call lifecycle.
 subscribe(c);
 render(c);
}

function start(){if(timer)return;update();timer=setInterval(update,750);}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();
