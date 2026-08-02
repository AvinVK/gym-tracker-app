// Declared up-front: api.* calls (via checkAuth() etc.) start firing as
// soon as the script runs, before the rest of this file is parsed. Auth
// itself rides on the session cookie Flask sets on login (sent automatically
// on same-origin fetches) — this is just the per-user localStorage draft key.
let currentUserId = null;

const api = {
  get: (url) => fetch(url).then(r => r.json()),
  post: (url, body) => fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then(async r => {
    if (!r.ok) throw new Error((await r.json()).error || "Request failed");
    return r.json();
  }),
  put: (url, body) => fetch(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then(async r => {
    if (!r.ok) throw new Error((await r.json()).error || "Request failed");
    return r.json();
  }),
  del: (url) => fetch(url, { method: "DELETE" }),
};

// ---------------- Date inputs: no future dates ----------------
const todayStr = new Date().toLocaleDateString("en-CA");

// Declared up-front: addExerciseBlock() runs during page init (before the
// draft module further down), and it calls saveExerciseDraft() internally.
// Starts true so that init-time DOM building can't clobber a saved draft
// before restoreDraft() gets a chance to read it; restoreDraft() flips it
// back off once restoration (or the decision that there's nothing to
// restore) is complete. Also stays true across a profile switch so the
// outgoing profile's UI reset doesn't overwrite their still-saved draft.
let restoringDraft = true;

function toast(msg) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), 1800);
}

// ---------------- Confirm modal ----------------
function confirmModal(message) {
  const modal = document.getElementById("confirm-modal");
  const okBtn = document.getElementById("confirm-modal-ok");
  const cancelBtn = document.getElementById("confirm-modal-cancel");
  document.getElementById("confirm-modal-message").textContent = message;
  modal.hidden = false;

  return new Promise(resolve => {
    function onOk() { cleanup(true); }
    function onCancel() { cleanup(false); }
    function cleanup(result) {
      modal.hidden = true;
      okBtn.removeEventListener("click", onOk);
      cancelBtn.removeEventListener("click", onCancel);
      resolve(result);
    }
    okBtn.addEventListener("click", onOk);
    cancelBtn.addEventListener("click", onCancel);
  });
}

// ---------------- Custom date picker ----------------
const dpModal = document.getElementById("date-picker-modal");
const dpGrid = document.getElementById("dp-grid");
const dpMonthLabel = document.getElementById("dp-month-label");
let dpViewYear, dpViewMonth, dpActiveField = null;

function formatDateDisplay(iso) {
  const [y, m, d] = iso.split("-");
  return `${d}-${m}-${y}`;
}

