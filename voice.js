import {
  doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, addDoc,
  collection, onSnapshot, query, where, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const ctx = () => window.YappathonVoiceContext || {};
const db = () => ctx().db;
const me = () => ctx().currentUser;
const profile = () => ctx().profile || {};
const cache = () => ctx().userCache || {};

const RTC_CONFIG = { iceServers: [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" }
] };
const peers = new Map();
let localStream = null, activeCall = null, incoming = null;
let stopInviteListener = null, stopSignalListener = null, stopPresenceListener = null;
let muted = false;

function toast(message){ if(typeof ctx().toast === "function") ctx().toast(message,"info"); else console.log(message); }
function esc(s){ return String(s||"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c])); }
function callRef(id){ return doc(db(),"voiceCalls",id); }
function signalRef(id){ return collection(db(),"voiceCalls",id,"signals"); }
function inviteRef(id,uid){ return doc(db(),"voiceCalls",id,"invites",uid); }
function presenceRef(id,uid){ return doc(db(),"voiceCalls",id,"presence",uid); }

function injectStyle(){
  if(document.getElementById("yappathon-voice-style")) return;
  const s=document.createElement("style"); s.id="yappathon-voice-style";
  s.textContent=`
  .voice-start-btn{margin-left:auto;display:inline-flex;align-items:center;gap:6px;border:1px solid var(--border);background:var(--bg-input);color:var(--text);border-radius:8px;padding:6px 10px;font-size:12px;font-weight:700;transition:.15s ease}
  .voice-start-btn:hover{background:var(--accent-soft);border-color:var(--accent);color:var(--accent);transform:translateY(-1px)}
  .voice-overlay{position:fixed;inset:0;z-index:10050;background:rgba(0,0,0,.58);backdrop-filter:blur(8px);display:flex;align-items:center;justify-content:center;padding:20px}
  .voice-card{width:min(420px,100%);background:var(--bg-alt);border:1px solid var(--border);border-radius:18px;padding:26px;box-shadow:0 24px 80px var(--shadow);animation:scaleIn .22s ease both}
  .voice-kicker{font-size:11px;text-transform:uppercase;letter-spacing:.1em;color:var(--accent);font-weight:800;margin-bottom:7px}.voice-card h2{margin:0 0 7px;font-size:23px}.voice-card p{margin:0;color:var(--text-muted)}
  .voice-call-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:22px}.voice-btn{border:1px solid var(--border);border-radius:9px;padding:9px 15px;background:var(--bg-input);color:var(--text);font-weight:700}.voice-btn.primary{background:var(--accent);color:var(--accent-contrast);border-color:var(--accent)}.voice-btn.danger{color:#fff;background:var(--danger);border-color:var(--danger)}
  .voice-panel{position:fixed;right:20px;bottom:20px;z-index:10040;width:min(360px,calc(100vw - 40px));background:var(--bg-alt);border:1px solid var(--border);border-radius:16px;box-shadow:0 20px 70px var(--shadow);overflow:hidden}.voice-panel-head{display:flex;justify-content:space-between;align-items:center;padding:13px 14px;border-bottom:1px solid var(--border)}.voice-panel-head strong{display:block}.voice-panel-head span{font-size:11px;color:var(--text-muted)}.voice-icon-btn{border:0;background:none;color:var(--text-muted);font-size:22px;line-height:1;padding:2px 6px}.voice-participants{padding:10px;max-height:240px;overflow:auto}.voice-person{display:flex;justify-content:space-between;align-items:center;padding:9px 10px;border-radius:9px;background:var(--bg-elevated);margin-bottom:5px}.voice-person span{font-size:11px;color:var(--online)}.voice-controls{display:flex;gap:7px;padding:10px;border-top:1px solid var(--border)}.voice-control{flex:1;border:1px solid var(--border);background:var(--bg-input);color:var(--text);border-radius:8px;padding:8px;font-weight:700;font-size:12px}.voice-control.danger{color:#fff;background:var(--danger);border-color:var(--danger)}
  @media(max-width:600px){.voice-panel{right:10px;bottom:10px;width:calc(100vw - 20px)}.voice-start-btn span{display:none}}
  `; document.head.appendChild(s);
}
function ensureUI(){
  if(document.getElementById("voice-root")) return;
  const root=document.createElement("div"); root.id="voice-root"; root.innerHTML=`
  <div class="voice-overlay" id="voice-incoming" hidden><div class="voice-card"><div class="voice-kicker">Incoming voice call</div><h2 id="voice-incoming-title">Incoming call</h2><p id="voice-incoming-sub">Someone is calling you.</p><div class="voice-call-actions"><button class="voice-btn danger" id="voice-decline">Decline</button><button class="voice-btn primary" id="voice-accept">Accept</button></div></div></div>
  <div class="voice-panel" id="voice-panel" hidden><div class="voice-panel-head"><div><strong id="voice-title">Voice</strong><span id="voice-count">1 person</span></div><button class="voice-icon-btn" id="voice-x" title="Leave">×</button></div><div class="voice-participants" id="voice-participants"></div><div class="voice-controls"><button class="voice-control" id="voice-mute">🎙️ Mute</button><button class="voice-control danger" id="voice-leave">☎ Leave</button></div></div>`;
  document.body.appendChild(root);
  document.getElementById("voice-accept").onclick=acceptIncoming; document.getElementById("voice-decline").onclick=declineIncoming; document.getElementById("voice-x").onclick=leaveCall; document.getElementById("voice-leave").onclick=leaveCall; document.getElementById("voice-mute").onclick=toggleMute;
}
function context(){
  const c=ctx();
  if(c.currentConvoType==="channel"&&c.currentChannel) return {type:"channel",id:c.currentChannel,name:"#"+c.currentChannel,members:[]};
  if(c.currentConvoType==="dm"&&c.currentDmId){const d=c.dmCache&&c.dmCache[c.currentDmId];if(!d)return null;return {type:d.type==="group"?"group":"dm",id:c.currentDmId,name:d.name||null,members:Array.isArray(d.members)?d.members:[]};}
  return null;
}
function callIdFor(c){return (c.type==="channel"?"channel_":"call_")+c.id;}
function callTitle(c){return c.type==="channel"?c.name+" voice":(c.type==="group"?(c.name||"Group voice"):"Voice call");}
async function microphone(){if(localStream)return localStream;localStream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true},video:false});return localStream;}
function addAudio(uid,stream){let a=document.querySelector(`audio[data-yappathon-voice="${CSS.escape(uid)}"]`);if(!a){a=document.createElement("audio");a.autoplay=true;a.dataset.yappathonVoice=uid;a.style.display="none";document.body.appendChild(a);}a.srcObject=stream;}
function peer(other){if(peers.has(other))return peers.get(other);const pc=new RTCPeerConnection(RTC_CONFIG);if(localStream)localStream.getTracks().forEach(t=>pc.addTrack(t,localStream));pc.onicecandidate=e=>{if(e.candidate&&activeCall)addDoc(signalRef(activeCall.id),{type:"candidate",from:me().uid,to:other,candidate:e.candidate.toJSON(),createdAt:serverTimestamp()});};pc.ontrack=e=>addAudio(other,e.streams[0]);pc.onconnectionstatechange=()=>{if(["failed","closed"].includes(pc.connectionState)){pc.close();peers.delete(other);renderPanel();}};peers.set(other,pc);return pc;}
async function offer(other){const pc=peer(other);const o=await pc.createOffer();await pc.setLocalDescription(o);await addDoc(signalRef(activeCall.id),{type:"offer",from:me().uid,to:other,offer:{type:o.type,sdp:o.sdp},createdAt:serverTimestamp()});}
function listenSignals(id){if(stopSignalListener)stopSignalListener();stopSignalListener=onSnapshot(signalRef(id),async snap=>{for(const change of snap.docChanges()){if(change.type!=="added")continue;const s=change.doc.data();if(s.to!==me().uid)continue;try{if(s.type==="offer"){const pc=peer(s.from);await pc.setRemoteDescription(s.offer);const answer=await pc.createAnswer();await pc.setLocalDescription(answer);await addDoc(signalRef(id),{type:"answer",from:me().uid,to:s.from,answer:{type:answer.type,sdp:answer.sdp},createdAt:serverTimestamp()});}else if(s.type==="answer"){const pc=peers.get(s.from);if(pc)await pc.setRemoteDescription(s.answer);}else if(s.type==="candidate"){const pc=peers.get(s.from);if(pc&&s.candidate)await pc.addIceCandidate(s.candidate);}}catch(e){console.warn("Voice signaling error",e);}}});}
async function presence(id,online){const p=presenceRef(id,me().uid);if(online)await setDoc(p,{uid:me().uid,name:profile().username||"Member",photoBase64:profile().photoBase64||null,joinedAt:serverTimestamp()});else await deleteDoc(p).catch(()=>{});}
async function startCall(){const c=context();if(!c)return;if(activeCall){toast("You're already in a voice call.");return;}try{await microphone();}catch(e){toast("Microphone permission is required for voice chat.");return;}const id=callIdFor(c),ref=callRef(id),existing=await getDoc(ref);if(existing.exists()&&existing.data().active){if(c.type==="channel")return joinCall(id,c);toast("A call is already active here.");return;}const members=c.type==="channel"?[]:c.members;await setDoc(ref,{kind:c.type,contextId:c.id,name:callTitle(c),members,active:true,createdBy:me().uid,createdAt:serverTimestamp(),updatedAt:serverTimestamp()});activeCall={id,context:c,host:true};await presence(id,true);listenSignals(id);listenPresence(id);showPanel();renderPanel();if(c.type!=="channel")for(const member of members)if(member!==me().uid)await setDoc(inviteRef(id,member),{uid:member,status:"ringing",from:me().uid,fromName:profile().username||"Someone",createdAt:serverTimestamp()});}
async function joinCall(id,c){if(activeCall){toast("You're already in a voice call.");return;}try{await microphone();}catch(e){toast("Microphone permission is required for voice chat.");return;}activeCall={id,context:c,host:false};await presence(id,true);listenSignals(id);listenPresence(id);showPanel();renderPanel();}
function listenPresence(id){if(stopPresenceListener)stopPresenceListener();stopPresenceListener=onSnapshot(collection(db(),"voiceCalls",id,"presence"),async snap=>{for(const change of snap.docChanges()){if(change.type!=="added"||change.doc.id===me().uid)continue;if(!peers.has(change.doc.id)&&activeCall){try{await offer(change.doc.id);}catch(e){console.warn("Voice offer error",e);}}}renderPanel();});}
function showPanel(){ensureUI();document.getElementById("voice-panel").hidden=false;}
function renderPanel(){if(!activeCall)return;ensureUI();const list=document.getElementById("voice-participants");list.innerHTML="";const self=document.createElement("div");self.className="voice-person";self.innerHTML=`<strong>${esc(profile().username||"You")}</strong><span>You</span>`;list.appendChild(self);peers.forEach((_,id)=>{const u=cache()[id];const row=document.createElement("div");row.className="voice-person";row.innerHTML=`<strong>${esc(u?.username||"Member")}</strong><span>Connected</span>`;list.appendChild(row);});const count=peers.size+1;document.getElementById("voice-title").textContent=callTitle(activeCall.context);document.getElementById("voice-count").textContent=count===1?"1 person":`${count} people`;}
async function leaveCall(){if(!activeCall)return;const id=activeCall.id,host=activeCall.host;for(const pc of peers.values())pc.close();peers.clear();if(stopSignalListener){stopSignalListener();stopSignalListener=null;}if(stopPresenceListener){stopPresenceListener();stopPresenceListener=null;}await presence(id,false);if(host)await updateDoc(callRef(id),{active:false,endedAt:serverTimestamp()}).catch(()=>{});document.querySelectorAll("audio[data-yappathon-voice]").forEach(a=>{a.srcObject=null;a.remove();});activeCall=null;document.getElementById("voice-panel").hidden=true;}
function toggleMute(){muted=!muted;if(localStream)localStream.getAudioTracks().forEach(t=>t.enabled=!muted);document.getElementById("voice-mute").textContent=muted?"🔇 Unmute":"🎙️ Mute";}
function showIncoming(callId,data){ensureUI();incoming={id:callId,data};document.getElementById("voice-incoming-title").textContent=data.name||"Incoming voice call";const from=cache()[data.createdBy]?.username||"Someone";document.getElementById("voice-incoming-sub").textContent=`${data.kind==='group'?'Group call':'Direct call'} from ${from}`;document.getElementById("voice-incoming").hidden=false;}
async function acceptIncoming(){if(!incoming)return;const x=incoming;incoming=null;document.getElementById("voice-incoming").hidden=true;await updateDoc(inviteRef(x.id,me().uid),{status:"accepted",acceptedAt:serverTimestamp()});await joinCall(x.id,{type:x.data.kind,id:x.data.contextId,name:x.data.name,members:x.data.members||[]});}
async function declineIncoming(){if(!incoming)return;const x=incoming;incoming=null;document.getElementById("voice-incoming").hidden=true;await updateDoc(inviteRef(x.id,me().uid),{status:"declined",declinedAt:serverTimestamp()}).catch(()=>{});}
function listenInvites(){if(stopInviteListener||!me()?.uid)return;stopInviteListener=onSnapshot(query(collection(db(),"voiceCalls"),where("members","array-contains",me().uid),where("active","==",true)),snap=>{for(const change of snap.docChanges())if(change.type==="added"){const data=change.doc.data();if(data.createdBy===me().uid||activeCall)continue;getDoc(inviteRef(change.doc.id,me().uid)).then(s=>{if(s.exists()&&s.data().status==="ringing")showIncoming(change.doc.id,data);});}});}
function refreshVoiceButton(){ensureUI();const header=document.getElementById("convo-header");if(!header)return;header.querySelectorAll(".voice-start-btn").forEach(x=>x.remove());const c=context();if(!c)return;const b=document.createElement("button");b.className="voice-start-btn";b.innerHTML=c.type==="channel"?"🎙️ <span>Join VC</span>":"📞 <span>Call</span>";b.title=c.type==="channel"?"Join channel voice chat":"Start a voice call";b.onclick=async()=>{if(c.type==="channel"){const id=callIdFor(c),s=await getDoc(callRef(id));if(s.exists()&&s.data().active)await joinCall(id,c);else await startCall();}else await startCall();};header.appendChild(b);}
function boot(){injectStyle();ensureUI();listenInvites();refreshVoiceButton();const header=document.getElementById("convo-header");if(header)new MutationObserver(refreshVoiceButton).observe(header,{childList:true});setInterval(()=>{listenInvites();refreshVoiceButton();},5000);}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",boot,{once:true});else boot();
