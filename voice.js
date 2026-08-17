// Runtime bridge for Yappathon's inline voice engine plus Multiplayer Pool.
// The inline voice engine can falsely tear down a call when a browser tab or
// network briefly delays the host heartbeat. This wrapper remembers the last
// call context and transparently rejoins only when the Firestore call is still
// active. An explicit user leave is never auto-rejoined.
import './pool-final.js';

const ctx = () => window.YappathonVoiceContext || {};
let lastCallId = null;
let lastCallContext = null;
let intentionalLeave = false;
let restoring = false;
function contextNow(){
  const c=ctx();
  if(c.currentConvoType==='channel'&&c.currentChannel)return{type:'channel',id:c.currentChannel,name:'#'+c.currentChannel,members:[]};
  if(c.currentConvoType==='dm'&&c.currentDmId){const d=c.dmCache?.[c.currentDmId];if(!d)return null;return{type:d.type==='group'?'group':'dm',id:c.currentDmId,name:d.name||null,members:Array.isArray(d.members)?d.members:[]}}
  return null;
}
function install(){
  const api=window.YappathonVoice;
  if(!api||api.__falseLeaveGuardInstalled)return!!api;
  api.__falseLeaveGuardInstalled=true;
  const leave=api.leave;
  api.leave=async function(){intentionalLeave=true;lastCallId=null;lastCallContext=null;return leave.apply(this,arguments)};
  const start=api.start;
  api.start=async function(){intentionalLeave=false;const r=await start.apply(this,arguments);const id=api.activeCallId?.();if(id){lastCallId=id;lastCallContext=contextNow()}return r};
  const join=api.join;
  api.join=async function(id,c){intentionalLeave=false;const r=await join.call(this,id,c);if(r!==false&&api.isInCall?.(id)){lastCallId=id;lastCallContext=c||contextNow()}return r};
  return true;
}
async function recover(){
  if(restoring||intentionalLeave||!lastCallId||!lastCallContext)return;
  const api=window.YappathonVoice;if(!api||api.activeCallId?.())return;
  const db=ctx().db;if(!db)return;
  try{const{doc,getDoc}=await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');const s=await getDoc(doc(db,'voiceCalls',lastCallId));if(!s.exists()||s.data()?.active!==true)return;restoring=true;await api.join(lastCallId,lastCallContext)}catch(e){console.warn('Voice call recovery failed:',e)}finally{restoring=false}
}
const timer=setInterval(()=>{if(install()){const api=window.YappathonVoice,id=api.activeCallId?.();if(id){lastCallId=id;lastCallContext=contextNow();intentionalLeave=false}recover()}},1000);
window.addEventListener('beforeunload',()=>clearInterval(timer),{once:true});
