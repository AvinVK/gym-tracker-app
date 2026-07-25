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
  document.getElementById("profile-last-period").value = currentUser.last_period_date || "";
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

function populateMuscleSelect(sel) {
  const current = sel.value;
  sel.innerHTML = `<option value="">Select...</option>` +
    availableMuscles.map(m => `<option value="${m}">${m}</option>`).join("");
  if (availableMuscles.includes(current)) sel.value = current;
}

async function loadMuscleOptions() {
  availableMuscles = await api.get("/api/muscles");
  exercisesContainer.querySelectorAll(".ex-muscle").forEach(populateMuscleSelect);
}

// ---------------- Time selects (12hr UI -> 24hr storage) ----------------
function initTimeSelect(group) {
  const hourSel = group.querySelector(".time-hour");
  const minuteSel = group.querySelector(".time-minute");
  const ampmSel = group.querySelector(".time-ampm");
  const hidden = group.querySelector("input[type=hidden]");

  hourSel.innerHTML = `<option value="">--</option>` +
    Array.from({ length: 12 }, (_, i) => i + 1)
      .map(h => `<option value="${h}">${h}</option>`).join("");
  minuteSel.innerHTML = `<option value="">--</option>` +
    Array.from({ length: 60 }, (_, i) => String(i).padStart(2, "0"))
      .map(m => `<option value="${m}">${m}</option>`).join("");

  function sync() {
    const h = hourSel.value;
    const m = minuteSel.value;
    if (!h || !m) {
      hidden.value = "";
      return;
    }
    let hour24 = parseInt(h, 10) % 12;
    if (ampmSel.value === "PM") hour24 += 12;
    hidden.value = `${String(hour24).padStart(2, "0")}:${m}`;
  }

  [hourSel, minuteSel, ampmSel].forEach(sel => sel.addEventListener("change", sync));
  group.closest("form").addEventListener("reset", () => setTimeout(sync));
}

document.querySelectorAll("[data-time-group]").forEach(initTimeSelect);

// ---------------- Workout Log ----------------
document.getElementById("workout-date").addEventListener("input", (e) => {
  document.getElementById("exlog-date").value = e.target.value;
});

document.getElementById("form-workout").addEventListener("submit", async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const body = Object.fromEntries(fd.entries());
  try {
    await api.post("/api/workout-log", body);
    toast("Workout logged");
    e.target.querySelectorAll("input, select, button").forEach(el => el.disabled = true);
    document.getElementById("card-exlog").hidden = false;
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
    <button type="button" class="set-remove">✕</button>`;
  row.querySelector(".set-remove").addEventListener("click", () => {
    row.remove();
    renumberSets(block);
  });
  setsDiv.appendChild(row);
  renumberSets(block);
}

async function onBlockMuscleChange(block) {
  const muscle = block.querySelector(".ex-muscle").value;
  const exSelect = block.querySelector(".ex-exercise");
  if (!muscle) {
    exSelect.innerHTML = `<option value="">Pick a muscle group first</option>`;
    return;
  }
  const exercises = await api.get(`/api/exercises-by-muscle/${encodeURIComponent(muscle)}`);
  exSelect.innerHTML = exercises.length
    ? exercises.map(ex => `<option value="${ex.exercise}">${ex.exercise}</option>`).join("")
    : `<option value="">No exercises for this muscle yet</option>`;
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
      <select class="ex-muscle" required></select>
    </label>
    <label>Exercise
      <select class="ex-exercise" required>
        <option value="">Pick a muscle group first</option>
      </select>
    </label>
    <div class="full">
      <label>Sets</label>
      <div class="ex-sets"></div>
      <button type="button" class="add-set secondary">+ Add Set</button>
    </div>
    <label class="full">Notes
      <input type="text" class="ex-notes" placeholder="optional">
    </label>`;

  populateMuscleSelect(block.querySelector(".ex-muscle"));
  block.querySelector(".ex-muscle").addEventListener("change", () => onBlockMuscleChange(block));
  block.querySelector(".add-set").addEventListener("click", () => addSetRow(block));
  block.querySelector(".exercise-remove").addEventListener("click", () => {
    block.remove();
    renumberExerciseBlocks();
  });

  exercisesContainer.appendChild(block);
  addSetRow(block);
  renumberExerciseBlocks();
}

document.getElementById("exlog-add-exercise").addEventListener("click", addExerciseBlock);
addExerciseBlock();

document.getElementById("form-exercise-log").addEventListener("submit", async (e) => {
  e.preventDefault();
  const date = e.target.elements["date"].value;
  const exercises = [...exercisesContainer.querySelectorAll(".exercise-block")].map(block => ({
    muscle_group: block.querySelector(".ex-muscle").value,
    exercise: block.querySelector(".ex-exercise").value,
    notes: block.querySelector(".ex-notes").value,
    sets: [...block.querySelectorAll(".set-row")].map(row => ({
      reps: parseInt(row.querySelector(".set-reps").value, 10) || null,
      weight_kg: parseFloat(row.querySelector(".set-weight").value) || null,
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

function workoutRowView(w) {
  return `
    <tr class="clickable-row" data-date="${w.date}" data-id="${w.id}">
      <td>${w.date}</td><td>${formatTime12(w.start_time)}</td>
      <td>${formatTime12(w.end_time)}</td><td>${formatDuration(w.duration_hours)}</td><td>${w.energy_level ?? ""}</td><td>${w.notes || ""}</td>
      <td class="row-actions">
        <button class="edit-btn" data-id="${w.id}">Edit</button>
      </td>
    </tr>`;
}

function workoutRowEdit(w) {
  return `
    <tr data-id="${w.id}">
      <td><input type="date" class="edit-date" value="${w.date}"></td>
      <td><input type="time" class="edit-start" value="${w.start_time || ""}"></td>
      <td><input type="time" class="edit-end" value="${w.end_time || ""}"></td>
      <td>${formatDuration(w.duration_hours)}</td>
      <td><input type="number" class="edit-energy" min="1" max="10" value="${w.energy_level ?? ""}"></td>
      <td><input type="text" class="edit-notes" value="${w.notes || ""}"></td>
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
      <td>${x.muscle_group}</td><td>${x.exercise}</td>
      <td>${x.set_number ?? ""}</td><td>${x.reps ?? ""}</td><td>${x.weight_kg ?? ""}</td><td>${x.notes || ""}</td>
      <td class="row-actions">
        <button class="edit-btn" data-id="${x.id}">Edit</button>
        <button class="del-btn" data-id="${x.id}">Delete</button>
      </td>
    </tr>`;
}

function exerciseRowEdit(x) {
  return `
    <tr data-id="${x.id}">
      <td><input type="text" class="edit-muscle" value="${x.muscle_group}"></td>
      <td><input type="text" class="edit-exercise" value="${x.exercise}"></td>
      <td><input type="number" class="edit-set" value="${x.set_number ?? ""}"></td>
      <td><input type="number" class="edit-reps" value="${x.reps ?? ""}"></td>
      <td><input type="number" step="0.5" class="edit-weight" value="${x.weight_kg ?? ""}"></td>
      <td><input type="text" class="edit-notes" value="${x.notes || ""}"></td>
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

// ---------------- Init ----------------
loadMuscleOptions();
