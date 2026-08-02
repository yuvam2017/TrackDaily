/* ============================================================
   Ghar Tracker — household item tracker, synced with Firebase
   Auth: Firebase email/password
   Data: Firestore — users/{uid}/items/{itemId}
   ============================================================ */

import { firebaseConfig } from "./firebase-config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword,
  createUserWithEmailAndPassword, signOut
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, collection, doc, setDoc, updateDoc, deleteDoc,
  onSnapshot, query, orderBy, deleteField
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const ICONS = ["🥛","📰","💧","🥚","🍞","🧴","🧀","🧃","🛢️","📦","🧻","🧂"];

/* ---------------- date helpers ---------------- */
function pad(n){ return n < 10 ? "0"+n : ""+n; }
function todayKey(){ const d=new Date(); return d.getFullYear()+"-"+pad(d.getMonth()+1)+"-"+pad(d.getDate()); }
function daysInMonth(y,m){ return new Date(y, m+1, 0).getDate(); }
function monthLabel(y,m){ return new Date(y,m,1).toLocaleDateString(undefined,{month:"long", year:"numeric"}); }

/* ---------------- state ---------------- */
let state = { items: [] };
let currentUser = null;
let unsubscribeItems = null;

function itemsCol(){ return collection(db, "users", currentUser.uid, "items"); }
function itemDoc(id){ return doc(db, "users", currentUser.uid, "items", id); }

function subscribeItems(){
  const q = query(itemsCol(), orderBy("createdAt"));
  unsubscribeItems = onSnapshot(q, snap => {
    state.items = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    // keep whichever tab is open in sync
    if(currentTab === "today") renderToday();
    if(currentTab === "history") renderHistory();
    if(currentTab === "items") renderItems();
  }, err => {
    console.error(err);
  });
}

/* ---------------- effective-dated value resolution ---------------- */
function getEffectiveValue(history, dateKey, fallback){
  if(!history || !history.length) return fallback;
  let result = history[0].val;
  for(const h of history){
    if(h.from <= dateKey) result = h.val;
    else break;
  }
  return result;
}
function withEffectiveValue(history, dateKey, val){
  const copy = (history || []).map(h => ({...h}));
  const idx = copy.findIndex(h => h.from === dateKey);
  if(idx >= 0){ copy[idx].val = val; }
  else { copy.push({from: dateKey, val}); }
  copy.sort((a,b) => a.from < b.from ? -1 : 1);
  return copy;
}

function getQtyForDate(item, dateKey){
  if(item.overrides && Object.prototype.hasOwnProperty.call(item.overrides, dateKey)){
    return item.overrides[dateKey];
  }
  return getEffectiveValue(item.qtyHistory, dateKey, 0);
}
function getRateForDate(item, dateKey){
  return getEffectiveValue(item.rateHistory, dateKey, 0);
}
function isOverridden(item, dateKey){
  return item.overrides && Object.prototype.hasOwnProperty.call(item.overrides, dateKey);
}
function getDefaultQtyOnDate(item, dateKey){
  return getEffectiveValue(item.qtyHistory, dateKey, 0);
}

/* ---------------- item CRUD (writes only touch the relevant field) ---------------- */
async function addItem({name, unit, icon, qty, rate}){
  const today = todayKey();
  const ref = doc(itemsCol());
  await setDoc(ref, {
    name, unit, icon: icon || ICONS[state.items.length % ICONS.length],
    qtyHistory: [{from: today, val: qty}],
    rateHistory: [{from: today, val: rate}],
    overrides: {},
    createdAt: today
  });
}
async function deleteItem(id){
  await deleteDoc(itemDoc(id));
}
async function updateItemBasic(id, {name, unit, icon}){
  await updateDoc(itemDoc(id), {name, unit, icon});
}
async function changeDefaultQty(item, dateKey, qty){
  await updateDoc(itemDoc(item.id), { qtyHistory: withEffectiveValue(item.qtyHistory, dateKey, qty) });
}
async function changeRate(item, dateKey, rate){
  await updateDoc(itemDoc(item.id), { rateHistory: withEffectiveValue(item.rateHistory, dateKey, rate) });
}
async function setOverride(item, dateKey, qty){
  await updateDoc(itemDoc(item.id), { [`overrides.${dateKey}`]: qty });
}
async function clearOverride(item, dateKey){
  await updateDoc(itemDoc(item.id), { [`overrides.${dateKey}`]: deleteField() });
}

