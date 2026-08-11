import {doc,getDoc,setDoc,updateDoc,deleteDoc,addDoc,collection,onSnapshot,query,where,serverTimestamp} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const C=()=>window.YappathonVoiceContext||{};
const db=()=>C().db, me=()=>C().currentUser, profile=()=>C().profile||{}, cache=()=>C().userCache||{};
const RTC={iceServers:[{urls:"stun:stun.l.google.com:19302"},{urls:"stun:stun1.l.google.com:19302"}]};
const CALL_FRESH_MS=45000,INVITE_FRESH_MS=30000;
let localStream=null,activeCall=null,incoming=null,muted=false,currentUid="",pollTimer=null,heartbeatTimer=null;
let stopInvites=null,stopSignals=null,stopPresence=null,stopCallWatch=null;
const peers=new Map(),queuedIce=new Map(),shownInvites=new Set(),callPeople=new Map();
const id=()=>me()?.uid||"";
const callRef=x=>doc(db(),"voiceCalls",x),invRef=(x,u)=>doc(db(),"voiceCalls",x,"invites",u),presRef=(x,u)=>doc(db(),"voiceCalls",x,"presence",u),sigCol=x=>collection(db(),"voiceCalls",x,"signals");
const toast=m=>typeof C().toast==="function"?C().toast(m,"info"):console.log(m);
const fresh=t=>!!t?.toMillis&&Date.now()-t.toMillis()<CALL_FRESH_MS;
const inviteFresh=t=>!!t?.toMillis&&Date.now()-t.toMillis()<INVITE_FRESH_MS;
const esc=s=>String(s||"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));
function $(x){return document.getElementById(x)}

function style(){
  if($("yappathon-voice-style"))return;
  const s=document.createElement("style");s.id="yappathon-voice-style";
  s.textContent=`
  .voice-start-btn{margin-left:auto;display:inline-flex;align-items:center;gap:6px;border:1px solid var(--border);background:var(--bg-input);color:var(--text);border-radius:8px;padding:6px 10px;font-size:12px;font-weight:700;white-space:nowrap}.voice-start-btn:hover{background:var(--accent-soft);border-color:var(--accent);color:var(--accent)}
  .voice-overlay{position:fixed;inset:0;z-index:10050;background:rgba(0,0,0,.58);backdrop-filter:blur(8px);display:flex;align-items:center;justify-content:center;padding:20px}.voice-overlay[hidden]{display:none!important}.voice-card{width:min(420px,100%);background:var(--bg-alt);border:1px solid var(--border);border-radius:18px;padding:26px;box-shadow:0 24px 80px var(--shadow)}.voice-kicker{font-size:11px;text-transform:uppercase;letter-spacing:.1em;color:var(--accent);font-weight:800}.voice-card h2{margin:7px 0;font-size:23px}.voice-card p{margin:0;color:var(--text-muted)}.voice-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:22px}.voice-btn{border:1px solid var(--border);border-radius:9px;padding:9px 15px;background:var(--bg-input);color:var(--text);font-weight:700}.voice-btn.primary{background:var(--accent);color:var(--accent-contrast);border-color:var(--accent)}.voice-btn.danger{color:#fff;background:var(--danger);border-color:var(--danger)}
  .voice-panel{position:fixed;right:20px;bottom:20px;z-index:10040;width:min(360px,calc(100vw - 40px));background:var(--bg-alt);border:1px solid var(--border);border-radius:16px;box-shadow:0 20px 70px var(--shadow);overflow:hidden}.voice-panel[hidden]{display:none!important}.voice-head{display:flex;justify-content:space-between;align-items:center;padding:13px 14px;border-bottom:1px solid var(--border)}.voice-head span{font-size:11px;color:var(--text-muted)}.voice-people{padding:10px;max-height:240px;overflow:auto}.voice-person{display:flex;justify-content:space-between;padding:9px 10px;border-radius:9px;background:var(--bg-elevated);margin-bottom:5px}.voice-person span{font-size:11px;color:var(--online)}.voice-controls{display:flex;gap:7px;padding:10px;border-top:1px solid var(--border)}.voice-control{flex:1;border:1px solid var(--border);background:var(--bg-input);color:var(--text);border-radius:8px;padding:8px;font-weight:700}.voice-control.danger{color:#fff;background:var(--danger);border-color:var(--danger)}
  .voice-dm-stage{position:absolute;left:0;right:0;top:56px;height:276px;z-index:8;background:linear-gradient(180deg,color-mix(in srgb,var(--bg-alt) 96%,transparent),var(--bg));border-bottom:1px solid var(--border);box-shadow:0 16px 45px rgba(0,0,0,.18);display:flex;flex-direction:column;overflow:hidden}.voice-dm-stage[hidden]{display:none!important}.voice-dm-stage-head{display:flex;align-items:center;gap:10px;padding:12px 16px;border-bottom:1px solid var(--border);background:color-mix(in srgb,var(--bg) 76%,transparent);flex:0 0 auto}.voice-dm-live{width:8px;height:8px;border-radius:50%;background:var(--online);box-shadow:0 0 12px var(--online)}.voice-dm-title{font-weight:800;font-size:13px}.voice-dm-sub{font-size:11px;color:var(--text-muted);margin-left:auto}.voice-dm-grid{flex:1;min-height:0;display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;padding:12px 16px;overflow:auto}.voice-dm-tile{position:relative;min-height:130px;border:1px solid var(--border);border-radius:14px;background:var(--bg-elevated);display:flex;align-items:center;justify-content:center;overflow:hidden;box-shadow:0 8px 28px rgba(0,0,0,.12)}.voice-dm-tile.me{border-color:var(--accent);box-shadow:0 0 0 1px var(--accent-soft),0 8px 28px rgba(0,0,0,.14)}.voice-dm-avatar{width:64px;height:64px;border-radius:50%;object-fit:cover;background:var(--accent);display:grid;place-items:center;color:#fff;font-weight:800;font-size:20px}.voice-dm-label{position:absolute;left:9px;bottom:8px;right:9px;display:flex;align-items:center;gap:6px;padding:5px 7px;border-radius:7px;background:rgba(0,0,0,.46);color:#fff;font-size:11px;font-weight:700;backdrop-filter:blur(5px)}.voice-dm-status{margin-left:auto;color:#8ff0bd;font-size:10px}.voice-dm-mic{width:18px;height:18px;border-radius:50%;display:grid;place-items:center;background:rgba(255,255,255,.12);font-size:9px}.voice-dm-controls{display:flex;align-items:center;justify-content:center;gap:8px;padding:10px 14px;border-top:1px solid var(--border);background:color-mix(in srgb,var(--bg-alt) 96%,transparent);flex:0 0 auto}.voice-dm-control{width:40px;height:36px;border:1px solid var(--border);border-radius:10px;background:var(--bg-input);color:var(--text);font-size:15px;cursor:pointer}.voice-dm-control:hover{border-color:var(--accent);background:var(--accent-soft)}.voice-dm-control.leave{width:auto;padding:0 15px;background:var(--danger);border-color:var(--danger);color:#fff;font-size:12px;font-weight:800}.voice-dm-control.leave:hover{filter:brightness(1.08)}
  .main.voice-dm-active .messages{padding-top:290px}.main.voice-dm-active .composer{position:relative;z-index:9}
  .shift-delete-hint{font-size:10px;color:var(--text-muted);margin-left:6px;opacity:.8}
  @media(max-width:860px){.voice-dm-stage{top:52px;height:250px}.main.voice-dm-active .messages{padding-top:264px}.voice-dm-grid{grid-template-columns:repeat(auto-fit,minmax(125px,1fr));padding:9px}.voice-dm-tile{min-height:105px}.voice-dm-avatar{width:52px;height:52px;font-size:16px}.voice-dm-sub{display:none}}
  @media(max-width:600px){.voice-panel{right:10px;bottom:10px;width:calc(100vw - 20px)}.voice-dm-stage{left:0;right:0;height:235px}.main.voice-dm-active .messages{padding-top:248px}.voice-dm-stage-head{padding:9px 11px}.voice-dm-grid{gap:6px;padding:7px}.voice-dm-tile{min-height:90px;border-radius:10px}.voice-dm-avatar{width:44px;height:44px}.voice-dm-controls{padding:7px}.voice-dm-control{width:36px;height:34px}.voice-dm-control.leave{padding:0 11px}}
  `;
  document.head.appendChild(s);
}

function ui(){
  if($("voice-root"))return;
  const r=document.createElement("div");r.id="voice-root";
  r.innerHTML=`
    <div class="voice-overlay" id="voice-incoming" hidden><div class="voice-card"><div class="voice-kicker">Incoming voice call</div><h2 id="voice-title-in">Incoming call</h2><p id="voice-sub-in">Someone is calling you.</p><div class="voice-actions"><button class="voice-btn danger" id="voice-decline">Decline</button><button class="voice-btn primary" id="voice-accept">Accept</button></div></div></div>
    <div class="voice-panel" id="voice-panel" hidden><div class="voice-head"><div><strong id="voice-name">Voice</strong><br><span id="voice-count">1 person</span></div><button class="voice-control" id="voice-leave-x" aria-label="Leave call">×</button></div><div class="voice-people" id="voice-people"></div><div class="voice-controls"><button class="voice-control" id="voice-mute">🎙️ Mute</button><button class="voice-control danger" id="voice-leave">☎ Leave</button></div></div>`;
  document.body.appendChild(r);
  $("voice-accept").onclick=accept;$("voice-decline").onclick=decline;$("voice-leave").onclick=leave;$("voice-leave-x").onclick=leave;$("voice-mute").onclick=toggleMute;
}

function ensureDmStage(){
  const main=document.querySelector('.main');
  if(!main)return null;
  let stage=$("voice-dm-stage");
  if(!stage){
    stage=document.createElement('section');stage.id='voice-dm-stage';stage.className='voice-dm-stage';stage.hidden=true;
    stage.innerHTML=`<div class="voice-dm-stage-head"><span class="voice-dm-live"></span><div class="voice-dm-title" id="voice-dm-title">Voice call</div><div class="voice-dm-sub" id="voice-dm-sub">Voice Connected</div></div><div class="voice-dm-grid" id="voice-dm-grid"></div><div class="voice-dm-controls"><button class="voice-dm-control" id="voice-dm-mute" title="Mute microphone">🎙</button><button class="voice-dm-control" id="voice-dm-deafen" title="Toggle speaker">🔊</button><button class="voice-dm-control leave" id="voice-dm-leave">Leave Call</button></div>`;
    main.appendChild(stage);
    $("voice-dm-mute").onclick=toggleMute;
    $("voice-dm-leave").onclick=leave;
    $("voice-dm-deafen").onclick=toggleDeafen;
  }
  return stage;
}

let deafened=false;
function toggleDeafen(){
  deafened=!deafened;
  document.querySelectorAll('audio[data-yv]').forEach(a=>a.muted=deafened);
  const b=$("voice-dm-deafen");if(b)b.textContent=deafened?'🔇':'🔊';
}

function context(){
  const c=C();
  if(c.currentConvoType==="channel"&&c.currentChannel)return{type:"channel",id:c.currentChannel,name:"#"+c.currentChannel,members:[]};
  if(c.currentConvoType==="dm"&&c.currentDmId){const d=c.dmCache?.[c.currentDmId];if(!d)return null;return{type:d.type==="group"?"group":"dm",id:c.currentDmId,name:d.name||null,members:Array.isArray(d.members)?d.members:[]}}
  return null;
}
function callId(c){return(c.type==="channel"?"channel_":"call_")+c.id}
function title(c){return c.type==="channel"?c.name+" voice":c.type==="group"?(c.name||"Group voice"):"Voice call"}
async function mic(){if(localStream)return true;localStream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true},video:false});return true}
function stopMic(){if(localStream){localStream.getTracks().forEach(t=>t.stop());localStream=null}}
function avatarFor(u){
  const wrap=document.createElement('div');wrap.className='voice-dm-avatar';
  if(u?.photoBase64){const img=document.createElement('img');img.src=u.photoBase64;img.alt='';img.className='voice-dm-avatar';wrap.replaceWith(img);return img}
  const name=u?.username||u?.name||'Member';wrap.textContent=name.trim().split(/\s+/).slice(0,2).map(x=>x[0]).join('').toUpperCase()||'?';return wrap;
}
function audio(u,stream){let a=document.querySelector(`audio[data-yv="${CSS.escape(u)}"]`);if(!a){a=document.createElement("audio");a.autoplay=true;a.dataset.yv=u;a.style.display="none";document.body.appendChild(a)}a.muted=deafened;a.srcObject=stream}
function peer(u){
  if(peers.has(u))return peers.get(u);
  const p=new RTCPeerConnection(RTC);localStream?.getTracks().forEach(t=>p.addTrack(t,localStream));
  p.onicecandidate=e=>{if(e.candidate&&activeCall)addDoc(sigCol(activeCall.id),{type:"candidate",from:id(),to:u,candidate:e.candidate.toJSON(),createdAt:serverTimestamp()}).catch(()=>{})};
  p.ontrack=e=>audio(u,e.streams[0]);
  p.onconnectionstatechange=()=>{if(["failed","closed","disconnected"].includes(p.connectionState)){if(p.connectionState!=="disconnected")p.close();peers.delete(u);render()}};
  peers.set(u,p);return p;
}
async function offer(u){
  if(!activeCall||id()>=u)return;
  const p=peer(u);if(p.signalingState!=="stable")return;
  const o=await p.createOffer();await p.setLocalDescription(o);
  await addDoc(sigCol(activeCall.id),{type:"offer",from:id(),to:u,offer:{type:o.type,sdp:o.sdp},createdAt:serverTimestamp()});
}
function signals(call){
  if(stopSignals)stopSignals();
  stopSignals=onSnapshot(sigCol(call),async snap=>{
    for(const ch of snap.docChanges()){
      if(ch.type!=="added")continue;const s=ch.doc.data();if(s.to!==id()||!activeCall)continue;
      try{
        if(s.type==="offer"){
          const p=peer(s.from);if(p.signalingState!=="stable")continue;await p.setRemoteDescription(s.offer);
          for(const c of queuedIce.get(s.from)||[])await p.addIceCandidate(c);queuedIce.delete(s.from);
          const a=await p.createAnswer();await p.setLocalDescription(a);
          await addDoc(sigCol(call),{type:"answer",from:id(),to:s.from,answer:{type:a.type,sdp:a.sdp},createdAt:serverTimestamp()});
        }else if(s.type==="answer"){
          const p=peers.get(s.from);if(p){await p.setRemoteDescription(s.answer);for(const c of queuedIce.get(s.from)||[])await p.addIceCandidate(c);queuedIce.delete(s.from)}}
        else if(s.type==="candidate"){
          const p=peers.get(s.from);if(p?.remoteDescription)await p.addIceCandidate(s.candidate);else{const q=queuedIce.get(s.from)||[];q.push(s.candidate);queuedIce.set(s.from,q)}}
      }catch(e){console.warn("Voice signaling error",e)}
    }
  });
}
function presence(call,on){const p=presRef(call,id());return on?setDoc(p,{uid:id(),name:profile().username||"Member",photoBase64:profile().photoBase64||null,joinedAt:serverTimestamp()}):deleteDoc(p).catch(()=>{})}
function presenceWatch(call){
  if(stopPresence)stopPresence();
  stopPresence=onSnapshot(collection(db(),"voiceCalls",call,"presence"),async snap=>{
    callPeople.clear();snap.forEach(d=>callPeople.set(d.id,{uid:d.id,...d.data()}));
    for(const ch of snap.docChanges())if(ch.type==="added"&&ch.doc.id!==id()&&activeCall&&!peers.has(ch.doc.id))try{await offer(ch.doc.id)}catch(e){console.warn("Voice offer error",e)}
    render();
  });
}
function render(){
  if(!activeCall)return;
  const n=$("voice-name"),p=$("voice-people");
  if(n)n.textContent=title(activeCall.context);
  if(p){p.innerHTML="";const people=[...callPeople.values()];if(!people.some(x=>x.uid===id()))people.unshift({uid:id(),name:profile().username||"You",photoBase64:profile().photoBase64||null});people.forEach(x=>{const el=document.createElement('div');el.className='voice-person';el.innerHTML=`<strong>${esc(x.name||cache()[x.uid]?.username||'Member')}</strong><span>${x.uid===id()?'You':'Connected'}</span>`;p.appendChild(el)})}
  const count=Math.max(1,callPeople.size);if($("voice-count"))$("voice-count").textContent=count===1?"1 person":`${count} people`;
  renderDmStage();
}
function renderDmStage(){
  const c=activeCall?.context;const stage=ensureDmStage();if(!stage)return;
  const inDm=!!activeCall&&c&&c.type!=="channel"&&C().currentConvoType==="dm"&&C().currentDmId===c.id;
  if(!inDm){stage.hidden=true;document.querySelector('.main')?.classList.remove('voice-dm-active');return}
  stage.hidden=false;document.querySelector('.main')?.classList.add('voice-dm-active');
  $("voice-dm-title").textContent=title(c);
  const people=[...callPeople.values()];if(!people.some(x=>x.uid===id()))people.unshift({uid:id(),name:profile().username||"You",photoBase64:profile().photoBase64||null});
  const grid=$("voice-dm-grid");if(!grid)return;grid.innerHTML='';
  people.forEach(x=>{
    const tile=document.createElement('div');tile.className='voice-dm-tile'+(x.uid===id()?' me':'');
    tile.appendChild(avatarFor(x));
    const label=document.createElement('div');label.className='voice-dm-label';
    const name=document.createElement('span');name.textContent=x.uid===id()?(profile().username||'You'):(x.name||cache()[x.uid]?.username||'Member');
    const status=document.createElement('span');status.className='voice-dm-status';status.textContent=x.uid===id()?(muted?'Muted':'You'):(peers.has(x.uid)?'Connected':'Joining…');
    const micIcon=document.createElement('span');micIcon.className='voice-dm-mic';micIcon.textContent=x.uid===id()&&muted?'🔇':'🎙';
    label.append(name,status,micIcon);tile.appendChild(label);grid.appendChild(tile);
  });
  const mb=$("voice-dm-mute");if(mb)mb.textContent=muted?'🔇':'🎙';
}
function panel(){ui();$("voice-panel").hidden=false;render()}
function watchCall(call){
  if(stopCallWatch)stopCallWatch();
  stopCallWatch=onSnapshot(callRef(call),snap=>{if(!activeCall||activeCall.id!==call)return;if(!snap.exists()||snap.data().active!==true||!fresh(snap.data().updatedAt))leave()});
}
function startHeartbeat(){clearInterval(heartbeatTimer);heartbeatTimer=setInterval(()=>{if(activeCall)updateDoc(callRef(activeCall.id),{updatedAt:serverTimestamp()}).catch(()=>{})},15000)}
function stopHeartbeat(){clearInterval(heartbeatTimer);heartbeatTimer=null}
async function startCall(){
  const c=context();if(!c)return;if(activeCall)return toast("You're already in a voice call.");
  try{await mic()}catch(e){toast("Microphone permission is required for voice chat.");return}
  const cid=callId(c),ref=callRef(cid),old=await getDoc(ref);
  if(old.exists()&&old.data().active&&fresh(old.data().updatedAt)){if(c.type==="channel")return joinCall(cid,c,old.data());toast("A call is already active here.");return}
  await setDoc(ref,{kind:c.type,contextId:c.id,name:title(c),members:c.type==="channel"?[]:c.members,active:true,createdBy:id(),createdAt:serverTimestamp(),updatedAt:serverTimestamp()});
  activeCall={id:cid,context:c,host:true};await presence(cid,true);signals(cid);presenceWatch(cid);watchCall(cid);startHeartbeat();panel();
  if(c.type!=="channel")for(const u of c.members)if(u!==id())await setDoc(invRef(cid,u),{uid:u,status:"ringing",from:id(),fromName:profile().username||"Someone",createdAt:serverTimestamp()})
}
async function joinCall(call,c,data){
  if(activeCall)return toast("You're already in a voice call.");
  const d=data||((await getDoc(call)).data());if(!d||d.active!==true||!fresh(d.updatedAt)){toast("That voice call has ended.");return}
  try{await mic()}catch(e){toast("Microphone permission is required for voice chat.");return}
  activeCall={id:call,context:c,host:false};await presence(call,true);signals(call);presenceWatch(call);watchCall(call);panel();
}
async function leave(){
  if(!activeCall)return;const x=activeCall;activeCall=null;
  for(const p of peers.values())p.close();peers.clear();queuedIce.clear();callPeople.clear();
  if(stopSignals)stopSignals();stopSignals=null;if(stopPresence)stopPresence();stopPresence=null;if(stopCallWatch)stopCallWatch();stopCallWatch=null;stopHeartbeat();
  await presence(x.id,false);if(x.host)await updateDoc(callRef(x.id),{active:false,endedAt:serverTimestamp(),updatedAt:serverTimestamp()}).catch(()=>{});
  document.querySelectorAll("audio[data-yv]").forEach(a=>{a.srcObject=null;a.remove()});stopMic();muted=false;deafened=false;
  if($("voice-panel"))$("voice-panel").hidden=true;
  if($("voice-dm-stage"))$("voice-dm-stage").hidden=true;document.querySelector('.main')?.classList.remove('voice-dm-active');
}
function toggleMute(){muted=!muted;localStream?.getAudioTracks().forEach(t=>t.enabled=!muted);if($("voice-mute"))$("voice-mute").textContent=muted?"🔇 Unmute":"🎙️ Mute";if($("voice-dm-mute"))$("voice-dm-mute").textContent=muted?'🔇':'🎙';renderDmStage()}
function hideIncoming(){incoming=null;if($("voice-incoming"))$("voice-incoming").hidden=true}
function showIncoming(call,data,invite){
  if(activeCall||shownInvites.has(call)||!invite||invite.status!=="ringing"||!inviteFresh(invite.createdAt)||!fresh(data.updatedAt))return;
  shownInvites.add(call);incoming={id:call,data};$("voice-title-in").textContent=data.name||"Incoming call";$("voice-sub-in").textContent=`${data.kind==="group"?"Group call":"Direct call"} from ${invite.fromName||cache()[data.createdBy]?.username||"Someone"}`;$("voice-incoming").hidden=false;
}
async function accept(){
  if(!incoming)return;const x=incoming;hideIncoming();const d=await getDoc(callRef(x.id));
  if(!d.exists()||d.data().active!==true||!fresh(d.data().updatedAt)||d.data().createdBy!==x.data.createdBy){toast("That call has ended.");return}
  await updateDoc(invRef(x.id,id()),{status:"accepted",acceptedAt:serverTimestamp()}).catch(()=>{});
  await joinCall(x.id,{type:x.data.kind,id:x.data.contextId,name:x.data.name,members:x.data.members||[]},d.data());
}
async function decline(){if(!incoming)return;const x=incoming;hideIncoming();await updateDoc(invRef(x.id,id()),{status:"declined",declinedAt:serverTimestamp()}).catch(()=>{})}
function stopInviteListener(){if(stopInvites)stopInvites();stopInvites=null}
function startInviteListener(){
  if(stopInvites||!id()||!db())return;
  stopInvites=onSnapshot(query(collection(db(),"voiceCalls"),where("members","array-contains",id()),where("active","==",true)),async snap=>{
    for(const ch of snap.docChanges()){
      if(ch.type!=="added"&&ch.type!=="modified")continue;const d=ch.doc.data();if(d.createdBy===id()||activeCall||!fresh(d.updatedAt))continue;
      const inv=await getDoc(invRef(ch.doc.id,id())).catch(()=>null);if(inv?.exists())showIncoming(ch.doc.id,d,inv.data());
    }
  },e=>console.warn("Voice invite listener stopped",e));
}
function button(){
  ui();const h=$("convo-header");if(!h)return;const c=context();const old=h.querySelector(".voice-start-btn");if(!c){old?.remove();renderDmStage();return}
  const key=c.type+":"+c.id;if(old&&old.dataset.voiceContext===key){renderDmStage();return}old?.remove();
  const b=document.createElement("button");b.className="voice-start-btn";b.dataset.voiceContext=key;b.innerHTML=c.type==="channel"?"🎙️ <span>Join VC</span>":"📞 <span>Call</span>";b.title=c.type==="channel"?"Join channel voice chat":"Start a voice call";
  b.onclick=async()=>{try{const freshCtx=context();if(!freshCtx)return;if(freshCtx.type==="channel"){const cid=callId(freshCtx),r=await getDoc(callRef(cid));if(r.exists()&&r.data().active&&fresh(r.data().updatedAt))await joinCall(cid,freshCtx,r.data());else await startCall()}else await startCall()}catch(e){console.error("Voice call failed",e);toast("Could not start voice chat.")}};
  h.appendChild(b);renderDmStage();
}