function setDateFieldValue(container, iso) {
  const input = container.querySelector("input[type=hidden]");
  const valueEl = container.querySelector(".date-field-value");
  input.value = iso || "";
  valueEl.textContent = iso ? formatDateDisplay(iso) : "dd-mm-yyyy";
  valueEl.classList.toggle("placeholder", !iso);
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

function renderDatePickerGrid() {
  dpMonthLabel.textContent = new Date(dpViewYear, dpViewMonth, 1)
    .toLocaleDateString("en-US", { month: "long", year: "numeric" });
  dpGrid.innerHTML = "";
  const firstDay = new Date(dpViewYear, dpViewMonth, 1).getDay();
  const daysInMonth = new Date(dpViewYear, dpViewMonth + 1, 0).getDate();
  const selectedIso = dpActiveField.container.querySelector("input[type=hidden]").value;
  const maxIso = dpActiveField.max;
  for (let i = 0; i < firstDay; i++) dpGrid.appendChild(document.createElement("span"));
  for (let day = 1; day <= daysInMonth; day++) {
    const iso = `${dpViewYear}-${String(dpViewMonth + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = day;
    btn.className = "date-picker-day";
    if (iso === selectedIso) btn.classList.add("selected");
    if (iso === todayStr) btn.classList.add("today");
    if (maxIso && iso > maxIso) {
      btn.disabled = true;
    } else {
      btn.addEventListener("click", () => {
        setDateFieldValue(dpActiveField.container, iso);
        const hiddenInput = dpActiveField.container.querySelector("input[type=hidden]");
        if (hiddenInput.id === "workout-date" && iso !== todayStr) {
          toast("You're logging a previous workout");
        }
        closeDatePicker();
      });
    }
    dpGrid.appendChild(btn);
  }
}

function openDatePicker(field) {
  dpActiveField = field;
  const current = field.container.querySelector("input[type=hidden]").value;
  const base = current || field.max || todayStr;
  const d = new Date(`${base}T00:00:00`);
  dpViewYear = d.getFullYear();
  dpViewMonth = d.getMonth();
  renderDatePickerGrid();
  dpModal.hidden = false;
}

function closeDatePicker() {
  dpModal.hidden = true;
  dpActiveField = null;
}

document.getElementById("dp-prev").addEventListener("click", () => {
  dpViewMonth--; if (dpViewMonth < 0) { dpViewMonth = 11; dpViewYear--; }
  renderDatePickerGrid();
});
document.getElementById("dp-next").addEventListener("click", () => {
  dpViewMonth++; if (dpViewMonth > 11) { dpViewMonth = 0; dpViewYear++; }
  renderDatePickerGrid();
});
document.getElementById("dp-cancel").addEventListener("click", closeDatePicker);
dpModal.addEventListener("click", (e) => { if (e.target === dpModal) closeDatePicker(); });

function initDateField(container) {
  const btn = container.querySelector(".date-field-btn");
  const max = container.dataset.max === "today" ? todayStr : null;
  const field = { container, max };
  btn.addEventListener("click", () => openDatePicker(field));
}

document.querySelectorAll("[data-date-field]").forEach(initDateField);

// ---------------- Auth (name -> email -> new-user setup or PIN login) ----------------
let currentUser = null;
let authDraft = { name: "", email: "" };

function showGreeting(name) {
  document.getElementById("user-greeting-text").textContent = `Hi, ${name}`;
  document.getElementById("user-menu").hidden = false;
}

function hideAllAuthModals() {
  document.getElementById("auth-name-modal").hidden = true;
  document.getElementById("auth-email-modal").hidden = true;
  document.getElementById("auth-signup-modal").hidden = true;
  document.getElementById("auth-login-modal").hidden = true;
}

function showAuthStep(id) {
  hideAllAuthModals();
  document.getElementById(id).hidden = false;
}

async function onLoggedIn(user, { isNewSignup = false } = {}) {
  // Block autosave while we tear down whatever was on screen before (e.g. a
  // previous session on a shared device): it's a reset, not something that
  // should overwrite the incoming user's own draft.
  restoringDraft = true;
  resetWorkoutFlowUI();

  currentUser = user;
  currentUserId = user.id;

  if (isNewSignup) {
    // Drafts are keyed by numeric user id (see draftKey() below), and ids
    // get reused once an old test/deleted account's id is assigned to a
    // brand-new signup. A genuinely new account can never have a legitimate
    // draft of its own yet, so anything under this id is stale leftovers
    // from whoever had this id before — never something to restore.
    clearDraft();
  }

  hideAllAuthModals();
  document.getElementById("user-menu-dropdown").hidden = true;
  showGreeting(user.name);

  await muscleOptionsReady;
  await restoreDraft(); // this user's own draft, if any; also resets restoringDraft when done

  if (document.querySelector('.tab-btn[data-tab="history"]').classList.contains("active")) {
    loadHistory();
  }
}

document.getElementById("form-auth-name").addEventListener("submit", (e) => {
  e.preventDefault();
  authDraft.name = new FormData(e.target).get("name").trim();
  showAuthStep("auth-email-modal");
});

document.getElementById("auth-email-back").addEventListener("click", () => {
  showAuthStep("auth-name-modal");
});

document.getElementById("form-auth-email").addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = new FormData(e.target).get("email").trim();
  try {
    const res = await api.post("/api/check-email", { email });
    authDraft.email = email;
    if (res.exists) {
      document.getElementById("form-auth-login").reset();
      document.getElementById("auth-login-name").textContent = res.name;
      showAuthStep("auth-login-modal");
    } else {
      const signupForm = document.getElementById("form-auth-signup");
      signupForm.reset();
      setDateFieldValue(signupForm.querySelector('[name="last_period_date"]').closest(".date-field"), "");
      showAuthStep("auth-signup-modal");
    }
  } catch (err) {
    toast(err.message);
  }
});

document.getElementById("auth-signup-back").addEventListener("click", () => {
  showAuthStep("auth-email-modal");
});

document.getElementById("form-auth-signup").addEventListener("submit", async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const body = { ...Object.fromEntries(fd.entries()), name: authDraft.name, email: authDraft.email };
  try {
    await api.post("/api/signup", body);
    const user = await api.get("/api/me");
    await onLoggedIn(user, { isNewSignup: true });
    toast(`Welcome, ${user.name}!`);
  } catch (err) {
    toast(err.message);
  }
});

document.getElementById("auth-login-back").addEventListener("click", () => {
  showAuthStep("auth-email-modal");
});

document.getElementById("form-auth-login").addEventListener("submit", async (e) => {
  e.preventDefault();
  const pin = new FormData(e.target).get("pin");
  try {
    await api.post("/api/login", { email: authDraft.email, pin });
    await onLoggedIn(await api.get("/api/me"));
  } catch (err) {
    toast(err.message);
  }
});

document.getElementById("logout-btn").addEventListener("click", async () => {
  document.getElementById("user-menu-dropdown").hidden = true;
  await api.post("/api/logout", {});
  currentUser = null;
  currentUserId = null;
  authDraft = { name: "", email: "" };
  restoringDraft = true;
  resetWorkoutFlowUI();
  document.getElementById("user-menu").hidden = true;
  document.getElementById("form-auth-name").reset();
  showAuthStep("auth-name-modal");
});

async function checkAuth() {
  const user = await api.get("/api/me");
  if (user) {
    await onLoggedIn(user);
  } else {
    showAuthStep("auth-name-modal");
  }
}

const muscleOptionsReady = loadMuscleOptions();
checkAuth();

// ---------------- User menu / Profile ----------------
const userMenuDropdown = document.getElementById("user-menu-dropdown");

document.getElementById("user-greeting-btn").addEventListener("click", (e) => {
  e.stopPropagation();
  userMenuDropdown.hidden = !userMenuDropdown.hidden;
});

document.addEventListener("click", () => { userMenuDropdown.hidden = true; });

function renderProfileAvatar() {
  const img = document.getElementById("profile-avatar-img");
  const placeholder = document.getElementById("profile-avatar-placeholder");
  if (currentUser && currentUser.avatar) {
    img.src = currentUser.avatar;
    img.hidden = false;
    placeholder.hidden = true;
  } else {
    img.hidden = true;
    placeholder.hidden = false;
    placeholder.textContent = currentUser && currentUser.name ? currentUser.name[0].toUpperCase() : "?";
  }
}

function showProfile() {
  document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
  document.querySelectorAll(".tab-panel").forEach(p => p.classList.remove("active"));
  document.querySelectorAll(".main-tab-panel").forEach(p => p.classList.remove("active"));
  document.getElementById("tab-profile").classList.add("active");

  document.getElementById("profile-name").value = currentUser.name || "";
  document.getElementById("profile-age").value = currentUser.age ?? "";
  setDateFieldValue(document.getElementById("profile-last-period").closest(".date-field"), currentUser.last_period_date || "");
  renderProfileAvatar();
}

document.getElementById("view-profile-btn").addEventListener("click", () => {
  userMenuDropdown.hidden = true;
  showProfile();
});

document.getElementById("profile-back").addEventListener("click", () => {
  document.querySelectorAll(".tab-panel").forEach(p => p.classList.remove("active"));
  document.getElementById("tab-log").classList.add("active");
  document.querySelector('.tab-btn[data-tab="log"]').classList.add("active");
  document.querySelectorAll(".main-tab-btn").forEach(b => b.classList.remove("active"));
  document.querySelector('.main-tab-btn[data-maintab="workout"]').classList.add("active");
  document.querySelectorAll(".main-tab-panel").forEach(p => p.classList.remove("active"));
  document.getElementById("maintab-workout").classList.add("active");
});

document.getElementById("form-profile").addEventListener("submit", async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const body = Object.fromEntries(fd.entries());
  try {
    await api.put(`/api/user/${currentUser.id}`, body);
    currentUser = { ...currentUser, ...body };
    showGreeting(currentUser.name);
    toast("Profile updated");
  } catch (err) {
    toast(err.message);
  }
});

document.getElementById("profile-avatar-input").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const fd = new FormData();
  fd.append("avatar", file);
  try {
    const res = await fetch(`/api/user/${currentUser.id}/avatar`, { method: "POST", body: fd });
    if (!res.ok) throw new Error((await res.json()).error || "Upload failed");
    const data = await res.json();
    currentUser.avatar = data.avatar;
    renderProfileAvatar();
    toast("Photo updated");
  } catch (err) {
    toast(err.message);
  }
});

// ---------------- Tabs ----------------
document.querySelectorAll(".main-tab-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".main-tab-btn").forEach(b => b.classList.remove("active"));
    document.querySelectorAll(".main-tab-panel").forEach(p => p.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach(p => p.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById("maintab-" + btn.dataset.maintab).classList.add("active");
    if (btn.dataset.maintab === "workout") {
      const activeSubTab = document.querySelector('.tabs .tab-btn.active') || document.querySelector('.tabs .tab-btn[data-tab="log"]');
      activeSubTab.classList.add("active");
      document.getElementById("tab-" + activeSubTab.dataset.tab).classList.add("active");
      if (activeSubTab.dataset.tab === "history") loadHistory();
    }
  });
});

document.querySelectorAll(".tab-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach(p => p.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById("tab-" + btn.dataset.tab).classList.add("active");
    if (btn.dataset.tab === "history") loadHistory();
  });
});

// ---------------- Muscle options (exercise log) ----------------
let availableMuscles = [];

function populateMuscleSelect(field) {
  setOptionFieldOptions(field, availableMuscles);
}

async function loadMuscleOptions() {
  availableMuscles = await api.get("/api/muscles");
  exercisesContainer.querySelectorAll(".ex-muscle-field").forEach(populateMuscleSelect);
}

// ---------------- Custom energy-level picker ----------------
const ENERGY_LEVELS = [
  { emoji: "😩", label: "Running on empty" },
  { emoji: "😔", label: "Really low energy" },
  { emoji: "😕", label: "Below average" },
  { emoji: "😐", label: "A little sluggish" },
  { emoji: "🙂", label: "Feeling okay" },
  { emoji: "🙃", label: "Decent energy" },
  { emoji: "😊", label: "Feeling good" },
  { emoji: "💪", label: "Strong and ready" },
  { emoji: "🔥", label: "Highly energized" },
  { emoji: "🚀", label: "Absolutely unstoppable" },
];

const epModal = document.getElementById("energy-picker-modal");
const epLevelsCol = document.getElementById("ep-levels");
const epEmoji = document.getElementById("ep-emoji");
const epLabel = document.getElementById("ep-label");
let epActiveContainer = null;
let epSelected = null;

epLevelsCol.innerHTML = ENERGY_LEVELS
  .map((lvl, i) => `<button type="button" class="time-picker-option" data-value="${i + 1}">${lvl.emoji} ${i + 1}</button>`)
  .join("");

function energyLevelInfo(value) {
  return ENERGY_LEVELS[parseInt(value, 10) - 1] || null;
}

function formatEnergyDisplay(value) {
  const info = energyLevelInfo(value);
  return info ? `${info.emoji} ${value}/10 — ${info.label}` : "How do you feel?";
}

function setEnergyFieldValue(container, value) {
  const hidden = container.querySelector("input[type=hidden]");
  const valueEl = container.querySelector(".energy-field-value");
  hidden.value = value || "";
  valueEl.textContent = formatEnergyDisplay(value);
  valueEl.classList.toggle("placeholder", !energyLevelInfo(value));
  hidden.dispatchEvent(new Event("change", { bubbles: true }));
}

function highlightEnergyPickerSelection() {
  epLevelsCol.querySelectorAll(".time-picker-option").forEach(b => b.classList.toggle("selected", b.dataset.value === String(epSelected)));
  const info = energyLevelInfo(epSelected);
  if (info) {
    epEmoji.textContent = info.emoji;
    epLabel.textContent = info.label;
  }
}

function jumpToEnergyOption(value) {
  const target = (value != null && [...epLevelsCol.querySelectorAll(".time-picker-option")].find(b => b.dataset.value === String(value))) || epLevelsCol.firstElementChild;
  if (!target) return;
  epLevelsCol.scrollTop = target.offsetTop - (epLevelsCol.clientHeight - target.offsetHeight) / 2;
}

function centeredEnergyOption() {
  const mid = epLevelsCol.clientHeight / 2;
  let closest = null;
  let closestDist = Infinity;
  epLevelsCol.querySelectorAll(".time-picker-option").forEach(opt => {
    const dist = Math.abs((opt.offsetTop + opt.offsetHeight / 2) - (epLevelsCol.scrollTop + mid));
    if (dist < closestDist) { closestDist = dist; closest = opt; }
  });
  return closest;
}

let epScrollTimer = null;
epLevelsCol.addEventListener("scroll", () => {
  clearTimeout(epScrollTimer);
  epScrollTimer = setTimeout(() => {
    const opt = centeredEnergyOption();
    if (!opt) return;
    epSelected = opt.dataset.value;
    highlightEnergyPickerSelection();
  }, 100);
});

epLevelsCol.addEventListener("click", (e) => {
  const btn = e.target.closest(".time-picker-option");
  if (!btn) return;
  epSelected = btn.dataset.value;
  jumpToEnergyOption(epSelected);
  highlightEnergyPickerSelection();
});

function openEnergyPicker(container) {
  epActiveContainer = container;
  const hidden = container.querySelector("input[type=hidden]");
  epSelected = hidden.value || "5"; // wheel always centers on something; default to the middle
  highlightEnergyPickerSelection();
  epModal.hidden = false;
  requestAnimationFrame(() => jumpToEnergyOption(epSelected));
}

function closeEnergyPicker() {
  epModal.hidden = true;
  epActiveContainer = null;
}

document.getElementById("ep-cancel").addEventListener("click", closeEnergyPicker);
epModal.addEventListener("click", (e) => { if (e.target === epModal) closeEnergyPicker(); });
document.getElementById("ep-done").addEventListener("click", () => {
  if (!epActiveContainer) return;
  setEnergyFieldValue(epActiveContainer, epSelected);
  closeEnergyPicker();
});

function initEnergyField(container) {
  const btn = container.querySelector(".energy-field-btn");
  const hidden = container.querySelector("input[type=hidden]");
  if (hidden.value) setEnergyFieldValue(container, hidden.value);
  btn.addEventListener("click", () => openEnergyPicker(container));
}

document.querySelectorAll("[data-energy-field]").forEach(initEnergyField);

// ---------------- Custom "time since eating" picker ----------------
const MEAL_TIMING_HOURS = Array.from({ length: 13 }, (_, i) => i * 0.5); // 0 to 6 hrs, half-hour steps

const mtpModal = document.getElementById("meal-timing-picker-modal");
const mtpHoursCol = document.getElementById("mtp-hours");
let mtpActiveContainer = null;
let mtpSelected = null;

function formatMealTimingLabel(value) {
  const n = parseFloat(value);
  return `${n} ${n === 1 ? "hr" : "hrs"} ago`;
}

mtpHoursCol.innerHTML = MEAL_TIMING_HOURS
  .map(v => `<button type="button" class="time-picker-option" data-value="${v}">${formatMealTimingLabel(v)}</button>`)
  .join("");

function setMealTimingFieldValue(container, value) {
  const hidden = container.querySelector("input[type=hidden]");
  const valueEl = container.querySelector(".meal-timing-field-value");
  const hasValue = value !== "" && value != null;
  hidden.value = hasValue ? value : "";
  valueEl.textContent = hasValue ? formatMealTimingLabel(value) : "How long ago?";
  valueEl.classList.toggle("placeholder", !hasValue);
  hidden.dispatchEvent(new Event("change", { bubbles: true }));
}

function highlightMealTimingSelection() {
  mtpHoursCol.querySelectorAll(".time-picker-option").forEach(b => b.classList.toggle("selected", b.dataset.value === String(mtpSelected)));
}

function jumpToMealTimingOption(value) {
  const target = (value != null && [...mtpHoursCol.querySelectorAll(".time-picker-option")].find(b => b.dataset.value === String(value))) || mtpHoursCol.firstElementChild;
  if (!target) return;
  mtpHoursCol.scrollTop = target.offsetTop - (mtpHoursCol.clientHeight - target.offsetHeight) / 2;
}

function centeredMealTimingOption() {
  const mid = mtpHoursCol.clientHeight / 2;
  let closest = null;
  let closestDist = Infinity;
  mtpHoursCol.querySelectorAll(".time-picker-option").forEach(opt => {
    const dist = Math.abs((opt.offsetTop + opt.offsetHeight / 2) - (mtpHoursCol.scrollTop + mid));
    if (dist < closestDist) { closestDist = dist; closest = opt; }
  });
  return closest;
}

let mtpScrollTimer = null;
mtpHoursCol.addEventListener("scroll", () => {
  clearTimeout(mtpScrollTimer);
  mtpScrollTimer = setTimeout(() => {
    const opt = centeredMealTimingOption();
    if (!opt) return;
    mtpSelected = opt.dataset.value;
    highlightMealTimingSelection();
  }, 100);
});

mtpHoursCol.addEventListener("click", (e) => {
  const btn = e.target.closest(".time-picker-option");
  if (!btn) return;
  mtpSelected = btn.dataset.value;
  jumpToMealTimingOption(mtpSelected);
  highlightMealTimingSelection();
});

function openMealTimingPicker(container) {
  mtpActiveContainer = container;
  const hidden = container.querySelector("input[type=hidden]");
  mtpSelected = hidden.value !== "" ? hidden.value : "3"; // wheel always centers on something; default to the middle
  highlightMealTimingSelection();
  mtpModal.hidden = false;
  requestAnimationFrame(() => jumpToMealTimingOption(mtpSelected));
}

function closeMealTimingPicker() {
  mtpModal.hidden = true;
  mtpActiveContainer = null;
}

document.getElementById("mtp-cancel").addEventListener("click", closeMealTimingPicker);
mtpModal.addEventListener("click", (e) => { if (e.target === mtpModal) closeMealTimingPicker(); });
document.getElementById("mtp-done").addEventListener("click", () => {
  if (!mtpActiveContainer) return;
  setMealTimingFieldValue(mtpActiveContainer, mtpSelected);
  closeMealTimingPicker();
});

function initMealTimingField(container) {
  const btn = container.querySelector(".meal-timing-field-btn");
  const hidden = container.querySelector("input[type=hidden]");
  if (hidden.value !== "") setMealTimingFieldValue(container, hidden.value);
  btn.addEventListener("click", () => openMealTimingPicker(container));
}

document.querySelectorAll("[data-meal-timing-field]").forEach(initMealTimingField);

// ---------------- Custom "set duration" picker (cardio sets) ----------------
// Sets are added/removed dynamically (addSetRow), so unlike the pickers above
// there's no static [data-x-field] to wire up at load time — initSetDurationField
// is instead called on each new row's field container as it's created.
const SET_DURATION_MINUTES = Array.from({ length: 121 }, (_, i) => i); // 0 to 120 min

const sdpModal = document.getElementById("set-duration-picker-modal");
const sdpMinutesCol = document.getElementById("sdp-minutes");
let sdpActiveContainer = null;
let sdpSelected = null;

sdpMinutesCol.innerHTML = SET_DURATION_MINUTES
  .map(m => `<button type="button" class="time-picker-option" data-value="${m}">${m} min</button>`)
  .join("");

function setSetDurationValue(row, value) {
  const hidden = row.querySelector(".set-duration");
  const valueEl = row.querySelector(".set-duration-field-value");
  const hasValue = value !== "" && value != null;
  hidden.value = hasValue ? value : "";
  valueEl.textContent = hasValue ? `${value} min` : "Set duration";
  valueEl.classList.toggle("placeholder", !hasValue);
  hidden.dispatchEvent(new Event("input", { bubbles: true }));
}

function highlightSetDurationSelection() {
  sdpMinutesCol.querySelectorAll(".time-picker-option").forEach(b => b.classList.toggle("selected", b.dataset.value === String(sdpSelected)));
}

function jumpToSetDurationOption(value) {
  const target = (value != null && [...sdpMinutesCol.querySelectorAll(".time-picker-option")].find(b => b.dataset.value === String(value))) || sdpMinutesCol.firstElementChild;
  if (!target) return;
  sdpMinutesCol.scrollTop = target.offsetTop - (sdpMinutesCol.clientHeight - target.offsetHeight) / 2;
}

function centeredSetDurationOption() {
  const mid = sdpMinutesCol.clientHeight / 2;
  let closest = null;
  let closestDist = Infinity;
  sdpMinutesCol.querySelectorAll(".time-picker-option").forEach(opt => {
    const dist = Math.abs((opt.offsetTop + opt.offsetHeight / 2) - (sdpMinutesCol.scrollTop + mid));
    if (dist < closestDist) { closestDist = dist; closest = opt; }
  });
  return closest;
}

let sdpScrollTimer = null;
sdpMinutesCol.addEventListener("scroll", () => {
  clearTimeout(sdpScrollTimer);
  sdpScrollTimer = setTimeout(() => {
    const opt = centeredSetDurationOption();
    if (!opt) return;
    sdpSelected = opt.dataset.value;
    highlightSetDurationSelection();
  }, 100);
});

sdpMinutesCol.addEventListener("click", (e) => {
  const btn = e.target.closest(".time-picker-option");
  if (!btn) return;
  sdpSelected = btn.dataset.value;
  jumpToSetDurationOption(sdpSelected);
  highlightSetDurationSelection();
});

function openSetDurationPicker(row) {
  sdpActiveContainer = row;
  const hidden = row.querySelector(".set-duration");
  sdpSelected = hidden.value !== "" ? hidden.value : "0"; // wheel always centers on something
  highlightSetDurationSelection();
  sdpModal.hidden = false;
  requestAnimationFrame(() => jumpToSetDurationOption(sdpSelected));
}

function closeSetDurationPicker() {
  sdpModal.hidden = true;
  sdpActiveContainer = null;
}

document.getElementById("sdp-cancel").addEventListener("click", closeSetDurationPicker);
sdpModal.addEventListener("click", (e) => { if (e.target === sdpModal) closeSetDurationPicker(); });
document.getElementById("sdp-done").addEventListener("click", () => {
  if (!sdpActiveContainer) return;
  setSetDurationValue(sdpActiveContainer, sdpSelected);
  closeSetDurationPicker();
});

function initSetDurationField(container) {
  const row = container.closest(".set-row");
  container.querySelector(".set-wheel-field-btn").addEventListener("click", () => openSetDurationPicker(row));
}

// ---------------- Custom "set intensity level" picker (cardio sets) ----------------
const SET_LEVELS = Array.from({ length: 10 }, (_, i) => i + 1); // 1 to 10

const slpModal = document.getElementById("set-level-picker-modal");
const slpLevelsCol = document.getElementById("slp-levels");
let slpActiveContainer = null;
let slpSelected = null;

slpLevelsCol.innerHTML = SET_LEVELS
  .map(n => `<button type="button" class="time-picker-option" data-value="${n}">Level ${n}</button>`)
  .join("");

function setSetLevelValue(row, value) {
  const hidden = row.querySelector(".set-level");
  const valueEl = row.querySelector(".set-level-field-value");
  const hasValue = value !== "" && value != null;
  hidden.value = hasValue ? value : "";
  valueEl.textContent = hasValue ? `Level ${value}` : "Set level";
  valueEl.classList.toggle("placeholder", !hasValue);
  hidden.dispatchEvent(new Event("input", { bubbles: true }));
}

function highlightSetLevelSelection() {
  slpLevelsCol.querySelectorAll(".time-picker-option").forEach(b => b.classList.toggle("selected", b.dataset.value === String(slpSelected)));
}

function jumpToSetLevelOption(value) {
  const target = (value != null && [...slpLevelsCol.querySelectorAll(".time-picker-option")].find(b => b.dataset.value === String(value))) || slpLevelsCol.firstElementChild;
  if (!target) return;
  slpLevelsCol.scrollTop = target.offsetTop - (slpLevelsCol.clientHeight - target.offsetHeight) / 2;
}

function centeredSetLevelOption() {
  const mid = slpLevelsCol.clientHeight / 2;
  let closest = null;
  let closestDist = Infinity;
  slpLevelsCol.querySelectorAll(".time-picker-option").forEach(opt => {
    const dist = Math.abs((opt.offsetTop + opt.offsetHeight / 2) - (slpLevelsCol.scrollTop + mid));
    if (dist < closestDist) { closestDist = dist; closest = opt; }
  });
  return closest;
}

let slpScrollTimer = null;
slpLevelsCol.addEventListener("scroll", () => {
  clearTimeout(slpScrollTimer);
  slpScrollTimer = setTimeout(() => {
    const opt = centeredSetLevelOption();
    if (!opt) return;
    slpSelected = opt.dataset.value;
    highlightSetLevelSelection();
  }, 100);
});

slpLevelsCol.addEventListener("click", (e) => {
  const btn = e.target.closest(".time-picker-option");
  if (!btn) return;
  slpSelected = btn.dataset.value;
  jumpToSetLevelOption(slpSelected);
  highlightSetLevelSelection();
});

function openSetLevelPicker(row) {
  slpActiveContainer = row;
  const hidden = row.querySelector(".set-level");
  slpSelected = hidden.value !== "" ? hidden.value : "5"; // wheel always centers on something
  highlightSetLevelSelection();
  slpModal.hidden = false;
  requestAnimationFrame(() => jumpToSetLevelOption(slpSelected));
}

function closeSetLevelPicker() {
  slpModal.hidden = true;
  slpActiveContainer = null;
}

document.getElementById("slp-cancel").addEventListener("click", closeSetLevelPicker);
slpModal.addEventListener("click", (e) => { if (e.target === slpModal) closeSetLevelPicker(); });
document.getElementById("slp-done").addEventListener("click", () => {
  if (!slpActiveContainer) return;
  setSetLevelValue(slpActiveContainer, slpSelected);
  closeSetLevelPicker();
});

function initSetLevelField(container) {
  const row = container.closest(".set-row");
  container.querySelector(".set-wheel-field-btn").addEventListener("click", () => openSetLevelPicker(row));
}

// ---------------- Custom option picker (muscle group / exercise dropdowns) ----------------
const opModal = document.getElementById("option-picker-modal");
const opTitle = document.getElementById("op-title");
const opList = document.getElementById("op-list");
let opActiveContainer = null;

function setOptionFieldValue(container, value) {
  const hidden = container.querySelector("input[type=hidden]");
  const valueEl = container.querySelector(".option-field-value");
  const placeholder = container.dataset.placeholder || "Select...";
  hidden.value = value || "";
  valueEl.textContent = value || placeholder;
  valueEl.classList.toggle("placeholder", !value);
  hidden.dispatchEvent(new Event("change", { bubbles: true }));
}

function setOptionFieldOptions(container, options, { emptyText } = {}) {
  container.__options = options;
  const btn = container.querySelector(".option-field-btn");
  const hidden = container.querySelector("input[type=hidden]");
  const valueEl = container.querySelector(".option-field-value");
  if (!options.length) {
    btn.disabled = true;
    hidden.value = "";
    valueEl.textContent = emptyText || "No options available";
    valueEl.classList.add("placeholder");
    return;
  }
  btn.disabled = false;
  if (!options.includes(hidden.value)) {
    hidden.value = "";
    valueEl.textContent = container.dataset.placeholder || "Select...";
    valueEl.classList.add("placeholder");
  }
}

function openOptionPicker(container) {
  const options = container.__options || [];
  if (!options.length) return;
  opActiveContainer = container;
  opTitle.textContent = container.dataset.title || "Select";
  const current = container.querySelector("input[type=hidden]").value;
  opList.innerHTML = options
    .map(o => `<button type="button" class="option-picker-item${o === current ? " selected" : ""}" data-value="${o}">${o}</button>`)
    .join("");
  opModal.hidden = false;
}

function closeOptionPicker() {
  opModal.hidden = true;
  opActiveContainer = null;
}

opList.addEventListener("click", (e) => {
  const btn = e.target.closest(".option-picker-item");
  if (!btn || !opActiveContainer) return;
  setOptionFieldValue(opActiveContainer, btn.dataset.value);
  closeOptionPicker();
});
document.getElementById("op-cancel").addEventListener("click", closeOptionPicker);
opModal.addEventListener("click", (e) => { if (e.target === opModal) closeOptionPicker(); });

function initOptionField(container) {
  container.querySelector(".option-field-btn").addEventListener("click", () => openOptionPicker(container));
}

// ---------------- Workout Log ----------------
let savedWorkoutId = null;

document.getElementById("workout-date").addEventListener("change", (e) => {
  setDateFieldValue(document.getElementById("exlog-date").closest(".date-field"), e.target.value);
});

document.getElementById("workout-edit-btn").addEventListener("click", () => {
  document.getElementById("form-workout").querySelectorAll("input, select, button").forEach(el => el.disabled = false);
  document.getElementById("workout-edit-btn").hidden = true;
});

document.getElementById("form-workout").addEventListener("submit", async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const body = Object.fromEntries(fd.entries());
  if (!body.date) {
    toast("Please select a date");
    return;
  }
  try {
    if (savedWorkoutId) {
      await api.put(`/api/workout-log/${savedWorkoutId}`, body);
      toast("Workout updated");
    } else {
      const res = await api.post("/api/workout-log", body);
      savedWorkoutId = res.id;
      toast("Workout logged");
    }
    e.target.querySelectorAll("input, select, button").forEach(el => el.disabled = true);
    document.getElementById("card-exlog").hidden = false;
    document.getElementById("workout-edit-btn").hidden = false;
    writeDraft({ workout: body, workoutSubmitted: true, workoutId: savedWorkoutId, exlogDate: body.date, exercises: collectExerciseBlocksDraft() });
  } catch (err) {
    toast(err.message);
  }
});

// ---------------- Exercise Log ----------------
const exercisesContainer = document.getElementById("exlog-exercises");

function renumberExerciseBlocks() {
  exercisesContainer.querySelectorAll(".exercise-block").forEach((block, i) => {
    block.querySelector(".exercise-block-title").textContent = `Exercise ${i + 1}`;
  });
}

function renumberSets(block) {
  block.querySelectorAll(".set-row").forEach((row, i) => {
    row.querySelector(".set-number").textContent = `Set ${i + 1}`;
  });
}

function initStepper(container) {
  const input = container.querySelector(".stepper-input");
  const step = parseFloat(container.dataset.step) || 1;
  const min = container.dataset.min !== undefined ? parseFloat(container.dataset.min) : null;
  function adjust(delta) {
    let val = parseFloat(input.value);
    if (isNaN(val)) val = 0;
    val = Math.round((val + delta) * 100) / 100;
    if (min != null && val < min) val = min;
    input.value = val;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }
  container.querySelector(".stepper-minus").addEventListener("click", () => adjust(-step));
  container.querySelector(".stepper-plus").addEventListener("click", () => adjust(step));
}

function updateSetColumnsLabel(block) {
  const isCardio = block.dataset.exerciseType === "cardio";
  const cols = block.querySelectorAll(".set-columns-label-col");
  cols[0].textContent = isCardio ? "Duration (min)" : "Reps";
  cols[1].textContent = isCardio ? "Level" : "Weight (kg)";
}

// Switches a block between "strength" (Reps + Weight) and "cardio"
// (Duration + Level) — e.g. a treadmill has neither reps nor a weight, just
// how long and at what level. Only rebuilds the sets list when the type
// actually changes, so picking a different exercise of the *same* type
// (Bench Press -> Incline Press) never throws away sets already entered.
function applyExerciseType(block, type) {
  const prevType = block.dataset.exerciseType || "strength";
  block.dataset.exerciseType = type;
  if (type === prevType) return;
  updateSetColumnsLabel(block);
  block.querySelector(".ex-sets").innerHTML = "";
  addSetRow(block);
}

function addSetRow(block, { copyLast = false } = {}) {
  const setsDiv = block.querySelector(".ex-sets");
  const existingRows = block.querySelectorAll(".set-row");
  const lastRow = existingRows[existingRows.length - 1];
  const isCardio = block.dataset.exerciseType === "cardio";
  const row = document.createElement("div");
  row.className = "set-row";
  row.innerHTML = isCardio ? `
    <span class="set-number"></span>
    <div class="stepper-duration set-duration-field">
      <button type="button" class="set-wheel-field-btn" aria-label="Set duration">
        <span class="set-wheel-field-icon" aria-hidden="true">⏱️</span>
        <span class="set-duration-field-value set-wheel-field-value placeholder">Set duration</span>
      </button>
      <input type="hidden" class="set-duration">
    </div>
    <div class="stepper-level set-level-field">
      <button type="button" class="set-wheel-field-btn" aria-label="Set intensity level">
        <span class="set-wheel-field-icon" aria-hidden="true">🔥</span>
        <span class="set-level-field-value set-wheel-field-value placeholder">Set level</span>
      </button>
      <input type="hidden" class="set-level">
    </div>
    <input type="text" class="set-notes" placeholder="Note for this set (optional)">
    <button type="button" class="set-remove">✕</button>` : `
    <span class="set-number"></span>
    <div class="stepper stepper-reps" data-step="2" data-min="1">
      <button type="button" class="stepper-btn stepper-minus" aria-label="Decrease reps">&minus;</button>
      <input type="number" class="set-reps stepper-input" min="1" placeholder="0" aria-label="Reps" required>
      <button type="button" class="stepper-btn stepper-plus" aria-label="Increase reps">+</button>
    </div>
    <div class="stepper stepper-weight" data-step="2.5" data-min="0">
      <button type="button" class="stepper-btn stepper-minus" aria-label="Decrease weight">&minus;</button>
      <input type="number" step="0.5" class="set-weight stepper-input" placeholder="kg" aria-label="Weight in kg">
      <button type="button" class="stepper-btn stepper-plus" aria-label="Increase weight">+</button>
    </div>
    <input type="text" class="set-notes" placeholder="Note for this set (optional)">
    <button type="button" class="set-remove">✕</button>`;
  if (isCardio) {
    initSetDurationField(row.querySelector(".set-duration-field"));
    initSetLevelField(row.querySelector(".set-level-field"));
  }
  if (copyLast && lastRow) {
    if (isCardio) {
      setSetDurationValue(row, lastRow.querySelector(".set-duration")?.value || "");
      setSetLevelValue(row, lastRow.querySelector(".set-level")?.value || "");
    } else {
      row.querySelector(".set-reps").value = lastRow.querySelector(".set-reps")?.value || "";
      row.querySelector(".set-weight").value = lastRow.querySelector(".set-weight")?.value || "";
    }
  }
  row.querySelectorAll(".stepper").forEach(initStepper);
  row.querySelector(".set-remove").addEventListener("click", () => {
    row.remove();
    renumberSets(block);
    saveExerciseDraft();
  });
  setsDiv.appendChild(row);
  renumberSets(block);
  saveExerciseDraft();
  return row;
}

// Pulls reps/weight out of a spoken phrase like "20 reps with 30 kgs".
// Deliberately tolerant of word order and missing units ("20 reps 30",
// "30 kg 20 reps", "bodyweight 15 reps", or just "20 reps" alone) since
// speech transcripts are inconsistent about how people phrase this.
function parseSpokenSet(text) {
  const t = (text || "").toLowerCase();
  let weight = null;
  if (/\bbody\s?weight\b|\bno weight\b|\bbodyweight\b/.test(t)) {
    weight = 0;
  } else {
    const weightMatch = t.match(/(\d+(?:\.\d+)?)\s*(?:kgs?|kilos?|kilograms?)/)
      || t.match(/weight\D{0,10}?(\d+(?:\.\d+)?)/); // "weight 30" said without a unit
    if (weightMatch) weight = parseFloat(weightMatch[1]);
  }
  const repsMatch = t.match(/(\d+(?:\.\d+)?)\s*reps?/);
  let reps = repsMatch ? Math.round(parseFloat(repsMatch[1])) : null;
  if (reps == null) {
    // No explicit "reps" keyword — fall back to the first number in the
    // phrase that wasn't already claimed as the weight.
    const nums = [...t.matchAll(/\d+(?:\.\d+)?/g)].map(m => parseFloat(m[0]));
    const candidate = nums.find(n => n !== weight);
    if (candidate != null) reps = Math.round(candidate);
  }
  return { reps, weight };
}

// Same idea as parseSpokenSet, but for cardio: "15 minutes at level 6",
// "level 6 for 15 mins", or just "15 minutes" alone.
function parseSpokenCardioSet(text) {
  const t = (text || "").toLowerCase();
  const durationMatch = t.match(/(\d+(?:\.\d+)?)\s*(?:mins?|minutes?)/);
  let duration = durationMatch ? parseFloat(durationMatch[1]) : null;
  const levelMatch = t.match(/level\D{0,10}?(\d+(?:\.\d+)?)/) || t.match(/(\d+(?:\.\d+)?)\s*(?:level)/);
  let level = levelMatch ? parseFloat(levelMatch[1]) : null;
  if (duration == null) {
    // No explicit "min(s)" keyword — fall back to the first number in the
    // phrase that wasn't already claimed as the level.
    const nums = [...t.matchAll(/\d+(?:\.\d+)?/g)].map(m => parseFloat(m[0]));
    const candidate = nums.find(n => n !== level);
    if (candidate != null) duration = candidate;
  }
  return { duration, level };
}

const SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition;

function initVoiceSetButton(block) {
  const btn = block.querySelector(".add-set-voice");
  if (!SpeechRecognitionCtor) {
    btn.disabled = true;
    btn.title = "Voice input isn't supported in this browser";
    return;
  }
  btn.addEventListener("click", () => {
    const recognition = new SpeechRecognitionCtor();
    recognition.lang = "en-US";
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    btn.classList.add("listening");
    btn.disabled = true;

    // Belt-and-suspenders: if the browser never fires a terminal event at
    // all (seen on some platforms when the mic/permission flow stalls
    // instead of erroring out), force a stop so the button doesn't get
    // stuck in "listening" forever.
    const safetyTimer = setTimeout(() => {
      try { recognition.stop(); } catch (err) { /* already stopped */ }
    }, 8000);

    recognition.addEventListener("result", (e) => {
      const transcript = e.results[0][0].transcript;
      const isCardio = block.dataset.exerciseType === "cardio";
      if (isCardio) {
        const { duration, level } = parseSpokenCardioSet(transcript);
        if (duration == null && level == null) {
          toast(`Didn't catch that: "${transcript}"`);
          return;
        }
        const targetRow = addSetRow(block);
        if (duration != null) setSetDurationValue(targetRow, duration);
        if (level != null) setSetLevelValue(targetRow, level);
        const parts = [duration != null ? `${duration} min` : null, level != null ? `level ${level}` : null].filter(Boolean);
        toast(`Added set: ${parts.join(", ")}`);
        return;
      }
      const { reps, weight } = parseSpokenSet(transcript);
      if (reps == null && weight == null) {
        toast(`Didn't catch that: "${transcript}"`);
        return;
      }
      const targetRow = addSetRow(block);
      if (reps != null) {
        const input = targetRow.querySelector(".set-reps");
        input.value = reps;
        input.dispatchEvent(new Event("input", { bubbles: true }));
      }
      if (weight != null) {
        const input = targetRow.querySelector(".set-weight");
        input.value = weight;
        input.dispatchEvent(new Event("input", { bubbles: true }));
      }
      const parts = [reps != null ? `${reps} reps` : null, weight != null ? `${weight} kg` : null].filter(Boolean);
      toast(`Added set: ${parts.join(", ")}`);
    });
    recognition.addEventListener("error", (e) => {
      toast(e.error === "not-allowed" ? "Microphone access denied" : "Didn't catch that — try again");
    });
    recognition.addEventListener("end", () => {
      clearTimeout(safetyTimer);
      btn.classList.remove("listening");
      btn.disabled = false;
    });

    try {
      recognition.start();
    } catch (err) {
      clearTimeout(safetyTimer);
      btn.classList.remove("listening");
      btn.disabled = false;
      toast("Couldn't start voice input");
    }
  });
}