/* ---------------- rendering ---------------- */
let currentTab = "today";
let historyMonth = new Date().getMonth();
let historyYear = new Date().getFullYear();
let openHistoryItemId = null;

window.goTab = function goTab(tab){
  currentTab = tab;
  document.querySelectorAll(".tab").forEach(t=>t.classList.add("hidden"));
  document.getElementById("tab-"+tab).classList.remove("hidden");
  document.querySelectorAll(".nav-btn").forEach(b=>{
    b.classList.toggle("active", b.dataset.tab === tab);
  });
  const titles = {today:"Today", history:"History", items:"Manage items"};
  document.getElementById("pageTitle").textContent = titles[tab];
  if(tab === "today") renderToday();
  if(tab === "history") renderHistory();
  if(tab === "items") renderItems();
};

function renderToday(){
  const list = document.getElementById("itemsList");
  const empty = document.getElementById("emptyToday");
  const tKey = todayKey();
  list.innerHTML = "";

  if(state.items.length === 0){
    empty.classList.remove("hidden");
    document.getElementById("todaySummary").classList.add("hidden");
    return;
  }
  empty.classList.add("hidden");

  let totalAmt = 0;
  state.items.forEach(item=>{
    const qty = getQtyForDate(item, tKey);
    const rate = getRateForDate(item, tKey);
    const amt = qty * rate;
    totalAmt += amt;
    const skipped = qty === 0;
    const overridden = isOverridden(item, tKey);

    const card = document.createElement("div");
    card.className = "item-card" + (skipped ? " skipped" : "");
    card.innerHTML = `
      <div class="item-icon">${item.icon}</div>
      <div class="item-info">
        <div class="item-name">${escapeHtml(item.name)}</div>
        <div class="item-qty ${overridden && !skipped ? 'custom' : ''}">
          ${skipped ? "Not taken today" : (qty + " " + item.unit + " today")}
          ${overridden && !skipped ? " (adjusted)" : ""}
        </div>
      </div>
      <button class="edit-pencil" data-action="editqty" data-id="${item.id}">✎</button>
      <button class="big-toggle" data-action="toggle" data-id="${item.id}">${skipped ? "✕" : "✓"}</button>
    `;
    list.appendChild(card);
  });

  document.getElementById("todaySummary").classList.remove("hidden");
  document.getElementById("todaySummary").innerHTML = `
    <div class="lbl">Today's total</div>
    <div class="amt">₹${totalAmt.toFixed(2)}</div>
  `;

  list.querySelectorAll('[data-action="toggle"]').forEach(btn=>{
    btn.onclick = async () => {
      const item = state.items.find(i=>i.id===btn.dataset.id);
      const qty = getQtyForDate(item, tKey);
      btn.disabled = true;
      if(qty === 0){ await clearOverride(item, tKey); }
      else { await setOverride(item, tKey, 0); }
      btn.disabled = false;
    };
  });
  list.querySelectorAll('[data-action="editqty"]').forEach(btn=>{
    btn.onclick = () => openQtyOverrideModal(btn.dataset.id, tKey);
  });
}

