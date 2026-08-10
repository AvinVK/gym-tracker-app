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
function confirmModal(message, okLabel = "Yes, Save") {
  const modal = document.getElementById("confirm-modal");
  const okBtn = document.getElementById("confirm-modal-ok");
  const cancelBtn = document.getElementById("confirm-modal-cancel");
  document.getElementById("confirm-modal-message").textContent = message;
  okBtn.textContent = okLabel;
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
      document.getElementById("signup-period-date-label").hidden = true;
      showAuthStep("auth-signup-modal");
    }
  } catch (err) {
    toast(err.message);
  }
});

document.getElementById("auth-signup-back").addEventListener("click", () => {
  showAuthStep("auth-email-modal");
});

// Last Period Date is only required when the "track my cycle" checkbox is
// on - shows/hides the date field to match, and clears out any previously
// picked date when switching it off so a stale value can't sneak into a
// submit that no longer intends to send one.
function wireCycleOptIn(checkbox, dateLabel) {
  checkbox.addEventListener("change", () => {
    dateLabel.hidden = !checkbox.checked;
    if (!checkbox.checked) {
      setDateFieldValue(dateLabel.querySelector(".date-field"), "");
    }
  });
}

const signupTrackCycle = document.getElementById("signup-track-cycle");
const signupPeriodDateLabel = document.getElementById("signup-period-date-label");
wireCycleOptIn(signupTrackCycle, signupPeriodDateLabel);

document.getElementById("form-auth-signup").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (signupTrackCycle.checked && !e.target.querySelector('[name="last_period_date"]').value) {
    toast("Add your last period date, or turn off cycle tracking");
    return;
  }
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
  const tracksCycle = !!currentUser.last_period_date;
  document.getElementById("profile-track-cycle").checked = tracksCycle;
  document.getElementById("profile-period-date-label").hidden = !tracksCycle;
  setDateFieldValue(document.getElementById("profile-last-period").closest(".date-field"), currentUser.last_period_date || "");
  renderProfileAvatar();
}

wireCycleOptIn(document.getElementById("profile-track-cycle"), document.getElementById("profile-period-date-label"));

document.getElementById("view-profile-btn").addEventListener("click", () => {
  userMenuDropdown.hidden = true;
  showProfile();
});

// ---------------- Your Cycle ----------------
// No per-user cycle length is collected, so this estimates every cycle as
// a standard 28 days from the last period date - the simplified 4-phase
// model most consumer cycle-tracking apps use absent more history.
const CYCLE_LENGTH_DAYS = 28;
const CYCLE_PHASES = [
  { key: "menstrual", label: "Menstrual Phase", startDay: 1, endDay: 5, color: "#f4436c" },
  { key: "follicular", label: "Follicular Phase", startDay: 6, endDay: 13, color: "#17c993" },
  { key: "ovulation", label: "Ovulation Phase", startDay: 14, endDay: 14, color: "#f5a623" },
  { key: "luteal", label: "Luteal Phase", startDay: 15, endDay: 28, color: "#22d3ee" },
];

function cyclePhaseForDay(day) {
  return CYCLE_PHASES.find(p => day >= p.startDay && day <= p.endDay) || CYCLE_PHASES[CYCLE_PHASES.length - 1];
}

// Cycle day (1-28) for an arbitrary date, not just today - shared by the
// Your Cycle tab summary and the phase dot next to each date in workout
// history. Returns null if the user hasn't opted into cycle tracking.
function cycleDayForDate(dateStr) {
  const lastPeriod = currentUser && currentUser.last_period_date;
  if (!lastPeriod) return null;
  const start = new Date(lastPeriod + "T00:00:00");
  const target = new Date(dateStr + "T00:00:00");
  const daysSince = Math.floor((target - start) / 86400000);
  // +1 so the last period date itself is cycle day 1, not day 0.
  return (((daysSince % CYCLE_LENGTH_DAYS) + CYCLE_LENGTH_DAYS) % CYCLE_LENGTH_DAYS) + 1;
}

function cyclePhaseForDate(dateStr) {
  const day = cycleDayForDate(dateStr);
  return day == null ? null : cyclePhaseForDay(day);
}

function renderCycleTab() {
  const emptyEl = document.getElementById("cycle-empty");
  const summaryEl = document.getElementById("cycle-summary");
  const noteEl = document.getElementById("cycle-estimate-note");
  const cycleDay = cycleDayForDate(todayStr);
  if (cycleDay == null) {
    emptyEl.hidden = false;
    summaryEl.hidden = true;
    noteEl.hidden = true;
    document.querySelectorAll(".cycle-phase-card").forEach(c => c.classList.remove("active"));
    return;
  }
  emptyEl.hidden = true;
  summaryEl.hidden = false;
  noteEl.hidden = false;

  const currentPhase = cyclePhaseForDay(cycleDay);
  const currentIndex = CYCLE_PHASES.indexOf(currentPhase);
  const nextPhase = CYCLE_PHASES[(currentIndex + 1) % CYCLE_PHASES.length];
  const daysUntilNext = nextPhase.startDay > cycleDay
    ? nextPhase.startDay - cycleDay
    : (CYCLE_LENGTH_DAYS - cycleDay) + nextPhase.startDay;

  document.getElementById("cycle-current-phase").textContent = currentPhase.label;
  document.getElementById("cycle-current-detail").textContent = `Day ${cycleDay} of ~${CYCLE_LENGTH_DAYS}`;
  document.getElementById("cycle-next-phase").textContent = nextPhase.label;
  document.getElementById("cycle-next-detail").textContent = `Starts in ${daysUntilNext} day${daysUntilNext === 1 ? "" : "s"}`;

  document.querySelectorAll(".cycle-phase-card").forEach(c => c.classList.toggle("active", c.dataset.phase === currentPhase.key));
}