async function onBlockMuscleChange(block) {
  const muscle = block.querySelector(".ex-muscle").value;
  const exField = block.querySelector(".ex-exercise-field");
  if (!muscle) {
    block.__exerciseTypes = {};
    setOptionFieldOptions(exField, [], { emptyText: "Pick a muscle group first" });
    applyExerciseType(block, "strength");
    return;
  }
  const exercises = await api.get(`/api/exercises-by-muscle/${encodeURIComponent(muscle)}`);
  block.__exerciseTypes = Object.fromEntries(exercises.map(ex => [ex.exercise, ex.type]));
  setOptionFieldOptions(exField, exercises.map(ex => ex.exercise), { emptyText: "No exercises for this muscle yet" });
  // Best guess before a specific exercise is picked (almost everything
  // under "Cardio" is duration+level) — the exercise dropdown's own change
  // handler below corrects this once a specific exercise is chosen.
  applyExerciseType(block, muscle === "Cardio" ? "cardio" : "strength");
}

function addExerciseBlock() {
  const block = document.createElement("div");
  block.className = "exercise-block grid-form";
  block.__exerciseTypes = {};
  block.innerHTML = `
    <div class="exercise-block-header">
      <span class="exercise-block-title"></span>
      <button type="button" class="exercise-remove">✕ Remove</button>
    </div>
    <label>Muscle Group
      <div class="option-field ex-muscle-field" data-option-field data-title="Muscle Group">
        <button type="button" class="option-field-btn">
          <span class="option-field-value placeholder">Select...</span>
          <span class="option-field-caret" aria-hidden="true">&#9662;</span>
        </button>
        <input type="hidden" class="ex-muscle" required>
      </div>
    </label>
    <label>Exercise
      <div class="option-field ex-exercise-field" data-option-field data-title="Exercise">
        <button type="button" class="option-field-btn" disabled>
          <span class="option-field-value placeholder">Pick a muscle group first</span>
          <span class="option-field-caret" aria-hidden="true">&#9662;</span>
        </button>
        <input type="hidden" class="ex-exercise" required>
      </div>
    </label>
    <div class="full">
      <label>Sets</label>
      <div class="set-columns-label" aria-hidden="true">
        <span class="set-columns-label-spacer"></span>
        <span class="set-columns-label-col">Reps</span>
        <span class="set-columns-label-col">Weight (kg)</span>
      </div>
      <div class="ex-sets"></div>
      <div class="set-actions">
        <button type="button" class="add-set secondary">+ Add Set</button>
        <button type="button" class="add-set-same secondary">Same as Above</button>
        <button type="button" class="add-set-voice secondary" aria-label="Add a set by voice" title="Say something like &quot;20 reps with 30 kgs&quot;">🎤</button>
      </div>
    </div>`;

  block.querySelectorAll("[data-option-field]").forEach(initOptionField);
  populateMuscleSelect(block.querySelector(".ex-muscle-field"));
  block.querySelector(".ex-muscle").addEventListener("change", () => {
    if (restoringDraft) return; // restoreDraft() awaits its own explicit call instead
    onBlockMuscleChange(block);
  });
  block.querySelector(".ex-exercise").addEventListener("change", () => {
    if (restoringDraft) return; // restoreDraft() sets the block's type explicitly instead
    const exerciseName = block.querySelector(".ex-exercise").value;
    applyExerciseType(block, (block.__exerciseTypes && block.__exerciseTypes[exerciseName]) || "strength");
  });
  block.querySelector(".add-set").addEventListener("click", () => addSetRow(block));
  block.querySelector(".add-set-same").addEventListener("click", () => addSetRow(block, { copyLast: true }));
  initVoiceSetButton(block);
  block.querySelector(".exercise-remove").addEventListener("click", () => {
    block.remove();
    renumberExerciseBlocks();
    saveExerciseDraft();
  });

  exercisesContainer.appendChild(block);
  addSetRow(block);
  renumberExerciseBlocks();

  // Most workouts train one muscle group across several exercises in a
  // row, so default a freshly-added block to whatever the previous one
  // has picked — setOptionFieldValue's change event also loads that
  // muscle's exercises into the dropdown below. Left alone during draft
  // restoration, which sets each block's own saved value explicitly.
  if (!restoringDraft) {
    const blocks = exercisesContainer.querySelectorAll(".exercise-block");
    const prevBlock = blocks[blocks.length - 2];
    const prevMuscle = prevBlock && prevBlock.querySelector(".ex-muscle").value;
    if (prevMuscle) {
      setOptionFieldValue(block.querySelector(".ex-muscle-field"), prevMuscle);
    }
  }

  return block;
}