/* ---------------- HISTORY TAB ---------------- */
function renderHistory(){
  document.getElementById("monthLabel").textContent = monthLabel(historyYear, historyMonth);
  const totalCard = document.getElementById("monthTotalCard");
  const list = document.getElementById("historyList");
  list.innerHTML = "";

  const dim = daysInMonth(historyYear, historyMonth);
  const today = new Date();
  const isCurrentMonth = (today.getFullYear()===historyYear && today.getMonth()===historyMonth);
  const lastDay = isCurrentMonth ? today.getDate() : dim;

  let grandTotal = 0;

  if(state.items.length === 0){
    totalCard.innerHTML = `<div class="muted">No items yet — add one in the Items tab.</div>`;
    return;
  }

  state.items.forEach(item=>{
    let itemQty = 0, itemAmt = 0;
    const dayLines = [];
    for(let d=1; d<=lastDay; d++){
      const dateKey = historyYear+"-"+pad(historyMonth+1)+"-"+pad(d);
      if(dateKey < item.createdAt) continue;
      const qty = getQtyForDate(item, dateKey);
      const rate = getRateForDate(item, dateKey);
      itemQty += qty;
      itemAmt += qty*rate;
      dayLines.push({dateKey, d, qty, rate, amt: qty*rate, overridden: isOverridden(item, dateKey)});
    }
    grandTotal += itemAmt;

    const row = document.createElement("div");
    row.className = "hist-row";
    const isOpen = openHistoryItemId === item.id;
    row.innerHTML = `
      <div class="hist-row-head" data-toggle="${item.id}">
        <div>
          <span class="name">${item.icon} ${escapeHtml(item.name)}</span>
          <div class="muted">${itemQty.toFixed(2)} ${item.unit}</div>
        </div>
        <div class="amt">₹${itemAmt.toFixed(2)}</div>
      </div>
      ${isOpen ? `<div class="hist-days">
        ${dayLines.map(l => `<div class="hist-day-line ${l.overridden?'override':''}">
            <span>${l.d} ${monthLabel(historyYear,historyMonth).split(" ")[0].slice(0,3)}</span>
            <span>${l.qty} ${item.unit} × ₹${l.rate} = ₹${l.amt.toFixed(2)}</span>
          </div>`).join("")}
      </div>` : ""}
    `;
    list.appendChild(row);
  });

  totalCard.innerHTML = `
    <div class="muted">Total bill — ${monthLabel(historyYear,historyMonth)}</div>
    <div class="big">₹${grandTotal.toFixed(2)}</div>
  `;

  list.querySelectorAll("[data-toggle]").forEach(el=>{
    el.onclick = () => {
      const id = el.dataset.toggle;
      openHistoryItemId = (openHistoryItemId === id) ? null : id;
      renderHistory();
    };
  });
}

document.getElementById("prevMonth").onclick = () => {
  historyMonth--;
  if(historyMonth < 0){ historyMonth = 11; historyYear--; }
  renderHistory();
};
document.getElementById("nextMonth").onclick = () => {
  historyMonth++;
  if(historyMonth > 11){ historyMonth = 0; historyYear++; }
  renderHistory();
};

document.getElementById("exportBtn").onclick = exportMonthCSV;

