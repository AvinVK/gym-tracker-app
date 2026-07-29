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
// restore) is complete.
const DRAFT_KEY = "gymtracker-draft-v1";
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

// ---------------- Onboarding ----------------
let currentUser = null;

function showGreeting(name) {
  document.getElementById("user-greeting-text").textContent = `Hi, ${name}`;
  document.getElementById("user-menu").hidden = false;
}

async function checkOnboarding() {
  const user = await api.get("/api/user");
  if (user) {
    currentUser = user;
    showGreeting(user.name);
  } else {
    document.getElementById("onboarding-modal").hidden = false;
  }
}

document.getElementById("form-onboarding").addEventListener("submit", async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const body = Object.fromEntries(fd.entries());
  if (!body.last_period_date) {
    toast("Please select a date");
    return;
  }
  try {
    const res = await api.post("/api/user", body);
    currentUser = { id: res.id, avatar: null, ...body };
    document.getElementById("onboarding-modal").hidden = true;
    showGreeting(body.name);
    toast(`Welcome, ${body.name}!`);
  } catch (err) {
    toast(err.message);
  }
});

checkOnboarding();

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

// ---------------- Custom time picker (12hr UI -> 24hr storage) ----------------
const tpModal = document.getElementById("time-picker-modal");
const tpHoursCol = document.getElementById("tp-hours");
const tpMinutesCol = document.getElementById("tp-minutes");
const tpAmpmCol = document.getElementById("tp-ampm");
let tpActiveContainer = null;
let tpSelected = { hour: null, minute: null, ampm: "AM" };

tpHoursCol.innerHTML = Array.from({ length: 12 }, (_, i) => i + 1)
  .map(h => `<button type="button" class="time-picker-option" data-value="${h}">${h}</button>`).join("");
tpMinutesCol.innerHTML = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, "0"))
  .map(m => `<button type="button" class="time-picker-option" data-value="${m}">${m}</button>`).join("");
tpAmpmCol.innerHTML = ["AM", "PM"]
  .map(a => `<button type="button" class="time-picker-option" data-value="${a}">${a}</button>`).join("");

function to12Hour(h24, m) {
  const h24n = parseInt(h24, 10);
  let h12 = h24n % 12;
  if (h12 === 0) h12 = 12;
  return { h12: String(h12), m, ampm: h24n >= 12 ? "PM" : "AM" };
}

function setTimeFieldValue(container, value) {
  const hidden = container.querySelector("input[type=hidden]");
  const valueEl = container.querySelector(".time-field-value");
  hidden.value = value || "";
  if (value) {
    const { h12, m, ampm } = to12Hour(...value.split(":"));
    valueEl.textContent = `${h12}:${m} ${ampm}`;
    valueEl.classList.remove("placeholder");
  } else {
    valueEl.textContent = "--:-- --";
    valueEl.classList.add("placeholder");
  }
  hidden.dispatchEvent(new Event("change", { bubbles: true }));
}

function highlightTimePickerSelection() {
  tpHoursCol.querySelectorAll(".time-picker-option").forEach(b => b.classList.toggle("selected", b.dataset.value === String(tpSelected.hour)));
  tpMinutesCol.querySelectorAll(".time-picker-option").forEach(b => b.classList.toggle("selected", b.dataset.value === String(tpSelected.minute)));
  tpAmpmCol.querySelectorAll(".time-picker-option").forEach(b => b.classList.toggle("selected", b.dataset.value === tpSelected.ampm));
}

function scrollTimePickerColumn(col, value) {
  const btn = value != null ? [...col.querySelectorAll(".time-picker-option")].find(b => b.dataset.value === String(value)) : null;
  (btn || col.firstElementChild).scrollIntoView({ block: "center" });
}

[tpHoursCol, tpMinutesCol, tpAmpmCol].forEach(col => {
  col.addEventListener("click", (e) => {
    const btn = e.target.closest(".time-picker-option");
    if (!btn) return;
    if (col === tpHoursCol) tpSelected.hour = btn.dataset.value;
    else if (col === tpMinutesCol) tpSelected.minute = btn.dataset.value;
    else tpSelected.ampm = btn.dataset.value;
    highlightTimePickerSelection();
  });
});

function openTimePicker(container) {
  tpActiveContainer = container;
  const hidden = container.querySelector("input[type=hidden]");
  if (hidden.value) {
    const { h12, m, ampm } = to12Hour(...hidden.value.split(":"));
    tpSelected = { hour: h12, minute: m, ampm };
  } else {
    tpSelected = { hour: null, minute: null, ampm: "AM" };
  }
  highlightTimePickerSelection();
  tpModal.hidden = false;
  requestAnimationFrame(() => {
    scrollTimePickerColumn(tpHoursCol, tpSelected.hour);
    scrollTimePickerColumn(tpMinutesCol, tpSelected.minute);
    scrollTimePickerColumn(tpAmpmCol, tpSelected.ampm);
  });
}