document.getElementById("exlog-add-exercise").addEventListener("click", addExerciseBlock);
addExerciseBlock();

document.getElementById("form-exercise-log").addEventListener("submit", async (e) => {
  e.preventDefault();
  const date = e.target.elements["date"].value;
  const exercises = [...exercisesContainer.querySelectorAll(".exercise-block")].map(block => {
    const isCardio = block.dataset.exerciseType === "cardio";
    return {
      muscle_group: block.querySelector(".ex-muscle").value,
      exercise: block.querySelector(".ex-exercise").value,
      sets: [...block.querySelectorAll(".set-row")].map(row => isCardio ? {
        duration_minutes: parseFloat(row.querySelector(".set-duration").value) || null,
        intensity_level: parseInt(row.querySelector(".set-level").value, 10) || null,
        notes: row.querySelector(".set-notes").value,
      } : {
        reps: parseInt(row.querySelector(".set-reps").value, 10) || null,
        weight_kg: parseFloat(row.querySelector(".set-weight").value) || null,
        notes: row.querySelector(".set-notes").value,
      }),
    };
  });
  if (!(await confirmModal(`Do you want to save these exercises for ${date}?`))) {
    return;
  }
  try {
    await api.post("/api/exercise-log", { date, exercises });
    toast("Exercises logged");
    resetWorkoutFlowUI();
    clearDraft();
  } catch (err) {
    toast(err.message);
  }
});

