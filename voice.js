import {doc,getDoc,setDoc,updateDoc,deleteDoc,addDoc,collection,onSnapshot,query,where,serverTimestamp} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// YAPPATHON VOICE ENGINE
// Pure call engine: WebRTC signaling, presence, mic handling. No UI of its
// own — dm-call-ui.js renders the in-page call stage and live-sync.js
// renders the incoming-call ("ringing") popup. Both drive this file through
// window.YappathonVoice.

const C=()=>window.YappathonVoiceContext||{};
const db=()=>C().db, me=()=>C().currentUser, profile=()=>C().profile||{};
const RTC={iceServers:[{urls:"stun:stun.l.google.com:19302"},{urls:"stun:stun1.l.google.com:19302"}]};
const CALL_FRESH_MS=45000;
let localStream=null,activeCall=null,muted=false,currentUid="",pollTimer=null,heartbeatTimer=null;
let stopSignals=null,stopPresence=null,stopCallWatch=null;
const peers=new Map(),queuedIce=new Map();
const id=()=>me()?.uid||"";
const callRef=x=>doc(db(),"voiceCalls",x),invRef=(x,u)=>doc(db(),"voiceCalls",x,"invites",u),presRef=(x,u)=>doc(db(),"voiceCalls",x,"presence",u),sigCol=x=>collection(db(),"voiceCalls",x,"signals");
const toast=m=>typeof C().toast==="function"?C().toast(m,"info"):console.log(m);
const fresh=t=>!!t?.toMillis&&Date.now()-t.toMillis()<CALL_FRESH_MS;
function $(x){return document.getElementById(x)}

function style(){
  if($("yappathon-voice-style"))return;
  const s=document.createElement("style");s.id="yappathon-voice-style";
  s.textContent=`
  .voice-start-btn{margin-left:auto;display:inline-flex;align-items:center;gap:6px;border:1px solid var(--border);background:var(--bg-input);color:var(--text);border-radius:8px;padding:6px 10px;font-size:12px;font-weight:700;white-space:nowrap}.voice-start-btn:hover{background:var(--accent-soft);border-color:var(--accent);color:var(--accent)}
  .shift-delete-hint{font-size:10px;color:var(--text-muted);margin-left:6px;opacity:.8}
  `;
  document.head.appendChild(s);
}

function context(){
  const c=C();
  if(c.currentConvoType==="channel"&&c.currentChannel)return{type:"channel",id:c.currentChannel,name:"#"+c.currentChannel,members:[]};
  if(c.currentConvoType==="dm"&&c.currentDmId){const d=c.dmCache?.[c.currentDmId];if(!d)return null;return{type:d.type==="group"?"group":"dm",id:c.currentDmId,name:d.name||null,members:Array.isArray(d.members)?d.members:[]}}
  return null;
}
function callId(c){return(c.type==="channel"?"channel_":"call_")+c.id}
async function mic(){if(localStream)return true;localStream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true},video:false});return true}
function stopMic(){if(localStream){localStream.getTracks().forEach(t=>t.stop());localStream=null}}
function audio(u,stream){let a=document.querySelector(`audio[data-yv="${CSS.escape(u)}"]`);if(!a){a=document.createElement("audio");a.autoplay=true;a.dataset.yv=u;a.style.display="none";document.body.appendChild(a)}a.srcObject=stream}
function peer(u){
  if(peers.has(u))return peers.get(u);
  const p=new RTCPeerConnection(RTC);localStream?.getTracks().forEach(t=>p.addTrack(t,localStream));
  p.onicecandidate=e=>{if(e.candidate&&activeCall)addDoc(sigCol(activeCall.id),{type:"candidate",from:id(),to:u,candidate:e.candidate.toJSON(),createdAt:serverTimestamp()}).catch(()=>{})};
  p.ontrack=e=>audio(u,e.streams[0]);
  p.onconnectionstatechange=()=>{if(["failed","closed","disconnected"].includes(p.connectionState)){if(p.connectionState!=="disconnected")p.close();peers.delete(u)}};
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
    for(const ch of snap.docChanges())if(ch.type==="added"&&ch.doc.id!==id()&&activeCall&&!peers.has(ch.doc.id))try{await offer(ch.doc.id)}catch(e){console.warn("Voice offer error",e)}
  });
}
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
  await setDoc(ref,{kind:c.type,contextId:c.id,name:c.type==="channel"?c.name+" voice":c.type==="group"?(c.name||"Group voice"):"Voice call",members:c.type==="channel"?[]:c.members,active:true,createdBy:id(),createdAt:serverTimestamp(),updatedAt:serverTimestamp()});
  activeCall={id:cid,context:c,host:true};await presence(cid,true);signals(cid);presenceWatch(cid);watchCall(cid);startHeartbeat();
  if(c.type!=="channel")for(const u of c.members)if(u!==id())await setDoc(invRef(cid,u),{uid:u,status:"ringing",from:id(),fromName:profile().username||"Someone",createdAt:serverTimestamp()})
}
async function joinCall(call,c,data){
  if(activeCall)return activeCall.id===call;
  const d=data||((await getDoc(callRef(call))).data());if(!d||d.active!==true||!fresh(d.updatedAt)){toast("That voice call has ended.");return false}
  try{await mic()}catch(e){toast("Microphone permission is required for voice chat.");return false}
  activeCall={id:call,context:c||{type:d.kind,id:d.contextId,name:d.name,members:d.members||[]},host:false};
  await presence(call,true);signals(call);presenceWatch(call);watchCall(call);
  return true;
}
async function leave(){
  if(!activeCall)return;const x=activeCall;activeCall=null;
  for(const p of peers.values())p.close();peers.clear();queuedIce.clear();
  if(stopSignals)stopSignals();stopSignals=null;if(stopPresence)stopPresence();stopPresence=null;if(stopCallWatch)stopCallWatch();stopCallWatch=null;stopHeartbeat();
  await presence(x.id,false);if(x.host)await updateDoc(callRef(x.id),{active:false,endedAt:serverTimestamp(),updatedAt:serverTimestamp()}).catch(()=>{});
  document.querySelectorAll("audio[data-yv]").forEach(a=>{a.srcObject=null;a.remove()});stopMic();muted=false;
}
function toggleMute(){muted=!muted;localStream?.getAudioTracks().forEach(t=>t.enabled=!muted);return muted}

