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
  del: (url) => fetch(url, { method: "DELETE" }),
};

function toast(msg) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), 1800);
}

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
    e.target.reset();
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
  try {
    await api.post("/api/exercise-log", { date, exercises });
    toast("Exercises logged");
    e.target.reset();
    exercisesContainer.innerHTML = "";
    addExerciseBlock();
  } catch (err) {
    toast(err.message);
  }
});

// ---------------- History ----------------
async function loadHistory() {
  const [workouts, exLogs] = await Promise.all([
    api.get("/api/workout-log"),
    api.get("/api/exercise-log"),
  ]);

  const wBody = document.querySelector("#table-workout-log tbody");
  wBody.innerHTML = workouts.map(w => `
    <tr>
      <td>${w.date}</td><td>${w.start_time || ""}</td>
      <td>${w.end_time || ""}</td><td>${w.duration_hours ?? ""}</td><td>${w.energy_level ?? ""}</td><td>${w.notes || ""}</td>
      <td><button class="del-btn" data-id="${w.id}" data-kind="workout">Delete</button></td>
    </tr>`).join("");

  const eBody = document.querySelector("#table-exercise-log tbody");
  eBody.innerHTML = exLogs.map(x => `
    <tr>
      <td>${x.date}</td><td>${x.muscle_group}</td><td>${x.exercise}</td>
      <td>${x.set_number ?? ""}</td><td>${x.reps ?? ""}</td><td>${x.weight_kg ?? ""}</td><td>${x.notes || ""}</td>
      <td><button class="del-btn" data-id="${x.id}" data-kind="exlog">Delete</button></td>
    </tr>`).join("");

  document.querySelectorAll(".del-btn[data-kind]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.id;
      const kind = btn.dataset.kind;
      const url = kind === "workout" ? `/api/workout-log/${id}` : `/api/exercise-log/${id}`;
      await api.del(url);
      toast("Deleted");
      loadHistory();
    });
  });
}

// ---------------- Init ----------------
loadMuscleOptions();