// Shared by "finished logging exercises" and "switching to a different
// profile": wipes the Log Workout / Log Exercises UI back to its blank
// starting state. Does NOT touch localStorage drafts itself — callers
// decide whether that draft should be cleared (flow finished) or left
// alone (just switching away, might switch back later).
function resetWorkoutFlowUI() {
  const workoutForm = document.getElementById("form-workout");
  document.getElementById("form-exercise-log").reset();
  exercisesContainer.innerHTML = "";
  addExerciseBlock();
  workoutForm.reset();
  workoutForm.querySelectorAll("input, select, button").forEach(el => el.disabled = false);
  document.getElementById("card-exlog").hidden = true;
  document.getElementById("workout-edit-btn").hidden = true;
  savedWorkoutId = null;
  // Defaults to today rather than blank — most visits are logged the same
  // day, so this saves a tap for the common case (see the date picker's
  // click handler for the "logging a previous workout" prompt when
  // someone deliberately picks an earlier date instead).
  setDateFieldValue(document.getElementById("workout-date").closest(".date-field"), todayStr);
  setDateFieldValue(document.getElementById("exlog-date").closest(".date-field"), todayStr);
  workoutForm.querySelectorAll(".energy-field").forEach(f => setEnergyFieldValue(f, ""));
  workoutForm.querySelectorAll(".meal-timing-field").forEach(f => setMealTimingFieldValue(f, ""));
}