let headerObserver=null;
function watchHeader(){
  const h=$("convo-header");if(!h||headerObserver)return;
  // The app rebuilds #convo-header's innerHTML on every channel/DM switch
  // (renderConvoHeader), which wipes out our injected button. Watch for
  // that instead of relying purely on the 1s poll, so the button doesn't
  // flicker out of existence between polls.
  headerObserver=new MutationObserver(()=>button());
  headerObserver.observe(h,{childList:true});
}
function button(){
  style();const h=$("convo-header");if(!h)return;watchHeader();const c=context();const old=h.querySelector(".voice-start-btn");if(!c){old?.remove();return}
  const key=c.type+":"+c.id;if(old&&old.dataset.voiceContext===key)return;old?.remove();
  const b=document.createElement("button");b.className="voice-start-btn";b.dataset.voiceContext=key;b.innerHTML=c.type==="channel"?"🎙️ <span>Join VC</span>":"📞 <span>Call</span>";b.title=c.type==="channel"?"Join channel voice chat":"Start a voice call";
  b.onclick=async()=>{try{const freshCtx=context();if(!freshCtx)return;if(freshCtx.type==="channel"){const cid=callId(freshCtx),r=await getDoc(callRef(cid));if(r.exists()&&r.data().active&&fresh(r.data().updatedAt))await joinCall(cid,freshCtx,r.data());else await startCall()}else await startCall()}catch(e){console.error("Voice call failed",e);toast("Could not start voice chat.")}};
  h.appendChild(b);
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

// Public API for the new call UI (dm-call-ui.js) and the ringing popup
// (live-sync.js) to drive the actual WebRTC call.
window.YappathonVoice={
  join:(callId,ctx)=>joinCall(callId,ctx,null),
  start:startCall,
  leave,
  toggleMute,
  isMuted:()=>muted,
  isInCall:cid=>!!activeCall&&(!cid||activeCall.id===cid),
  activeCallId:()=>activeCall?.id||null
};

function boot(){
  style();installShiftDelete();
  const tick=()=>{const u=id();if(u!==currentUid){currentUid=u}button()};
  tick();clearInterval(pollTimer);pollTimer=setInterval(tick,1000);
  window.addEventListener("beforeunload",()=>{stopHeartbeat();stopMic()},{once:true});
}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",boot,{once:true});else boot();