function closeTimePicker() {
  tpModal.hidden = true;
  tpActiveContainer = null;
}

document.getElementById("tp-cancel").addEventListener("click", closeTimePicker);
tpModal.addEventListener("click", (e) => { if (e.target === tpModal) closeTimePicker(); });
document.getElementById("tp-done").addEventListener("click", () => {
  if (!tpActiveContainer) return;
  const { hour, minute, ampm } = tpSelected;
  if (hour && minute) {
    let h24 = parseInt(hour, 10) % 12;
    if (ampm === "PM") h24 += 12;
    setTimeFieldValue(tpActiveContainer, `${String(h24).padStart(2, "0")}:${minute}`);
  } else {
    setTimeFieldValue(tpActiveContainer, "");
  }
  closeTimePicker();
});

function initTimeField(container) {
  const btn = container.querySelector(".time-field-btn");
  const hidden = container.querySelector("input[type=hidden]");
  if (hidden.value) setTimeFieldValue(container, hidden.value);
  btn.addEventListener("click", () => openTimePicker(container));
}

document.querySelectorAll("[data-time-field]").forEach(initTimeField);

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

function addSetRow(block) {
  const setsDiv = block.querySelector(".ex-sets");
  const row = document.createElement("div");
  row.className = "set-row";
  row.innerHTML = `
    <span class="set-number"></span>
    <input type="number" class="set-reps" min="1" placeholder="Reps" required>
    <input type="number" step="0.5" class="set-weight" placeholder="Weight (kg)">
    <input type="text" class="set-notes" placeholder="Note for this set (optional)">
    <button type="button" class="set-remove">✕</button>`;
  row.querySelector(".set-remove").addEventListener("click", () => {
    row.remove();
    renumberSets(block);
    saveExerciseDraft();
  });
  setsDiv.appendChild(row);
  renumberSets(block);
  saveExerciseDraft();
}

async function onBlockMuscleChange(block) {
  const muscle = block.querySelector(".ex-muscle").value;
  const exField = block.querySelector(".ex-exercise-field");
  if (!muscle) {
    setOptionFieldOptions(exField, [], { emptyText: "Pick a muscle group first" });
    return;
  }
  const exercises = await api.get(`/api/exercises-by-muscle/${encodeURIComponent(muscle)}`);
  setOptionFieldOptions(exField, exercises.map(ex => ex.exercise), { emptyText: "No exercises for this muscle yet" });
}

