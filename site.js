/* Blazing:Rebirth Current Tracker: GitHub Pages + Firebase layer.
   Loads the character/stage data from Firestore (public read), lets approved
   editors sign in with Google, and falls back to the bundled starting data
   when Firebase isn't set up yet or the database is still empty. */
const FB = "https://www.gstatic.com/firebasejs/10.12.2/";
const CHUNKS = {units: 4, stages: 2, site: 1};
const numOf = id => parseInt(String(id).replace(/\D+/g, ""), 10) || 0;
const chunkOf = (col, id) => col.charAt(0) + (numOf(id) % CHUNKS[col]);
const $ = s => document.querySelector(s);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

let WIKI = {}, SEED = {units: {}, stages: {}};
const dataReady = Promise.all([
  fetch("data/wiki.json").then(r => r.ok ? r.json() : {}).catch(() => ({})),
  fetch("data/seed.json").then(r => r.ok ? r.json() : {units: {}, stages: {}}).catch(() => ({units: {}, stages: {}}))
]).then(([w, s]) => { WIKI = w || {}; SEED = s || {units: {}, stages: {}}; });

const downloads = {
  save({filename, data}){
    const a = document.createElement("a"); a.href = URL.createObjectURL(data); a.download = filename || "download";
    document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
    return Promise.resolve({status: "saved"});
  }
};
const withWiki = (col, id, v) => { const o = Object.assign({}, v); if (col === "units" && WIKI[id]) o.wiki = WIKI[id]; return o; };
const asDocs = (col, items) => Object.entries(items).map(([id, v]) => { const o = withWiki(col, id, v); return {id, exists: true, data: () => o}; });

const cfg = window.BLAZING_FIREBASE || {};
const configured = !!(cfg.apiKey && cfg.projectId && !/^PASTE/i.test(cfg.apiKey));

function startStatic(why){
  // Read-only mode from the bundled data, so the site still works without Firebase
  console.info("Blazing tracker: " + why + " Showing the bundled data read-only. See README.md.");
  const no = () => Promise.reject({code: "unavailable"});
  const staticDb = {collection: col => ({
    onSnapshot(cb){ dataReady.then(() => cb({docs: asDocs(col, SEED[col] || {})})); return () => {}; },
    doc: () => ({set: no, update: no, delete: no})
  })};
  window.__fbResolve({use: n => Promise.resolve(n === "db" ? staticDb : n === "user" ? {isOwner: () => Promise.resolve(false)} : n === "downloads" ? downloads : null)});
}