// ---------------- History ----------------
const cardWorkoutLog = document.getElementById("card-workout-log");
const cardExerciseDetail = document.getElementById("card-exercise-detail");
let currentWorkouts = [];
let currentExerciseLogs = [];
let currentDetailDate = null;

function showWorkoutLog() {
  cardExerciseDetail.hidden = true;
  cardWorkoutLog.hidden = false;
}

async function showExerciseDetail(date) {
  currentDetailDate = date;
  document.getElementById("exercise-detail-title").textContent = `Exercises Done — ${date}`;
  cardWorkoutLog.hidden = true;
  cardExerciseDetail.hidden = false;
  await loadExerciseDetail(date);
}

document.getElementById("exercise-detail-back").addEventListener("click", showWorkoutLog);

// ---- Workout log table ----
function energyFieldHtml(cls, value) {
  const info = energyLevelInfo(value);
  return `
    <div class="energy-field">
      <button type="button" class="energy-field-btn">
        <span class="energy-field-value${info ? "" : " placeholder"}">${formatEnergyDisplay(value)}</span>
        <span class="energy-field-icon" aria-hidden="true">⚡</span>
      </button>
      <input type="hidden" class="${cls}" value="${value || ""}">
    </div>`;
}

function formatMuscles(muscles) {
  return muscles ? muscles.split(",").join(", ") : "";
}