// Shift-clicking a delete action skips Yappathon's in-app confirmation.
// Normal clicks still show the confirmation dialog.
function installShiftDelete(){
  if(window.__yappathonShiftDeleteInstalled)return;window.__yappathonShiftDeleteInstalled=true;
  document.addEventListener('click',e=>{
    const btn=e.target.closest?.('.msg-action[title="Delete message"]');
    if(!btn||!e.shiftKey)return;
    setTimeout(()=>{
      const backdrop=$("app-dialog-backdrop"),confirm=$("app-dialog-confirm");
      if(backdrop?.classList.contains('open')&&confirm)confirm.click();
    },0);
  },true);
  document.addEventListener('pointerover',e=>{
    const btn=e.target.closest?.('.msg-action[title="Delete message"]');
    if(btn)btn.title='Delete message · Shift-click to skip confirmation';
  },true);
}

function boot(){
  style();ui();installShiftDelete();ensureDmStage();
  const tick=()=>{const u=id();if(u!==currentUid){stopInviteListener();currentUid=u;shownInvites.clear();hideIncoming();if(u)startInviteListener()}button()};
  tick();clearInterval(pollTimer);pollTimer=setInterval(tick,1000);
  window.addEventListener("beforeunload",()=>{stopHeartbeat();stopInviteListener();stopMic()},{once:true});
}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",boot,{once:true});else boot();