let mods = null;
if (configured){
  try { mods = await Promise.all([import(FB + "firebase-app.js"), import(FB + "firebase-auth.js"), import(FB + "firebase-firestore.js")]); }
  catch(e){ mods = null; }
}
if (!configured) startStatic("Firebase isn't set up yet.");
else if (!mods) startStatic("Couldn't reach Firebase.");
else {
  const [{ initializeApp }, { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword, updatePassword },
    { getFirestore, collection, doc, onSnapshot, getDoc, getDocs, setDoc, updateDoc, deleteDoc, addDoc, deleteField, FieldPath, serverTimestamp }] = mods;
  const app = initializeApp(cfg);
  const auth = getAuth(app), fs = getFirestore(app);
  const empty = {units: null, stages: null};
  // Username logins: each username becomes a made-up address on the project's own Firebase domain.
  // No email is ever sent to it; it only gives the account a unique name.
  const USER_DOMAIN = "@" + String(cfg.authDomain || (cfg.projectId + ".firebaseapp.com")).toLowerCase();
  const isUserAcct = e => String(e || "").toLowerCase().endsWith(USER_DOMAIN);
  const nameOf = e => isUserAcct(e) ? String(e).slice(0, -USER_DOMAIN.length) : String(e || "");
  const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{2,29}$/;
  let creatorAuth = null;
  const getCreator = () => creatorAuth || (creatorAuth = getAuth(initializeApp(cfg, "creator")));
  let role = null, firstAuth = true, resolveRole;
  const roleReady = new Promise(r => { resolveRole = r; });

  const clean = o => JSON.parse(JSON.stringify(o === undefined ? null : o));
  const strip = (col, o) => { const c = clean(o) || {}; delete c.id; if (col === "units") delete c.wiki; return c; };
  // Turn a nested patch into field paths, so an update merges like the tracker expects
  function flatten(path, obj, out){
    for (const [k, v] of Object.entries(obj)){
      const p = path.concat(k);
      if (v && typeof v === "object" && !Array.isArray(v)){
        if (v.__delete__) out.push([p, deleteField()]);
        else if (Object.keys(v).length) flatten(p, v, out);
      } else out.push([p, v]);
    }
    return out;
  }
  const db = {collection: col => ({
    onSnapshot(cb, onErr){
      return onSnapshot(collection(fs, col), qs => {
        const items = {};
        qs.forEach(d => Object.assign(items, (d.data() || {}).items || {}));
        empty[col] = Object.keys(items).length === 0;
        cb({docs: asDocs(col, empty[col] ? (SEED[col] || {}) : items)});
        renderAuth();
      }, e => { if (onErr) onErr(e); });
    },
    doc(id){
      const ref = doc(fs, col, chunkOf(col, id));
      return {
        async set(obj){
          const v = strip(col, obj);
          try { await updateDoc(ref, new FieldPath("items", id), v); }
          catch(e){ if (e && e.code === "not-found") await setDoc(ref, {items: {[id]: v}}, {merge: true}); else throw e; }
        },
        async update(patch){
          const pairs = flatten(["items", id], strip(col, patch), []);
          if (!pairs.length) return;
          const args = []; pairs.forEach(([p, v]) => args.push(new FieldPath(...p), v));
          try { await updateDoc(ref, ...args); }
          catch(e){
            if (!(e && e.code === "not-found")) throw e;
            await setDoc(ref, {items: {[id]: strip(col, patch)}}, {merge: true});
          }
        },
        async delete(){ await updateDoc(ref, new FieldPath("items", id), deleteField()); }
      };
    }
  })};

  // Pictures added from the site are stored in Firestore as small WebP data URLs
  const imgCache = window.__fbImgCache, imgWant = window.__fbImgWant, inflight = new Set();
  let redrawTimer = null;
  const redraw = () => { clearTimeout(redrawTimer); redrawTimer = setTimeout(() => { if (window.__BLAZING_RERENDER__) window.__BLAZING_RERENDER__(); }, 60); };
  window.__fbFetchImg = id => {
    if (imgCache[id] || inflight.has(id)) return;
    inflight.add(id);
    getDoc(doc(fs, "images", id.slice(3))).then(d => {
      if (d.exists() && d.data().data){ imgCache[id] = d.data().data; redraw(); }
    }).catch(() => {}).finally(() => inflight.delete(id));
  };
  Object.keys(imgWant).forEach(id => window.__fbFetchImg(id));
  const toDataUrl = blob => new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(blob); });
  const assets = {
    async upload(blob){
      if (!role) throw {code: "permission-denied"};
      const data = await toDataUrl(blob);
      if (data.length > 950000) throw {code: "too_large"};
      const r = await addDoc(collection(fs, "images"), {data, by: (auth.currentUser && auth.currentUser.email) || "", at: serverTimestamp()});
      const id = "fs_" + r.id; imgCache[id] = data; return {id};
    },
    async delete(id){ if (role && String(id).startsWith("fs_")) await deleteDoc(doc(fs, "images", String(id).slice(3))); }
  };

  async function findRole(u){
    const email = (u.email || "").toLowerCase(); if (!email) return null;
    const ref = doc(fs, "editors", email);
    try {
      const d = await getDoc(ref);
      if (d.exists()) return d.data().role === "admin" ? "admin" : "editor";
      // Only the owner named in the security rules can make this first admin entry
      await setDoc(ref, {role: "admin", added: serverTimestamp(), note: "owner"});
      return "admin";
    } catch(e){ return null; }
  }
  onAuthStateChanged(auth, async u => {
    role = u ? await findRole(u) : null;
    if (firstAuth){ firstAuth = false; resolveRole(role); }
    else if (window.__BLAZING_SETROLE__) window.__BLAZING_SETROLE__(!!role);
    renderAuth();
  });

  /* ---------- Sign-in bar and editor management ---------- */
  const bar = el("div", "authbar");
  const topbar = $(".topbar"); if (topbar) topbar.prepend(bar);
  let authMsg = "";
  function renderAuth(){
    bar.textContent = "";
    const u = auth.currentUser;
    if (!u){
      const b = el("button", "notes-btn auth-btn", "Sign in"); b.type = "button"; b.title = "Editors sign in here";
      b.addEventListener("click", openSignIn);
      bar.append(b);
    } else {
      const who = el("span", "auth-who");
      who.append(el("b", null, nameOf(u.email) || "Signed in"), el("small", null, role === "admin" ? "Admin" : role === "editor" ? "Editor" : "View only"));
      bar.append(who);
      if (isUserAcct(u.email)){
        const pw = el("button", "notes-btn auth-out", "Change password"); pw.type = "button";
        pw.addEventListener("click", async () => {
          const np = prompt("New password (at least 6 characters):"); if (!np) return;
          if (np.length < 6){ alert("That's too short. Use at least 6 characters."); return; }
          try { await updatePassword(auth.currentUser, np); alert("Password changed."); }
          catch(e){ alert(e && e.code === "auth/requires-recent-login" ? "For safety, sign out and back in, then try again." : "Couldn't change the password. Try again."); }
        });
        bar.append(pw);
      }
      if (role === "admin"){ const eb = el("button", "notes-btn", "Editors"); eb.type = "button"; eb.addEventListener("click", openEditors); bar.append(eb); }
      const so = el("button", "notes-btn auth-out", "Sign out"); so.type = "button";
      so.addEventListener("click", () => signOut(auth)); bar.append(so);
    }
    if (authMsg) bar.append(el("span", "auth-msg", authMsg));
    const vo = $("#viewonly");
    if (vo) vo.textContent = u && !role
      ? "You're signed in as " + nameOf(u.email) + ", but this account can't edit yet. Ask the owner to add it under Editors."
      : "View only. Editors can sign in at the top of the page.";
    const seed = $("#ed-seed"); if (seed) seed.hidden = !(role === "admin" && (empty.units || empty.stages));
  }

  // Sign-in dialog: Google, or a username + password made by an admin
  const si = el("div", "nview edview"); si.hidden = true;
  si.innerHTML = '<div class="npanel si-panel" role="dialog" aria-modal="true" aria-labelledby="si-title"><div class="nhead"><h2 id="si-title">Sign in</h2><button type="button" class="btn" id="si-close">Close</button></div><div class="nbody">' +
    '<button type="button" class="btn si-google" id="si-google">Sign in with Google</button>' +
    '<div class="si-or"><span>or</span></div>' +
    '<form class="si-form" id="si-form"><label>Username<input id="si-user" autocomplete="username" autocapitalize="none" spellcheck="false" required></label>' +
    '<label>Password<input id="si-pass" type="password" autocomplete="current-password" required></label>' +
    '<button class="btn primary" type="submit">Sign in</button><p class="si-msg" id="si-msg" role="status" aria-live="polite"></p></form>' +
    '<p class="ed-note">Only people the owner has added can edit. Everyone else can still view everything without signing in.</p></div></div>';
  document.body.append(si);
  const siMsg = t => { si.querySelector("#si-msg").textContent = t || ""; };
  function openSignIn(){ si.hidden = false; siMsg(""); document.body.style.overflow = "hidden"; setTimeout(() => si.querySelector("#si-user").focus(), 30); }
  function closeSignIn(){ si.hidden = true; document.body.style.overflow = ""; }
  si.addEventListener("click", e => { if (e.target === si) closeSignIn(); });
  si.querySelector("#si-close").addEventListener("click", closeSignIn);
  document.addEventListener("keydown", e => { if (e.key === "Escape" && !si.hidden) closeSignIn(); });
  si.querySelector("#si-google").addEventListener("click", async () => {
    try { await signInWithPopup(auth, new GoogleAuthProvider()); authMsg = ""; closeSignIn(); }
    catch(e){ siMsg(e && e.code === "auth/unauthorized-domain" ? "Google sign-in isn't allowed on this web address yet. Add it under Authorized domains in Firebase." : e && e.code === "auth/popup-closed-by-user" ? "" : "Couldn't sign in with Google. Try again."); }
  });
  si.querySelector("#si-form").addEventListener("submit", async e => {
    e.preventDefault();
    const name = si.querySelector("#si-user").value.trim().toLowerCase(), pass = si.querySelector("#si-pass").value;
    if (!name || !pass) return;
    const email = name.includes("@") ? name : name + USER_DOMAIN;
    siMsg("Signing in…");
    try { await signInWithEmailAndPassword(auth, email, pass); si.querySelector("#si-pass").value = ""; closeSignIn(); }
    catch(err){
      const c = err && err.code || "";
      siMsg(c === "auth/operation-not-allowed" ? "Username sign-in isn't turned on yet. The owner needs to enable Email/Password in Firebase."
        : c === "auth/too-many-requests" ? "Too many tries. Wait a few minutes and try again."
        : "That username and password don't match. Check them and try again.");
    }
  });

  // Editors dialog (admins only)
  const ov = el("div", "nview edview"); ov.hidden = true;
  ov.innerHTML = '<div class="npanel" role="dialog" aria-modal="true" aria-labelledby="ed-title"><div class="nhead"><h2 id="ed-title">Editors</h2><button type="button" class="btn" id="ed-close">Close</button></div><div class="nbody" id="ed-body"></div></div>';
  document.body.append(ov);
  ov.addEventListener("click", e => { if (e.target === ov) closeEditors(); });
  ov.querySelector("#ed-close").addEventListener("click", () => closeEditors());
  document.addEventListener("keydown", e => { if (e.key === "Escape" && !ov.hidden) closeEditors(); });
  function closeEditors(){ ov.hidden = true; document.body.style.overflow = ""; }
  async function openEditors(){
    ov.hidden = false; document.body.style.overflow = "hidden";
    const body = ov.querySelector("#ed-body"); body.textContent = "Loading…";
    let list = [];
    try { list = (await getDocs(collection(fs, "editors"))).docs.map(d => Object.assign({email: d.id}, d.data())); }
    catch(e){ body.textContent = "Couldn't load the editor list."; return; }
    body.textContent = "";
    const intro = el("p", "ed-note", "People on this list can sign in and edit results, pictures, notes and stages. Admins can also add and remove people here. Add someone by their Google email, or make them a username and password if they'd rather not share an email.");
    const ul = el("ul", "ed-list");
    list.sort((a, b) => (a.role === "admin" ? 0 : 1) - (b.role === "admin" ? 0 : 1) || a.email.localeCompare(b.email)).forEach(x => {
      const li = el("li"); const nm = el("span", "ed-email", nameOf(x.email)); nm.title = isUserAcct(x.email) ? "Username login" : "Google account";
      if (isUserAcct(x.email)) nm.prepend(el("span", "ed-kind", "User "));
      li.append(nm, el("span", "ed-role " + (x.role === "admin" ? "admin" : ""), x.role === "admin" ? "Admin" : "Editor"));
      const me = auth.currentUser && auth.currentUser.email && auth.currentUser.email.toLowerCase() === x.email;
      if (!me){
        const rm = el("button", "linkish", "Remove"); rm.type = "button";
        rm.addEventListener("click", async () => { if (!confirm("Remove " + nameOf(x.email) + "? They won't be able to edit anymore.")) return; try { await deleteDoc(doc(fs, "editors", x.email)); openEditors(); } catch(e){ alert("Couldn't remove them."); } });
        li.append(rm);
      } else li.append(el("span", "ed-me", "You"));
      ul.append(li);
    });
    const form = el("form", "ed-add"); form.innerHTML = '<h3>Add a Google account</h3><input type="email" required placeholder="name@gmail.com" aria-label="Email address"><select aria-label="Role"><option value="editor">Editor</option><option value="admin">Admin</option></select><button class="btn primary" type="submit">Add</button>';
    form.addEventListener("submit", async e => {
      e.preventDefault();
      const email = form.querySelector("input").value.trim().toLowerCase(), r = form.querySelector("select").value;
      if (!email) return;
      try { await setDoc(doc(fs, "editors", email), {role: r, added: serverTimestamp()}); openEditors(); }
      catch(err){ alert("Couldn't add them. Check the address and try again."); }
    });
    const uf = el("form", "ed-add"); uf.innerHTML = '<h3>Or make a username and password</h3><input class="uf-user" required placeholder="username" aria-label="Username" autocapitalize="none" spellcheck="false"><input class="uf-pass" required placeholder="password (6+ characters)" aria-label="Password" autocomplete="new-password"><select aria-label="Role"><option value="editor">Editor</option><option value="admin">Admin</option></select><button class="btn primary" type="submit">Create</button><p class="si-msg uf-msg" role="status" aria-live="polite"></p>';
    const ufMsg = t => { uf.querySelector(".uf-msg").textContent = t || ""; };
    const gen = () => { const a = "abcdefghjkmnpqrstuvwxyz23456789"; let o = ""; const r = crypto.getRandomValues(new Uint32Array(10)); r.forEach(n => o += a[n % a.length]); return o; };
    uf.querySelector(".uf-pass").value = gen();
    uf.addEventListener("submit", async e => {
      e.preventDefault();
      const name = uf.querySelector(".uf-user").value.trim().toLowerCase(), pass = uf.querySelector(".uf-pass").value, r = uf.querySelector("select").value;
      if (!USERNAME_RE.test(name)){ ufMsg("Usernames are 3–30 characters: letters, numbers, dots, dashes or underscores."); return; }
      if (pass.length < 6){ ufMsg("Use a password with at least 6 characters."); return; }
      const email = name + USER_DOMAIN, ca = getCreator();
      ufMsg("Creating…");
      try {
        await createUserWithEmailAndPassword(ca, email, pass);
        await signOut(ca).catch(() => {});
        await setDoc(doc(fs, "editors", email), {role: r, added: serverTimestamp(), kind: "username"});
        await openEditors();
        const box = ov.querySelector("#ed-body");
        const done = el("div", "ed-made"); done.append(el("b", null, "Created. Send these to them privately:"), el("code", null, "Username: " + name + "\nPassword: " + pass), el("small", null, "They sign in with the Sign in button and can change their password after."));
        box.prepend(done);
      } catch(err){
        const c = err && err.code || "";
        ufMsg(c === "auth/email-already-in-use" ? "That username is taken. Pick another one."
          : c === "auth/operation-not-allowed" ? "Turn on Email/Password in Firebase first (Authentication > Sign-in method)."
          : c === "auth/weak-password" ? "That password is too weak. Try a longer one."
          : "Couldn't create it. Try again.");
      }
    });
    const seedBox = el("div", "ed-seed"); seedBox.id = "ed-seed";
    seedBox.append(el("h3", null, "Starting data"), el("p", "ed-note", "The database is empty, so the site is showing the bundled starting data. Load it into the database once so edits can be saved."));
    const sb = el("button", "btn primary", "Load starting data"); sb.type = "button";
    sb.addEventListener("click", async () => {
      if (!confirm("Load the starting data into the database? Only do this once, on an empty database.")) return;
      sb.disabled = true; sb.textContent = "Loading…";
      try {
        for (const col of ["units", "stages"]){
          if (empty[col] === false) continue;
          const groups = {};
          Object.entries(SEED[col] || {}).forEach(([id, v]) => { const c = chunkOf(col, id); (groups[c] = groups[c] || {})[id] = strip(col, v); });
          for (const [c, items] of Object.entries(groups)) await setDoc(doc(fs, col, c), {items});
        }
        sb.textContent = "Done"; seedBox.hidden = true;
      } catch(e){ sb.disabled = false; sb.textContent = "Couldn't load it. Try again"; }
    });
    seedBox.append(sb); seedBox.hidden = !(empty.units || empty.stages);
    const bk = el("div", "ed-seed");
    bk.append(el("h3", null, "Backup"), el("p", "ed-note", "Download everything in the database (results, notes, stages, editors) as one file to keep somewhere safe."));
    const bb = el("button", "btn", "Download backup"); bb.type = "button";
    bb.addEventListener("click", async () => {
      const out = {};
      for (const col of ["units", "stages", "editors"]){ const qs = await getDocs(collection(fs, col)); out[col] = {}; qs.forEach(d => { out[col][d.id] = d.data(); }); }
      downloads.save({filename: "blazing-tracker-backup-" + new Date().toISOString().slice(0, 10) + ".json", data: new Blob([JSON.stringify(out, null, 1)], {type: "application/json"})});
    });
    bk.append(bb);
    body.append(intro, ul, form, uf, seedBox, bk);
  }

  dataReady.then(() => {
    window.__fbResolve({use: n => {
      if (n === "db") return Promise.resolve(db);
      if (n === "user") return Promise.resolve({isOwner: () => roleReady.then(r => !!r)});
      if (n === "assets") return Promise.resolve(assets);
      if (n === "downloads") return Promise.resolve(downloads);
      return Promise.resolve(null);
    }});
  });
  renderAuth();
}