function workoutRowView(w) {
  return `
    <tr class="clickable-row" data-date="${w.date}" data-id="${w.id}">
      <td data-label="Date">${w.date}</td><td data-label="Muscles Targeted">${formatMuscles(w.muscles)}</td><td data-label="Energy Level">${w.energy_level ?? ""}</td><td data-label="Notes">${w.notes || ""}</td>
      <td class="row-actions">
        <button class="edit-btn" data-id="${w.id}">Edit</button>
      </td>
    </tr>`;
}

function workoutRowEdit(w) {
  return `
    <tr data-id="${w.id}">
      <td data-label="Date">
        <div class="date-field" data-max="today">
          <button type="button" class="date-field-btn">
            <span class="date-field-value">${formatDateDisplay(w.date)}</span>
            <span class="date-field-icon" aria-hidden="true">📅</span>
          </button>
          <input type="hidden" class="edit-date" value="${w.date}">
        </div>
      </td>
      <td data-label="Muscles Targeted">${formatMuscles(w.muscles)}</td>
      <td data-label="Energy Level">${energyFieldHtml("edit-energy", w.energy_level)}</td>
      <td data-label="Notes"><input type="text" class="edit-notes" value="${w.notes || ""}"></td>
      <td class="row-actions">
        <button class="save-btn" data-id="${w.id}">Save</button>
        <button class="cancel-btn" data-id="${w.id}">Cancel</button>
      </td>
    </tr>`;
}

function renderWorkoutTable() {
  const wBody = document.querySelector("#table-workout-log tbody");
  wBody.innerHTML = currentWorkouts.map(workoutRowView).join("");
  bindWorkoutRowEvents();
}

function bindWorkoutRowEvents() {
  const wBody = document.querySelector("#table-workout-log tbody");
  wBody.querySelectorAll("tr.clickable-row").forEach(row => {
    row.addEventListener("click", () => showExerciseDetail(row.dataset.date));
  });
  wBody.querySelectorAll(".edit-btn").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const w = currentWorkouts.find(x => x.id == btn.dataset.id);
      btn.closest("tr").outerHTML = workoutRowEdit(w);
      bindWorkoutEditRowEvents(w.id);
    });
  });
}

function bindWorkoutEditRowEvents(id) {
  const row = document.querySelector(`#table-workout-log tbody tr[data-id="${id}"]`);
  initDateField(row.querySelector(".date-field"));
  initEnergyField(row.querySelector(".energy-field"));
  row.querySelector(".save-btn").addEventListener("click", async (e) => {
    e.stopPropagation();
    const body = {
      date: row.querySelector(".edit-date").value,
      energy_level: row.querySelector(".edit-energy").value || null,
      notes: row.querySelector(".edit-notes").value,
    };
    try {
      await api.put(`/api/workout-log/${id}`, body);
      toast("Updated");
      loadHistory();
    } catch (err) {
      toast(err.message);
    }
  });
  row.querySelector(".cancel-btn").addEventListener("click", (e) => {
    e.stopPropagation();
    renderWorkoutTable();
  });
}

async function loadHistory() {
  showWorkoutLog();
  currentWorkouts = await api.get("/api/workout-log");
  renderWorkoutTable();
}

// ---- Exercise detail table ----
function exerciseRowView(x) {
  return `
    <tr data-id="${x.id}">
      <td data-label="Muscle Group">${x.muscle_group}</td><td data-label="Exercise">${x.exercise}</td>
      <td data-label="Set #">${x.set_number ?? ""}</td><td data-label="Reps">${x.reps ?? ""}</td><td data-label="Weight (kg)">${x.weight_kg ?? ""}</td>
      <td data-label="Duration (min)">${x.duration_minutes ?? ""}</td><td data-label="Level">${x.intensity_level ?? ""}</td>
      <td data-label="Notes">${x.notes || ""}</td>
      <td class="row-actions">
        <button class="edit-btn" data-id="${x.id}">Edit</button>
        <button class="del-btn" data-id="${x.id}">Delete</button>
      </td>
    </tr>`;
}