document.getElementById("cycle-add-date-btn").addEventListener("click", showProfile);

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
  if (document.getElementById("profile-track-cycle").checked && !document.getElementById("profile-last-period").value) {
    toast("Add your last period date, or turn off cycle tracking");
    return;
  }
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
    } else if (btn.dataset.maintab === "cycle") {
      renderCycleTab();
    } else if (btn.dataset.maintab === "performance") {
      renderPerformanceTab();
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

// Same idea as formatEnergyDisplay but without the emoji/label - used where
// space is tight (the History table's inline edit row), which doesn't need
// the full descriptive text that the picker button shows while choosing.
function formatEnergyCompact(value) {
  return energyLevelInfo(value) ? `${value}/10` : "How do you feel?";
}

function setEnergyFieldValue(container, value) {
  const hidden = container.querySelector("input[type=hidden]");
  const valueEl = container.querySelector(".energy-field-value");
  hidden.value = value || "";
  valueEl.textContent = container.dataset.compact != null ? formatEnergyCompact(value) : formatEnergyDisplay(value);
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
// 10/20/30/40 min, then 1 hr and up in 30-min steps to 6 hrs - stored as
// hours (rounded to 2dp) since that's what workout_log.hours_since_meal is,
// but generated from minutes here since that's how the increments were
// actually specified.
const MEAL_TIMING_MINUTES = [10, 20, 30, 40, ...Array.from({ length: 11 }, (_, i) => 60 + i * 30)];
const MEAL_TIMING_HOURS = MEAL_TIMING_MINUTES.map(m => Math.round((m / 60) * 100) / 100);

const mtpModal = document.getElementById("meal-timing-picker-modal");
const mtpHoursCol = document.getElementById("mtp-hours");
let mtpActiveContainer = null;
let mtpSelected = null;

function formatMealTimingLabel(value) {
  const n = parseFloat(value);
  if (n < 1) {
    const mins = Math.round(n * 60);
    return `${mins} min${mins === 1 ? "" : "s"} ago`;
  }
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
document.getElementById("sdp-done").addEventListener("click", async () => {
  if (!sdpActiveContainer) return;
  const row = sdpActiveContainer;
  const newValue = parseFloat(sdpSelected);
  closeSetDurationPicker(); // close first so the confirm modal isn't stacked on top of it
  if (!(await guardPrEdit(row, newValue, " min"))) return;
  setSetDurationValue(row, sdpSelected);
  const block = row.closest(".exercise-block");
  checkForPR(block, row, block.querySelector(".ex-exercise").value, true);
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
const opSearch = document.getElementById("op-search");
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

function setOptionFieldOptions(container, options, { emptyText, images, defaultOptions } = {}) {
  container.__options = options;
  container.__images = images || {};
  // A curated subset to show first (e.g. the exercise picker's hand-picked
  // list) - openOptionPicker() shows only this until "Show all" is tapped,
  // so a long imported catalog doesn't bury the familiar exercises. Falls
  // back to the full list when there's no meaningful subset to prefer.
  container.__defaultOptions = (defaultOptions && defaultOptions.length) ? defaultOptions : null;
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

function renderOptionPickerList(container, { showAll, query } = {}) {
  const options = container.__options || [];
  const defaultOptions = container.__defaultOptions;
  const current = container.querySelector("input[type=hidden]").value;
  const q = (query || "").trim().toLowerCase();

  let visible;
  if (q) {
    // A search query always searches the full catalog, not just the
    // curated subset - typing "che" is a request to find something
    // specific, not a request to browse.
    visible = options.filter(o => o.toLowerCase().includes(q));
  } else {
    // If the current value is already picked and isn't in the curated
    // subset, start expanded - otherwise it'd look like the selection
    // vanished.
    visible = (!showAll && defaultOptions && (!current || defaultOptions.includes(current)))
      ? defaultOptions
      : options;
  }

  const images = container.__images || {};
  if (!visible.length) {
    opList.innerHTML = `<p class="option-picker-empty">No matches</p>`;
    return;
  }
  let html = visible
    .map(o => {
      const imgUrl = images[o] && images[o][0];
      const thumb = imgUrl ? `<img class="option-picker-thumb" src="${imgUrl}" alt="" loading="lazy">` : "";
      return `<button type="button" class="option-picker-item${o === current ? " selected" : ""}" data-value="${o}">${thumb}<span>${o}</span></button>`;
    })
    .join("");
  if (!q && visible === defaultOptions && options.length > defaultOptions.length) {
    html += `<button type="button" class="option-picker-show-all">Show all ${options.length} exercises &darr;</button>`;
  }
  opList.innerHTML = html;
}

function openOptionPicker(container) {
  const options = container.__options || [];
  if (!options.length) return;
  opActiveContainer = container;
  opTitle.textContent = container.dataset.title || "Select";
  opSearch.value = "";
  renderOptionPickerList(container);
  opModal.hidden = false;
  // Deliberately not auto-focusing the search box here - on mobile that
  // pops the keyboard open the instant the picker appears, covering half
  // the list before the user has asked to type anything. It only opens now
  // when they actually tap the search field themselves.
}

opSearch.addEventListener("input", () => {
  if (!opActiveContainer) return;
  renderOptionPickerList(opActiveContainer, { query: opSearch.value });
});

function closeOptionPicker() {
  opModal.hidden = true;
  opActiveContainer = null;
}

opList.addEventListener("click", (e) => {
  if (!opActiveContainer) return;
  if (e.target.closest(".option-picker-show-all")) {
    renderOptionPickerList(opActiveContainer, { showAll: true });
    return;
  }
  const btn = e.target.closest(".option-picker-item");
  if (!btn) return;
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

// ---------------- PR (personal record) detection ----------------
// Fetched once per page load and cached - a PR only needs to beat whatever
// was already saved before this session. Invalidated after a successful
// exercise-log submit so a second logging session later the same page load
// sees the fresh max instead of a stale cache.
let exerciseHistoryCache = null;
async function getExerciseHistory() {
  if (!exerciseHistoryCache) {
    try {
      exerciseHistoryCache = await api.get("/api/exercise-log");
    } catch (err) {
      exerciseHistoryCache = [];
    }
  }
  return exerciseHistoryCache;
}

// Dedupes so nudging a stepper back and forth across the same record value
// doesn't toast every time - keyed by exercise+value, cleared only on a
// full page load (a fresh session for PR-spotting purposes).
const notifiedPRs = new Set();

// PR metric is weight for strength sets, duration for cardio sets - Level
// is a subjective 1-10 rating and Speed only exists for some exercises, so
// duration is the one metric every cardio exercise actually has.
async function checkForPR(block, row, exerciseName, isCardio) {
  if (!exerciseName) return;
  const metricKey = isCardio ? "duration_minutes" : "weight_kg";
  const inputSelector = isCardio ? ".set-duration" : ".set-weight";
  const value = parseFloat(row.querySelector(inputSelector)?.value);
  if (isNaN(value) || value <= 0) { delete row.dataset.prValue; return; }

  const history = await getExerciseHistory();
  let priorBest = 0;
  let hasHistory = false;
  history.forEach(x => {
    if (x.exercise === exerciseName && x[metricKey] != null) {
      hasHistory = true;
      priorBest = Math.max(priorBest, x[metricKey]);
    }
  });
  if (!hasHistory) { delete row.dataset.prValue; return; } // nothing to beat yet - logging an exercise for the first time isn't a "PR"

  // Also beat any other not-yet-saved set for the same exercise already
  // entered in this block this session, not just what's already on the
  // server, so the 2nd set of a brand new PR streak isn't wrongly re-toasted.
  block.querySelectorAll(".set-row").forEach(r => {
    if (r === row) return;
    const v = parseFloat(r.querySelector(inputSelector)?.value);
    if (!isNaN(v)) priorBest = Math.max(priorBest, v);
  });

  if (value > priorBest) {
    // Marks this row as currently holding a recorded PR - guardPrEdit()
    // uses this to require confirmation before letting the value change
    // again, so an accidental later edit can't silently corrupt it.
    row.dataset.prValue = value;
    const dedupeKey = `${exerciseName}:${value}`;
    if (!notifiedPRs.has(dedupeKey)) {
      notifiedPRs.add(dedupeKey);
      toast(`You just hit a new PR for ${exerciseName} exercise!`);
    }
  } else {
    delete row.dataset.prValue;
  }
}

// If this row's current field value was already recorded as a PR, changing
// it needs confirmation first - silently editing it away could corrupt the
// PR history (e.g. accidentally bumping a real 50kg PR to a typo'd 52.5kg).
// Returns true if it's fine to proceed with the change.
async function guardPrEdit(row, newValue, unit) {
  const prValue = row.dataset.prValue;
  if (prValue == null || parseFloat(prValue) === newValue) return true;
  const ok = await confirmModal(
    `This set was recorded as your new PR of ${prValue}${unit} — change it to ${newValue}${unit}?`,
    "Yes, Change It"
  );
  if (ok) delete row.dataset.prValue; // re-evaluated fresh by checkForPR right after
  return ok;
}

function updateSetColumnsLabel(block) {
  const isCardio = block.dataset.exerciseType === "cardio";
  const levelOverride = EXERCISE_LEVEL_OVERRIDES[block.querySelector(".ex-exercise").value];
  const cols = block.querySelectorAll(".set-columns-label-col");
  cols[0].textContent = isCardio ? "Duration (min)" : "Reps";
  cols[1].textContent = isCardio ? (levelOverride ? levelOverride.label : "Level") : "Weight (kg)";
}

// Rebuilds the sets list when the currently-selected exercise's Level
// override (see EXERCISE_LEVEL_OVERRIDES) changes - e.g. Treadmill Walk
// swaps the generic 1-10 intensity Level for an actual Speed reading, so
// switching to/from it needs a different 2nd cardio field, not just a
// different label. Same rebuild-only-when-needed guard as
// applyExerciseType/applyExtraField.
function applyLevelOverride(block) {
  const levelOverride = EXERCISE_LEVEL_OVERRIDES[block.querySelector(".ex-exercise").value];
  const prevKey = block.dataset.levelOverrideKey || "";
  const newKey = levelOverride ? levelOverride.key : "";
  block.dataset.levelOverrideKey = newKey;
  updateSetColumnsLabel(block);
  if (newKey === prevKey) return;
  const hadSets = block.querySelectorAll(".set-row").length > 0;
  block.querySelector(".ex-sets").innerHTML = "";
  if (hadSets) addSetRow(block);
}

// Adds/removes the 3rd "extra field" label column (e.g. "Inclination (%)")
// next to Reps/Weight or Duration/Level, keeping it in sync with whether
// the currently-selected exercise has one (see EXERCISE_EXTRA_FIELDS).
function updateSetColumnsExtraLabel(block) {
  const extraField = EXERCISE_EXTRA_FIELDS[block.querySelector(".ex-exercise").value];
  const label = block.querySelector(".set-columns-label");
  let extraCol = label.querySelector(".set-columns-label-extra");
  label.classList.toggle("has-extra", !!extraField);
  if (extraField) {
    if (!extraCol) {
      extraCol = document.createElement("span");
      extraCol.className = "set-columns-label-col set-columns-label-extra";
      label.appendChild(extraCol);
    }
    extraCol.textContent = extraField.label;
  } else if (extraCol) {
    extraCol.remove();
  }
}

// Rebuilds the sets list when the currently-selected exercise's extra field
// (see EXERCISE_EXTRA_FIELDS) changes - e.g. switching from Step Machine (no
// extra field) to Treadmill Walk (Inclination) or back. Only rebuilds when
// that actually changes, same guard as applyExerciseType, so switching
// between two exercises that both have (or both lack) an extra field never
// throws away sets already entered.
function applyExtraField(block) {
  const extraField = EXERCISE_EXTRA_FIELDS[block.querySelector(".ex-exercise").value];
  const prevKey = block.dataset.extraFieldKey || "";
  const newKey = extraField ? extraField.key : "";
  block.dataset.extraFieldKey = newKey;
  updateSetColumnsExtraLabel(block);
  if (newKey === prevKey) return;
  const hadSets = block.querySelectorAll(".set-row").length > 0;
  block.querySelector(".ex-sets").innerHTML = "";
  if (hadSets) addSetRow(block);
}

function updateSetTypeToggle(block) {
  const type = block.dataset.exerciseType || "strength";
  block.querySelectorAll(".set-type-btn").forEach(btn => btn.classList.toggle("active", btn.dataset.type === type));
}

// Switches a block between "strength" (Reps + Weight) and "cardio"
// (Duration + Level) — e.g. a treadmill has neither reps nor a weight, just
// how long and at what level. Defaults to whatever the picked exercise is
// classified as in the DB, but the Reps/Time toggle next to "Sets" lets a
// user override that per-block for any exercise (someone might want to time
// a set of burpees, or count reps of something classified as cardio). Only
// rebuilds the sets list when the type actually changes, so picking a
// different exercise of the *same* type (Bench Press -> Incline Press)
// never throws away sets already entered.
function applyExerciseType(block, type) {
  const prevType = block.dataset.exerciseType || "strength";
  block.dataset.exerciseType = type;
  updateSetTypeToggle(block);
  if (type === prevType) return;
  updateSetColumnsLabel(block);
  const hadSets = block.querySelectorAll(".set-row").length > 0;
  block.querySelector(".ex-sets").innerHTML = "";
  if (hadSets) addSetRow(block);
}

function addSetRow(block, { copyLast = false } = {}) {
  const setsDiv = block.querySelector(".ex-sets");
  const existingRows = block.querySelectorAll(".set-row");
  const lastRow = existingRows[existingRows.length - 1];
  const isCardio = block.dataset.exerciseType === "cardio";
  const exerciseName = block.querySelector(".ex-exercise").value;
  const levelOverride = EXERCISE_LEVEL_OVERRIDES[exerciseName];
  const extraField = EXERCISE_EXTRA_FIELDS[exerciseName];
  const row = document.createElement("div");
  row.className = "set-row" + (extraField ? " has-extra" : "");
  const extraHtml = extraField ? `
    <div class="stepper set-extra-field" data-step="${extraField.step}" data-min="${extraField.min}">
      <button type="button" class="stepper-btn stepper-minus" aria-label="Decrease ${extraField.label}">&minus;</button>
      <input type="number" class="set-extra stepper-input" min="${extraField.min}" placeholder="${extraField.placeholder || ""}" aria-label="${extraField.label}">
      <button type="button" class="stepper-btn stepper-plus" aria-label="Increase ${extraField.label}">+</button>
    </div>` : "";
  // The 2nd cardio field is normally the generic 1-10 intensity Level
  // wheel-picker, but some exercises (Treadmill Walk) swap it for a plain
  // stepper field instead (e.g. actual Speed) via EXERCISE_LEVEL_OVERRIDES.
  const levelHtml = levelOverride ? `
    <div class="stepper set-speed-field" data-step="${levelOverride.step}" data-min="${levelOverride.min}">
      <button type="button" class="stepper-btn stepper-minus" aria-label="Decrease ${levelOverride.label}">&minus;</button>
      <input type="number" class="set-speed stepper-input" min="${levelOverride.min}" step="${levelOverride.step}" placeholder="${levelOverride.placeholder || ""}" aria-label="${levelOverride.label}">
      <button type="button" class="stepper-btn stepper-plus" aria-label="Increase ${levelOverride.label}">+</button>
    </div>` : `
    <div class="stepper-level set-level-field">
      <button type="button" class="set-wheel-field-btn" aria-label="Set intensity level">
        <span class="set-wheel-field-icon" aria-hidden="true">🔥</span>
        <span class="set-level-field-value set-wheel-field-value placeholder">Set level</span>
      </button>
      <input type="hidden" class="set-level">
    </div>`;
  row.innerHTML = isCardio ? `
    <span class="set-number"></span>
    <div class="stepper-duration set-duration-field">
      <button type="button" class="set-wheel-field-btn" aria-label="Set duration">
        <span class="set-wheel-field-icon" aria-hidden="true">⏱️</span>
        <span class="set-duration-field-value set-wheel-field-value placeholder">Set duration</span>
      </button>
      <input type="hidden" class="set-duration">
    </div>
    ${levelHtml}
    ${extraHtml}
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
      <button type="button" class="set-bodyweight-btn" aria-label="No added weight - bodyweight only">BW</button>
    </div>
    ${extraHtml}
    <button type="button" class="set-remove">✕</button>`;
  if (isCardio) {
    initSetDurationField(row.querySelector(".set-duration-field"));
    if (!levelOverride) initSetLevelField(row.querySelector(".set-level-field"));
  }
  if (copyLast && lastRow) {
    if (isCardio) {
      setSetDurationValue(row, lastRow.querySelector(".set-duration")?.value || "");
      if (levelOverride) {
        row.querySelector(".set-speed").value = lastRow.querySelector(".set-speed")?.value || "";
      } else {
        setSetLevelValue(row, lastRow.querySelector(".set-level")?.value || "");
      }
    } else {
      row.querySelector(".set-reps").value = lastRow.querySelector(".set-reps")?.value || "";
      row.querySelector(".set-weight").value = lastRow.querySelector(".set-weight")?.value || "";
    }
    if (extraField) {
      row.querySelector(".set-extra").value = lastRow.querySelector(".set-extra")?.value || "";
    }
  }
  row.querySelectorAll(".stepper").forEach(initStepper);
  if (!isCardio) {
    const weightInput = row.querySelector(".set-weight");
    const bwBtn = row.querySelector(".set-bodyweight-btn");
    const syncBodyweightBtn = () => bwBtn.classList.toggle("active", weightInput.value === "0");
    bwBtn.addEventListener("click", () => {
      weightInput.value = bwBtn.classList.contains("active") ? "" : "0";
      weightInput.dispatchEvent(new Event("input", { bubbles: true }));
    });
    syncBodyweightBtn();
    // Debounced so nudging the stepper's +/- buttons repeatedly (each one
    // fires its own "input" event) only checks once the value settles,
    // instead of once per click on the way up.
    weightInput.addEventListener("input", () => {
      syncBodyweightBtn();
      clearTimeout(weightInput.__prTimer);
      weightInput.__prTimer = setTimeout(async () => {
        const newValue = parseFloat(weightInput.value);
        if (isNaN(newValue)) return;
        const proceed = await guardPrEdit(row, newValue, "kg");
        if (!proceed) {
          // Revert without dispatching "input" - that would just re-enter
          // this same debounce loop. "change" still lets the delegated
          // draft-autosave listener pick up the reverted value.
          weightInput.value = row.dataset.prValue;
          weightInput.dispatchEvent(new Event("change", { bubbles: true }));
          return;
        }
        checkForPR(block, row, block.querySelector(".ex-exercise").value, false);
      }, 500);
    });
  }
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
  // "reps" is a short, easily-mistranscribed word — speech recognizers
  // commonly render it as "wraps", "raps", or "repetitions" instead, so this
  // accepts those too rather than requiring an exact match. Both word orders
  // are covered ("20 reps" and "reps 20"), same as the weight pattern above.
  const REPS_WORD = "reps?|rep(?:')?s|repetitions?|repeats?|wraps?|raps?";
  const repsMatch = t.match(new RegExp(`(\\d+(?:\\.\\d+)?)\\s*(?:${REPS_WORD})\\b`))
    || t.match(new RegExp(`(?:${REPS_WORD})\\D{0,10}?(\\d+(?:\\.\\d+)?)`));
  let reps = repsMatch ? Math.round(parseFloat(repsMatch[1])) : null;
  if (reps == null) {
    // No recognizable reps keyword at all — fall back to the first number in
    // the phrase that wasn't already claimed as the weight.
    const nums = [...t.matchAll(/\d+(?:\.\d+)?/g)].map(m => parseFloat(m[0]));
    const candidate = nums.find(n => n !== weight);
    if (candidate != null) reps = Math.round(candidate);
  }
  return { reps, weight };
}

// Merges parseFn's reading of each speech-recognition alternative, field by
// field, always trusting the earliest (highest-confidence) alternative that
// answered a given field and never letting a later one override it - only
// used to fill in whatever the top alternative left blank. Picking whichever
// alternative looked "most complete" (an earlier version of this function)
// backfired on noisier phone-mic audio: a low-confidence alternative that
// happened to parse cleanly, even wrongly, would win over a mostly-correct
// top alternative just for being more "complete", which made results worse
// on a phone than doing nothing beyond alternative #1 at all.
function bestSpeechParse(results, parseFn) {
  let merged = null;
  for (let i = 0; i < results.length; i++) {
    const parsed = parseFn(results[i].transcript);
    if (!merged) {
      merged = parsed;
    } else {
      for (const key in parsed) {
        if (merged[key] == null && parsed[key] != null) merged[key] = parsed[key];
      }
    }
    if (Object.values(merged).every(v => v != null)) break;
  }
  return merged || parseFn(results[0]?.transcript || "");
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
    // >1 so a mis-transcribed "reps" in the top guess can still be caught by
    // checking the recognizer's other candidate transcripts (bestSpeechParse
    // below) instead of failing outright on whichever one happened to be
    // ranked first. Kept small, not maxed out - alternatives past the first
    // couple are usually low-confidence noise on a phone mic, and
    // bestSpeechParse only consults them to fill in a field the top
    // alternative missed entirely, not to second-guess one it already got.
    recognition.maxAlternatives = 3;

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
      // Force the mic to release the moment we have a final result instead
      // of waiting on the browser's own end-of-speech detection - on iOS
      // Safari that detection can lag well behind the result event, so the
      // "browser is listening" indicator stays lit even though we're done
      // with it.
      try { recognition.stop(); } catch (err) { /* already stopped */ }
      const transcript = e.results[0][0].transcript;
      const isCardio = block.dataset.exerciseType === "cardio";
      if (isCardio) {
        const { duration, level } = bestSpeechParse(e.results[0], parseSpokenCardioSet);
        if (duration == null && level == null) {
          toast(`Didn't catch that: "${transcript}"`);
          return;
        }
        const targetRow = addSetRow(block);
        if (duration != null) setSetDurationValue(targetRow, duration);
        if (level != null) setSetLevelValue(targetRow, level);
        const parts = [duration != null ? `${duration} min` : null, level != null ? `level ${level}` : null].filter(Boolean);
        toast(`Added set: ${parts.join(", ")}`);
        if (duration != null) checkForPR(block, targetRow, block.querySelector(".ex-exercise").value, true);
        return;
      }
      const { reps, weight } = bestSpeechParse(e.results[0], parseSpokenSet);
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

// Dictate-a-note button on the shared per-exercise note field. Mirrors
// initVoiceSetButton's pattern (safety timer, listening/disabled state) but
// just appends the transcript to the note text instead of parsing it.
function initNoteMicButton(block) {
  const btn = block.querySelector(".note-mic-btn");
  const input = block.querySelector(".ex-notes");
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

    const safetyTimer = setTimeout(() => {
      try { recognition.stop(); } catch (err) { /* already stopped */ }
    }, 8000);

    recognition.addEventListener("result", (e) => {
      // See initVoiceSetButton - stop right away so the mic indicator
      // doesn't linger on iOS Safari after we've already got our result.
      try { recognition.stop(); } catch (err) { /* already stopped */ }
      const transcript = e.results[0][0].transcript;
      input.value = input.value ? `${input.value} ${transcript}` : transcript;
      input.dispatchEvent(new Event("input", { bubbles: true }));
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

// One-off fields that only apply to a single exercise (e.g. treadmill
// incline) - stored in the same per-set `attributes` JSON as everything
// else instead of a dedicated column (see docs/eav-example.md). Rendered as
// a 3rd per-set field alongside Reps/Weight or Duration/Level (see
// addSetRow) so it varies per set just like those do. Add more entries
// here as new one-off fields come up.
const EXERCISE_EXTRA_FIELDS = {
  "Treadmill Walk": { key: "inclination_percent", label: "Inclination (%)", step: 1, min: 0, placeholder: "0" },
};

// Swaps the generic 1-10 intensity "Level" wheel-picker (the normal 2nd
// cardio field) for a plain stepper field on exercises where "Level"
// doesn't make sense - Treadmill Walk cares about actual Speed, not an
// arbitrary intensity rating. Also stored in the per-set `attributes` JSON,
// same mechanism as EXERCISE_EXTRA_FIELDS.
const EXERCISE_LEVEL_OVERRIDES = {
  "Treadmill Walk": { key: "speed_kmh", label: "Speed (km/h)", step: 0.5, min: 0, placeholder: "0" },
};

async function onBlockMuscleChange(block) {
  const muscle = block.querySelector(".ex-muscle").value;
  const exField = block.querySelector(".ex-exercise-field");
  if (!muscle) {
    block.__exerciseTypes = {};
    setOptionFieldOptions(exField, [], { emptyText: "Pick a muscle group first" });
    applyExerciseType(block, "strength");
    applyExtraField(block);
    applyLevelOverride(block);
    return;
  }
  const exercises = await api.get(`/api/exercises-by-muscle/${encodeURIComponent(muscle)}`);
  block.__exerciseTypes = Object.fromEntries(exercises.map(ex => [ex.exercise, ex.type]));
  const exerciseImages = Object.fromEntries(exercises.map(ex => [ex.exercise, ex.images]));
  // setOptionFieldOptions resets the exercise value (silently, no "change"
  // event) if it's not one of the new muscle's exercises - so the extra
  // field needs updating here too, not just from the exercise dropdown's
  // own change handler below, or switching away from Treadmill Walk would
  // leave a stale Inclination column showing.
  setOptionFieldOptions(exField, exercises.map(ex => ex.exercise), {
    emptyText: "No exercises for this muscle yet",
    images: exerciseImages,
    defaultOptions: exercises.filter(ex => ex.curated).map(ex => ex.exercise),
  });
  // Best guess before a specific exercise is picked (almost everything
  // under "Cardio" is duration+level) — the exercise dropdown's own change
  // handler below corrects this once a specific exercise is chosen.
  applyExerciseType(block, muscle === "Cardio" ? "cardio" : "strength");
  applyExtraField(block);
  applyLevelOverride(block);
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
      <div class="sets-header">
        <label>Sets</label>
        <div class="set-type-toggle" role="group" aria-label="How to log sets">
          <button type="button" class="set-type-btn" data-type="strength">Reps</button>
          <button type="button" class="set-type-btn" data-type="cardio">Time</button>
        </div>
      </div>
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
    </div>
    <label class="full">Notes for this exercise
      <div class="note-field">
        <input type="text" class="ex-notes" placeholder="optional">
        <button type="button" class="note-mic-btn secondary" aria-label="Dictate note" title="Speak your note">🎤</button>
      </div>
    </label>`;

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
    applyExtraField(block);
    applyLevelOverride(block);
  });
  block.querySelector(".add-set").addEventListener("click", () => addSetRow(block));
  block.querySelector(".add-set-same").addEventListener("click", () => addSetRow(block, { copyLast: true }));
  block.querySelectorAll(".set-type-btn").forEach(btn => {
    btn.addEventListener("click", () => applyExerciseType(block, btn.dataset.type));
  });
  updateSetTypeToggle(block);
  initVoiceSetButton(block);
  initNoteMicButton(block);
  block.querySelector(".exercise-remove").addEventListener("click", () => {
    block.remove();
    renumberExerciseBlocks();
    saveExerciseDraft();
  });

  exercisesContainer.appendChild(block);
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
    const exerciseName = block.querySelector(".ex-exercise").value;
    const levelOverride = EXERCISE_LEVEL_OVERRIDES[exerciseName];
    const extraField = EXERCISE_EXTRA_FIELDS[exerciseName];
    const notes = block.querySelector(".ex-notes").value;
    return {
      muscle_group: block.querySelector(".ex-muscle").value,
      exercise: exerciseName,
      sets: [...block.querySelectorAll(".set-row")].map((row, i) => {
        const set = isCardio ? {
          duration_minutes: parseFloat(row.querySelector(".set-duration").value) || null,
          ...(levelOverride
            ? { [levelOverride.key]: parseFloat(row.querySelector(".set-speed").value) || null }
            : { intensity_level: parseInt(row.querySelector(".set-level").value, 10) || null }),
        } : {
          reps: parseInt(row.querySelector(".set-reps").value, 10) || null,
          weight_kg: parseFloat(row.querySelector(".set-weight").value) || null,
        };
        if (extraField) {
          const v = parseFloat(row.querySelector(".set-extra").value);
          if (!isNaN(v)) set[extraField.key] = v;
        }
        // One note per exercise, not per set - only the first set carries
        // it (each exercise_log row still has its own `notes` column, but
        // the rest are just left blank rather than duplicating the text).
        if (i === 0) set.notes = notes;
        return set;
      }),
    };
  });
  if (!(await confirmModal(`Do you want to save these exercises for ${date}?`))) {
    return;
  }
  try {
    await api.post("/api/exercise-log", { date, exercises });
    exerciseHistoryCache = null; // stale after this submit - refetch next time a PR check needs it
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
let historyPage = 0; // 0 = this calendar week, 1 = last week, etc.
let historyPhaseFilter = null; // null = All, else a CYCLE_PHASES key

// Monday-start week containing dateStr, as a local midnight Date.
function weekStartDate(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  const day = (d.getDay() + 6) % 7; // Mon=0 ... Sun=6
  d.setDate(d.getDate() - day);
  return d;
}

function weekIndexFor(dateStr) {
  const msPerWeek = 7 * 86400000;
  return Math.round((weekStartDate(todayStr) - weekStartDate(dateStr)) / msPerWeek);
}

function formatWeekRangeLabel(page) {
  const start = weekStartDate(todayStr);
  start.setDate(start.getDate() - page * 7);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  const fmt = d => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return page === 0 ? `This Week (${fmt(start)} – ${fmt(end)})` : `${fmt(start)} – ${fmt(end)}`;
}

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
    <div class="energy-field" data-compact>
      <button type="button" class="energy-field-btn">
        <span class="energy-field-value${info ? "" : " placeholder"}">${formatEnergyCompact(value)}</span>
        <span class="energy-field-icon" aria-hidden="true">⚡</span>
      </button>
      <input type="hidden" class="${cls}" value="${value || ""}">
    </div>`;
}

function formatMuscles(muscles) {
  return muscles ? muscles.split(",").join(", ") : "";
}

function workoutRowView(w) {
  const phase = cyclePhaseForDate(w.date);
  const dot = phase ? `<span class="phase-dot" style="background:${phase.color}" title="${phase.label}"></span>` : "";
  return `
    <tr class="clickable-row" data-date="${w.date}" data-id="${w.id}">
      <td data-label="Date"><span class="date-with-phase">${dot}${w.date}</span></td><td data-label="Muscles Targeted">${formatMuscles(w.muscles)}</td><td data-label="Energy Level">${w.energy_level ?? ""}</td><td data-label="Notes">${w.notes || ""}</td>
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

// Doubles as both the phase-color legend and the history filter: each pill
// is clickable, filters the table to that phase, and shows which filter
// (if any) is currently active - one control instead of a legend plus a
// separate filter dropdown.
function renderPhaseLegend() {
  const legend = document.getElementById("workout-log-phase-legend");
  if (!currentUser || !currentUser.last_period_date) {
    legend.hidden = true;
    return;
  }
  legend.hidden = false;
  const allPill = `<button type="button" class="phase-legend-item phase-filter-btn${historyPhaseFilter === null ? " active" : ""}" data-phase="">All</button>`;
  const phasePills = CYCLE_PHASES.map(p =>
    `<button type="button" class="phase-legend-item phase-filter-btn${historyPhaseFilter === p.key ? " active" : ""}" data-phase="${p.key}"><span class="phase-dot" style="background:${p.color}"></span>${p.label}</button>`
  ).join("");
  legend.innerHTML = allPill + phasePills;
  legend.querySelectorAll(".phase-filter-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      historyPhaseFilter = btn.dataset.phase || null;
      renderWorkoutTable();
    });
  });
}

function renderWorkoutTable() {
  const pageWorkouts = historyPhaseFilter
    ? currentWorkouts.filter(w => cyclePhaseForDate(w.date)?.key === historyPhaseFilter)
    : currentWorkouts.filter(w => weekIndexFor(w.date) === historyPage);
  const wBody = document.querySelector("#table-workout-log tbody");
  wBody.innerHTML = pageWorkouts.map(workoutRowView).join("");
  bindWorkoutRowEvents();
  renderPhaseLegend();

  document.getElementById("history-pager").hidden = !!historyPhaseFilter;
  if (!historyPhaseFilter) renderHistoryPager();

  const emptyEl = document.getElementById("history-empty");
  if (historyPhaseFilter && pageWorkouts.length === 0) {
    const phase = CYCLE_PHASES.find(p => p.key === historyPhaseFilter);
    emptyEl.textContent = `No workouts logged during your ${phase.label} yet.`;
    emptyEl.hidden = false;
  } else {
    emptyEl.hidden = true;
  }
}

function renderHistoryPager() {
  const maxPage = currentWorkouts.length
    ? Math.max(...currentWorkouts.map(w => weekIndexFor(w.date)))
    : 0;
  document.querySelector("#history-pager .history-pager-label").textContent = formatWeekRangeLabel(historyPage);
  document.getElementById("history-pager-newer").disabled = historyPage === 0;
  document.getElementById("history-pager-older").disabled = historyPage >= maxPage;
}

document.getElementById("history-pager-newer").addEventListener("click", () => {
  if (historyPage === 0) return;
  historyPage--;
  renderWorkoutTable();
});
document.getElementById("history-pager-older").addEventListener("click", () => {
  historyPage++;
  renderWorkoutTable();
});

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
  historyPage = 0;
  historyPhaseFilter = null;
  currentWorkouts = await api.get("/api/workout-log");
  renderWorkoutTable();
}

// ---- Your Performance tab: PR progression chart ----
const PERF_CHART_W = 600;
const PERF_CHART_H = 260;
const PERF_PAD = { left: 46, right: 16, top: 20, bottom: 30 };

function svgEl(tag, attrs) {
  const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const k in attrs) el.setAttribute(k, attrs[k]);
  return el;
}

// Illustrative relative hormone levels (0-100, each hormone scaled to its
// own cycle peak - NOT a shared concentration scale, since estradiol/
// progesterone/testosterone are measured in totally different units and
// magnitudes) across a standard 28-day cycle. Shaped from the qualitative
// patterns described in:
//  - Reed BG, Carr BR, "The Normal Menstrual Cycle and the Control of
//    Ovulation", Endotext (NCBI Bookshelf, NIH), 2018 - estrogen peaks just
//    before ovulation then falls sharply at the LH surge, with a smaller
//    secondary rise in the mid-luteal phase; progesterone stays low through
//    the follicular phase then rises sharply after ovulation, peaking in
//    the mid-luteal phase.
//  - Bui HN et al., "Dynamics of serum testosterone during the menstrual
//    cycle", Steroids, 2013 - testosterone shows only a small, statistically
//    modest periovulatory rise on top of otherwise fairly flat levels
//    (unlike estrogen/progesterone's large swings), so it's drawn far
//    flatter here rather than as a third dramatic peak.
// Not digitized from either paper's figures - hand-shaped to match the
// papers' described curve shape and turning points, not exact data.
const HORMONE_CURVES = {
  estrogen: { color: "#ec6f9b", points: [
    [1, 18], [3, 14], [5, 16], [7, 26], [9, 42], [11, 68], [12, 92], [13, 100],
    [14, 60], [16, 50], [18, 58], [20, 68], [22, 65], [25, 40], [28, 20],
  ] },
  progesterone: { color: "#7c9ff0", points: [
    [1, 8], [5, 6], [9, 6], [13, 8], [14, 10], [16, 35], [18, 65], [20, 90],
    [22, 100], [25, 70], [28, 20],
  ] },
  testosterone: { color: "#34d399", points: [
    [1, 42], [5, 40], [9, 42], [11, 48], [13, 58], [14, 62], [16, 55],
    [18, 48], [20, 44], [22, 42], [25, 40], [28, 42],
  ] },
};

// Standard Catmull-Rom-to-cubic-Bezier conversion (tension 1/6) so the
// hand-picked keyframes above read as one smooth biological curve instead
// of a jagged connect-the-dots line.
function catmullRomPath(pts) {
  if (pts.length < 2) return "";
  let d = `M${pts[0].x},${pts[0].y}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] || p2;
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C${cp1x},${cp1y} ${cp2x},${cp2y} ${p2.x},${p2.y}`;
  }
  return d;
}

function renderHormoneReferenceChart() {
  const svg = document.getElementById("hormone-chart");
  if (!svg) return;
  svg.innerHTML = "";

  const plotLeft = PERF_PAD.left, plotRight = PERF_CHART_W - PERF_PAD.right;
  const plotTop = PERF_PAD.top, plotBottom = PERF_CHART_H - PERF_PAD.bottom;
  const plotW = plotRight - plotLeft, plotH = plotBottom - plotTop;

  const xFor = day => plotLeft + ((day - 1) / 27) * plotW;
  const yFor = v => plotTop + plotH - (v / 100) * plotH;

  // Same phase colors/day-ranges used everywhere else in the app (History
  // phase dots, PR-by-phase breakdown, the phase cards above this chart) -
  // drawn first as translucent bands so the curves render on top of them.
  // Luteal's band is stretched to the plot's right edge rather than to
  // xFor(29) (which doesn't exist - day 28 is the cycle's last day) so it
  // doesn't fall a half-day short of the axis.
  CYCLE_PHASES.forEach(p => {
    const x1 = xFor(p.startDay);
    const x2 = p.key === "luteal" ? plotRight : xFor(p.endDay + 1);
    // Same opacity as the phase-colored area fill on the Your Performance
    // chart (renderPerformanceChart) - 0.1 washed green and cyan into a
    // near-identical dark teal against the black background.
    svg.appendChild(svgEl("rect", { x: x1, y: plotTop, width: x2 - x1, height: plotH, fill: p.color, "fill-opacity": "0.28" }));
  });

  // Y gridlines at 0/50/100 (relative-percent axis, not real units).
  [0, 50, 100].forEach(v => {
    const y = yFor(v);
    svg.appendChild(svgEl("line", { class: "hormone-gridline", x1: plotLeft, x2: plotRight, y1: y, y2: y }));
  });

  // X labels at cycle days 1/7/14/21/28.
  [1, 7, 14, 21, 28].forEach(day => {
    const x = xFor(day);
    const label = svgEl("text", { class: "hormone-axis-label", x, y: PERF_CHART_H - 8, "text-anchor": day === 1 ? "start" : day === 28 ? "end" : "middle" });
    label.textContent = `Day ${day}`;
    svg.appendChild(label);
  });

  Object.values(HORMONE_CURVES).forEach(({ color, points }) => {
    const pts = points.map(([day, v]) => ({ x: xFor(day), y: yFor(v) }));
    svg.appendChild(svgEl("path", { class: "hormone-line", d: catmullRomPath(pts), stroke: color }));
  });

  // Hover anywhere over the plot to see which phase that day falls in -
  // same crosshair-plus-tooltip pattern as the Your Performance chart
  // (renderPerformanceChart), except keyed on day-under-cursor instead of
  // nearest data point, since this chart has no discrete points to snap to.
  const wrap = svg.closest(".hormone-chart-wrap");
  const tooltip = document.getElementById("hormone-tooltip");
  const crosshair = svgEl("line", { class: "hormone-crosshair", x1: 0, x2: 0, y1: plotTop, y2: plotBottom });
  svg.appendChild(crosshair);
  const hitRect = svgEl("rect", { x: plotLeft, y: plotTop, width: plotW, height: plotH, fill: "transparent" });
  svg.appendChild(hitRect);

  function showTooltip(day, clientX, clientY) {
    const phase = cyclePhaseForDay(day);
    tooltip.innerHTML = `<span class="hormone-tooltip-dot" style="background:${phase.color}"></span><span>${phase.label}<span class="hormone-tooltip-day"> — Day ${day}</span></span>`;
    const wrapRect = wrap.getBoundingClientRect();
    tooltip.style.left = `${clientX - wrapRect.left}px`;
    tooltip.style.top = `${clientY - wrapRect.top - 12}px`;
    tooltip.hidden = false;
    crosshair.setAttribute("x1", xFor(day));
    crosshair.setAttribute("x2", xFor(day));
    crosshair.style.opacity = 1;
  }
  function hideTooltip() {
    tooltip.hidden = true;
    crosshair.style.opacity = 0;
  }
  hitRect.addEventListener("pointermove", (e) => {
    const svgRect = svg.getBoundingClientRect();
    const scaleX = PERF_CHART_W / svgRect.width;
    const localX = (e.clientX - svgRect.left) * scaleX;
    const day = Math.min(28, Math.max(1, Math.round(1 + ((localX - plotLeft) / plotW) * 27)));
    showTooltip(day, e.clientX, e.clientY);
  });
  hitRect.addEventListener("pointerleave", hideTooltip);
}
renderHormoneReferenceChart();

// One point per day: the best set logged that day for that exercise (top
// set), not every individual set - so the line reads as "how the exercise
// progressed" rather than a noisy scatter of every rep scheme tried. Same
// weight-vs-duration split as checkForPR(), except an exercise logged both
// ways (rare) picks whichever has more data points rather than showing two
// incompatible units on one chart.
function computeExerciseSeries(history, exerciseName) {
  const rows = history.filter(x => x.exercise === exerciseName);
  const weightCount = rows.filter(x => x.weight_kg != null).length;
  const durationCount = rows.filter(x => x.duration_minutes != null).length;
  const metricKey = durationCount > weightCount ? "duration_minutes" : "weight_kg";
  const unit = metricKey === "weight_kg" ? "kg" : "min";

  const byDate = {};
  rows.forEach(x => {
    const v = x[metricKey];
    if (v == null) return;
    if (!byDate[x.date] || v > byDate[x.date]) byDate[x.date] = v;
  });
  const points = Object.keys(byDate).sort().map(date => ({ date, value: byDate[date] }));
  return { unit, points };
}

// Rounds an axis step to a "clean" number (1/2/5/10 x a power of ten)
// instead of whatever the raw data range happens to divide into.
function niceStep(range) {
  const rough = range / 4;
  const mag = Math.pow(10, Math.floor(Math.log10(rough || 1)));
  const norm = rough / mag;
  let step;
  if (norm < 1.5) step = 1;
  else if (norm < 3) step = 2;
  else if (norm < 7) step = 5;
  else step = 10;
  return step * mag;
}

// Not zero-based on purpose: a strength/cardio PR chart is read for slope
// and position, not filled area, so zooming into the data's actual range
// (with one step of padding above/below) makes real progress visible
// instead of flattening a 30->40kg climb against a 0-40 axis.
function computeYAxis(values) {
  const dataMin = Math.min(...values);
  const dataMax = Math.max(...values);
  const step = niceStep(Math.max(dataMax - dataMin, 1));
  const yMin = Math.max(0, Math.floor(dataMin / step) * step - step);
  let yMax = Math.ceil(dataMax / step) * step + step;
  if (yMax === yMin) yMax = yMin + step;
  return { yMin, yMax, step };
}

function formatPerfDate(dateStr) {
  return new Date(dateStr + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// Color for a single point's date, reusing the same CYCLE_PHASES colors as
// the History phase dots and Your Cycle cards - e.g. a menstrual-phase
// point gets the same pink used everywhere else for "menstrual". Falls
// back to plain accent purple when cycle tracking is off (no phase to
// color by), so the chart still renders sensibly for a user like kohal.
function colorForDate(dateStr) {
  const phase = cyclePhaseForDate(dateStr);
  return phase ? phase.color : "#6d5ef8";
}

function renderPerformanceChart(series) {
  const svg = document.getElementById("perf-chart");
  const wrap = document.getElementById("perf-chart-wrap");
  const tooltip = document.getElementById("perf-tooltip");
  const legendEl = document.getElementById("perf-phase-legend");
  svg.innerHTML = "";
  tooltip.hidden = true;

  const { unit, points } = series;
  if (points.length === 0) { legendEl.hidden = true; return; }

  const plotLeft = PERF_PAD.left, plotRight = PERF_CHART_W - PERF_PAD.right;
  const plotTop = PERF_PAD.top, plotBottom = PERF_CHART_H - PERF_PAD.bottom;
  const plotW = plotRight - plotLeft, plotH = plotBottom - plotTop;

  const { yMin, yMax, step } = computeYAxis(points.map(p => p.value));
  const dates = points.map(p => new Date(p.date + "T00:00:00").getTime());
  const minDate = dates[0], maxDate = dates[dates.length - 1];
  const dateSpan = Math.max(maxDate - minDate, 1);

  const xFor = i => points.length === 1 ? plotLeft + plotW / 2 : plotLeft + ((dates[i] - minDate) / dateSpan) * plotW;
  const yFor = v => plotTop + plotH - ((v - yMin) / (yMax - yMin)) * plotH;

  const segColors = points.map(p => colorForDate(p.date));
  const tracksCycle = points.some(p => cyclePhaseForDate(p.date));

  // Area fill first (bottom of the stack) so the gridlines drawn next
  // still show through the translucent fill instead of hiding under it.
  // One quad per consecutive pair of points (not one shape per phase run) -
  // grouping same-phase points into a single run left a gap wherever a
  // single differently-phased point sat between two runs, since nothing
  // then connected it to its neighbors. Per-segment coloring is always
  // contiguous: every pair of adjacent points gets its own colored quad,
  // and adjacent quads share an edge so there's never a break in the fill.
  for (let i = 0; i < points.length - 1; i++) {
    const x1 = xFor(i), x2 = xFor(i + 1);
    const y1 = yFor(points[i].value), y2 = yFor(points[i + 1].value);
    const d = `M${x1},${plotBottom} L${x1},${y1} L${x2},${y2} L${x2},${plotBottom} Z`;
    svg.appendChild(svgEl("path", { d, fill: segColors[i], "fill-opacity": "0.28", stroke: "none" }));
  }

  // Y gridlines + labels - clean rounded numbers per the mark spec.
  for (let v = yMin; v <= yMax + 0.001; v += step) {
    const y = yFor(v);
    svg.appendChild(svgEl("line", { class: "perf-gridline", x1: plotLeft, x2: plotRight, y1: y, y2: y }));
    const label = svgEl("text", { class: "perf-axis-label", x: plotLeft - 8, y: y + 4, "text-anchor": "end" });
    label.textContent = String(Math.round(v * 10) / 10);
    svg.appendChild(label);
  }

  // X labels: at most 5, evenly spaced by index - never one per point.
  const xTickCount = Math.min(points.length, 5);
  const xTickIndices = new Set();
  for (let i = 0; i < xTickCount; i++) {
    xTickIndices.add(Math.round((i / (xTickCount - 1 || 1)) * (points.length - 1)));
  }
  xTickIndices.forEach(i => {
    const label = svgEl("text", { class: "perf-axis-label", x: xFor(i), y: PERF_CHART_H - 8, "text-anchor": "middle" });
    label.textContent = formatPerfDate(points[i].date);
    svg.appendChild(label);
  });

  // Line: same per-segment coloring as the area fill, for the same
  // never-a-gap reason - each 2-point segment is its own <path>, colored
  // by its starting point, so a lone differently-phased point still
  // connects to both neighbors instead of floating disconnected.
  for (let i = 0; i < points.length - 1; i++) {
    const d = `M${xFor(i)},${yFor(points[i].value)} L${xFor(i + 1)},${yFor(points[i + 1].value)}`;
    svg.appendChild(svgEl("path", { class: "perf-line", d, stroke: segColors[i] }));
  }
  points.forEach((p, i) => {
    svg.appendChild(svgEl("circle", { cx: xFor(i), cy: yFor(p.value), r: 3, fill: segColors[i] }));
  });

  // Direct-label only the two moments that matter - current value and the
  // all-time PR (same point when she's currently at her peak) - never a
  // number on every dot.
  let maxIndex = 0;
  points.forEach((p, i) => { if (p.value > points[maxIndex].value) maxIndex = i; });
  const lastIndex = points.length - 1;

  function drawMarker(i, labelText, labelClass) {
    const cx = xFor(i), cy = yFor(points[i].value);
    svg.appendChild(svgEl("circle", { class: "perf-dot-ring", cx, cy, r: 6 }));
    svg.appendChild(svgEl("circle", { cx, cy, r: 4, fill: segColors[i] }));
    const label = svgEl("text", { class: labelClass, x: cx, y: cy - 14, "text-anchor": "middle" });
    label.textContent = labelText;
    svg.appendChild(label);
  }
  drawMarker(lastIndex, `${points[lastIndex].value} ${unit}`, "perf-value-label");
  if (maxIndex !== lastIndex) drawMarker(maxIndex, `PR: ${points[maxIndex].value} ${unit}`, "perf-pr-label");

  if (tracksCycle) {
    legendEl.hidden = false;
    legendEl.innerHTML = CYCLE_PHASES.map(p =>
      `<span class="phase-legend-item"><span class="phase-dot" style="background:${p.color}"></span>${p.label}</span>`
    ).join("");
  } else {
    legendEl.hidden = true;
  }

  // Hover: crosshair snaps to the nearest point on X; one tooltip shows
  // that point's date + value. The hit target is the whole plot area, not
  // just the 3px dots, so the pointer only has to be roughly on target.
  const crosshair = svgEl("line", { class: "perf-crosshair", x1: 0, x2: 0, y1: plotTop, y2: plotBottom });
  svg.appendChild(crosshair);
  const hitRect = svgEl("rect", { x: plotLeft, y: plotTop, width: plotW, height: plotH, fill: "transparent" });
  svg.appendChild(hitRect);

  function showTooltip(i, clientX, clientY) {
    const p = points[i];
    tooltip.innerHTML = "";
    const valueEl = document.createElement("div");
    valueEl.className = "perf-tooltip-value";
    valueEl.textContent = `${p.value} ${unit}`;
    const dateEl = document.createElement("div");
    dateEl.className = "perf-tooltip-date";
    const phase = cyclePhaseForDate(p.date);
    dateEl.textContent = phase ? `${formatPerfDate(p.date)} — ${phase.label}` : formatPerfDate(p.date);
    tooltip.appendChild(valueEl);
    tooltip.appendChild(dateEl);
    const wrapRect = wrap.getBoundingClientRect();
    tooltip.style.left = `${clientX - wrapRect.left}px`;
    tooltip.style.top = `${clientY - wrapRect.top - 12}px`;
    tooltip.hidden = false;
    crosshair.setAttribute("x1", xFor(i));
    crosshair.setAttribute("x2", xFor(i));
    crosshair.style.opacity = 1;
  }
  function hideTooltip() {
    tooltip.hidden = true;
    crosshair.style.opacity = 0;
  }
  hitRect.addEventListener("pointermove", (e) => {
    const svgRect = svg.getBoundingClientRect();
    const scaleX = PERF_CHART_W / svgRect.width;
    const localX = (e.clientX - svgRect.left) * scaleX;
    let nearest = 0, nearestDist = Infinity;
    points.forEach((p, i) => {
      const d = Math.abs(xFor(i) - localX);
      if (d < nearestDist) { nearestDist = d; nearest = i; }
    });
    showTooltip(nearest, e.clientX, e.clientY);
  });
  hitRect.addEventListener("pointerleave", hideTooltip);
}

// For each exercise, takes whichever metric (weight or duration) has more
// data points - same rule as computeExerciseSeries() - finds its all-time
// best value and the date it was set, then buckets that exercise into
// whichever cycle phase that date falls in. An exercise with no PR date
// falling in a tracked cycle (or logged before cycle tracking was turned
// on) simply doesn't appear in any bucket. An exercise logged only once
// is skipped entirely - same "nothing to beat yet" rule as checkForPR's
// live PR toast, since a lone data point trivially "wins" its own value.
function computePRPhaseBreakdown(history) {
  const byExercise = {};
  history.forEach(x => {
    if (!byExercise[x.exercise]) byExercise[x.exercise] = [];
    byExercise[x.exercise].push(x);
  });

  const byPhase = {};
  CYCLE_PHASES.forEach(p => { byPhase[p.key] = []; });

  Object.keys(byExercise).forEach(name => {
    const rows = byExercise[name];
    const weightCount = rows.filter(x => x.weight_kg != null).length;
    const durationCount = rows.filter(x => x.duration_minutes != null).length;
    const metricKey = durationCount > weightCount ? "duration_minutes" : "weight_kg";
    const metricCount = metricKey === "weight_kg" ? weightCount : durationCount;
    if (metricCount < 2) return;
    const unit = metricKey === "weight_kg" ? "kg" : "min";
    let best = null;
    rows.forEach(x => {
      const v = x[metricKey];
      if (v == null) return;
      if (!best || v > best.value) best = { value: v, date: x.date };
    });
    if (!best) return;
    const phase = cyclePhaseForDate(best.date);
    if (!phase) return;
    byPhase[phase.key].push({ name, unit, value: best.value });
  });

  return byPhase;
}

// A horizontal bar per phase (count of exercises whose all-time PR landed
// in that phase) is the right form for "compare a count across a few
// categories" - a line chart is for trend over time, not this. Bar length
// is relative to the phase with the most PRs; the exercise names ride
// along underneath each bar since "how many" alone doesn't answer "which
// ones" - the actual question being asked.
function renderPRPhaseBreakdown(history) {
  const byPhase = computePRPhaseBreakdown(history);
  const totalCount = Object.values(byPhase).reduce((sum, arr) => sum + arr.length, 0);

  const emptyEl = document.getElementById("prphase-empty");
  const contentEl = document.getElementById("prphase-content");
  if (totalCount === 0) {
    emptyEl.hidden = false;
    contentEl.hidden = true;
    return;
  }
  emptyEl.hidden = true;
  contentEl.hidden = false;

  const maxCount = Math.max(...CYCLE_PHASES.map(p => byPhase[p.key].length), 1);
  contentEl.innerHTML = CYCLE_PHASES.map(p => {
    const items = byPhase[p.key];
    const pct = items.length ? Math.max((items.length / maxCount) * 100, 6) : 2;
    const names = items.length
      ? items.map(it => `${it.name} (${it.value} ${it.unit})`).join(", ")
      : "No PRs yet";
    return `
      <div class="prphase-row">
        <div class="prphase-row-top">
          <span class="prphase-name"><span class="phase-dot" style="background:${p.color}"></span>${p.label}</span>
          <span class="prphase-count">${items.length} PR${items.length === 1 ? "" : "s"}</span>
        </div>
        <div class="prphase-bar-track">
          <div class="prphase-bar-fill" style="width:${pct}%; background:${p.color};"></div>
        </div>
        <p class="prphase-exercises">${names}</p>
      </div>`;
  }).join("");
}

async function renderPerformanceTab() {
  const history = await getExerciseHistory();
  const exercises = [...new Set(history.map(x => x.exercise))].sort();

  const emptyEl = document.getElementById("perf-empty");
  const contentEl = document.getElementById("perf-content");
  if (exercises.length === 0) {
    emptyEl.hidden = false;
    contentEl.hidden = true;
  } else {
    emptyEl.hidden = true;
    contentEl.hidden = false;

    const field = document.querySelector(".perf-exercise-field");
    setOptionFieldOptions(field, exercises);
    const currentValue = field.querySelector("input[type=hidden]").value;
    const selected = exercises.includes(currentValue) ? currentValue : exercises[0];
    setOptionFieldValue(field, selected);
    renderPerformanceChart(computeExerciseSeries(history, selected));
  }
  renderPRPhaseBreakdown(history);
}

initOptionField(document.querySelector(".perf-exercise-field"));
document.getElementById("perf-exercise-value").addEventListener("change", async (e) => {
  const history = await getExerciseHistory();
  renderPerformanceChart(computeExerciseSeries(history, e.target.value));
});

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
      notes: block.querySelector(".ex-notes").value,
      sets: [...block.querySelectorAll(".set-row")].map(row => {
        // levelValue holds whichever the 2nd cardio field currently is
        // (the generic Level wheel-picker, or a per-exercise override like
        // Speed) - restoreDraft figures out which one to write back to the
        // same way, based on what addSetRow actually rendered for it.
        const s = isCardio ? {
          duration_minutes: row.querySelector(".set-duration").value,
          levelValue: (row.querySelector(".set-speed") || row.querySelector(".set-level")).value,
        } : {
          reps: row.querySelector(".set-reps").value,
          weight_kg: row.querySelector(".set-weight").value,
        };
        const extraInput = row.querySelector(".set-extra");
        if (extraInput) s.extraValue = extraInput.value;
        return s;
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
          block.dataset.levelOverrideKey = (EXERCISE_LEVEL_OVERRIDES[ex.exercise] || {}).key || "";
          updateSetColumnsLabel(block);
          updateSetTypeToggle(block);
          block.dataset.extraFieldKey = (EXERCISE_EXTRA_FIELDS[ex.exercise] || {}).key || "";
          updateSetColumnsExtraLabel(block);
          block.querySelector(".ex-notes").value = ex.notes || "";
          const isCardio = block.dataset.exerciseType === "cardio";
          block.querySelector(".ex-sets").innerHTML = "";
          const sets = ex.sets && ex.sets.length ? ex.sets : [{}];
          sets.forEach(() => addSetRow(block));
          const rows = block.querySelectorAll(".set-row");
          sets.forEach((s, i) => {
            if (isCardio) {
              setSetDurationValue(rows[i], s.duration_minutes || "");
              const speedInput = rows[i].querySelector(".set-speed");
              if (speedInput) speedInput.value = s.levelValue || "";
              else setSetLevelValue(rows[i], s.levelValue || "");
            } else {
              rows[i].querySelector(".set-reps").value = s.reps || "";
              rows[i].querySelector(".set-weight").value = s.weight_kg || "";
            }
            const extraInput = rows[i].querySelector(".set-extra");
            if (extraInput && s.extraValue != null) extraInput.value = s.extraValue;
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

