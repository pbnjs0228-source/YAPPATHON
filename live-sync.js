(() => {
  'use strict';
  const C=()=>window.YappathonVoiceContext||{};
  const FIREBASE='https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
  let fs=null,profileUnsub=null,callUnsub=null,started=false;
  const loadedProfiles=new Map();
  const callLogs=new Map();
  async function firestore(){if(!fs)fs=await import(FIREBASE);return fs}
  function convoFromCall(d){return d.kind==='channel'?{type:'channel',id:d.contextId}:{type:d.kind==='group'?'group':'dm',id:d.contextId}}
  function msgCollection(d){const c=convoFromCall(d);return c.type==='channel'?['channels',c.id,'messages']:['dms',c.id,'messages']}
  function durationText(ms){const s=Math.max(0,Math.round(ms/1000));if(s<60)return `${s} second${s===1?'':'s'}`;const m=Math.floor(s/60);if(m<60)return `${m} minute${m===1?'':'s'}`;const h=Math.floor(m/60);return `${h} hour${h===1?'':'s'}`}
  function tsMs(v){return v?.toMillis?.()||0}
  async function syncUserHistory(uid,username,photoBase64){
    const c=C();if(!c.db||!uid)return;
    try{
      const{collectionGroup,query,where,getDocs,writeBatch}=await firestore();
      const snap=await getDocs(query(collectionGroup(c.db,'messages'),where('uid','==',uid)));
      let batch=writeBatch(c.db),n=0;
      for(const d of snap.docs){const data=d.data()||{},changes={};if(data.username!==username)changes.username=username;const p=photoBase64||null;if((data.photoBase64||null)!==p)changes.photoBase64=p;if(!Object.keys(changes).length)continue;batch.update(d.ref,changes);n++;if(n===400){await batch.commit();batch=writeBatch(c.db);n=0}}
      if(n)await batch.commit();
    }catch(e){console.warn('YAPPATHON profile history sync failed:',e)}
  }
  function watchProfiles(){const c=C();if(!c.db||profileUnsub)return;firestore().then(({collection,onSnapshot})=>{profileUnsub=onSnapshot(collection(c.db,'users'),snap=>{snap.forEach(d=>{const p=d.data()||{},key=JSON.stringify({username:p.username||'',photoBase64:p.photoBase64||null}),old=loadedProfiles.get(d.id);loadedProfiles.set(d.id,key);if(old!==undefined&&old!==key)syncUserHistory(d.id,p.username||'Someone',p.photoBase64||null)})})}).catch(()=>{})}
  async function ensureCallLog(callId,d){
    const c=C(),uid=c.currentUser?.uid;if(!c.db||!uid||d.createdBy!==uid)return;
    const key=callId;if(callLogs.has(key))return;
    try{
      const{doc,setDoc,serverTimestamp}=await firestore();
      const [parent,id]=msgCollection(d);const ref=doc(c.db,parent,id,'messages','call_'+callId);
      const username=c.profile?.username||'Someone';
      await setDoc(ref,{uid,username,role:c.profile?.role||'member',photoBase64:c.profile?.photoBase64||null,text:`${username} started a call`,imageBase64:null,mentions:[],timestamp:serverTimestamp(),callLog:true,callId});
      callLogs.set(key,{ref,startedAt:tsMs(d.createdAt)||Date.now(),username});
    }catch(e){console.warn('YAPPATHON call log start failed:',e)}
  }
  async function finishCallLog(callId,d){
    const state=callLogs.get(callId);if(!state)return;callLogs.delete(callId);
    try{const{updateDoc}=await firestore();const end=tsMs(d.endedAt)||tsMs(d.updatedAt)||Date.now();const duration=durationText(Math.max(0,end-state.startedAt));await updateDoc(state.ref,{text:`${state.username} started a call for ${duration}`})}catch(e){console.warn('YAPPATHON call log finish failed:',e)}
  }
  function watchCalls(){const c=C();const uid=c.currentUser?.uid;if(!c.db||!uid||callUnsub)return;firestore().then(({collection,query,where,onSnapshot})=>{callUnsub=onSnapshot(query(collection(c.db,'voiceCalls'),where('createdBy','==',uid)),snap=>{snap.docChanges().forEach(ch=>{const d=ch.doc.data()||{},key=ch.doc.id;if(ch.type==='added'||ch.type==='modified'){if(d.active===true)ensureCallLog(key,d);else if(callLogs.has(key))finishCallLog(key,d)}})})},e=>console.warn('YAPPATHON call log listener failed:',e))}).catch(()=>{})}
  function resetIfUserChanged(){const uid=C().currentUser?.uid||'';if(uid===resetIfUserChanged.uid)return;resetIfUserChanged.uid=uid;if(profileUnsub){profileUnsub();profileUnsub=null}if(callUnsub){callUnsub();callUnsub=null}loadedProfiles.clear();callLogs.clear();if(uid){watchProfiles();watchCalls()}}
  function start(){if(started)return;started=true;resetIfUserChanged();setInterval(resetIfUserChanged,1000)}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();