function exportMonthCSV(){
  const dim = daysInMonth(historyYear, historyMonth);
  const today = new Date();
  const isCurrentMonth = (today.getFullYear()===historyYear && today.getMonth()===historyMonth);
  const lastDay = isCurrentMonth ? today.getDate() : dim;

  let rows = [["Item","Date","Quantity","Unit","Rate","Amount","Adjusted"]];
  state.items.forEach(item=>{
    for(let d=1; d<=lastDay; d++){
      const dateKey = historyYear+"-"+pad(historyMonth+1)+"-"+pad(d);
      if(dateKey < item.createdAt) continue;
      const qty = getQtyForDate(item, dateKey);
      const rate = getRateForDate(item, dateKey);
      rows.push([item.name, dateKey, qty, item.unit, rate, (qty*rate).toFixed(2), isOverridden(item,dateKey)?"Yes":""]);
    }
  });
  const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], {type:"text/csv"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `ghar-tracker-${historyYear}-${pad(historyMonth+1)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/* ---------------- ITEMS TAB ---------------- */
function renderItems(){
  const list = document.getElementById("manageList");
  list.innerHTML = "";
  const tKey = todayKey();

  state.items.forEach(item=>{
    const qty = getDefaultQtyOnDate(item, tKey);
    const rate = getRateForDate(item, tKey);
    const card = document.createElement("div");
    card.className = "manage-card";
    card.innerHTML = `
      <div class="manage-card-head">
        <div class="name">${item.icon} ${escapeHtml(item.name)}</div>
      </div>
      <div class="meta">Default: ${qty} ${item.unit} · Rate: ₹${rate} / ${item.unit}</div>
      <div class="manage-actions">
        <button class="chip-btn" data-act="editbasic" data-id="${item.id}">Edit name/unit</button>
        <button class="chip-btn" data-act="changeqty" data-id="${item.id}">Change quantity</button>
        <button class="chip-btn" data-act="changerate" data-id="${item.id}">Change rate</button>
        <button class="chip-btn danger" data-act="delete" data-id="${item.id}">Delete</button>
      </div>
    `;
    list.appendChild(card);
  });

  list.querySelectorAll('[data-act="editbasic"]').forEach(b=>b.onclick=()=>openEditBasicModal(b.dataset.id));
  list.querySelectorAll('[data-act="changeqty"]').forEach(b=>b.onclick=()=>openChangeQtyModal(b.dataset.id));
  list.querySelectorAll('[data-act="changerate"]').forEach(b=>b.onclick=()=>openChangeRateModal(b.dataset.id));
  list.querySelectorAll('[data-act="delete"]').forEach(b=>b.onclick=async ()=>{
    const item = state.items.find(i=>i.id===b.dataset.id);
    if(confirm(`Delete "${item.name}"? This removes all its history.`)){
      await deleteItem(b.dataset.id);
    }
  });
}

document.getElementById("addItemBtn").onclick = openAddItemModal;

/* ---------------- MODALS ---------------- */
const overlay = document.getElementById("modalOverlay");
const modalBox = document.getElementById("modalBox");

function closeModal(){
  overlay.classList.add("hidden");
  modalBox.innerHTML = "";
}
overlay.onclick = (e) => { if(e.target === overlay) closeModal(); };

function openAddItemModal(){
  modalBox.innerHTML = `
    <h2>Add new item</h2>
    <div class="field"><label>Name</label><input id="f-name" placeholder="e.g. Milk"></div>
    <div class="field"><label>Unit</label><input id="f-unit" placeholder="e.g. L, kg, piece, packet"></div>
    <div class="field"><label>Default quantity (today onward)</label><input id="f-qty" type="number" step="any" placeholder="e.g. 1"></div>
    <div class="field"><label>Rate per unit (₹)</label><input id="f-rate" type="number" step="any" placeholder="e.g. 60"></div>
    <div class="modal-actions">
      <button class="btn-cancel" id="f-cancel">Cancel</button>
      <button class="btn-primary" id="f-save">Add item</button>
    </div>
  `;
  overlay.classList.remove("hidden");
  document.getElementById("f-cancel").onclick = closeModal;
  document.getElementById("f-save").onclick = async () => {
    const name = document.getElementById("f-name").value.trim();
    const unit = document.getElementById("f-unit").value.trim();
    const qty = parseFloat(document.getElementById("f-qty").value);
    const rate = parseFloat(document.getElementById("f-rate").value);
    if(!name || !unit || isNaN(qty) || isNaN(rate)){ alert("Please fill all fields."); return; }
    await addItem({name, unit, qty, rate});
    closeModal();
  };
}

function openEditBasicModal(id){
  const item = state.items.find(i=>i.id===id);
  modalBox.innerHTML = `
    <h2>Edit item</h2>
    <div class="field"><label>Name</label><input id="f-name" value="${escapeAttr(item.name)}"></div>
    <div class="field"><label>Unit</label><input id="f-unit" value="${escapeAttr(item.unit)}"></div>
    <div class="field"><label>Icon (emoji)</label><input id="f-icon" value="${escapeAttr(item.icon)}"></div>
    <div class="modal-actions">
      <button class="btn-cancel" id="f-cancel">Cancel</button>
      <button class="btn-primary" id="f-save">Save</button>
    </div>
  `;
  overlay.classList.remove("hidden");
  document.getElementById("f-cancel").onclick = closeModal;
  document.getElementById("f-save").onclick = async () => {
    const name = document.getElementById("f-name").value.trim();
    const unit = document.getElementById("f-unit").value.trim();
    const icon = document.getElementById("f-icon").value.trim() || item.icon;
    if(!name || !unit){ alert("Name and unit can't be empty."); return; }
    await updateItemBasic(id, {name, unit, icon});
    closeModal();
  };
}

function openChangeQtyModal(id){
  const item = state.items.find(i=>i.id===id);
  const tKey = todayKey();
  modalBox.innerHTML = `
    <h2>Change default quantity — ${escapeHtml(item.name)}</h2>
    <p class="muted">This becomes the new everyday default from the date you choose, until you change it again.</p>
    <div class="field"><label>New default quantity (${escapeHtml(item.unit)})</label><input id="f-qty" type="number" step="any" value="${getDefaultQtyOnDate(item, tKey)}"></div>
    <div class="field"><label>Effective from</label><input id="f-date" type="date" value="${tKey}"></div>
    <div class="modal-actions">
      <button class="btn-cancel" id="f-cancel">Cancel</button>
      <button class="btn-primary" id="f-save">Save</button>
    </div>
  `;
  overlay.classList.remove("hidden");
  document.getElementById("f-cancel").onclick = closeModal;
  document.getElementById("f-save").onclick = async () => {
    const qty = parseFloat(document.getElementById("f-qty").value);
    const date = document.getElementById("f-date").value;
    if(isNaN(qty) || !date){ alert("Please fill all fields."); return; }
    await changeDefaultQty(item, date, qty);
    closeModal();
  };
}

function openChangeRateModal(id){
  const item = state.items.find(i=>i.id===id);
  const tKey = todayKey();
  modalBox.innerHTML = `
    <h2>Change rate — ${escapeHtml(item.name)}</h2>
    <p class="muted">Applies from the chosen date onward. Past bills stay calculated at the old rate.</p>
    <div class="field"><label>New rate per ${escapeHtml(item.unit)} (₹)</label><input id="f-rate" type="number" step="any" value="${getRateForDate(item, tKey)}"></div>
    <div class="field"><label>Effective from</label><input id="f-date" type="date" value="${tKey}"></div>
    <div class="modal-actions">
      <button class="btn-cancel" id="f-cancel">Cancel</button>
      <button class="btn-primary" id="f-save">Save</button>
    </div>
  `;
  overlay.classList.remove("hidden");
  document.getElementById("f-cancel").onclick = closeModal;
  document.getElementById("f-save").onclick = async () => {
    const rate = parseFloat(document.getElementById("f-rate").value);
    const date = document.getElementById("f-date").value;
    if(isNaN(rate) || !date){ alert("Please fill all fields."); return; }
    await changeRate(item, date, rate);
    closeModal();
  };
}

function openQtyOverrideModal(id, dateKey){
  const item = state.items.find(i=>i.id===id);
  const current = getQtyForDate(item, dateKey);
  modalBox.innerHTML = `
    <h2>${escapeHtml(item.name)} — just for today</h2>
    <p class="muted">This changes only today's quantity. Your everyday default stays the same.</p>
    <div class="field"><label>Quantity (${escapeHtml(item.unit)})</label><input id="f-qty" type="number" step="any" value="${current}"></div>
    <div class="modal-actions">
      <button class="btn-cancel" id="f-reset">Use default</button>
      <button class="btn-primary" id="f-save">Save</button>
    </div>
  `;
  overlay.classList.remove("hidden");
  document.getElementById("f-reset").onclick = async () => {
    await clearOverride(item, dateKey);
    closeModal();
  };
  document.getElementById("f-save").onclick = async () => {
    const qty = parseFloat(document.getElementById("f-qty").value);
    if(isNaN(qty)){ alert("Enter a valid number."); return; }
    const defaultQty = getDefaultQtyOnDate(item, dateKey);
    if(qty === defaultQty){ await clearOverride(item, dateKey); }
    else { await setOverride(item, dateKey, qty); }
    closeModal();
  };
}

/* ---------------- utils ---------------- */
function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}
function escapeAttr(s){ return escapeHtml(s); }

/* ---------------- nav wiring ---------------- */
document.querySelectorAll(".nav-btn").forEach(btn=>{
  btn.onclick = () => window.goTab(btn.dataset.tab);
});

/* ---------------- auth / login screen ---------------- */
const lockScreen = document.getElementById("lockScreen");
const appEl = document.getElementById("app");
const emailInput = document.getElementById("emailInput");
const passwordInput = document.getElementById("passwordInput");
const lockBtn = document.getElementById("lockBtn");
const lockTitle = document.getElementById("lockTitle");
const lockSub = document.getElementById("lockSub");
const lockError = document.getElementById("lockError");
const toggleModeText = document.getElementById("toggleModeText");
const toggleModeLink = document.getElementById("toggleModeLink");

let mode = "login"; // or "signup"

function setMode(m){
  mode = m;
  lockError.textContent = "";
  if(mode === "login"){
    lockTitle.textContent = "Log in";
    lockSub.textContent = "Sign in to sync your household items";
    lockBtn.textContent = "Log in";
    toggleModeText.textContent = "Don't have an account?";
    toggleModeLink.textContent = "Sign up";
  } else {
    lockTitle.textContent = "Sign up";
    lockSub.textContent = "Create an account to start tracking";
    lockBtn.textContent = "Sign up";
    toggleModeText.textContent = "Already have an account?";
    toggleModeLink.textContent = "Log in";
  }
}
toggleModeLink.onclick = (e) => { e.preventDefault(); setMode(mode === "login" ? "signup" : "login"); };

function friendlyAuthError(err){
  const code = err && err.code || "";
  if(code.includes("invalid-email")) return "That email doesn't look right.";
  if(code.includes("user-not-found") || code.includes("wrong-password") || code.includes("invalid-credential")) return "Email or password is incorrect.";
  if(code.includes("email-already-in-use")) return "An account already exists with that email — try logging in.";
  if(code.includes("weak-password")) return "Password should be at least 6 characters.";
  return "Something went wrong. Please try again.";
}

lockBtn.onclick = async () => {
  const email = emailInput.value.trim();
  const password = passwordInput.value;
  if(!email || !password){ lockError.textContent = "Please enter email and password."; return; }
  lockBtn.disabled = true;
  lockError.textContent = "";
  try{
    if(mode === "login"){
      await signInWithEmailAndPassword(auth, email, password);
    } else {
      await createUserWithEmailAndPassword(auth, email, password);
    }
  } catch(err){
    lockError.textContent = friendlyAuthError(err);
  } finally {
    lockBtn.disabled = false;
  }
};
passwordInput.addEventListener("keydown", e => { if(e.key === "Enter") lockBtn.click(); });

document.getElementById("logoutBtn").onclick = () => signOut(auth);

/* ---------------- boot ---------------- */
onAuthStateChanged(auth, (user) => {
  if(user){
    currentUser = user;
    lockScreen.classList.add("hidden");
    appEl.classList.remove("hidden");
    subscribeItems();
    window.goTab("today");
  } else {
    if(unsubscribeItems){ unsubscribeItems(); unsubscribeItems = null; }
    currentUser = null;
    state.items = [];
    appEl.classList.add("hidden");
    lockScreen.classList.remove("hidden");
    setMode("login");
    emailInput.value = "";
    passwordInput.value = "";
  }
});