function addExerciseBlock() {
  const block = document.createElement("div");
  block.className = "exercise-block grid-form";
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
      <div class="ex-sets"></div>
      <button type="button" class="add-set secondary">+ Add Set</button>
    </div>`;

  block.querySelectorAll("[data-option-field]").forEach(initOptionField);
  populateMuscleSelect(block.querySelector(".ex-muscle-field"));
  block.querySelector(".ex-muscle").addEventListener("change", () => {
    if (restoringDraft) return; // restoreDraft() awaits its own explicit call instead
    onBlockMuscleChange(block);
  });
  block.querySelector(".add-set").addEventListener("click", () => addSetRow(block));
  block.querySelector(".exercise-remove").addEventListener("click", () => {
    block.remove();
    renumberExerciseBlocks();
    saveExerciseDraft();
  });

  exercisesContainer.appendChild(block);
  addSetRow(block);
  renumberExerciseBlocks();
  return block;
}

document.getElementById("exlog-add-exercise").addEventListener("click", addExerciseBlock);
addExerciseBlock();

document.getElementById("form-exercise-log").addEventListener("submit", async (e) => {
  e.preventDefault();
  const date = e.target.elements["date"].value;
  const exercises = [...exercisesContainer.querySelectorAll(".exercise-block")].map(block => ({
    muscle_group: block.querySelector(".ex-muscle").value,
    exercise: block.querySelector(".ex-exercise").value,
    sets: [...block.querySelectorAll(".set-row")].map(row => ({
      reps: parseInt(row.querySelector(".set-reps").value, 10) || null,
      weight_kg: parseFloat(row.querySelector(".set-weight").value) || null,
      notes: row.querySelector(".set-notes").value,
    })),
  }));
  if (!(await confirmModal(`Do you want to save these exercises for ${date}?`))) {
    return;
  }
  try {
    await api.post("/api/exercise-log", { date, exercises });
    toast("Exercises logged");
    e.target.reset();
    exercisesContainer.innerHTML = "";
    addExerciseBlock();

    const workoutForm = document.getElementById("form-workout");
    workoutForm.reset();
    workoutForm.querySelectorAll("input, select, button").forEach(el => el.disabled = false);
    document.getElementById("card-exlog").hidden = true;
    document.getElementById("workout-edit-btn").hidden = true;
    savedWorkoutId = null;
    setDateFieldValue(document.getElementById("workout-date").closest(".date-field"), "");
    setDateFieldValue(document.getElementById("exlog-date").closest(".date-field"), "");
    workoutForm.querySelectorAll(".time-field").forEach(f => setTimeFieldValue(f, ""));
    clearDraft();
  } catch (err) {
    toast(err.message);
  }
});

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
function formatTime12(t) {
  if (!t) return "";
  const [hStr, mStr] = t.split(":");
  let h = parseInt(hStr, 10);
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12;
  if (h === 0) h = 12;
  return `${h}:${mStr} ${ampm}`;
}

function formatDuration(hours) {
  if (hours == null) return "";
  let h = Math.floor(hours);
  let m = Math.round((hours - h) * 60);
  if (m === 60) { h += 1; m = 0; }
  if (h === 0 && m === 0) return "0 mins";
  const parts = [];
  if (h > 0) parts.push(`${h} hr${h !== 1 ? "s" : ""}`);
  if (m > 0) parts.push(`${m} min${m !== 1 ? "s" : ""}`);
  return parts.join(" ");
}

function timeFieldHtml(cls, value) {
  let display = "--:-- --";
  if (value) {
    const { h12, m, ampm } = to12Hour(...value.split(":"));
    display = `${h12}:${m} ${ampm}`;
  }
  return `
    <div class="time-field">
      <button type="button" class="time-field-btn">
        <span class="time-field-value${value ? "" : " placeholder"}">${display}</span>
        <span class="time-field-icon" aria-hidden="true">🕐</span>
      </button>
      <input type="hidden" class="${cls}" value="${value || ""}">
    </div>`;
}

function workoutRowView(w) {
  return `
    <tr class="clickable-row" data-date="${w.date}" data-id="${w.id}">
      <td data-label="Date">${w.date}</td><td data-label="Start">${formatTime12(w.start_time)}</td>
      <td data-label="End">${formatTime12(w.end_time)}</td><td data-label="Duration">${formatDuration(w.duration_hours)}</td><td data-label="Energy Level">${w.energy_level ?? ""}</td><td data-label="Notes">${w.notes || ""}</td>
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
      <td data-label="Start">${timeFieldHtml("edit-start", w.start_time)}</td>
      <td data-label="End">${timeFieldHtml("edit-end", w.end_time)}</td>
      <td data-label="Duration">${formatDuration(w.duration_hours)}</td>
      <td data-label="Energy Level"><input type="number" class="edit-energy" min="1" max="10" value="${w.energy_level ?? ""}"></td>
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
  row.querySelectorAll(".time-field").forEach(initTimeField);
  row.querySelector(".save-btn").addEventListener("click", async (e) => {
    e.stopPropagation();
    const body = {
      date: row.querySelector(".edit-date").value,
      start_time: row.querySelector(".edit-start").value,
      end_time: row.querySelector(".edit-end").value,
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
      <td data-label="Set #">${x.set_number ?? ""}</td><td data-label="Reps">${x.reps ?? ""}</td><td data-label="Weight (kg)">${x.weight_kg ?? ""}</td><td data-label="Notes">${x.notes || ""}</td>
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
function readDraft() {
  try {
    return JSON.parse(localStorage.getItem(DRAFT_KEY));
  } catch {
    return null;
  }
}

function writeDraft(patch) {
  localStorage.setItem(DRAFT_KEY, JSON.stringify({ ...(readDraft() || {}), ...patch }));
}

function clearDraft() {
  localStorage.removeItem(DRAFT_KEY);
}

function collectExerciseBlocksDraft() {
  return [...exercisesContainer.querySelectorAll(".exercise-block")].map(block => ({
    muscle_group: block.querySelector(".ex-muscle").value,
    exercise: block.querySelector(".ex-exercise").value,
    sets: [...block.querySelectorAll(".set-row")].map(row => ({
      reps: row.querySelector(".set-reps").value,
      weight_kg: row.querySelector(".set-weight").value,
      notes: row.querySelector(".set-notes").value,
    })),
  }));
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
      if (w.energy_level) form.querySelector('[name="energy_level"]').value = w.energy_level;
      if (w.notes) form.querySelector('[name="notes"]').value = w.notes;
      if (w.date) setDateFieldValue(document.getElementById("workout-date").closest(".date-field"), w.date);
      const startGroup = form.querySelector('input[name="start_time"]')?.closest(".time-field");
      const endGroup = form.querySelector('input[name="end_time"]')?.closest(".time-field");
      if (startGroup && w.start_time) setTimeFieldValue(startGroup, w.start_time);
      if (endGroup && w.end_time) setTimeFieldValue(endGroup, w.end_time);
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
          block.querySelector(".ex-sets").innerHTML = "";
          const sets = ex.sets && ex.sets.length ? ex.sets : [{}];
          sets.forEach(() => addSetRow(block));
          const rows = block.querySelectorAll(".set-row");
          sets.forEach((s, i) => {
            rows[i].querySelector(".set-reps").value = s.reps || "";
            rows[i].querySelector(".set-weight").value = s.weight_kg || "";
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

// ---------------- Init ----------------
loadMuscleOptions().then(restoreDraft);
