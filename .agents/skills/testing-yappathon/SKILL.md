---
name: testing-yappathon
description: How to run and test the YAPPATHON single-file Firebase chat app locally, including account setup, known Firestore rules pitfalls, and UI paths for the member context menu, DMs, block/mute, and the timetable settings pane.
---

# Testing YAPPATHON locally

The whole app is one static file: `index.html`. There is no build step and no dependencies to install.

## Serving

```bash
cd <repo> && python3 -m http.server 8000
# open http://localhost:8000
```

Firebase config is hard-coded in `index.html` (project `orangefox-ce8b1`). As of the last test run
`localhost` **is** an authorized domain, so Google sign-in and email/password both work and no
config banner appears. If the banner does appear, email/password sign-up should still work — the
app surfaces an explicit banner rather than a wall of console errors.

## Accounts

Sign up through the UI: click **Sign up**, fill Username / Email / Password (any values, e.g.
`something@example.com` / `Passw0rd!23`). For two-user scenarios open a second Chrome **incognito**
window (`ctrl+shift+n`) and sign up a second account there. Accounts persist in the shared live
project, so reuse or vary emails between runs.

## Known blocker: Firestore rules deny writes for ordinary accounts

The deployed security rules on the live project reject `users/{uid}` updates and `channels/*`
creates for normal (non-admin) accounts with `permission-denied`. Symptoms in the UI are generic
toasts that hide the real cause:

| Toast | Underlying write |
|---|---|
| `Couldn't create that DM.` | `setDoc(channels/dm_<a>_<b>)` |
| `Couldn't save that change.` | `updateDoc(users/{uid}, {blocked|muted})` |
| `Couldn't save changes.` | profile / timetable save on `users/{uid}` |

Anything that writes (DM creation, block, mute, profile save, timetable save) may therefore be
untestable until rules are deployed. A repo `firestore.rules` file may exist but committing it does
**not** deploy it — only the project owner can deploy via the Firebase console / `firebase deploy`.

**Quick triage:** before blaming a feature, try an unrelated write — change the username on
Settings → Profile and click Save. If that also fails, it is the rules, not the feature.

**Surfacing the real error:** the catch blocks swallow exceptions. Temporarily add
`console.error('X', e && e.code, e && e.message)` inside the relevant `catch`, reload, retry, then
read the console and `git checkout -- index.html` to revert.

## UI paths

- **Member context menu:** right-click a row in the right-hand member list (or a message row).
  Items: View profile / Create DM (or Open DM) / Mute / Block. Right-clicking your own row shows
  only View profile. Closes on Escape, outside click, or window resize.
- **DMs:** appear in the sidebar "Direct Messages" section with an `@` prefix; empty state reads
  "Right-click a member to start a DM." Channel id is `dm_<sortedUidA>_<sortedUidB>`.
- **Timetable:** Settings (⚙️ bottom-left) → 🗓️ Timetable. Contains only the enable checkbox, week
  select, "Paste as text" textarea, Fill grid / Clear grid buttons, and the 7×10 grid.

## Pasting tab-separated data

Do **not** type tab characters with a `type` action — tabs move focus between grid inputs and
scramble the data. Put the text on the X clipboard and press `ctrl+v` instead:

```bash
sudo apt-get install -y xclip   # not preinstalled
printf 'a\tb\n...' | DISPLAY=:0 xclip -selection clipboard
```

Check `echo $DISPLAY` — it is usually `:0`, not `:1`.

## Devin Secrets Needed

None. The Firebase config is public and embedded in `index.html`. Testing write paths requires
deployed Firestore rules (a project-owner action), not a secret.
