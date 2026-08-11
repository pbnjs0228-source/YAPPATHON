(() => {
  'use strict';
  const C=()=>window.YappathonVoiceContext||{};
  const FIREBASE='https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
  let fs=null,profileUnsub=null,callUnsub=null,inviteUnsubs=new Map(),started=false;
  const loadedProfiles=new Map(),callLogs=new Map(),seenIncoming=new Set();
  async function firestore(){if(!fs)fs=await import(FIREBASE);return fs}
  function current(){return C().currentUser||null}
  function profile(){return C().profile||{}}
  function convoFromCall(d){return d.kind==='channel'?{type:'channel',id:d.contextId}:{type:d.kind==='group'?'group':'dm',id:d.contextId}}
  function msgPath(d){const c=convoFromCall(d);return c.type==='channel'?['channels',c.id,'messages']:['dms',c.id,'messages']}
  function durationText(ms){const s=Math.max(0,Math.round(ms/1000));if(s<60)return `${s} second${s===1?'':'s'}`;const m=Math.floor(s/60);if(m<60)return `${m} minute${m===1?'':'s'}`;const h=Math.floor(m/60);return `${h} hour${h===1?'':'s'}`}
  function ms(v){return v?.toMillis?.()||0}

  async function syncUserHistory(uid,username,photoBase64){
    const c=C();if(!c.db||!uid)return;
    try{
      const{collectionGroup,query,where,getDocs,writeBatch}=await firestore();
      const snap=await getDocs(query(collectionGroup(c.db,'messages'),where('uid','==',uid)));
      let batch=writeBatch(c.db),n=0;
      for(const d of snap.docs){
        const old=d.data()||{},changes={};
        if(old.username!==username)changes.username=username;
        const p=photoBase64||null;
        if((old.photoBase64||null)!==p)changes.photoBase64=p;
        if(!Object.keys(changes).length)continue;
        batch.update(d.ref,changes);n++;
        if(n>=400){await batch.commit();batch=writeBatch(c.db);n=0}
      }
      if(n)await batch.commit();
    }catch(e){console.warn('YAPPATHON profile history sync failed:',e)}
  }

  function watchProfiles(){
    const c=C();if(!c.db||profileUnsub)return;
    firestore().then(({collection,onSnapshot})=>{
      profileUnsub=onSnapshot(collection(c.db,'users'),snap=>{
        snap.docChanges().forEach(ch=>{
          if(ch.type==='removed')return;
          const p=ch.doc.data()||{},key=JSON.stringify({username:p.username||'',photoBase64:p.photoBase64||null}),old=loadedProfiles.get(ch.doc.id);
          loadedProfiles.set(ch.doc.id,key);
          if(old!==undefined&&old!==key)syncUserHistory(ch.doc.id,p.username||'Someone',p.photoBase64||null);
        });
      },e=>console.warn('YAPPATHON profile listener failed:',e));
    }).catch(()=>{});
  }

  function incomingUi(){
    if(document.getElementById('yap-incoming-call'))return document.getElementById('yap-incoming-call');
    const s=document.createElement('style');s.textContent=`#yap-incoming-call{position:fixed;inset:0;z-index:20000;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.58);backdrop-filter:blur(8px)}#yap-incoming-call[hidden]{display:none!important}.yap-in-card{width:min(430px,calc(100vw - 32px));padding:26px;border:1px solid var(--border);border-radius:20px;background:var(--bg-alt);box-shadow:0 25px 90px rgba(0,0,0,.45);text-align:center}.yap-in-icon{width:70px;height:70px;margin:0 auto 12px;border-radius:50%;display:grid;place-items:center;background:var(--accent-soft);font-size:32px;animation:yapRingIncoming 1s ease-in-out infinite}.yap-in-card h2{margin:8px 0}.yap-in-card p{color:var(--text-muted);margin:0}.yap-in-actions{display:flex;justify-content:center;gap:10px;margin-top:22px}.yap-in-actions button{border:0;border-radius:10px;padding:10px 18px;font-weight:800;cursor:pointer}.yap-in-decline{background:var(--danger);color:#fff}.yap-in-accept{background:var(--accent);color:var(--accent-contrast)}@keyframes yapRingIncoming{0%,100%{transform:scale(1);box-shadow:0 0 0 0 rgba(255,255,255,.08)}50%{transform:scale(1.08);box-shadow:0 0 0 12px rgba(255,255,255,.05)}}`;document.head.appendChild(s);
    const d=document.createElement('div');d.id='yap-incoming-call';d.hidden=true;d.innerHTML='<div class="yap-in-card"><div class="yap-in-icon">📞</div><h2 id="yap-in-name">Incoming call</h2><p id="yap-in-text">Someone is calling you</p><div class="yap-in-actions"><button class="yap-in-decline" id="yap-in-decline">Decline</button><button class="yap-in-accept" id="yap-in-accept">Accept</button></div></div>';document.body.appendChild(d);return d;
  }
  async function showIncoming(callId,call,inviteUid){
    const uid=current()?.uid;if(!uid||uid!==inviteUid||call.createdBy===uid)return;
    const inv=call.__invite;if(inv?.status!=='ringing'||!inv.createdAt?.toMillis||Date.now()-inv.createdAt.toMillis()>30000)return;
    const el=incomingUi(),caller=(C().userCache||{})[call.createdBy]||{};
    document.getElementById('yap-in-name').textContent=`${caller.username||'Someone'} is calling you`;
    document.getElementById('yap-in-text').textContent=call.kind==='group'?(call.name||'Group call'):'Incoming voice call';
    el.hidden=false;
    const accept=async()=>{try{const{updateDoc}=await firestore();await updateDoc(docRef(callId,inviteUid),{status:'accepted',respondedAt:(await firestore()).serverTimestamp()});el.hidden=true}catch(e){console.warn('Accept call failed',e)}};
    const decline=async()=>{try{const{updateDoc}=await firestore();await updateDoc(docRef(callId,inviteUid),{status:'declined',respondedAt:(await firestore()).serverTimestamp()})}catch(e){}el.hidden=true};
    document.getElementById('yap-in-accept').onclick=accept;document.getElementById('yap-in-decline').onclick=decline;
  }
  function docRef(callId,uid){return window.YappathonVoiceContext?.db?null:null}
  async function watchCallInvites(callId,call){
    const uid=current()?.uid;if(!uid||call.createdBy===uid)return;
    if(inviteUnsubs.has(callId))return;
    try{
      const{doc,onSnapshot}=await firestore();
      const ref=doc(C().db,'voiceCalls',callId,'invites',uid);
      const unsub=onSnapshot(ref,snap=>{if(!snap.exists())return;const inv=snap.data()||{};const merged={...call,__invite:inv};if(inv.status==='ringing')showIncoming(callId,merged,uid);else{const el=document.getElementById('yap-incoming-call');if(el)el.hidden=true}},()=>{});
      inviteUnsubs.set(callId,unsub);
    }catch(e){console.warn('Incoming call listener failed:',e)}
  }
  async function watchIncomingCalls(){
    const c=C(),uid=current()?.uid;if(!c.db||!uid)return;
    try{
      const{collection,onSnapshot}=await firestore();
      if(callUnsub)callUnsub();
      callUnsub=onSnapshot(collection(c.db,'voiceCalls'),snap=>{
        snap.docChanges().forEach(ch=>{
          const d=ch.doc.data()||{},callId=ch.doc.id;
          if(d.active===true&&Array.isArray(d.members)&&d.members.includes(uid))watchCallInvites(callId,d);
          if(ch.type==='removed' || d.active!==true){const u=inviteUnsubs.get(callId);if(u){u();inviteUnsubs.delete(callId)}}
        });
      },e=>console.warn('Incoming call watcher failed:',e));
    }catch(e){console.warn('Incoming call watcher failed:',e)}
  }

  async function ensureCallLog(callId,d){
    const c=C(),uid=current()?.uid;if(!c.db||!uid||d.createdBy!==uid)return;
    if(callLogs.has(callId))return;
    try{
      const{doc,setDoc,serverTimestamp}=await firestore();const p=msgPath(d);const ref=doc(c.db,...p,'call_'+callId);
      const username=profile().username||'Someone';
      await setDoc(ref,{uid,username,role:profile().role||'member',photoBase64:profile().photoBase64||null,text:`${username} started a call`,imageBase64:null,mentions:[],timestamp:serverTimestamp(),callLog:true,callId},{merge:true});
      callLogs.set(callId,{ref,startedAt:ms(d.createdAt)||Date.now(),username});
    }catch(e){console.warn('YAPPATHON call log start failed:',e)}
  }
  async function finishCallLog(callId,d){const st=callLogs.get(callId);if(!st)return;callLogs.delete(callId);try{const{updateDoc}=await firestore();const end=ms(d.endedAt)||ms(d.updatedAt)||Date.now();await updateDoc(st.ref,{text:`${st.username} started a call for ${durationText(Math.max(0,end-st.startedAt))}`})}catch(e){console.warn('YAPPATHON call log finish failed:',e)}}
  function watchCalls(){const c=C(),uid=current()?.uid;if(!c.db||!uid||callUnsub)return;firestore().then(({collection,query,where,onSnapshot})=>{callUnsub=onSnapshot(query(collection(c.db,'voiceCalls'),where('createdBy','==',uid)),snap=>{snap.docChanges().forEach(ch=>{const d=ch.doc.data()||{},key=ch.doc.id;if(d.active===true)ensureCallLog(key,d);else if(callLogs.has(key))finishCallLog(key,d)})})}).catch(()=>{})}
  function reset(){const uid=current()?.uid||'';if(uid===reset.uid)return;reset.uid=uid;if(profileUnsub){profileUnsub();profileUnsub=null}if(callUnsub){callUnsub();callUnsub=null}inviteUnsubs.forEach(u=>u());inviteUnsubs.clear();loadedProfiles.clear();callLogs.clear();if(uid){watchProfiles();watchCalls();watchIncomingCalls()}}
  function start(){if(started)return;started=true;reset();setInterval(reset,1000)}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();