function exerciseRowEdit(x) {
  return `
    <tr data-id="${x.id}">
      <td data-label="Muscle Group"><input type="text" class="edit-muscle" value="${x.muscle_group}"></td>
      <td data-label="Exercise"><input type="text" class="edit-exercise" value="${x.exercise}"></td>
      <td data-label="Set #"><input type="number" class="edit-set" value="${x.set_number ?? ""}"></td>
      <td data-label="Reps"><input type="number" class="edit-reps" value="${x.reps ?? ""}"></td>
      <td data-label="Weight (kg)"><input type="number" step="0.5" class="edit-weight" value="${x.weight_kg ?? ""}"></td>
      <td data-label="Duration (min)"><input type="number" class="edit-duration" value="${x.duration_minutes ?? ""}"></td>
      <td data-label="Level"><input type="number" class="edit-level" value="${x.intensity_level ?? ""}"></td>
      <td data-label="Notes"><input type="text" class="edit-notes" value="${x.notes || ""}"></td>
      <td class="row-actions">
        <button class="save-btn" data-id="${x.id}">Save</button>
        <button class="cancel-btn" data-id="${x.id}">Cancel</button>
      </td>
    </tr>`;
}

function renderExerciseTable() {
  const eBody = document.querySelector("#table-exercise-log tbody");
  eBody.innerHTML = currentExerciseLogs.map(exerciseRowView).join("");
  bindExerciseRowEvents();
}

function bindExerciseRowEvents() {
  const eBody = document.querySelector("#table-exercise-log tbody");
  eBody.querySelectorAll(".edit-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const x = currentExerciseLogs.find(item => item.id == btn.dataset.id);
      btn.closest("tr").outerHTML = exerciseRowEdit(x);
      bindExerciseEditRowEvents(x.id);
    });
  });
  eBody.querySelectorAll(".del-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      await api.del(`/api/exercise-log/${btn.dataset.id}`);
      toast("Deleted");
      loadExerciseDetail(currentDetailDate);
    });
  });
}

function bindExerciseEditRowEvents(id) {
  const row = document.querySelector(`#table-exercise-log tbody tr[data-id="${id}"]`);
  row.querySelector(".save-btn").addEventListener("click", async () => {
    const body = {
      muscle_group: row.querySelector(".edit-muscle").value,
      exercise: row.querySelector(".edit-exercise").value,
      set_number: parseInt(row.querySelector(".edit-set").value, 10) || null,
      reps: parseInt(row.querySelector(".edit-reps").value, 10) || null,
      weight_kg: parseFloat(row.querySelector(".edit-weight").value) || null,
      duration_minutes: parseFloat(row.querySelector(".edit-duration").value) || null,
      intensity_level: parseInt(row.querySelector(".edit-level").value, 10) || null,
      notes: row.querySelector(".edit-notes").value,
    };
    try {
      await api.put(`/api/exercise-log/${id}`, body);
      toast("Updated");
      loadExerciseDetail(currentDetailDate);
    } catch (err) {
      toast(err.message);
    }
  });
  row.querySelector(".cancel-btn").addEventListener("click", () => {
    renderExerciseTable();
  });
}

async function loadExerciseDetail(date) {
  currentExerciseLogs = await api.get(`/api/exercise-log?date=${encodeURIComponent(date)}`);
  renderExerciseTable();
}

// ---------------- Draft autosave (survive accidental reloads) ----------------
function draftKey() {
  return `gymtracker-draft-v1-${currentUserId}`;
}

function readDraft() {
  try {
    return JSON.parse(localStorage.getItem(draftKey()));
  } catch {
    return null;
  }
}

function writeDraft(patch) {
  localStorage.setItem(draftKey(), JSON.stringify({ ...(readDraft() || {}), ...patch }));
}

function clearDraft() {
  localStorage.removeItem(draftKey());
}

function collectExerciseBlocksDraft() {
  return [...exercisesContainer.querySelectorAll(".exercise-block")].map(block => {
    const isCardio = block.dataset.exerciseType === "cardio";
    return {
      muscle_group: block.querySelector(".ex-muscle").value,
      exercise: block.querySelector(".ex-exercise").value,
      type: block.dataset.exerciseType || "strength",
      sets: [...block.querySelectorAll(".set-row")].map(row => isCardio ? {
        duration_minutes: row.querySelector(".set-duration").value,
        intensity_level: row.querySelector(".set-level").value,
        notes: row.querySelector(".set-notes").value,
      } : {
        reps: row.querySelector(".set-reps").value,
        weight_kg: row.querySelector(".set-weight").value,
        notes: row.querySelector(".set-notes").value,
      }),
    };
  });
}

function saveWorkoutDraft() {
  if (restoringDraft) return;
  // Deliberately doesn't touch workoutSubmitted/workoutId: those only change
  // on an actual save (see the submit handler), so editing an already-saved
  // visit keeps updating the same row instead of drafting a duplicate.
  const form = document.getElementById("form-workout");
  writeDraft({ workout: Object.fromEntries(new FormData(form).entries()) });
}

function saveExerciseDraft() {
  if (restoringDraft) return;
  const draft = readDraft();
  if (!draft || !draft.workoutSubmitted) return; // exercise card isn't open yet
  writeDraft({ exlogDate: document.getElementById("exlog-date").value, exercises: collectExerciseBlocksDraft() });
}

document.getElementById("form-workout").addEventListener("input", saveWorkoutDraft);
document.getElementById("form-workout").addEventListener("change", saveWorkoutDraft);
document.getElementById("card-exlog").addEventListener("input", saveExerciseDraft);
document.getElementById("card-exlog").addEventListener("change", saveExerciseDraft);

async function restoreDraft() {
  const draft = readDraft();
  if (!draft) {
    restoringDraft = false;
    return;
  }

  try {
    if (draft.workout) {
      const w = draft.workout;
      const form = document.getElementById("form-workout");
      if (w.energy_level) setEnergyFieldValue(form.querySelector('[name="energy_level"]').closest(".energy-field"), w.energy_level);
      if (w.pre_workout_meal) form.querySelector('[name="pre_workout_meal"]').value = w.pre_workout_meal;
      if (w.hours_since_meal) setMealTimingFieldValue(form.querySelector('[name="hours_since_meal"]').closest(".meal-timing-field"), w.hours_since_meal);
      if (w.notes) form.querySelector('[name="notes"]').value = w.notes;
      if (w.date) setDateFieldValue(document.getElementById("workout-date").closest(".date-field"), w.date);
    }

    if (draft.workoutSubmitted) {
      savedWorkoutId = draft.workoutId || null;
      document.getElementById("form-workout").querySelectorAll("input, select, button").forEach(el => el.disabled = true);
      document.getElementById("card-exlog").hidden = false;
      document.getElementById("workout-edit-btn").hidden = false;

      if (draft.exlogDate) {
        setDateFieldValue(document.getElementById("exlog-date").closest(".date-field"), draft.exlogDate);
      }

      if (draft.exercises && draft.exercises.length) {
        exercisesContainer.innerHTML = "";
        for (const ex of draft.exercises) {
          const block = addExerciseBlock();
          if (ex.muscle_group) {
            setOptionFieldValue(block.querySelector(".ex-muscle-field"), ex.muscle_group);
            await onBlockMuscleChange(block);
            setOptionFieldValue(block.querySelector(".ex-exercise-field"), ex.exercise || "");
          }
          block.dataset.exerciseType = ex.type || "strength";
          updateSetColumnsLabel(block);
          const isCardio = block.dataset.exerciseType === "cardio";
          block.querySelector(".ex-sets").innerHTML = "";
          const sets = ex.sets && ex.sets.length ? ex.sets : [{}];
          sets.forEach(() => addSetRow(block));
          const rows = block.querySelectorAll(".set-row");
          sets.forEach((s, i) => {
            if (isCardio) {
              setSetDurationValue(rows[i], s.duration_minutes || "");
              setSetLevelValue(rows[i], s.intensity_level || "");
            } else {
              rows[i].querySelector(".set-reps").value = s.reps || "";
              rows[i].querySelector(".set-weight").value = s.weight_kg || "";
            }
            rows[i].querySelector(".set-notes").value = s.notes || "";
          });
        }
      }
      toast("Restored your unsaved entry");
    } else if (draft.workout && Object.values(draft.workout).some(v => v)) {
      toast("Restored your unsaved entry");
    }
  } finally {
    restoringDraft = false;
  }
}

// loadMuscleOptions()/checkOnboarding() already kicked off earlier
// (see "Onboarding / profile picker"); restoreDraft() runs per-profile
// from inside selectProfile() once we know who's using the app.
