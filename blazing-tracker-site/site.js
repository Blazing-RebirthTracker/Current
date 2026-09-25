/* Blazing:Rebirth Current Tracker: GitHub Pages + Firebase layer.
   Loads the character/stage data from Firestore (public read), lets approved
   editors sign in with Google, and falls back to the bundled starting data
   when Firebase isn't set up yet or the database is still empty. */
const FB = "https://www.gstatic.com/firebasejs/10.12.2/";
const CHUNKS = {units: 4, stages: 2};
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
  const [{ initializeApp }, { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged },
    { getFirestore, collection, doc, onSnapshot, getDoc, getDocs, setDoc, updateDoc, deleteDoc, addDoc, deleteField, FieldPath, serverTimestamp }] = mods;
  const app = initializeApp(cfg);
  const auth = getAuth(app), fs = getFirestore(app);
  const empty = {units: null, stages: null};
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
      b.addEventListener("click", async () => {
        try { await signInWithPopup(auth, new GoogleAuthProvider()); authMsg = ""; }
        catch(e){ authMsg = e && e.code === "auth/unauthorized-domain" ? "Sign-in isn't allowed on this web address yet. Add it under Authorized domains in Firebase." : e && e.code === "auth/popup-closed-by-user" ? "" : "Couldn't sign in. Try again."; renderAuth(); }
      });
      bar.append(b);
    } else {
      const who = el("span", "auth-who");
      who.append(el("b", null, u.email || "Signed in"), el("small", null, role === "admin" ? "Admin" : role === "editor" ? "Editor" : "View only"));
      bar.append(who);
      if (role === "admin"){ const eb = el("button", "notes-btn", "Editors"); eb.type = "button"; eb.addEventListener("click", openEditors); bar.append(eb); }
      const so = el("button", "notes-btn auth-out", "Sign out"); so.type = "button";
      so.addEventListener("click", () => signOut(auth)); bar.append(so);
    }
    if (authMsg) bar.append(el("span", "auth-msg", authMsg));
    const vo = $("#viewonly");
    if (vo) vo.textContent = u && !role
      ? "You're signed in as " + u.email + ", but this account can't edit yet. Ask the owner to add it under Editors."
      : "View only. Editors can sign in at the top right.";
    const seed = $("#ed-seed"); if (seed) seed.hidden = !(role === "admin" && (empty.units || empty.stages));
  }

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
    const intro = el("p", "ed-note", "People on this list can sign in with that Google account and edit results, pictures, notes and stages. Admins can also add and remove people here.");
    const ul = el("ul", "ed-list");
    list.sort((a, b) => (a.role === "admin" ? 0 : 1) - (b.role === "admin" ? 0 : 1) || a.email.localeCompare(b.email)).forEach(x => {
      const li = el("li"); li.append(el("span", "ed-email", x.email), el("span", "ed-role " + (x.role === "admin" ? "admin" : ""), x.role === "admin" ? "Admin" : "Editor"));
      const me = auth.currentUser && auth.currentUser.email && auth.currentUser.email.toLowerCase() === x.email;
      if (!me){
        const rm = el("button", "linkish", "Remove"); rm.type = "button";
        rm.addEventListener("click", async () => { if (!confirm("Remove " + x.email + "?")) return; try { await deleteDoc(doc(fs, "editors", x.email)); openEditors(); } catch(e){ alert("Couldn't remove them."); } });
        li.append(rm);
      } else li.append(el("span", "ed-me", "You"));
      ul.append(li);
    });
    const form = el("form", "ed-add"); form.innerHTML = '<input type="email" required placeholder="name@gmail.com" aria-label="Email address"><select aria-label="Role"><option value="editor">Editor</option><option value="admin">Admin</option></select><button class="btn primary" type="submit">Add</button>';
    form.addEventListener("submit", async e => {
      e.preventDefault();
      const email = form.querySelector("input").value.trim().toLowerCase(), r = form.querySelector("select").value;
      if (!email) return;
      try { await setDoc(doc(fs, "editors", email), {role: r, added: serverTimestamp()}); openEditors(); }
      catch(err){ alert("Couldn't add them. Check the address and try again."); }
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
    body.append(intro, ul, form, seedBox, bk);
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
