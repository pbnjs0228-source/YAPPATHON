(() => {
  'use strict';

  const C = () => window.YappathonVoiceContext || {};
  const $ = id => document.getElementById(id);
  const FIREBASE = 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

  let fs = null;
  let lastProfiles = new Map();
  let syncing = new Set();
  let callState = null;
  let observer = null;
  let poll = null;

  async function firestore() {
    if (!fs) fs = await import(FIREBASE);
    return fs;
  }

  function convo() {
    const c = C();
    if (c.currentConvoType === 'channel' && c.currentChannel) {
      return { type: 'channel', id: c.currentChannel, name: '#' + c.currentChannel, members: [] };
    }
    if (c.currentConvoType === 'dm' && c.currentDmId) {
      const d = c.dmCache?.[c.currentDmId];
      if (!d) return null;
      return {
        type: d.type === 'group' ? 'group' : 'dm',
        id: c.currentDmId,
        name: d.name || null,
        members: Array.isArray(d.members) ? d.members : []
      };
    }
    return null;
  }

  function callId(c) {
    return (c.type === 'channel' ? 'channel_' : 'call_') + c.id;
  }

  function activeCallStage() {
    const stage = $('voice-dm-stage');
    return !!stage && !stage.hidden;
  }

  function durationText(ms) {
    const total = Math.max(1, Math.round(ms / 1000));
    if (total < 60) return `${total} second${total === 1 ? '' : 's'}`;
    const minutes = Math.floor(total / 60);
    if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'}`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'}`;
    const days = Math.floor(hours / 24);
    return `${days} day${days === 1 ? '' : 's'}`;
  }

  async function messagesCollection(c) {
    const { collection } = await firestore();
    return c.type === 'channel'
      ? collection(C().db, 'channels', c.id, 'messages')
      : collection(C().db, 'dms', c.id, 'messages');
  }

  async function syncUserHistory(uid, username, photoBase64) {
    if (!C().db || !uid || syncing.has(uid)) return;
    syncing.add(uid);
    try {
      const { collectionGroup, query, where, getDocs, writeBatch } = await firestore();
      const q = query(collectionGroup(C().db, 'messages'), where('uid', '==', uid));
      const snap = await getDocs(q);
      let batch = writeBatch(C().db);
      let count = 0;
      for (const d of snap.docs) {
        const data = d.data() || {};
        const changes = {};
        if (data.username !== username) changes.username = username;
        const nextPhoto = photoBase64 || null;
        if ((data.photoBase64 || null) !== nextPhoto) changes.photoBase64 = nextPhoto;
        if (!Object.keys(changes).length) continue;
        batch.update(d.ref, changes);
        count++;
        if (count >= 400) {
          await batch.commit();
          batch = writeBatch(C().db);
          count = 0;
        }
      }
      if (count) await batch.commit();
    } catch (e) {
      console.warn('YAPPATHON message profile sync failed:', e);
    } finally {
      syncing.delete(uid);
    }
  }

  function watchProfiles() {
    const c = C();
    if (!c.db) return;
    firestore().then(({ collection, onSnapshot }) => {
      onSnapshot(collection(c.db, 'users'), snap => {
        snap.forEach(d => {
          const p = d.data() || {};
          const next = JSON.stringify({ username: p.username || '', photoBase64: p.photoBase64 || null });
          const previous = lastProfiles.get(d.id);
          lastProfiles.set(d.id, next);
          if (previous !== undefined && previous !== next) {
            syncUserHistory(d.id, p.username || 'Someone', p.photoBase64 || null);
          }
        });
      }, () => {});
    }).catch(() => {});
  }

  async function getCallDoc(c) {
    const { doc, getDoc } = await firestore();
    try {
      const snap = await getDoc(doc(C().db, 'voiceCalls', callId(c)));
      return snap.exists() ? snap.data() : null;
    } catch (_) {
      return null;
    }
  }

  async function startCallLog(c, call) {
    if (!call || call.createdBy !== C().currentUser?.uid) return;
    if (callState && callState.id === callId(c)) return;

    const username = C().profile?.username || 'Someone';
    const text = `${username} started a call`;
    try {
      const { addDoc, serverTimestamp } = await firestore();
      const col = await messagesCollection(c);
      const ref = await addDoc(col, {
        uid: C().currentUser.uid,
        username,
        role: C().profile?.role || 'member',
        photoBase64: C().profile?.photoBase64 || null,
        text,
        imageBase64: null,
        mentions: [],
        timestamp: serverTimestamp(),
        callLog: true
      });
      callState = {
        id: callId(c),
        convo: c,
        messagePath: ref.path,
        messageId: ref.id,
        startedAt: Date.now()
      };
      localStorage.setItem('yappathon-call-log', JSON.stringify(callState));
    } catch (e) {
      console.warn('YAPPATHON call log start failed:', e);
    }
  }

  async function finishCallLog() {
    if (!callState) return;
    const state = callState;
    callState = null;
    localStorage.removeItem('yappathon-call-log');
    try {
      const { doc, updateDoc } = await firestore();
      const ref = doc(C().db, ...state.messagePath.split('/'));
      const duration = durationText(Date.now() - state.startedAt);
      const username = C().profile?.username || 'Someone';
      await updateDoc(ref, { text: `${username} started a call for ${duration}` });
    } catch (e) {
      console.warn('YAPPATHON call log finish failed:', e);
    }
  }

  async function restoreCallLog() {
    try {
      const raw = localStorage.getItem('yappathon-call-log');
      if (!raw) return;
      const saved = JSON.parse(raw);
      if (!saved?.id || !saved?.messagePath || !saved?.startedAt) return;
      if (Date.now() - saved.startedAt > 24 * 60 * 60 * 1000) {
        localStorage.removeItem('yappathon-call-log');
        return;
      }
      callState = saved;
    } catch (_) {}
  }

  async function watchCalls() {
    const c = convo();
    const active = activeCallStage();

    if (active && c) {
      const call = await getCallDoc(c);
      if (call?.active) await startCallLog(c, call);
      return;
    }

    // If the user navigated away from the conversation, use the original
    // conversation saved with the call rather than losing the final duration.
    if (!active && callState) await finishCallLog();
  }

  function start() {
    if (poll) return;
    watchProfiles();
    restoreCallLog();
    observer = new MutationObserver(() => { watchCalls().catch(() => {}); });
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['hidden', 'class'] });
    poll = setInterval(() => watchCalls().catch(() => {}), 1200);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
