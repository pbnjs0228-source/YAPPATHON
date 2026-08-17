// Runtime bridge for Yappathon's inline voice engine plus Multiplayer Pool.
// The inline voice engine can falsely tear down a call when a browser tab or
// network briefly delays the host heartbeat. This wrapper remembers the last
// call context and transparently rejoins only when the Firestore call is still
// active. An explicit user leave is never auto-rejoined.
import './pool.js';

const ctx = () => window.YappathonVoiceContext || {};
let lastCallId = null;
let lastCallContext = null;
let intentionalLeave = false;
let restoring = false;

function contextNow(){
  const c=ctx();
  if(c.currentConvoType==='channel' && c.currentChannel) return {type:'channel',id:c.currentChannel,name:'#'+c.currentChannel,members:[]};
  if(c.currentConvoType==='dm' && c.currentDmId){
    const d=c.dmCache?.[c.currentDmId];
    if(!d) return null;
    return {type:d.type==='group'?'group':'dm',id:c.currentDmId,name:d.name||null,members:Array.isArray(d.members)?d.members:[]};
  }
  return null;
}

function install(){
  const api=window.YappathonVoice;
  if(!api || api.__falseLeaveGuardInstalled)return !!api;
  api.__falseLeaveGuardInstalled=true;
  const originalLeave=api.leave;
  api.leave=async function(){
    intentionalLeave=true;
    lastCallId=null;
    lastCallContext=null;
    return originalLeave.apply(this,arguments);
  };
  const originalStart=api.start;
  api.start=async function(){
    intentionalLeave=false;
    const result=await originalStart.apply(this,arguments);
    const id=api.activeCallId?.();
    if(id){lastCallId=id;lastCallContext=contextNow();}
    return result;
  };
  const originalJoin=api.join;
  api.join=async function(callId,callContext){
    intentionalLeave=false;
    const result=await originalJoin.call(this,callId,callContext);
    if(result!==false && api.isInCall?.(callId)){
      lastCallId=callId;lastCallContext=callContext||contextNow();
    }
    return result;
  };
  return true;
}

async function recover(){
  if(restoring || intentionalLeave || !lastCallId || !lastCallContext)return;
  const api=window.YappathonVoice;
  if(!api || api.activeCallId?.())return;
  const db=ctx().db;
  if(!db)return;
  try{
    const {doc,getDoc}=await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
    const snap=await getDoc(doc(db,'voiceCalls',lastCallId));
    if(!snap.exists() || snap.data()?.active!==true)return;
    restoring=true;
    await api.join(lastCallId,lastCallContext);
  }catch(e){console.warn('Voice call recovery failed:',e)}
  finally{restoring=false}
}

const timer=setInterval(()=>{
  if(install()){
    const api=window.YappathonVoice;
    const id=api.activeCallId?.();
    if(id){lastCallId=id;lastCallContext=contextNow();intentionalLeave=false}
    recover();
  }
},1000);
window.addEventListener('beforeunload',()=>clearInterval(timer),{once:true});
