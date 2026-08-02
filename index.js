/* ============================================================
   Ghar Tracker — simple local household item tracker
   No backend. Everything lives in localStorage on this device.
   ============================================================ */

const STORAGE_KEY = "ghar-tracker-data-v1";
const PASSCODE_KEY = "ghar-tracker-passcode-v1";
const SESSION_KEY = "ghar-tracker-unlocked";

const ICONS = ["🥛","📰","💧","🥚","🍞","🧴","🧀","🧃","🛢️","📦","🧻","🧂"];

/* ---------------- date helpers ---------------- */
function pad(n){ return n < 10 ? "0"+n : ""+n; }
function toKey(d){ return d.getFullYear()+"-"+pad(d.getMonth()+1)+"-"+pad(d.getDate()); }
function todayKey(){ return toKey(new Date()); }
function daysInMonth(y,m){ return new Date(y, m+1, 0).getDate(); }
function monthLabel(y,m){
  return new Date(y,m,1).toLocaleDateString(undefined,{month:"long", year:"numeric"});
}

/* ---------------- state ---------------- */
let state = { items: [] };

function loadState(){
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    state = raw ? JSON.parse(raw) : { items: [] };
  } catch(e){ state = { items: [] }; }
}
function saveState(){
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

/* ---------------- effective-dated value resolution ----------------
   history = [{from:"YYYY-MM-DD", val:number}, ...] kept sorted ascending
--------------------------------------------------------------------*/
function getEffectiveValue(history, dateKey, fallback){
  if(!history || !history.length) return fallback;
  let result = history[0].val;
  for(const h of history){
    if(h.from <= dateKey) result = h.val;
    else break;
  }
  return result;
}
function setEffectiveValue(history, dateKey, val){
  const idx = history.findIndex(h => h.from === dateKey);
  if(idx >= 0){ history[idx].val = val; }
  else { history.push({from: dateKey, val}); }
  history.sort((a,b) => a.from < b.from ? -1 : 1);
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

/* ---------------- item CRUD ---------------- */
function makeId(){ return "id" + Date.now() + Math.random().toString(16).slice(2,8); }

function addItem({name, unit, icon, qty, rate}){
  const today = todayKey();
  state.items.push({
    id: makeId(),
    name, unit, icon: icon || ICONS[state.items.length % ICONS.length],
    qtyHistory: [{from: today, val: qty}],
    rateHistory: [{from: today, val: rate}],
    overrides: {},
    createdAt: today
  });
  saveState();
}
function deleteItem(id){
  state.items = state.items.filter(i => i.id !== id);
  saveState();
}
function updateItemBasic(id, {name, unit, icon}){
  const it = state.items.find(i=>i.id===id);
  if(!it) return;
  it.name = name; it.unit = unit; it.icon = icon;
  saveState();
}

/* ---------------- rendering ---------------- */
let currentTab = "today";
let historyMonth = new Date().getMonth();
let historyYear = new Date().getFullYear();
let openHistoryItemId = null;

function goTab(tab){
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
}

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
    const defaultQty = getDefaultQtyOnDate(item, tKey);

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
    btn.onclick = () => {
      const item = state.items.find(i=>i.id===btn.dataset.id);
      const qty = getQtyForDate(item, tKey);
      if(!item.overrides) item.overrides = {};
      if(qty === 0){
        // currently skipped -> restore default (remove override)
        delete item.overrides[tKey];
      } else {
        // mark skipped
        item.overrides[tKey] = 0;
      }
      saveState();
      renderToday();
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
      if(dateKey < item.createdAt) continue; // item didn't exist yet
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
  list.querySelectorAll('[data-act="delete"]').forEach(b=>b.onclick=()=>{
    const item = state.items.find(i=>i.id===b.dataset.id);
    if(confirm(`Delete "${item.name}"? This removes all its history.`)){
      deleteItem(b.dataset.id);
      renderItems();
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
  document.getElementById("f-save").onclick = () => {
    const name = document.getElementById("f-name").value.trim();
    const unit = document.getElementById("f-unit").value.trim();
    const qty = parseFloat(document.getElementById("f-qty").value);
    const rate = parseFloat(document.getElementById("f-rate").value);
    if(!name || !unit || isNaN(qty) || isNaN(rate)){ alert("Please fill all fields."); return; }
    addItem({name, unit, qty, rate});
    closeModal();
    renderItems();
    if(currentTab==="today") renderToday();
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
  document.getElementById("f-save").onclick = () => {
    const name = document.getElementById("f-name").value.trim();
    const unit = document.getElementById("f-unit").value.trim();
    const icon = document.getElementById("f-icon").value.trim() || item.icon;
    if(!name || !unit){ alert("Name and unit can't be empty."); return; }
    updateItemBasic(id, {name, unit, icon});
    closeModal();
    renderItems();
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
  document.getElementById("f-save").onclick = () => {
    const qty = parseFloat(document.getElementById("f-qty").value);
    const date = document.getElementById("f-date").value;
    if(isNaN(qty) || !date){ alert("Please fill all fields."); return; }
    setEffectiveValue(item.qtyHistory, date, qty);
    saveState();
    closeModal();
    renderItems();
    if(currentTab==="today") renderToday();
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
  document.getElementById("f-save").onclick = () => {
    const rate = parseFloat(document.getElementById("f-rate").value);
    const date = document.getElementById("f-date").value;
    if(isNaN(rate) || !date){ alert("Please fill all fields."); return; }
    setEffectiveValue(item.rateHistory, date, rate);
    saveState();
    closeModal();
    renderItems();
    if(currentTab==="today") renderToday();
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
  document.getElementById("f-reset").onclick = () => {
    if(item.overrides) delete item.overrides[dateKey];
    saveState();
    closeModal();
    renderToday();
  };
  document.getElementById("f-save").onclick = () => {
    const qty = parseFloat(document.getElementById("f-qty").value);
    if(isNaN(qty)){ alert("Enter a valid number."); return; }
    if(!item.overrides) item.overrides = {};
    const defaultQty = getDefaultQtyOnDate(item, dateKey);
    if(qty === defaultQty){ delete item.overrides[dateKey]; }
    else { item.overrides[dateKey] = qty; }
    saveState();
    closeModal();
    renderToday();
  };
}

/* ---------------- utils ---------------- */
function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}
function escapeAttr(s){ return escapeHtml(s); }

/* ---------------- nav wiring ---------------- */
document.querySelectorAll(".nav-btn").forEach(btn=>{
  btn.onclick = () => goTab(btn.dataset.tab);
});

/* ---------------- lock screen ---------------- */
const lockScreen = document.getElementById("lockScreen");
const appEl = document.getElementById("app");
const lockInput = document.getElementById("lockInput");
const lockBtn = document.getElementById("lockBtn");
const lockTitle = document.getElementById("lockTitle");
const lockSub = document.getElementById("lockSub");
const lockError = document.getElementById("lockError");

function hasPasscode(){ return !!localStorage.getItem(PASSCODE_KEY); }

function setupLockScreen(){
  if(!hasPasscode()){
    lockTitle.textContent = "Set a passcode";
    lockSub.textContent = "This just locks the app on this device — pick anything you'll remember.";
    lockBtn.textContent = "Set passcode";
  } else {
    lockTitle.textContent = "Enter passcode";
    lockSub.textContent = "Unlock your tracker";
    lockBtn.textContent = "Unlock";
  }
  lockError.textContent = "";
  lockInput.value = "";
}

function tryUnlock(){
  const val = lockInput.value.trim();
  if(!val){ lockError.textContent = "Please enter a passcode."; return; }
  if(!hasPasscode()){
    if(val.length < 4){ lockError.textContent = "Use at least 4 characters."; return; }
    localStorage.setItem(PASSCODE_KEY, val);
    unlockApp();
    return;
  }
  if(val === localStorage.getItem(PASSCODE_KEY)){
    unlockApp();
  } else {
    lockError.textContent = "Wrong passcode. Try again.";
    lockInput.value = "";
  }
}
function unlockApp(){
  sessionStorage.setItem(SESSION_KEY, "1");
  lockScreen.classList.add("hidden");
  appEl.classList.remove("hidden");
  goTab("today");
}
lockBtn.onclick = tryUnlock;
lockInput.addEventListener("keydown", e => { if(e.key === "Enter") tryUnlock(); });

document.getElementById("logoutBtn").onclick = () => {
  sessionStorage.removeItem(SESSION_KEY);
  appEl.classList.add("hidden");
  lockScreen.classList.remove("hidden");
  setupLockScreen();
};

/* ---------------- boot ---------------- */
loadState();
if(sessionStorage.getItem(SESSION_KEY) === "1"){
  lockScreen.classList.add("hidden");
  appEl.classList.remove("hidden");
  goTab("today");
} else {
  setupLockScreen();
}
