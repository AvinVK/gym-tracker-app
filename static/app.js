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

// ---------------- Modal scroll lock ----------------
// Background must stay frozen behind any open modal-overlay (exercise
// picker, date picker, etc.) - on iOS Safari the page still rubber-band
// scrolls behind a fixed overlay with just `overflow: hidden` on body, so
// this pins the body in place (position: fixed) instead and restores the
// scroll position on close. Driven by a MutationObserver on the shared
// [hidden] attribute rather than per-modal open/close calls, so it covers
// every current and future .modal-overlay for free.
let modalScrollY = 0;
function updateBodyScrollLock() {
  const anyOpen = !!document.querySelector(".modal-overlay:not([hidden])");
  const locked = document.body.style.position === "fixed";
  if (anyOpen && !locked) {
    modalScrollY = window.scrollY;
    document.body.style.position = "fixed";
    document.body.style.top = `-${modalScrollY}px`;
    document.body.style.width = "100%";
  } else if (!anyOpen && locked) {
    document.body.style.position = "";
    document.body.style.top = "";
    document.body.style.width = "";
    window.scrollTo(0, modalScrollY);
  }
}
new MutationObserver(updateBodyScrollLock).observe(document.body, {
  attributes: true, attributeFilter: ["hidden"], subtree: true,
});

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
        if (hiddenInput.id === "log-date-hidden" && iso !== todayStr) {
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
  // Kept as a no-op-ish helper (the topbar greeting it used to fill no
  // longer exists - the Today screen's own greeting is populated by
  // renderTodayScreen) so callers elsewhere don't need to change.
}

const WEEKDAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

// Cached so the Today screen can re-render (e.g. re-trigger the ring
// animation on every tab entry, see switchTab) without re-fetching.
let latestStreakData = null;

async function refreshStreak() {
  const s = await api.get("/api/streak");
  if (!s || s.error) return;
  latestStreakData = s;

  document.getElementById("streak-info-visits-needed").textContent = s.visits_needed;
  document.getElementById("streak-info-milestone-start").textContent = s.milestone_start;
  document.getElementById("streak-info-milestone-step").textContent = s.milestone_step;
  document.getElementById("streak-info-max-shields").textContent = s.max_shields;

  const powerStat = document.getElementById("cycle-power-stat");
  const hasPeriodDate = !!(currentUser && currentUser.last_period_date);
  powerStat.hidden = !hasPeriodDate || !s.period_power;
  if (hasPeriodDate && s.period_power) {
    document.getElementById("cycle-power-text").textContent =
      `What a Diva! Went ${s.period_power} day${s.period_power === 1 ? "" : "s"} to the gym during periods.`;
  }

  if (document.getElementById("maintab-today").classList.contains("active")) {
    renderTodayStreakCard(false);
  }
}

// Streak ring circumference: 2*PI*46 (see the SVG's r=46 in index.html).
const STREAK_RING_CIRCUMFERENCE = 289;

// animateFromZero: true when the Today screen was just entered (see
// switchTab) - the ring transitions in from 0 per the design spec; false
// for a plain data refresh (e.g. after logging a period), which just jumps
// straight to the current value with no animation.
function renderTodayStreakCard(animateFromZero) {
  const s = latestStreakData;
  const ring = document.getElementById("today-streak-ring-progress");
  const countEl = document.getElementById("today-streak-ring-count");
  const targetEl = document.getElementById("today-streak-ring-target");
  const headlineEl = document.getElementById("today-streak-headline");
  const metaEl = document.getElementById("today-streak-meta");
  const pipsEl = document.getElementById("today-streak-pips");
  if (!s) return;

  const n = Math.max(0, s.visits_needed - s.visits_this_week);
  const headline = n === 0 ? "Streak locked in this week"
    : n === 1 ? "One more visit keeps<br>the streak"
    : `${n} more visits keep<br>the streak`;
  // Grab the (i) button before wiping headlineEl's own innerHTML - it lives
  // inside headlineEl in the source HTML, so overwriting innerHTML first
  // would detach it from the document entirely, and getElementById would
  // never find it again to re-append.
  const infoBtn = document.getElementById("today-streak-info-btn");
  headlineEl.innerHTML = headline + " ";
  headlineEl.appendChild(infoBtn);

  countEl.textContent = s.visits_this_week;
  targetEl.textContent = `of ${s.visits_needed}`;

  const shieldGlyphs = Array.from({ length: s.shield_count }, () => "&#128737;&#65039;").join("");
  metaEl.innerHTML = `<span>&#128293; ${s.current_streak}-week streak</span>` +
    (shieldGlyphs ? `<span class="dot-sep">&middot;</span><span>${shieldGlyphs}</span>` : "");

  pipsEl.innerHTML = Array.from({ length: s.visits_needed }, (_, i) =>
    `<span class="today-streak-pip${i < s.visits_this_week ? " filled" : ""}"></span>`
  ).join("");

  const reducedMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const pct = Math.min(1, s.visits_this_week / s.visits_needed);
  const targetDash = `${pct * STREAK_RING_CIRCUMFERENCE} ${STREAK_RING_CIRCUMFERENCE}`;
  if (animateFromZero && !reducedMotion) {
    ring.style.transition = "none";
    ring.setAttribute("stroke-dasharray", `0 ${STREAK_RING_CIRCUMFERENCE}`);
    requestAnimationFrame(() => {
      ring.style.transition = "";
      requestAnimationFrame(() => ring.setAttribute("stroke-dasharray", targetDash));
    });
  } else {
    ring.style.transition = "none";
    ring.setAttribute("stroke-dasharray", targetDash);
  }
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
  refreshStreak();

  await muscleOptionsReady;
  await restoreDraft(); // this user's own draft, if any; also resets restoringDraft when done

  switchTab("today");
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

async function handleLogout() {
  document.getElementById("streak-info-modal").hidden = true;
  await api.post("/api/logout", {});
  currentUser = null;
  currentUserId = null;
  authDraft = { name: "", email: "" };
  restoringDraft = true;
  resetWorkoutFlowUI();
  document.getElementById("form-auth-name").reset();
  showAuthStep("auth-name-modal");
}

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

// ---------------- Streak info modal ----------------
const streakInfoModal = document.getElementById("streak-info-modal");
document.getElementById("today-streak-info-btn").addEventListener("click", (e) => {
  e.stopPropagation();
  streakInfoModal.hidden = false;
});
document.getElementById("streak-info-close").addEventListener("click", () => { streakInfoModal.hidden = true; });
streakInfoModal.addEventListener("click", (e) => { if (e.target === streakInfoModal) streakInfoModal.hidden = true; });

// Falls back to the default illustration (not a per-user placeholder) for
// anyone who hasn't uploaded their own picture yet.
function renderProfileAvatar() {
  const img = document.getElementById("profile-avatar-img");
  img.src = (currentUser && currentUser.avatar) || "default-avatar.jpeg";
  const todayImg = document.getElementById("today-avatar-img");
  if (todayImg) todayImg.src = (currentUser && currentUser.avatar) || "default-avatar.jpeg";
}

// ---------------- Profile (edit modal, opened from Today's avatar) ----------------
// Editing profile fields moved off the Your Body tab and behind a tap on
// the Today screen's avatar - Your Body is now just body-performance data
// (Strength by phase / Fuel), not account settings.
function openProfileEditModal() {
  document.getElementById("profile-name").value = currentUser.name || "";
  document.getElementById("profile-age").value = currentUser.age ?? "";
  const tracksCycle = !!currentUser.last_period_date;
  document.getElementById("profile-track-cycle").checked = tracksCycle;
  document.getElementById("profile-period-date-label").hidden = !tracksCycle;
  setDateFieldValue(document.getElementById("profile-last-period").closest(".date-field"), currentUser.last_period_date || "");
  renderProfileAvatar();
  document.getElementById("profile-edit-modal").hidden = false;
}
// Tapping the avatar opens a small menu (View Profile / Log Out) instead of
// jumping straight into the edit form - logout used to live as its own
// button on the Your Body tab, but that tab is body-performance data now,
// not account settings, so both account actions live behind the avatar.
const todayAvatarImg = document.getElementById("today-avatar-img");
const todayAvatarMenu = document.getElementById("today-avatar-menu");
function closeAvatarMenu() {
  todayAvatarMenu.hidden = true;
  todayAvatarImg.setAttribute("aria-expanded", "false");
}
function openAvatarMenu() {
  // position:fixed (not CSS-anchored absolute) so the menu never gets
  // clipped by .today-greeting's overflow:hidden (used to contain its
  // decorative glow) - computed fresh each open in case the avatar moved
  // (e.g. orientation change).
  const rect = todayAvatarImg.getBoundingClientRect();
  todayAvatarMenu.style.top = `${rect.bottom + 8}px`;
  todayAvatarMenu.style.right = `${window.innerWidth - rect.right}px`;
  todayAvatarMenu.hidden = false;
  todayAvatarImg.setAttribute("aria-expanded", "true");
}
todayAvatarImg.addEventListener("click", (e) => {
  e.stopPropagation();
  if (todayAvatarMenu.hidden) openAvatarMenu(); else closeAvatarMenu();
});
todayAvatarImg.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openAvatarMenu(); }
});
document.getElementById("today-avatar-view-profile-btn").addEventListener("click", () => {
  closeAvatarMenu();
  openProfileEditModal();
});
document.getElementById("today-avatar-logout-btn").addEventListener("click", () => {
  closeAvatarMenu();
  handleLogout();
});
document.addEventListener("click", (e) => {
  if (!todayAvatarMenu.hidden && !todayAvatarMenu.contains(e.target) && e.target !== todayAvatarImg) closeAvatarMenu();
});
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeAvatarMenu(); });
function closeProfileEditModal() { document.getElementById("profile-edit-modal").hidden = true; }
document.getElementById("profile-edit-cancel").addEventListener("click", closeProfileEditModal);
document.getElementById("profile-edit-modal").addEventListener("click", (e) => {
  if (e.target === e.currentTarget) closeProfileEditModal();
});

// ---------------- Your Body tab ----------------
function renderYouTab() {
  document.getElementById("card-pending-exercises").hidden = !currentUser.is_admin;
  if (currentUser.is_admin) loadPendingExercises();

  renderCyclePerfSection();
}

// ---------------- Pending exercise approvals (admin only) ----------------
// The other side of the propose flow in the option picker (see
// handleProposeExercise/finalizeNewExercise) - a name that didn't
// substring-match and wasn't a semantic "did you mean" match lands here for
// review. Approving/rejecting relabels any sets already logged under the
// raw text server-side (see routes/exercise_plan.py), so this doesn't need
// to touch exercise_log itself.
async function loadPendingExercises() {
  const list = document.getElementById("pending-exercises-list");
  const empty = document.getElementById("pending-exercises-empty");
  const pending = await api.get("/api/exercise-plan/pending");
  if (!Array.isArray(pending) || !pending.length) {
    list.innerHTML = "";
    empty.hidden = false;
    return;
  }
  empty.hidden = true;
  list.innerHTML = pending.map(p => `
    <div class="pending-exercise-row" data-id="${p.id}">
      <div class="pending-exercise-meta">
        Proposed by ${escapeHtml(p.proposed_by_name)} &middot; ${escapeHtml((p.proposed_at || "").slice(0, 10))}
      </div>
      <div class="pending-exercise-fields">
        <label>Exercise name
          <input type="text" class="pe-exercise" value="${escapeHtml(p.exercise)}">
        </label>
        <label>Muscle group
          <select class="pe-muscle">
            ${availableMuscles.map(m => `<option value="${escapeHtml(m)}"${m === p.target_muscle ? " selected" : ""}>${escapeHtml(m)}</option>`).join("")}
          </select>
        </label>
      </div>
      <div class="pending-exercise-actions">
        <button type="button" class="primary pe-approve">Approve</button>
        <button type="button" class="secondary pe-reject-toggle">Reject / Redirect</button>
      </div>
      <div class="pending-exercise-reject-panel" hidden>
        <p class="field-hint">Leave blank to just discard the proposal, or point her existing logged sets at an exercise that already exists.</p>
        <label>Redirect to muscle group
          <select class="pe-resolved-muscle">
            <option value="">(none - just discard)</option>
            ${availableMuscles.map(m => `<option value="${escapeHtml(m)}">${escapeHtml(m)}</option>`).join("")}
          </select>
        </label>
        <label>Redirect to exercise name
          <input type="text" class="pe-resolved-exercise" placeholder="exact existing exercise name">
        </label>
        <div class="pending-exercise-actions">
          <button type="button" class="danger pe-reject-confirm">Confirm Reject</button>
          <button type="button" class="secondary pe-reject-cancel">Cancel</button>
        </div>
      </div>
    </div>`).join("");
}

document.getElementById("pending-exercises-list").addEventListener("click", async (e) => {
  const row = e.target.closest(".pending-exercise-row");
  if (!row) return;
  const id = row.dataset.id;

  if (e.target.closest(".pe-approve")) {
    try {
      await api.post(`/api/exercise-plan/pending/${id}/approve`, {
        exercise: row.querySelector(".pe-exercise").value.trim(),
        target_muscle: row.querySelector(".pe-muscle").value,
      });
      toast("Exercise approved");
      loadPendingExercises();
    } catch (err) {
      toast(err.message);
    }
    return;
  }
  if (e.target.closest(".pe-reject-toggle")) {
    row.querySelector(".pending-exercise-reject-panel").hidden = false;
    return;
  }
  if (e.target.closest(".pe-reject-cancel")) {
    row.querySelector(".pending-exercise-reject-panel").hidden = true;
    return;
  }
  if (e.target.closest(".pe-reject-confirm")) {
    try {
      await api.post(`/api/exercise-plan/pending/${id}/reject`, {
        resolved_muscle: row.querySelector(".pe-resolved-muscle").value,
        resolved_exercise: row.querySelector(".pe-resolved-exercise").value.trim(),
      });
      toast("Proposal rejected");
      loadPendingExercises();
    } catch (err) {
      toast(err.message);
    }
  }
});

wireCycleOptIn(document.getElementById("profile-track-cycle"), document.getElementById("profile-period-date-label"));

// ---------------- Your Cycle ----------------
// No per-user cycle length is collected, so this estimates every cycle as
// a standard 28 days from the last period date - the simplified 4-phase
// model most consumer cycle-tracking apps use absent more history. Period
// (menstrual phase) length IS per-user, adjustable via the Log Period
// button, so the phase boundaries are computed fresh from currentUser
// rather than a fixed array - call getCyclePhases() once per render and
// reuse that same array/objects (each call builds new objects, so a phase
// object from one call won't === one from another).
const CYCLE_LENGTH_DAYS = 28;
const DEFAULT_PERIOD_DAYS = 5;

function getCyclePhases() {
  const periodDays = (currentUser && currentUser.period_length_days) || DEFAULT_PERIOD_DAYS;
  return [
    { key: "menstrual", label: "Menstrual Phase", startDay: 1, endDay: periodDays, color: "#f4436c" },
    { key: "follicular", label: "Follicular Phase", startDay: periodDays + 1, endDay: 13, color: "#17c993" },
    { key: "ovulation", label: "Ovulation Phase", startDay: 14, endDay: 14, color: "#f5a623" },
    { key: "luteal", label: "Luteal Phase", startDay: 15, endDay: 28, color: "#22d3ee" },
  ];
}

function cyclePhaseForDay(day) {
  const phases = getCyclePhases();
  return phases.find(p => day >= p.startDay && day <= p.endDay) || phases[phases.length - 1];
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
  renderCycleCalendar();

  // Kept in sync here (not left as static HTML) since period length is
  // per-user and adjustable via Log Period - a fixed "Day 1-5" would go
  // stale the moment someone changes it.
  const phasesForList = getCyclePhases();
  const menstrualPhase = phasesForList.find(p => p.key === "menstrual");
  const follicularPhase = phasesForList.find(p => p.key === "follicular");
  document.getElementById("cycle-phase-days-menstrual").textContent =
    menstrualPhase.startDay === menstrualPhase.endDay ? `Day ${menstrualPhase.startDay}` : `Day ${menstrualPhase.startDay}-${menstrualPhase.endDay}`;
  document.getElementById("cycle-phase-days-follicular").textContent = `Day ${follicularPhase.startDay}-${follicularPhase.endDay}`;

  const currentBlock = document.getElementById("cycle-current-block");
  const nextBlock = document.getElementById("cycle-next-block");
  const noteEl = document.getElementById("cycle-estimate-note");
  const cycleDay = cycleDayForDate(todayStr);
  if (cycleDay == null) {
    currentBlock.hidden = true;
    nextBlock.hidden = true;
    noteEl.hidden = true;
    document.querySelectorAll(".cycle-phase-card").forEach(c => c.classList.remove("active"));
    return;
  }
  currentBlock.hidden = false;
  nextBlock.hidden = false;
  noteEl.hidden = false;

  // Looked up against one phases array (not cyclePhaseForDay's own internal
  // call) so currentPhase is === one of this array's own objects - needed
  // for indexOf to find it below.
  const phases = getCyclePhases();
  const currentPhase = phases.find(p => cycleDay >= p.startDay && cycleDay <= p.endDay) || phases[phases.length - 1];
  const currentIndex = phases.indexOf(currentPhase);
  const nextPhase = phases[(currentIndex + 1) % phases.length];
  const daysUntilNext = nextPhase.startDay > cycleDay
    ? nextPhase.startDay - cycleDay
    : (CYCLE_LENGTH_DAYS - cycleDay) + nextPhase.startDay;

  const nextPhaseDate = new Date(todayStr + "T00:00:00");
  nextPhaseDate.setDate(nextPhaseDate.getDate() + daysUntilNext);
  const nextPhaseDateLabel = nextPhaseDate.toLocaleDateString("en-US", { month: "short", day: "numeric" });

  document.getElementById("cycle-current-phase").textContent = currentPhase.label;
  document.getElementById("cycle-current-detail").textContent = `Day ${cycleDay} of ~${CYCLE_LENGTH_DAYS}`;
  document.getElementById("cycle-next-phase").textContent = nextPhase.label;
  document.getElementById("cycle-next-detail").textContent = `Starts in ${daysUntilNext} day${daysUntilNext === 1 ? "" : "s"} (${nextPhaseDateLabel})`;

  document.querySelectorAll(".cycle-phase-card").forEach(c => c.classList.toggle("active", c.dataset.phase === currentPhase.key));
}

// ---------------- Period calendar ----------------
// Normally a read-only month view marking every projected menstrual-phase
// day - reuses cyclePhaseForDate so it never drifts from the phase math
// already driving the summary above and the History dots. Log Period
// switches it into a logging mode instead: the projected marks clear and
// day cells become individually toggleable - tap an unselected day to add
// it, tap a selected one to remove it. The very first tap (starting from
// an empty selection) also auto-fills forward to the user's usual period
// length as a convenience - today obviously isn't the end of a period that
// starts today - which the user can then freely add to or remove days
// from. Only the *first* tap is restricted to today-or-earlier (you can't
// say your period will begin in the future); once at least one day is
// selected, any day (past or future) can be toggled. Save submits the
// selection's min..max span as last_period_date + period_length_days,
// since that's all the backend model can represent - a day deselected from
// the middle of an otherwise-contiguous run won't be reflected as a gap
// once saved, only shrinking the ends actually changes what's stored.
let cycleCalViewYear, cycleCalViewMonth;
let periodLogging = false;
let periodLogDates = new Set();

function addDaysIso(iso, days) {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function renderCycleCalendar() {
  if (cycleCalViewYear == null) {
    const d = new Date(todayStr + "T00:00:00");
    cycleCalViewYear = d.getFullYear();
    cycleCalViewMonth = d.getMonth();
  }

  const hasPeriodDate = !!(currentUser && currentUser.last_period_date);
  document.getElementById("cycle-calendar-banner").hidden = hasPeriodDate || periodLogging;
  document.getElementById("cycle-log-period-btn").hidden = periodLogging || !hasPeriodDate;
  document.getElementById("cycle-cal-log-hint").hidden = !periodLogging;
  document.getElementById("cycle-cal-log-actions").hidden = !periodLogging;

  document.getElementById("cycle-cal-month-label").textContent = new Date(cycleCalViewYear, cycleCalViewMonth, 1)
    .toLocaleDateString("en-US", { month: "long", year: "numeric" });

  const grid = document.getElementById("cycle-cal-grid");
  grid.innerHTML = "";
  const firstDay = new Date(cycleCalViewYear, cycleCalViewMonth, 1).getDay();
  const daysInMonth = new Date(cycleCalViewYear, cycleCalViewMonth + 1, 0).getDate();
  for (let i = 0; i < firstDay; i++) grid.appendChild(document.createElement("span"));
  for (let day = 1; day <= daysInMonth; day++) {
    const iso = `${cycleCalViewYear}-${String(cycleCalViewMonth + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const cell = document.createElement("button");
    cell.type = "button";
    cell.textContent = day;
    cell.className = "cycle-cal-day";
    if (iso === todayStr) cell.classList.add("today");
    if (periodLogging) {
      if (periodLogDates.size === 0 && iso > todayStr) {
        cell.disabled = true;
      } else {
        cell.classList.add("selectable");
        cell.addEventListener("click", () => selectPeriodLogDay(iso));
      }
      if (periodLogDates.has(iso)) cell.classList.add("period");
    } else if (hasPeriodDate) {
      // Not disabled here (unlike a future day during logging) - just a
      // plain inert button with no click handler, so it reads as normal
      // text rather than the dimmed :disabled style.
      const phase = cyclePhaseForDate(iso);
      if (phase && phase.key === "menstrual") cell.classList.add("period");
    }
    grid.appendChild(cell);
  }
}

document.getElementById("cycle-cal-prev").addEventListener("click", () => {
  cycleCalViewMonth--; if (cycleCalViewMonth < 0) { cycleCalViewMonth = 11; cycleCalViewYear--; }
  renderCycleCalendar();
});
document.getElementById("cycle-cal-next").addEventListener("click", () => {
  cycleCalViewMonth++; if (cycleCalViewMonth > 11) { cycleCalViewMonth = 0; cycleCalViewYear++; }
  renderCycleCalendar();
});
document.getElementById("cycle-calendar-add-date-btn").addEventListener("click", () => switchTab("you"));

// ---------------- Log Period ----------------
function selectPeriodLogDay(iso) {
  if (periodLogDates.has(iso)) {
    periodLogDates.delete(iso);
  } else {
    const startingFresh = periodLogDates.size === 0;
    periodLogDates.add(iso);
    if (startingFresh) {
      // Convenience auto-fill for the common case (today obviously isn't
      // the end of a period that starts today) - the user is then free to
      // toggle any of these back off, or add more days, before Save.
      const usualLength = (currentUser && currentUser.period_length_days) || DEFAULT_PERIOD_DAYS;
      for (let i = 1; i < usualLength; i++) periodLogDates.add(addDaysIso(iso, i));
    }
  }
  renderCycleCalendar();
}

document.getElementById("cycle-log-period-btn").addEventListener("click", () => {
  periodLogging = true;
  periodLogDates = new Set();
  renderCycleCalendar();
});

document.getElementById("cycle-cal-log-cancel").addEventListener("click", () => {
  periodLogging = false;
  periodLogDates = new Set();
  renderCycleCalendar();
});

document.getElementById("cycle-cal-log-save").addEventListener("click", async () => {
  if (periodLogDates.size === 0) {
    toast("Tap at least one day first");
    return;
  }
  const sorted = [...periodLogDates].sort();
  const start = sorted[0];
  const end = sorted[sorted.length - 1];
  const periodLengthDays = Math.round((new Date(end + "T00:00:00") - new Date(start + "T00:00:00")) / 86400000) + 1;
  try {
    const res = await api.put(`/api/user/${currentUserId}/period`, { last_period_date: start, period_length_days: periodLengthDays });
    currentUser.last_period_date = res.last_period_date;
    currentUser.period_length_days = res.period_length_days;
    periodLogging = false;
    periodLogDates = new Set();
    toast("Period logged");
    renderCycleTab();
    refreshStreak();
  } catch (err) {
    toast(err.message);
  }
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
    closeProfileEditModal();
    toast("Profile updated");
    // Opened from - and always closes back to - Today, so refresh it in
    // place (name/avatar in the greeting, cycle strip if tracking changed)
    // rather than requiring a manual tab switch to see the change land.
    if (activeTab === "today") renderTodayScreen();
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

// ---------------- Tabs (bottom nav) ----------------
// Replaces the old two-level data-maintab + data-tab state (see the design
// handoff's "State Management" section) with a single activeTab covering
// all five bottom-nav destinations.
let activeTab = "today";

function switchTab(name) {
  activeTab = name;
  document.querySelectorAll(".bottom-nav-item").forEach(b => b.classList.toggle("active", b.dataset.maintab === name));
  document.querySelectorAll(".main-tab-panel").forEach(p => {
    const isActive = p.id === "maintab-" + name;
    p.classList.toggle("active", isActive);
    p.hidden = !isActive;
  });
  if (name === "today") renderTodayScreen();
  else if (name === "log") renderLogScreen();
  else if (name === "history") loadHistory();
  else if (name === "cycle") renderCycleTab();
  else if (name === "you") renderYouTab();
}

document.querySelectorAll(".bottom-nav-item").forEach(btn => {
  btn.addEventListener("click", () => switchTab(btn.dataset.maintab));
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

// ---------------- Custom option picker (muscle group / exercise dropdowns) ----------------
// Exercise names were always seed data until the new-exercise proposal flow
// (see renderOptionPickerList/proposeNewExercise) let a user's own typed
// text into this list and into the admin approval queue - escaping is what
// keeps a name like "<img onerror=...>" inert instead of executing.
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

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
    // The exercise field is the only picker that can propose a brand new
    // catalog entry (see addExerciseBlock/onBlockMuscleChange) - the
    // muscle-group and Performance-tab exercise pickers only ever choose
    // among exercises that already exist.
    if (q && container.__allowPropose) {
      opList.innerHTML = `
        <p class="option-picker-empty">No matches for "${escapeHtml(query)}"</p>
        <button type="button" class="option-picker-add-btn" data-query="${escapeHtml(query)}">+ Add "${escapeHtml(query)}" as a new exercise</button>`;
    } else {
      opList.innerHTML = `<p class="option-picker-empty">No matches</p>`;
    }
    return;
  }
  let html = visible
    .map(o => {
      const imgUrl = images[o] && images[o][0];
      const thumb = imgUrl ? `<img class="option-picker-thumb" src="${imgUrl}" alt="" loading="lazy">` : "";
      return `<button type="button" class="option-picker-item${o === current ? " selected" : ""}" data-value="${escapeHtml(o)}">${thumb}<span>${escapeHtml(o)}</span></button>`;
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
  // Tapping the thumbnail enlarges it in place instead of picking the
  // exercise - it shouldn't also select and close the picker underneath it.
  const thumb = e.target.closest(".option-picker-thumb");
  if (thumb) {
    const wasEnlarged = thumb.classList.contains("enlarged");
    opList.querySelectorAll(".option-picker-thumb.enlarged").forEach(t => t.classList.remove("enlarged"));
    if (!wasEnlarged) thumb.classList.add("enlarged");
    return;
  }
  if (e.target.closest(".option-picker-show-all")) {
    renderOptionPickerList(opActiveContainer, { showAll: true });
    return;
  }
  const addBtn = e.target.closest(".option-picker-add-btn");
  if (addBtn) {
    handleProposeExercise(opActiveContainer, addBtn.dataset.query);
    return;
  }
  const candidateBtn = e.target.closest(".option-picker-candidate-item");
  if (candidateBtn) {
    setOptionFieldValue(opActiveContainer, candidateBtn.dataset.value);
    closeOptionPicker();
    return;
  }
  const notMatchBtn = e.target.closest(".option-picker-not-a-match");
  if (notMatchBtn) {
    finalizeNewExercise(opActiveContainer, notMatchBtn.dataset.query);
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

// A name typed here never blocks logging - it's usable immediately either
// way (see handleProposeExercise). What's still open is only whether it
// joins the shared catalog: a strong semantic match to an existing exercise
// asks her to confirm rather than silently merging (two genuinely different
// exercises can share enough wording to look alike - see matching.py), and
// anything she says is new goes to the admin approval queue while she keeps
// working uninterrupted.
async function handleProposeExercise(container, query) {
  const muscle = container.__muscle;
  opList.innerHTML = `<p class="option-picker-empty">Checking for a match...</p>`;
  let candidates = [];
  try {
    const res = await api.post("/api/exercise-plan/candidates", { muscle, name: query });
    candidates = res.candidates || [];
  } catch (err) {
    toast(err.message);
  }
  if (opActiveContainer !== container) return; // picker was closed while the request was in flight
  if (candidates.length) {
    opList.innerHTML = `
      <p class="option-picker-empty">Did you mean one of these?</p>
      ${candidates.map(c => `<button type="button" class="option-picker-item option-picker-candidate-item" data-value="${escapeHtml(c.exercise)}"><span>${escapeHtml(c.exercise)}</span></button>`).join("")}
      <button type="button" class="option-picker-not-a-match" data-query="${escapeHtml(query)}">No, "${escapeHtml(query)}" is a different exercise</button>`;
  } else {
    finalizeNewExercise(container, query);
  }
}

async function finalizeNewExercise(container, query) {
  const muscle = container.__muscle;
  try {
    const res = await api.post("/api/exercise-plan/propose", { muscle, name: query });
    if (opActiveContainer !== container) return;
    if (container.__options && !container.__options.includes(res.exercise)) {
      container.__options = [...container.__options, res.exercise];
    }
    // The exercise-change listener (see addExerciseBlock) picks the Reps-vs-
    // Time layout from block.__exerciseTypes, populated from the muscle's
    // existing catalog before this exercise even existed - without this, a
    // brand-new Cardio proposal would silently fall back to "strength" and
    // render Reps/Weight fields instead of Duration/Level.
    const block = container.closest(".exercise-block");
    if (block) {
      block.__exerciseTypes = block.__exerciseTypes || {};
      block.__exerciseTypes[res.exercise] = res.type || "strength";
    }
    setOptionFieldValue(container, res.exercise);
    closeOptionPicker();
    toast(res.status === "pending"
      ? `Added "${res.exercise}" - logged now, pending approval to join the shared list`
      : `Using "${res.exercise}"`);
  } catch (err) {
    toast(err.message);
  }
}

// ---------------- Workout Log (one-screen log, 2b) ----------------
// The old two-step flow asked for the visit's date/energy/meal/notes via
// its own "Save Visit" form before exercises could be logged at all - the
// single-screen redesign collects the same fields through the session
// strip instead and creates/updates the workout_log row lazily (see
// ensureVisitSaved), the first time anything actually needs it to exist.
let savedWorkoutId = null;
let logSessionDate = todayStr;
let sessionFields = { energy_level: "", pre_workout_meal: "", hours_since_meal: "", notes: "" };
let currentExerciseIndex = -1;
// exercise -> [{reps,weight}|{duration,level}] from the most recent *other*
// session, cached per exercise for the Sets card's "Last time: ..." line
// and drawn from the same exercise-log history checkForPR already caches.
let lastSessionFor = {};

function currentSessionBody() {
  return {
    date: logSessionDate,
    energy_level: sessionFields.energy_level || null,
    pre_workout_meal: sessionFields.pre_workout_meal || "",
    hours_since_meal: sessionFields.hours_since_meal || null,
    notes: sessionFields.notes || "",
  };
}

// Creates the visit row on first use, updates it on every later call - the
// backend's exercise-log endpoint requires a workout_log row for the date
// to already exist (see routes/exercise_log.py), which used to be the
// user's own explicit "Save Visit" press; here it's implicit. Several
// session-strip chips (and Done) can all call this in quick succession
// without awaiting each other - chained onto visitSaveChain so a second
// call always sees the first one's savedWorkoutId before deciding
// POST-vs-PUT, instead of racing it and creating a duplicate visit row.
let visitSaveChain = Promise.resolve();
function ensureVisitSaved() {
  visitSaveChain = visitSaveChain.then(() => ensureVisitSavedNow());
  return visitSaveChain;
}
async function ensureVisitSavedNow() {
  const body = currentSessionBody();
  try {
    if (savedWorkoutId) {
      await api.put(`/api/workout-log/${savedWorkoutId}`, body);
    } else {
      const res = await api.post("/api/workout-log", body);
      savedWorkoutId = res.id;
    }
    refreshStreak();
  } catch (err) {
    toast(err.message);
  }
  saveWorkoutDraft();
}

// ---------------- Exercise Log ----------------
const exercisesContainer = document.getElementById("log-exercises-container");

function renumberExerciseBlocks() {
  exercisesContainer.querySelectorAll(".exercise-block").forEach((block, i) => {
    block.querySelector(".exercise-block-title").textContent = `Exercise ${i + 1}`;
  });
}

// Collapsing a block only hides it (CSS) and fills in a one-line summary -
// nothing about its actual data changes, so re-expanding always shows
// exactly what was there before. Collapse state itself isn't persisted
// (not part of the draft) - it's just "which block are you looking at
// right now" UI, not data.
function collapseExerciseBlock(block) {
  block.classList.add("collapsed");
  block.querySelector(".exercise-block-summary-btn").setAttribute("aria-expanded", "false");
  const exerciseName = block.querySelector(".ex-exercise").value;
  const setCount = block.querySelectorAll(".set-row").length;
  block.querySelector(".exercise-block-summary").textContent = exerciseName
    ? `${exerciseName} — ${setCount} set${setCount === 1 ? "" : "s"}`
    : "Not filled in yet";
}

function expandExerciseBlock(block) {
  block.classList.remove("collapsed");
  block.querySelector(".exercise-block-summary-btn").setAttribute("aria-expanded", "true");
}

function renumberSets(block) {
  block.querySelectorAll(".set-row").forEach((row, i) => {
    row.querySelector(".set-number").textContent = `Set ${i + 1}`;
  });
}

function initStepper(container) {
  const input = container.querySelector(".stepper-input");
  // Reads step/min/max from the dataset fresh on every click rather than
  // capturing them once - the exercise-log edit row's Level/Speed stepper
  // swaps its dataset when the Level/Speed toggle is flipped (different
  // units, different range), and this same function backs that stepper too.
  function adjust(sign) {
    const step = parseFloat(container.dataset.step) || 1;
    const min = container.dataset.min !== undefined ? parseFloat(container.dataset.min) : null;
    const max = container.dataset.max !== undefined ? parseFloat(container.dataset.max) : null;
    let val = parseFloat(input.value);
    if (isNaN(val)) val = 0;
    val = Math.round((val + sign * step) * 100) / 100;
    if (min != null && val < min) val = min;
    if (max != null && val > max) val = max;
    input.value = val;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }
  container.querySelector(".stepper-minus").addEventListener("click", () => adjust(-1));
  container.querySelector(".stepper-plus").addEventListener("click", () => adjust(1));
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

// Small "PR" badge on the row itself (see the 2b set-row spec) mirroring
// row.dataset.prValue - kept in sync from every place that sets/clears it
// rather than baked into checkForPR alone, so guardPrEdit's own clears
// (an edit that erases the PR) update the badge too.
function syncPrBadge(row) {
  let badge = row.querySelector(".set-pr-badge");
  if (row.dataset.prValue != null) {
    if (!badge) {
      badge = document.createElement("span");
      badge.className = "set-pr-badge";
      badge.textContent = "PR";
      row.querySelector(".set-remove")?.insertAdjacentElement("beforebegin", badge);
    }
  } else if (badge) {
    badge.remove();
  }
}

// PR metric is weight for strength sets, duration for cardio sets - Level
// is a subjective 1-10 rating and Speed only exists for some exercises, so
// duration is the one metric every cardio exercise actually has.
async function checkForPR(block, row, exerciseName, isCardio) {
  if (!exerciseName) return;
  const metricKey = isCardio ? "duration_minutes" : "weight_kg";
  const inputSelector = isCardio ? ".set-duration" : ".set-weight";
  const value = parseFloat(row.querySelector(inputSelector)?.value);
  if (isNaN(value) || value <= 0) { delete row.dataset.prValue; syncPrBadge(row); return; }

  const history = await getExerciseHistory();
  let priorBest = 0;
  let hasHistory = false;
  history.forEach(x => {
    if (x.exercise === exerciseName && x[metricKey] != null) {
      hasHistory = true;
      priorBest = Math.max(priorBest, x[metricKey]);
    }
  });
  if (!hasHistory) { delete row.dataset.prValue; syncPrBadge(row); return; } // nothing to beat yet - logging an exercise for the first time isn't a "PR"

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
  syncPrBadge(row);
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
  if (ok) { delete row.dataset.prValue; syncPrBadge(row); } // re-evaluated fresh by checkForPR right after
  return ok;
}

// Switches a cardio block's 2nd set field between "level" (generic 1-10
// intensity wheel-picker) and "speed" (plain Speed (km/h) stepper) - the
// Level/Speed toggle in the sets header (see addExerciseBlock) lets the
// user pick whichever matches what their machine actually shows, for any
// cardio exercise, not just exercises the app happens to know about. It's
// one toggle per block, not per set, since an exercise is tracked one way
// or the other for the whole set list.
function applyLevelMode(block, mode) {
  const prevMode = block.dataset.levelMode || "level";
  block.dataset.levelMode = mode;
  if (mode !== prevMode) {
    const captured = captureSetRows(block);
    block.querySelector(".ex-sets").innerHTML = "";
    restoreSetRows(block, captured);
  }
  updateLevelModeToggle(block);
}

// Syncs the sets-header Level/Speed toggle's visibility and active state.
// Hidden for non-cardio blocks and for exercises where Speed is already
// shown permanently as the extra field (see EXERCISE_EXTRA_FIELDS) - there's
// nothing left to toggle since Speed's already on the row.
function updateLevelModeToggle(block) {
  const toggle = block.querySelector(".set-level-mode-toggle");
  if (!toggle) return;
  const isCardio = block.dataset.exerciseType === "cardio";
  const speedIsExtra = EXERCISE_EXTRA_FIELDS[block.querySelector(".ex-exercise").value] === CARDIO_SPEED_FIELD;
  toggle.hidden = !(isCardio && !speedIsExtra);
  const mode = block.dataset.levelMode || "level";
  toggle.querySelectorAll(".set-level-mode-btn").forEach(btn => btn.classList.toggle("active", btn.dataset.mode === mode));
}

// Snapshots each set row's field values before a rebuild (see
// applyLevelMode/applyExtraField/applyExerciseType below) so switching
// Level<->Speed, adding/dropping an extra field, or flipping Reps<->Time
// only loses the fields that are genuinely incompatible with the new set
// shape (e.g. Reps when switching to Duration+Level) instead of collapsing
// every row down to a single blank one.
function captureSetRows(block) {
  return [...block.querySelectorAll(".set-row")].map(row => ({
    reps: row.querySelector(".set-reps")?.value || "",
    weight: row.querySelector(".set-weight")?.value || "",
    duration: row.querySelector(".set-duration")?.value || "",
    level: row.querySelector(".set-level")?.value || "",
    speed: row.querySelector(".set-speed")?.value || "",
    extra: row.querySelector(".set-extra")?.value || "",
  }));
}

// Rebuilds one row per captured entry (instead of always collapsing to
// one), carrying over whichever fields still exist on the new row shape.
function restoreSetRows(block, captured) {
  captured.forEach(data => {
    const row = addSetRow(block);
    const reps = row.querySelector(".set-reps");
    if (reps && data.reps) reps.value = data.reps;
    const weight = row.querySelector(".set-weight");
    if (weight && data.weight) {
      weight.value = data.weight;
      row.querySelector(".set-bodyweight-btn")?.classList.toggle("active", data.weight === "0");
    }
    const duration = row.querySelector(".set-duration");
    if (duration && data.duration) duration.value = data.duration;
    const level = row.querySelector(".set-level");
    if (level && data.level) level.value = data.level;
    const speed = row.querySelector(".set-speed");
    if (speed && data.speed) speed.value = data.speed;
    const extra = row.querySelector(".set-extra");
    if (extra && data.extra) extra.value = data.extra;
  });
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
  if (newKey !== prevKey) {
    const captured = captureSetRows(block);
    block.querySelector(".ex-sets").innerHTML = "";
    restoreSetRows(block, captured);
  }
  updateLevelModeToggle(block);
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
  if (type !== prevType) {
    const captured = captureSetRows(block);
    block.querySelector(".ex-sets").innerHTML = "";
    restoreSetRows(block, captured);
  }
  updateLevelModeToggle(block);
}

function addSetRow(block, { copyLast = false } = {}) {
  const setsDiv = block.querySelector(".ex-sets");
  const existingRows = block.querySelectorAll(".set-row");
  const lastRow = existingRows[existingRows.length - 1];
  const isCardio = block.dataset.exerciseType === "cardio";
  const exerciseName = block.querySelector(".ex-exercise").value;
  const levelOverride = block.dataset.levelMode === "speed" ? CARDIO_SPEED_FIELD : null;
  // Extra fields (Inclination, Speed-as-extra, ...) are all cardio concepts
  // - gated on isCardio so switching a block to Reps mode (the Reps/Time
  // toggle allows overriding type for any exercise, e.g. reps of Burpees)
  // doesn't keep rendering a stray Speed/Inclination field alongside
  // Reps+Weight.
  const extraField = isCardio ? EXERCISE_EXTRA_FIELDS[exerciseName] : null;
  const row = document.createElement("div");
  row.className = "set-row" + (extraField ? " has-extra" : "");
  const extraLabelHtml = extraField ? `<span class="set-row-label set-row-label-3">${extraField.label}</span>` : "";
  const extraHtml = extraField ? `
    <div class="stepper set-extra-field stepper-labeled" data-step="${extraField.step}" data-min="${extraField.min}">
      <button type="button" class="stepper-btn stepper-minus" aria-label="Decrease ${extraField.label}">&minus;</button>
      <input type="number" class="set-extra stepper-input" min="${extraField.min}" step="${extraField.step}" placeholder="${extraField.placeholder || ""}" aria-label="${extraField.label}">
      <button type="button" class="stepper-btn stepper-plus" aria-label="Increase ${extraField.label}">+</button>
    </div>` : "";
  // The 2nd cardio field is the generic 1-10 intensity Level wheel-picker,
  // or a plain Speed stepper when the block's Level/Speed toggle is set to
  // Speed (see applyLevelMode).
  const levelHtml = levelOverride ? `
    <div class="stepper set-speed-field stepper-labeled" data-step="${levelOverride.step}" data-min="${levelOverride.min}">
      <button type="button" class="stepper-btn stepper-minus" aria-label="Decrease ${levelOverride.label}">&minus;</button>
      <input type="number" class="set-speed stepper-input" min="${levelOverride.min}" step="${levelOverride.step}" placeholder="${levelOverride.placeholder || ""}" aria-label="${levelOverride.label}">
      <button type="button" class="stepper-btn stepper-plus" aria-label="Increase ${levelOverride.label}">+</button>
    </div>` : `
    <div class="stepper stepper-level stepper-labeled" data-step="1" data-min="1" data-max="10">
      <button type="button" class="stepper-btn stepper-minus" aria-label="Decrease intensity level">&minus;</button>
      <input type="number" class="set-level stepper-input" min="1" max="10" step="1" placeholder="LEVEL" aria-label="Intensity level, 1 to 10">
      <button type="button" class="stepper-btn stepper-plus" aria-label="Increase intensity level">+</button>
    </div>`;
  row.innerHTML = isCardio ? `
    <span class="set-row-label set-row-label-1">Duration (min)</span>
    <span class="set-row-label set-row-label-2">${levelOverride ? levelOverride.label : "Level"}</span>
    ${extraLabelHtml}
    <div class="set-row-top">
      <span class="set-number"></span>
      <button type="button" class="set-remove" aria-label="Remove set">&minus;</button>
    </div>
    <div class="set-row-steppers">
      <div class="stepper stepper-duration stepper-labeled" data-step="5" data-min="0">
        <button type="button" class="stepper-btn stepper-minus" aria-label="Decrease duration">&minus;</button>
        <input type="number" class="set-duration stepper-input" min="0" step="5" placeholder="MIN" aria-label="Duration in minutes">
        <button type="button" class="stepper-btn stepper-plus" aria-label="Increase duration">+</button>
      </div>
      ${levelHtml}
      ${extraHtml}
    </div>` : `
    <span class="set-row-label set-row-label-1">Reps</span>
    <span class="set-row-label set-row-label-2">Weight (kg)</span>
    <div class="set-row-top">
      <span class="set-number"></span>
      <button type="button" class="set-bodyweight-btn" aria-label="No added weight - bodyweight only">
        <span class="bw-switch" aria-hidden="true"></span>BW
      </button>
      <button type="button" class="set-remove" aria-label="Remove set">&minus;</button>
    </div>
    <div class="set-row-steppers">
      <div class="stepper stepper-reps stepper-labeled" data-step="2" data-min="1">
        <button type="button" class="stepper-btn stepper-minus" aria-label="Decrease reps">&minus;</button>
        <input type="number" class="set-reps stepper-input" min="1" placeholder="REPS" aria-label="Reps" required>
        <button type="button" class="stepper-btn stepper-plus" aria-label="Increase reps">+</button>
      </div>
      <div class="stepper stepper-weight stepper-labeled" data-step="2.5" data-min="0">
        <button type="button" class="stepper-btn stepper-minus" aria-label="Decrease weight">&minus;</button>
        <input type="number" step="0.5" class="set-weight stepper-input" placeholder="KG" aria-label="Weight in kg">
        <button type="button" class="stepper-btn stepper-plus" aria-label="Increase weight">+</button>
      </div>
    </div>`;
  if (copyLast && lastRow) {
    if (isCardio) {
      row.querySelector(".set-duration").value = lastRow.querySelector(".set-duration")?.value || "";
      if (levelOverride) {
        row.querySelector(".set-speed").value = lastRow.querySelector(".set-speed")?.value || "";
      } else {
        row.querySelector(".set-level").value = lastRow.querySelector(".set-level")?.value || "";
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
  if (isCardio) {
    const durationInput = row.querySelector(".set-duration");
    // Same debounce/guard shape as the weight input above - duration is the
    // cardio PR metric (see checkForPR), so an edit that would silently
    // erase a recorded PR needs the same confirmation weight edits get.
    durationInput.addEventListener("input", () => {
      clearTimeout(durationInput.__prTimer);
      durationInput.__prTimer = setTimeout(async () => {
        const newValue = parseFloat(durationInput.value);
        if (isNaN(newValue)) return;
        const proceed = await guardPrEdit(row, newValue, " min");
        if (!proceed) {
          durationInput.value = row.dataset.prValue;
          durationInput.dispatchEvent(new Event("change", { bubbles: true }));
          return;
        }
        checkForPR(block, row, block.querySelector(".ex-exercise").value, true);
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
        const useSpeed = block.dataset.levelMode === "speed";
        if (duration != null) targetRow.querySelector(".set-duration").value = duration;
        if (level != null) {
          if (useSpeed) targetRow.querySelector(".set-speed").value = level;
          else targetRow.querySelector(".set-level").value = level;
        }
        const parts = [duration != null ? `${duration} min` : null, level != null ? `${useSpeed ? "speed" : "level"} ${level}` : null].filter(Boolean);
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
  initNoteMicButtonGeneric(block.querySelector(".note-mic-btn"), block.querySelector(".ex-notes"));
}

// Generalized for any text input outside an exercise block too - the
// session note/meal modals (see renderSessionStrip) reuse this same
// dictation behavior on their own plain inputs.
function initNoteMicButtonGeneric(btn, input) {
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

// The 2nd cardio field is either the generic 1-10 intensity "Level"
// wheel-picker or a plain "Speed (km/h)" stepper - which one is shown is a
// per-block toggle the user controls directly (see applyLevelMode), not
// something baked into the exercise. Also stored in the per-set `attributes`
// JSON, same mechanism as EXERCISE_EXTRA_FIELDS.
const CARDIO_SPEED_FIELD = { key: "speed_kmh", label: "Speed (km/h)", step: 0.5, min: 0, placeholder: "KM/H" };

// Exercises where Speed is the obviously-right starting point (a treadmill
// has no meaningful "intensity level") - just picks the toggle's initial
// position when the exercise is selected. The toggle itself is always
// visible and the user can flip it either way for any cardio exercise.
// Exercises where Level and Speed both matter at once (see
// EXERCISE_EXTRA_FIELDS below) aren't in this set - the toggle only exists
// for the "one or the other" case.
const CARDIO_SPEED_DEFAULT_EXERCISES = new Set([]);

// One-off fields that only apply to a single exercise - stored in the same
// per-set `attributes` JSON as everything else instead of a dedicated
// column (see docs/eav-example.md). Rendered as a 3rd per-set field
// alongside Reps/Weight or Duration/Level (see addSetRow) so it varies per
// set just like those do. Add more entries here as new one-off fields come
// up.
//
// Treadmill/Cycling/Cross Trainer point this at CARDIO_SPEED_FIELD (the
// same object the toggle uses) rather than a one-off field of their own -
// their consoles show both a resistance/intensity Level *and* an actual
// Speed, so Speed lives here as the extra field while Level stays the
// normal 2nd field. Whenever extraField is CARDIO_SPEED_FIELD, addSetRow
// hides the Level/Speed toggle entirely (see speedIsExtra below) - there's
// nothing left to toggle since Speed's already shown, and the toggle
// setting it to "speed" too would show Speed twice on the same row.
const EXERCISE_EXTRA_FIELDS = {
  "Treadmill": CARDIO_SPEED_FIELD,
  "Cycling": CARDIO_SPEED_FIELD,
  "Cross Trainer": CARDIO_SPEED_FIELD,
};

async function onBlockMuscleChange(block) {
  const muscle = block.querySelector(".ex-muscle").value;
  const exField = block.querySelector(".ex-exercise-field");
  if (!muscle) {
    block.__exerciseTypes = {};
    setOptionFieldOptions(exField, [], { emptyText: "Pick a muscle group first" });
    applyExerciseType(block, "strength");
    applyExtraField(block);
    applyLevelMode(block, "level");
    return;
  }
  const exercises = await api.get(`/api/exercises-by-muscle/${encodeURIComponent(muscle)}`);
  exField.__muscle = muscle;
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
  applyLevelMode(block, "level");
}

// container defaults to the Log Workout form's own exercise list, but the
// History detail view's group editor (see startGroupEdit) builds a
// detached block into its own holder instead - every side effect below
// that assumes "the" block list means exercisesContainer is guarded so
// that usage doesn't touch the real Log Workout form/draft at all.
function addExerciseBlock(container = exercisesContainer) {
  const block = document.createElement("div");
  block.className = "exercise-block grid-form";
  block.__exerciseTypes = {};
  block.innerHTML = `
    <div class="exercise-block-header">
      <button type="button" class="exercise-block-summary-btn" aria-expanded="true">
        <span class="exercise-block-chevron" aria-hidden="true">&#9662;</span>
        <span class="exercise-block-title"></span>
        <span class="exercise-block-summary"></span>
      </button>
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
        <div class="set-level-mode-toggle" role="group" aria-label="Track intensity by level or speed" hidden>
          <button type="button" class="set-level-mode-btn" data-mode="level">Level</button>
          <button type="button" class="set-level-mode-btn" data-mode="speed">Speed</button>
        </div>
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
  // Only this field can propose a brand new catalog entry (see
  // renderOptionPickerList/handleProposeExercise) - the muscle-group field
  // and the Performance tab's exercise field only ever pick among exercises
  // that already exist.
  block.querySelector(".ex-exercise-field").__allowPropose = true;
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
    applyLevelMode(block, CARDIO_SPEED_DEFAULT_EXERCISES.has(exerciseName) ? "speed" : "level");
  });
  block.querySelector(".add-set").addEventListener("click", () => addSetRow(block));
  block.querySelector(".add-set-same").addEventListener("click", () => addSetRow(block, { copyLast: true }));
  block.querySelectorAll(".set-type-btn").forEach(btn => {
    btn.addEventListener("click", () => applyExerciseType(block, btn.dataset.type));
  });
  updateSetTypeToggle(block);
  block.querySelectorAll(".set-level-mode-btn").forEach(btn => {
    btn.addEventListener("click", () => applyLevelMode(block, btn.dataset.mode));
  });
  updateLevelModeToggle(block);
  initVoiceSetButton(block);
  initNoteMicButton(block);
  block.querySelector(".exercise-remove").addEventListener("click", () => {
    block.remove();
    renumberExerciseBlocks();
    saveExerciseDraft();
  });
  block.querySelector(".exercise-block-summary-btn").addEventListener("click", () => {
    if (block.classList.contains("collapsed")) expandExerciseBlock(block);
    else collapseExerciseBlock(block);
  });

  // Collapsing every other block on add is dead weight from the old
  // multi-exercise-visible-at-once form (back when .exercise-block-header
  // wasn't hidden) - the chip row is what keeps things compact now, and
  // every block reaching this line already gets .log-set-block added by
  // its caller right after, whose header is hidden regardless of collapsed
  // state. Worse than dead: it used to run unconditionally, including on
  // the currently *active*, visible block - collapsing it hid its whole
  // .full content (see the CSS), so opening the "+" picker and canceling
  // out of it (never reaching setActiveExerciseIndex(), the only place
  // that un-collapses) left the exercise you were looking at with its sets
  // seemingly gone until you switched chips away and back.
  container.appendChild(block);
  if (container === exercisesContainer) {
    renumberExerciseBlocks();
  }

  // Most workouts train one muscle group across several exercises in a
  // row, so default a freshly-added block to whatever the previous one
  // has picked — setOptionFieldValue's change event also loads that
  // muscle's exercises into the dropdown below. Left alone during draft
  // restoration, which sets each block's own saved value explicitly, and
  // during a detached (non-exercisesContainer) build, which always
  // prefills its own muscle/exercise explicitly right after creation.
  if (!restoringDraft && container === exercisesContainer) {
    const blocks = exercisesContainer.querySelectorAll(".exercise-block");
    const prevBlock = blocks[blocks.length - 2];
    const prevMuscle = prevBlock && prevBlock.querySelector(".ex-muscle").value;
    if (prevMuscle) {
      setOptionFieldValue(block.querySelector(".ex-muscle-field"), prevMuscle);
    }
  }

  return block;
}

// weight_kg=0 is the bodyweight sentinel (see the BW toggle in addSetRow,
// which sets the input's value to the string "0") - `parseFloat(...) ||
// null` would collapse that back to null since 0 is falsy in JS, silently
// losing the "explicitly bodyweight" signal and making it indistinguishable
// from "no weight entered". Only a truly empty input means null.
function parseWeightKg(str) {
  return str === "" ? null : parseFloat(str);
}

async function submitExerciseLog() {
  const date = logSessionDate;
  const exercises = [...exercisesContainer.querySelectorAll(".exercise-block")]
    .filter(block => block.querySelector(".ex-exercise").value)
    .map(block => {
      const isCardio = block.dataset.exerciseType === "cardio";
      const exerciseName = block.querySelector(".ex-exercise").value;
      const levelOverride = block.dataset.levelMode === "speed" ? CARDIO_SPEED_FIELD : null;
      const extraField = EXERCISE_EXTRA_FIELDS[exerciseName];
      const notes = block.querySelector(".ex-notes").value;
      const sets = [...block.querySelectorAll(".set-row")]
        .map(row => {
          const set = isCardio ? {
            duration_minutes: parseFloat(row.querySelector(".set-duration").value) || null,
            ...(levelOverride
              ? { [levelOverride.key]: parseFloat(row.querySelector(".set-speed").value) || null }
              : { intensity_level: parseInt(row.querySelector(".set-level").value, 10) || null }),
          } : {
            reps: parseInt(row.querySelector(".set-reps").value, 10) || null,
            weight_kg: parseWeightKg(row.querySelector(".set-weight").value),
          };
          if (extraField) {
            const v = parseFloat(row.querySelector(".set-extra").value);
            if (!isNaN(v)) set[extraField.key] = v;
          }
          return set;
        })
        // A row added via "Log set"/"+ Add Set" but never actually filled
        // in isn't a real set - drop it here rather than saving a phantom
        // zero/null entry. Weight alone doesn't count (legitimately 0 for
        // bodyweight) - reps (or duration, for cardio) is what makes a set
        // real.
        .filter(set => isCardio ? set.duration_minutes != null : set.reps != null);
      // One note per exercise, not per set - only the first (real) set
      // carries it (each exercise_log row still has its own `notes`
      // column, but the rest are just left blank rather than duplicating
      // the text).
      if (sets.length) sets[0].notes = notes;
      return { muscle_group: block.querySelector(".ex-muscle").value, exercise: exerciseName, sets };
    })
    // An exercise with zero real sets is exactly the "added the chip but
    // never actually logged anything" case - drop the whole exercise
    // rather than saving it with an empty sets array.
    .filter(ex => ex.sets.length > 0);
  if (!exercises.length) {
    // ensureVisitSaved() (see the session-strip's energy/meal chips) may
    // have already speculatively created a workout_log row before any
    // exercise was added - clean that back up rather than leaving an empty
    // visit sitting in History with nothing logged against it.
    if (savedWorkoutId) {
      try { await api.del(`/api/workout-log/${savedWorkoutId}`); } catch { /* best-effort cleanup */ }
    }
    toast("No workout was logged for today");
    clearDraft();
    resetWorkoutFlowUI();
    switchTab("today");
    return;
  }
  try {
    await ensureVisitSaved();
    const res = await api.post("/api/exercise-log", { date, exercises });
    exerciseHistoryCache = null; // stale after this submit - refetch next time a PR check needs it
    toast(res.duplicate ? "This exact session already exists for this day" : "Workout logged");
    clearDraft();
    resetWorkoutFlowUI();
    switchTab("today");
  } catch (err) {
    toast(err.message);
  }
}

// Shared by "finished logging exercises" and "switching to a different
// profile": wipes the Log screen back to its blank starting state. Does
// NOT touch localStorage drafts itself — callers decide whether that draft
// should be cleared (flow finished) or left alone (just switching away,
// might switch back later).
function resetWorkoutFlowUI() {
  exercisesContainer.innerHTML = "";
  currentExerciseIndex = -1;
  savedWorkoutId = null;
  logSessionDate = todayStr;
  sessionFields = { energy_level: "", pre_workout_meal: "", hours_since_meal: "", notes: "" };
  stopRestTimer();
  renderLogExerciseChips();
  setActiveExerciseIndex(-1);
  renderSessionStrip();
}

// ---------------- Log screen chrome (2b) ----------------

// setEnergyFieldValue always dispatches a "change" event, even when called
// programmatically here just to refresh the chip's label - without this
// guard, every renderSessionStrip() call (including the one inside
// resetWorkoutFlowUI, right after savedWorkoutId is cleared) would trip
// the energy input's own "change" listener below and call
// ensureVisitSaved() again, creating a stray blank visit row.
let renderingSessionStrip = false;

function renderSessionStrip() {
  renderingSessionStrip = true;
  const energyField = document.querySelector("#session-strip .energy-field");
  setEnergyFieldValue(energyField, sessionFields.energy_level || "");
  renderingSessionStrip = false;
  const mealBtn = document.getElementById("log-meal-btn");
  const mealValueEl = mealBtn.querySelector(".meal-timing-field-value");
  if (sessionFields.pre_workout_meal || sessionFields.hours_since_meal) {
    const parts = [];
    if (sessionFields.pre_workout_meal) parts.push(sessionFields.pre_workout_meal);
    if (sessionFields.hours_since_meal) parts.push(formatMealTimingLabel(sessionFields.hours_since_meal));
    mealValueEl.textContent = `\u{1F37D}️ ${parts.join(" · ")}`;
    mealValueEl.classList.remove("placeholder");
  } else {
    mealValueEl.textContent = "\u{1F37D} Add fuel";
    mealValueEl.classList.add("placeholder");
  }
  const noteChip = document.getElementById("log-note-chip");
  noteChip.textContent = sessionFields.notes ? `\u{1F4DD} ${sessionFields.notes}` : "+ Note";
  noteChip.classList.toggle("chip-add", !sessionFields.notes);
  noteChip.classList.toggle("filled", !!sessionFields.notes);
}

// The energy field auto-wires itself (see the [data-energy-field] loop
// near initEnergyField) - this just mirrors its value into sessionFields
// and syncs the visit row once it settles.
document.getElementById("log-energy-input").addEventListener("change", (e) => {
  if (renderingSessionStrip) return;
  sessionFields.energy_level = e.target.value;
  ensureVisitSaved();
});

document.getElementById("log-meal-btn").addEventListener("click", () => {
  const modal = document.getElementById("session-meal-modal");
  document.getElementById("session-meal-input").value = sessionFields.pre_workout_meal || "";
  modal.hidden = false;
});
document.getElementById("session-meal-cancel").addEventListener("click", () => { document.getElementById("session-meal-modal").hidden = true; });
document.getElementById("session-meal-modal").addEventListener("click", (e) => {
  if (e.target === e.currentTarget) e.currentTarget.hidden = true;
});
document.getElementById("session-meal-next").addEventListener("click", () => {
  sessionFields.pre_workout_meal = document.getElementById("session-meal-input").value.trim();
  document.getElementById("session-meal-modal").hidden = true;
  // Chains straight into the existing hours-since-eating wheel - one chip,
  // two fields, per the design handoff (they're both "when/what did you
  // eat", so they belong behind the same affordance).
  openMealTimingPicker(document.getElementById("log-meal-field"));
});
document.getElementById("log-meal-timing-input").addEventListener("change", (e) => {
  sessionFields.hours_since_meal = e.target.value;
  renderSessionStrip();
  ensureVisitSaved();
});
initNoteMicButtonGeneric(document.getElementById("session-meal-mic-btn"), document.getElementById("session-meal-input"));

document.getElementById("log-note-chip").addEventListener("click", () => {
  document.getElementById("session-note-input").value = sessionFields.notes || "";
  document.getElementById("session-note-modal").hidden = false;
});
document.getElementById("session-note-cancel").addEventListener("click", () => { document.getElementById("session-note-modal").hidden = true; });
document.getElementById("session-note-modal").addEventListener("click", (e) => {
  if (e.target === e.currentTarget) e.currentTarget.hidden = true;
});
document.getElementById("session-note-save").addEventListener("click", () => {
  sessionFields.notes = document.getElementById("session-note-input").value.trim();
  document.getElementById("session-note-modal").hidden = true;
  renderSessionStrip();
  ensureVisitSaved();
});
initNoteMicButtonGeneric(document.getElementById("session-note-mic-btn"), document.getElementById("session-note-input"));

// Session date lives as text in the header subtitle (see updateLogHeader) -
// tapping it opens the same shared date-picker modal every other date
// field uses, via a detached carrier element (never inserted into the DOM)
// instead of a visible .date-field, since there's nothing to show here
// beyond the subtitle text itself.
const logDateCarrier = document.createElement("div");
logDateCarrier.innerHTML = `<input type="hidden" id="log-date-hidden"><span class="date-field-value"></span>`;
const logDateHiddenInput = logDateCarrier.querySelector("input");
logDateHiddenInput.addEventListener("change", () => {
  logSessionDate = logDateHiddenInput.value || todayStr;
  savedWorkoutId = null; // switching dates means a different (or not-yet-existing) visit row
  updateLogHeader();
  saveWorkoutDraft();
});
document.getElementById("log-header-subtitle").addEventListener("click", () => {
  logDateHiddenInput.value = logSessionDate;
  openDatePicker({ container: logDateCarrier, max: todayStr });
});

function updateLogHeader() {
  const blocks = [...exercisesContainer.querySelectorAll(".exercise-block")].filter(b => b.querySelector(".ex-exercise").value);
  const muscles = [...new Set(blocks.map(b => b.querySelector(".ex-muscle").value).filter(Boolean))];
  document.getElementById("log-header-title").textContent = muscles.length ? muscles.join(" & ") : "New workout";
  const phase = cyclePhaseForDate(logSessionDate);
  const dateLabel = logSessionDate === todayStr ? "Today" : formatDateDisplay(logSessionDate);
  const parts = [dateLabel];
  if (phase) parts.push(phase.label.replace(" Phase", ""));
  if (blocks.length) parts.push(`exercise ${Math.max(currentExerciseIndex, 0) + 1} of ${blocks.length}`);
  document.getElementById("log-header-subtitle").textContent = parts.join(" · ");
}

async function updateSetsCardLastTime(exerciseName) {
  const el = document.getElementById("sets-card-last-time");
  if (!exerciseName) { el.textContent = ""; return; }
  const history = await getExerciseHistory();
  const rows = history.filter(x => x.exercise === exerciseName && x.date !== logSessionDate);
  if (!rows.length) { el.textContent = ""; return; }
  const lastDate = [...new Set(rows.map(x => x.date))].sort().pop();
  const lastSets = rows.filter(x => x.date === lastDate).sort((a, b) => (a.set_number || 0) - (b.set_number || 0));
  lastSessionFor[exerciseName] = lastSets;
  const isCardio = lastSets[0].duration_minutes != null && lastSets[0].reps == null;
  const summary = lastSets.map(s => isCardio ? `${s.duration_minutes}min` : `${s.reps}×${s.weight_kg}`).join(", ");
  el.textContent = `Last time: ${summary}`;
}

function renderLogExerciseChips() {
  const chipsEl = document.getElementById("log-exercise-chips");
  const allBlocks = [...exercisesContainer.children];
  const named = allBlocks
    .map((b, i) => ({ b, i }))
    .filter(({ b }) => b.querySelector(".ex-exercise").value);
  // With zero exercises, the big "+ Add Exercise" button in the empty sets
  // card (see setActiveExerciseIndex) already covers this affordance - a
  // lone "+" chip up here too would just be a redundant, less-visible copy
  // of the same action.
  if (!named.length) {
    chipsEl.hidden = true;
    chipsEl.innerHTML = "";
    return;
  }
  chipsEl.hidden = false;
  const chips = named
    .map(({ b, i }) => `<button type="button" class="chip${i === currentExerciseIndex ? " chip-active" : ""}" data-index="${i}">${escapeHtml(b.querySelector(".ex-exercise").value)}</button>`)
    .join("");
  chipsEl.innerHTML = chips + `<button type="button" class="chip chip-add" id="log-add-exercise-chip">+</button>`;
  chipsEl.querySelectorAll(".chip[data-index]").forEach(chip => {
    chip.addEventListener("click", () => setActiveExerciseIndex(parseInt(chip.dataset.index, 10)));
  });
  document.getElementById("log-add-exercise-chip").addEventListener("click", promptAddExercise);
}

function setActiveExerciseIndex(i) {
  currentExerciseIndex = i;
  const blocks = [...exercisesContainer.children];
  blocks.forEach((b, idx) => { b.hidden = idx !== i; });
  const active = blocks[i];
  const emptyEl = document.getElementById("sets-card-empty");
  if (active) {
    emptyEl.hidden = true;
    exercisesContainer.hidden = false;
    // addExerciseBlock() collapses every *other* block whenever a new one
    // is added (see its own container===exercisesContainer branch) - that
    // stuck .collapsed class hides this block's whole .full content
    // (.sets-header/.ex-sets/.set-actions, see the CSS), so switching back
    // to it via its chip showed an empty Sets card even though its sets
    // were still there in the DOM, just display:none'd. Always expand the
    // block being activated to guarantee that never lingers.
    expandExerciseBlock(active);
    updateSetsCardLastTime(active.querySelector(".ex-exercise").value);
  } else {
    emptyEl.hidden = false;
    exercisesContainer.hidden = true;
    document.getElementById("sets-card-last-time").textContent = "";
  }
  renderLogExerciseChips();
  updateLogHeader();
}

function waitForChange(el) {
  return new Promise(resolve => {
    el.addEventListener("change", () => resolve(el.value), { once: true });
  });
}

// The "+" chip's flow: muscle picker, then (once picked) the exercise
// picker for that muscle - the same cascade the old per-block dropdowns
// used, just driven from outside the block instead of inline in it.
async function promptAddExercise() {
  await muscleOptionsReady;
  if (!availableMuscles.length) { toast("Still loading exercises..."); return; }
  const block = addExerciseBlock();
  block.classList.add("log-set-block");
  block.hidden = true;
  const muscleField = block.querySelector(".ex-muscle-field");
  const exerciseField = block.querySelector(".ex-exercise-field");
  const muscleHidden = block.querySelector(".ex-muscle");
  const exerciseHidden = block.querySelector(".ex-exercise");

  openOptionPicker(muscleField);
  const muscle = await waitForChange(muscleHidden);
  if (!muscle) { block.remove(); return; }
  await onBlockMuscleChange(block);
  if (!exerciseField.__options || !exerciseField.__options.length) {
    toast("No exercises for this muscle yet");
    block.remove();
    return;
  }
  openOptionPicker(exerciseField);
  const exercise = await waitForChange(exerciseHidden);
  if (!exercise) { block.remove(); return; }

  block.hidden = false;
  addSetRow(block);
  currentExerciseIndex = [...exercisesContainer.children].indexOf(block);
  setActiveExerciseIndex(currentExerciseIndex);
  saveExerciseDraft();
}

// ---------------- Rest timer (2b footer button) ----------------
const REST_DURATION = 90;
let restRemaining = 0;
let restInterval = null;

function updateRestButtonUI() {
  const label = document.getElementById("log-footer-btn-label");
  const fill = document.getElementById("log-footer-btn-fill");
  if (restRemaining > 0) {
    const m = Math.floor(restRemaining / 60), s = restRemaining % 60;
    label.textContent = `Rest ${m}:${String(s).padStart(2, "0")}`;
    fill.style.width = `${((REST_DURATION - restRemaining) / REST_DURATION) * 100}%`;
  } else {
    label.textContent = "Start rest";
    fill.style.width = "0%";
  }
}

function stopRestTimer() {
  clearInterval(restInterval);
  restInterval = null;
  restRemaining = 0;
  updateRestButtonUI();
}

function startRestTimer() {
  clearInterval(restInterval);
  restRemaining = REST_DURATION;
  updateRestButtonUI();
  restInterval = setInterval(() => {
    restRemaining--;
    if (restRemaining <= 0) { stopRestTimer(); return; }
    updateRestButtonUI();
  }, 1000);
}

document.getElementById("log-footer-btn").addEventListener("click", () => {
  startRestTimer();
});

document.getElementById("log-close-btn").addEventListener("click", () => switchTab("today"));
document.getElementById("log-done-btn").addEventListener("click", submitExerciseLog);
document.getElementById("log-add-exercise-btn").addEventListener("click", promptAddExercise);

function renderLogScreen() {
  renderSessionStrip();
  renderLogExerciseChips();
  updateLogHeader();
}

// ---------------- Today screen (2a) ----------------
function todayGreetingCopy() {
  const hour = new Date().getHours();
  const part = hour < 12 ? "Morning" : hour < 18 ? "Afternoon" : "Evening";
  const name = (currentUser && currentUser.name) ? currentUser.name.split(" ")[0] : "";
  return `${part}${name ? `, ${name}` : ""}`;
}

// Cycle-phase insight sentence for the Today strip - one short template per
// phase, filled from the same computePRPhaseBreakdown() the Cycle tab's
// "Where your PRs happen" card uses, so the two never disagree.
const TODAY_PHASE_INSIGHT_TEMPLATES = {
  menstrual: (n, total) => `Your body is resetting — <strong>${n} of your ${total} PRs</strong> landed in this phase.`,
  follicular: (n, total) => `Estrogen is climbing — <strong>${n} of your ${total} PRs</strong> landed in this phase. Good week to push weight.`,
  ovulation: (n, total) => `You're near your peak — <strong>${n} of your ${total} PRs</strong> landed in this phase.`,
  luteal: (n, total) => `Energy may dip late this phase — <strong>${n} of your ${total} PRs</strong> landed here.`,
};

async function renderTodayCycleStrip() {
  const wrap = document.getElementById("today-cycle-card-wrap");
  if (!currentUser || !currentUser.last_period_date) { wrap.hidden = true; return; }
  const cycleDay = cycleDayForDate(todayStr);
  const phases = getCyclePhases();
  const currentPhase = phases.find(p => cycleDay >= p.startDay && cycleDay <= p.endDay) || phases[phases.length - 1];
  wrap.hidden = false;
  document.getElementById("today-cycle-day").textContent = `Cycle day ${cycleDay}`;
  const phaseEl = document.getElementById("today-cycle-phase");
  phaseEl.textContent = currentPhase.label.replace(" Phase", "");
  phaseEl.style.color = currentPhase.color;

  // Fixed day-order layout (menstrual always starts day 1, luteal always
  // ends day 28) - "past"/"future" relative to today is just a day-range
  // comparison, no phase-order wraparound to worry about within one bar.
  const barEl = document.getElementById("today-phase-bar");
  barEl.innerHTML = phases.map(p => {
    const upcomingOpacity = p.key === "luteal" ? ".25" : ".35";
    if (p.key === currentPhase.key) {
      const elapsed = cycleDay - p.startDay + 1;
      const remaining = p.endDay - cycleDay;
      let html = `<div class="today-phase-bar-seg" style="flex:${elapsed};background:${p.color};opacity:1"></div>`;
      if (remaining > 0) html += `<div class="today-phase-bar-seg" style="flex:${remaining};background:${p.color};opacity:${upcomingOpacity}"></div>`;
      return html;
    }
    const opacity = p.endDay < currentPhase.startDay ? "1" : upcomingOpacity;
    return `<div class="today-phase-bar-seg" style="flex:${p.endDay - p.startDay + 1};background:${p.color};opacity:${opacity}"></div>`;
  }).join("");

  const history = await getExerciseHistory();
  const byPhase = computePRPhaseBreakdown(history);
  const total = Object.values(byPhase).reduce((sum, arr) => sum + arr.length, 0);
  const n = byPhase[currentPhase.key].length;
  const insightEl = document.getElementById("today-cycle-insight");
  if (total > 0) {
    insightEl.innerHTML = TODAY_PHASE_INSIGHT_TEMPLATES[currentPhase.key](n, total);
    insightEl.querySelector("strong").style.color = currentPhase.color;
  } else {
    insightEl.textContent = "";
  }

  const currentIndex = phases.indexOf(currentPhase);
  const nextPhase = phases[(currentIndex + 1) % phases.length];
  const daysUntilNext = nextPhase.startDay > cycleDay ? nextPhase.startDay - cycleDay : (CYCLE_LENGTH_DAYS - cycleDay) + nextPhase.startDay;
  document.getElementById("today-cycle-footnote").textContent =
    `${nextPhase.label.replace(" Phase", "")} in ${daysUntilNext} day${daysUntilNext === 1 ? "" : "s"}`;
}

async function renderTodayLastSession() {
  const emptyEl = document.getElementById("today-last-session-empty");
  const cardEl = document.getElementById("today-last-session-card");
  const repeatBtn = document.getElementById("today-cta-repeat");
  let workouts = [];
  try { workouts = await api.get("/api/workout-log"); } catch (err) { /* stays empty */ }
  if (!workouts.length) {
    emptyEl.hidden = false;
    cardEl.hidden = true;
    repeatBtn.hidden = true;
    return;
  }
  const last = workouts[0]; // ORDER BY date DESC, id DESC
  emptyEl.hidden = true;
  cardEl.hidden = false;

  const history = await getExerciseHistory();
  const dayRows = history.filter(x => x.date === last.date);
  const prDaysByDate = computePRDaysByDate(history);
  const hasPr = (prDaysByDate.get(last.date) || new Set()).size > 0;

  document.getElementById("today-last-session-title").textContent = formatMuscles(last.muscles) || "Rest day";
  document.getElementById("today-last-session-pr-tag").hidden = !hasPr;

  const setCount = dayRows.length;
  const bestWeight = dayRows.reduce((max, x) => x.weight_kg != null ? Math.max(max, x.weight_kg) : max, 0);
  const statsEl = document.getElementById("today-last-session-stats");
  const statParts = [`<span>Sets <strong>${setCount}</strong></span>`];
  if (bestWeight > 0) statParts.push(`<span>Best <strong>${bestWeight} kg</strong></span>`);
  if (last.energy_level != null) statParts.push(`<span>Energy <strong>${formatEnergyCompact(last.energy_level)}</strong></span>`);
  statsEl.innerHTML = statParts.join("");

  const daysAgo = Math.round((new Date(todayStr + "T00:00:00") - new Date(last.date + "T00:00:00")) / 86400000);
  const relDate = daysAgo === 0 ? "Today" : daysAgo === 1 ? "Yesterday" : `${daysAgo} days ago`;
  const phase = cyclePhaseForDate(last.date);
  const metaParts = [relDate];
  if (phase) metaParts.push(phase.label.replace(" Phase", ""));
  if (last.notes) metaParts.push(`“${last.notes}”`);
  document.getElementById("today-last-session-meta").textContent = metaParts.join(" · ");

  const groups = groupExerciseLogs(dayRows);
  repeatBtn.hidden = groups.length === 0;
  repeatBtn.textContent = `Repeat ${formatMuscles(last.muscles) || "last"} day`;
  repeatBtn.onclick = () => startLogSession({ repeatFrom: groups });
}

// Resolves once `el.hidden` becomes true - lets code that opens one of the
// existing picker modals imperatively (rather than via their own button
// click) wait for the user to finish with it (Done or Cancel, either way),
// same as waitForChange() does for the option-picker cascade.
function waitUntilHidden(el) {
  return new Promise(resolve => {
    if (el.hidden) { resolve(); return; }
    const obs = new MutationObserver(() => {
      if (el.hidden) { obs.disconnect(); resolve(); }
    });
    obs.observe(el, { attributes: true, attributeFilter: ["hidden"] });
  });
}

// Before a fresh "Start today's workout" drops the user into the Log
// screen, walk them through the same energy / meal-name / meal-timing
// pickers the session-strip chips use inline - just moved earlier so it
// reads as a quick check-in rather than something to remember to fill in
// later. Reuses the real session-strip elements and their existing "change"
// listeners (see renderSessionStrip et al.) so values persist exactly as
// they already do when set from the chips themselves.
async function promptSessionFeelAndFood() {
  const energyField = document.querySelector("#session-strip .energy-field");
  openEnergyPicker(energyField);
  await waitUntilHidden(epModal);

  document.getElementById("session-meal-input").value = sessionFields.pre_workout_meal || "";
  document.getElementById("session-meal-modal").hidden = false;
  await waitUntilHidden(document.getElementById("session-meal-modal"));
  // "Next" on the meal-name modal chains straight into the hours-since
  // wheel (see the session-meal-next handler) - "Cancel" doesn't, so only
  // wait on it if it's actually open.
  if (!mtpModal.hidden) await waitUntilHidden(mtpModal);

  renderSessionStrip();
  ensureVisitSaved();
}

// Starts (or re-enters) the Log screen. opts.repeatFrom, when given, is a
// list of {muscle_group, exercise, sets} groups (see groupExerciseLogs)
// from the most recent visit, prefilled as a head start rather than a
// blank screen - see the design handoff's "Repeat ..." button.
async function startLogSession({ repeatFrom } = {}) {
  // Never stomps a session already in progress (e.g. restored from an
  // earlier interrupted draft, or just switched away from and back) -
  // only prefills from the last visit when the log screen is genuinely
  // empty, and otherwise just navigates there as-is.
  const alreadyInProgress = exercisesContainer.children.length > 0;
  if (repeatFrom && repeatFrom.length && !alreadyInProgress) {
    for (const group of repeatFrom) {
      const block = addExerciseBlock();
      block.classList.add("log-set-block");
      block.hidden = true;
      setOptionFieldValue(block.querySelector(".ex-muscle-field"), group.muscle_group);
      await onBlockMuscleChange(block);
      setOptionFieldValue(block.querySelector(".ex-exercise-field"), group.exercise);
      group.sets.forEach(s => {
        const row = addSetRow(block);
        row.querySelector(".set-reps") && (row.querySelector(".set-reps").value = s.reps ?? "");
        row.querySelector(".set-weight") && (row.querySelector(".set-weight").value = s.weight_kg ?? "");
        row.querySelector(".set-duration") && (row.querySelector(".set-duration").value = s.duration_minutes ?? "");
      });
    }
    currentExerciseIndex = 0;
    setActiveExerciseIndex(0);
  }
  switchTab("log");
}

document.getElementById("today-cta-start").addEventListener("click", async () => {
  // Same "anything real to resume" check renderTodayCtaState() uses for the
  // Start-vs-Continue label (see below) - deliberately not a raw
  // exercisesContainer.children.length check, which would also count a
  // block whose muscle got picked but whose exercise pick was abandoned
  // (see collectExerciseBlocksDraft's docstring) and wrongly skip the
  // check-in on what the label still correctly calls a fresh start.
  if (!isWorkoutInProgress()) await promptSessionFeelAndFood();
  startLogSession();
});
document.getElementById("today-cta-rest").addEventListener("click", () => {
  toast("Noted — rest is part of the plan.");
});
document.getElementById("today-all-history-link").addEventListener("click", () => switchTab("history"));

async function renderTodayScreen() {
  const now = new Date();
  document.getElementById("today-date").textContent = now.toLocaleDateString("en-US", { weekday: "long", day: "numeric", month: "long" }).toUpperCase();
  document.getElementById("today-greeting-title").textContent = todayGreetingCopy();
  renderProfileAvatar();

  if (latestStreakData) renderTodayStreakCard(true);
  else await refreshStreak().then(() => renderTodayStreakCard(true));

  renderTodayCycleStrip();
  renderTodayLastSession();
  renderTodayCtaState();
}

// The CTA otherwise looks identical whether or not a workout is already
// mid-flight (exercises added via the Log screen's "X" close button, or a
// restored draft from a killed app/tab) - without this, there's no way to
// tell "Start today's workout" will actually resume something rather than
// begin fresh. Swaps in "Continue" copy plus a small hint pill whenever
// there's anything to resume.
function namedExerciseCount() {
  return [...exercisesContainer.children].filter(b => b.querySelector(".ex-exercise").value).length;
}
function isWorkoutInProgress() {
  const hasSessionFields = !!(sessionFields.energy_level || sessionFields.pre_workout_meal || sessionFields.hours_since_meal || sessionFields.notes);
  return namedExerciseCount() > 0 || hasSessionFields;
}
function renderTodayCtaState() {
  const namedCount = namedExerciseCount();
  const inProgress = isWorkoutInProgress();
  document.getElementById("today-cta-start-label").textContent = inProgress ? "Continue today's workout" : "Start today's workout";
  const hint = document.getElementById("today-cta-hint");
  if (inProgress) {
    hint.hidden = false;
    hint.textContent = namedCount > 0
      ? `Workout in progress — ${namedCount} exercise${namedCount === 1 ? "" : "s"} added, not yet saved`
      : "Workout in progress — not yet saved";
  } else {
    hint.hidden = true;
  }
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

// Re-fetches rather than reusing whatever was already rendered - editing a
// set from the detail view cascades an edited_at onto its parent
// workout_log row (see update_exercise_log in app.py), and simply toggling
// visibility back to the already-rendered table would leave that badge
// (and any other edit made while in the detail view) stale until a full
// page reload.
async function showWorkoutLog() {
  cardExerciseDetail.hidden = true;
  cardWorkoutLog.hidden = false;
  const [workouts, history] = await Promise.all([api.get("/api/workout-log"), getExerciseHistory()]);
  currentWorkouts = workouts;
  currentPRDaysByDate = computePRDaysByDate(history);
  renderWorkoutTable();
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

// Which day(s) hold an all-time PR, per muscle group - same "PR" definition
// used everywhere else in the app (see checkForPR/computePRPhaseBreakdown):
// the day's best set for an exercise counts as a PR only if it beats every
// STRICTLY EARLIER day's best for that same exercise (so an exercise's very
// first time logged is never itself a PR - nothing to beat yet - and a tie
// doesn't re-mark a later day, only the day the record was first reached).
// Returns Map<date, Set<muscle_group>> so a day with PRs in more than one
// muscle group (e.g. Chest and Legs the same day) can show a tag for each.
function computePRDaysByDate(history) {
  const byExercise = new Map();
  history.forEach(x => {
    if (!byExercise.has(x.exercise)) byExercise.set(x.exercise, { muscle_group: x.muscle_group, rows: [] });
    byExercise.get(x.exercise).rows.push(x);
  });

  const prDaysByDate = new Map();
  byExercise.forEach(({ muscle_group, rows }) => {
    const weightCount = rows.filter(x => x.weight_kg != null).length;
    const durationCount = rows.filter(x => x.duration_minutes != null).length;
    const metricKey = durationCount > weightCount ? "duration_minutes" : "weight_kg";

    const byDate = {};
    rows.forEach(x => {
      const v = x[metricKey];
      if (v == null) return;
      if (!byDate[x.date] || v > byDate[x.date]) byDate[x.date] = v;
    });

    let runningMax = null;
    Object.keys(byDate).sort().forEach(date => {
      const v = byDate[date];
      if (runningMax != null && v > runningMax) {
        if (!prDaysByDate.has(date)) prDaysByDate.set(date, new Set());
        prDaysByDate.get(date).add(muscle_group);
      }
      if (runningMax == null || v > runningMax) runningMax = v;
    });
  });
  return prDaysByDate;
}

// Populated by showWorkoutLog() alongside currentWorkouts - workoutRowView
// reads from it to tag a day's Date cell with e.g. "CHEST PR".
let currentPRDaysByDate = new Map();

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

function formatHistoryCardDate(iso) {
  return new Date(iso + "T00:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

// Groups same-day rows together (see ensureVisitSaved - reopening the log
// screen later the same day creates a second workout_log row rather than
// reusing the first), so the history list clubs them into one card per
// date instead of showing near-duplicate cards with identical muscles.
function groupWorkoutsByDate(workouts) {
  const groups = [];
  const byDate = new Map();
  workouts.forEach(w => {
    let group = byDate.get(w.date);
    if (!group) {
      group = { date: w.date, sessions: [] };
      byDate.set(w.date, group);
      groups.push(group);
    }
    group.sessions.push(w);
  });
  return groups;
}

function sessionMetaHtml(w) {
  const editedBadge = w.edited_at ? `<span class="edited-badge">Edited</span>` : "";
  const metaParts = [];
  if (w.energy_level != null) metaParts.push(`Energy <strong>${w.energy_level}/10</strong>`);
  if (w.notes) metaParts.push(`<span class="history-card-note">&ldquo;${w.notes}&rdquo;</span>`);
  return { editedBadge, metaHtml: metaParts.length ? `<p class="history-card-meta">${metaParts.join(" &middot; ")}</p>` : "" };
}

function workoutCardView(group) {
  const { date, sessions } = group;
  const phase = cyclePhaseForDate(date);
  const dot = phase ? `<span class="phase-dot" style="background:${phase.color}" title="${phase.label}"></span>` : "";
  const prMuscles = currentPRDaysByDate.get(date);
  const prTags = prMuscles
    ? [...prMuscles].map(m => `<span class="pr-day-tag">${m}-PR</span>`).join("")
    : "";
  const muscles = formatMuscles(sessions[0].muscles) || "&mdash;";

  if (sessions.length === 1) {
    const w = sessions[0];
    const { editedBadge, metaHtml } = sessionMetaHtml(w);
    return `
      <div class="history-card clickable-row" data-date="${date}" data-id="${w.id}">
        <div class="history-card-top">
          <span class="date-with-phase">${dot}${formatHistoryCardDate(date)}</span>
          <span class="history-card-badges">${prTags}${editedBadge}</span>
        </div>
        <h3 class="history-card-muscles">${muscles}</h3>
        ${metaHtml}
        <div class="history-card-actions">
          <button class="edit-btn" data-id="${w.id}">Edit</button>
        </div>
      </div>`;
  }

  const sessionRows = sessions.map((w, i) => {
    const { editedBadge, metaHtml } = sessionMetaHtml(w);
    return `
      <div class="history-session-row" data-id="${w.id}">
        <div class="history-session-row-top">
          <span class="history-session-label">Session ${sessions.length - i}</span>
          ${editedBadge}
        </div>
        ${metaHtml || `<p class="history-card-meta history-card-meta-empty">No details logged</p>`}
        <div class="history-card-actions">
          <button class="edit-btn" data-id="${w.id}">Edit</button>
        </div>
      </div>`;
  }).join("");

  return `
    <div class="history-card clickable-row" data-date="${date}">
      <div class="history-card-top">
        <span class="date-with-phase">${dot}${formatHistoryCardDate(date)}</span>
        <span class="history-card-badges">${prTags}</span>
      </div>
      <h3 class="history-card-muscles">${muscles}</h3>
      <p class="history-card-meta history-sessions-count">${sessions.length} sessions logged that day</p>
      <div class="history-sessions">${sessionRows}</div>
    </div>`;
}

function sessionEditRow(w) {
  return `
    <div class="history-session-row history-session-edit" data-id="${w.id}">
      ${workoutEditFieldsHtml(w)}
      <div class="history-card-actions">
        <button class="save-btn" data-id="${w.id}">Save</button>
        <button class="cancel-btn" data-id="${w.id}">Cancel</button>
      </div>
    </div>`;
}

// Date is deliberately not editable here - it's what determines which
// day's exercise_log rows this visit groups with, and letting it drift
// away from that in the History editor (as opposed to catching a wrong
// date before ever saving) is more likely to silently orphan a visit from
// its own sets than to fix a real mistake. Only the softer, always-safe-to-
// change fields (energy, food, notes) are editable after the fact.
function workoutEditFieldsHtml(w) {
  return `
    <div class="history-card-edit-row">
      ${energyFieldHtml("edit-energy", w.energy_level)}
      <div class="meal-timing-field" data-meal-timing-field>
        <button type="button" class="meal-timing-field-btn">
          <span class="meal-timing-field-value placeholder">&#127869; How long ago?</span>
        </button>
        <input type="hidden" class="edit-hours-since-meal" value="${w.hours_since_meal ?? ""}">
      </div>
    </div>
    <input type="text" class="edit-meal" placeholder="What'd you eat before?" value="${w.pre_workout_meal || ""}">
    <input type="text" class="edit-notes" placeholder="Notes" value="${w.notes || ""}">`;
}

function workoutCardEdit(w) {
  return `
    <div class="history-card" data-id="${w.id}">
      <h3 class="history-card-muscles">${formatMuscles(w.muscles) || "&mdash;"}</h3>
      ${workoutEditFieldsHtml(w)}
      <div class="history-card-actions">
        <button class="save-btn" data-id="${w.id}">Save</button>
        <button class="cancel-btn" data-id="${w.id}">Cancel</button>
      </div>
    </div>`;
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
  const phasePills = getCyclePhases().map(p =>
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
  const wBody = document.getElementById("history-list");
  wBody.innerHTML = groupWorkoutsByDate(pageWorkouts).map(workoutCardView).join("");
  bindWorkoutRowEvents();
  renderPhaseLegend();

  document.getElementById("history-pager").hidden = !!historyPhaseFilter;
  if (!historyPhaseFilter) renderHistoryPager();

  const emptyEl = document.getElementById("history-empty");
  if (historyPhaseFilter && pageWorkouts.length === 0) {
    const phase = getCyclePhases().find(p => p.key === historyPhaseFilter);
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
  const wBody = document.getElementById("history-list");
  wBody.querySelectorAll(".history-card.clickable-row").forEach(card => {
    card.addEventListener("click", () => showExerciseDetail(card.dataset.date));
  });
  wBody.querySelectorAll(".edit-btn").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const w = currentWorkouts.find(x => x.id == btn.dataset.id);
      const sessionRow = btn.closest(".history-session-row");
      if (sessionRow) {
        sessionRow.outerHTML = sessionEditRow(w);
      } else {
        btn.closest(".history-card").outerHTML = workoutCardEdit(w);
      }
      bindWorkoutEditRowEvents(w.id);
    });
  });
}

function bindWorkoutEditRowEvents(id) {
  const row = document.querySelector(`#history-list .history-card[data-id="${id}"], #history-list .history-session-row[data-id="${id}"]`);
  initEnergyField(row.querySelector(".energy-field"));
  initMealTimingField(row.querySelector(".meal-timing-field"));
  row.querySelector(".save-btn").addEventListener("click", async (e) => {
    e.stopPropagation();
    const w = currentWorkouts.find(x => x.id == id);
    const body = {
      date: w.date,
      energy_level: row.querySelector(".edit-energy").value || null,
      pre_workout_meal: row.querySelector(".edit-meal").value,
      hours_since_meal: row.querySelector(".edit-hours-since-meal").value || null,
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
  historyPage = 0;
  historyPhaseFilter = null;
  await showWorkoutLog();
}

// Shared chart canvas size - originally the Your Performance tab's PR
// chart, now also the hormone reference chart's (see PERF_CHART_H below).
const PERF_CHART_W = 600;
const PERF_CHART_H = 260;

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

// Unlike PERF_PAD, this chart draws no y-axis number labels, so it doesn't
// need PERF_PAD's wide left margin (46px, sized to fit those numbers) -
// reusing it left the plot area visibly off-center, with a much bigger gap
// on the left than the right.
const HORMONE_PAD = { left: 16, right: 16, top: 20, bottom: 30 };

function renderHormoneReferenceChart() {
  const svg = document.getElementById("hormone-chart");
  if (!svg) return;
  svg.innerHTML = "";

  const plotLeft = HORMONE_PAD.left, plotRight = PERF_CHART_W - HORMONE_PAD.right;
  const plotTop = HORMONE_PAD.top, plotBottom = PERF_CHART_H - HORMONE_PAD.bottom;
  const plotW = plotRight - plotLeft, plotH = plotBottom - plotTop;

  const xFor = day => plotLeft + ((day - 1) / 27) * plotW;
  const yFor = v => plotTop + plotH - (v / 100) * plotH;

  // Same phase colors/day-ranges used everywhere else in the app (History
  // phase dots, PR-by-phase breakdown, the phase cards above this chart) -
  // drawn first as translucent bands so the curves render on top of them.
  // Luteal's band is stretched to the plot's right edge rather than to
  // xFor(29) (which doesn't exist - day 28 is the cycle's last day) so it
  // doesn't fall a half-day short of the axis.
  getCyclePhases().forEach(p => {
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
    // Well clear of a fingertip on touch, not just a mouse cursor - 12px
    // (fine for a mouse pointer) left the tooltip hidden under the finger
    // that triggered it on phones.
    tooltip.style.top = `${clientY - wrapRect.top - 44}px`;
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

// Click-to-toggle popovers for the chart's info button and the Sources
// link - click rather than hover so they work the same on a phone as with
// a mouse, and closing on an outside click/tap is the standard pattern for
// a disclosure like this (Escape too, for keyboard users).
function initTogglePopover(btn, panel) {
  if (!btn || !panel) return;
  function close() {
    panel.hidden = true;
    btn.setAttribute("aria-expanded", "false");
  }
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    const opening = panel.hidden;
    document.querySelectorAll(".hormone-info-popover:not([hidden]), .hormone-sources-detail:not([hidden])").forEach(p => {
      if (p !== panel) { p.hidden = true; }
    });
    panel.hidden = !opening;
    btn.setAttribute("aria-expanded", String(opening));
  });
  document.addEventListener("click", (e) => {
    if (!panel.hidden && !panel.contains(e.target) && e.target !== btn) close();
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
}
initTogglePopover(document.getElementById("hormone-info-btn"), document.getElementById("hormone-info-popover"));
initTogglePopover(document.getElementById("hormone-sources-toggle"), document.getElementById("hormone-sources-detail"));

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
  // Latest edited_at among whichever of that date's sets were edited (not
  // just the one that happened to set byDate's max value) - a date's point
  // represents the whole day's sets for this exercise, so any edit to any
  // of them counts. editedPrevByDate rides along with it - the previous
  // value of that same (latest-edited) set's metric, for the tooltip's
  // "was ..." line (see showTooltip).
  const editedAtByDate = {};
  const editedPrevByDate = {};
  rows.forEach(x => {
    if (x.edited_at && (!editedAtByDate[x.date] || x.edited_at > editedAtByDate[x.date])) {
      editedAtByDate[x.date] = x.edited_at;
      editedPrevByDate[x.date] = x.previous_values ? x.previous_values[metricKey] : null;
    }
    const v = x[metricKey];
    if (v == null) return;
    if (!byDate[x.date] || v > byDate[x.date]) byDate[x.date] = v;
  });
  const points = Object.keys(byDate).sort().map(date => ({
    date, value: byDate[date],
    editedAt: editedAtByDate[date] || null,
    editedPrev: editedAtByDate[date] ? (editedPrevByDate[date] ?? null) : null,
  }));
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

// exercise_log.edited_at is stamped server-side via SQLite's datetime('now'),
// a "YYYY-MM-DD HH:MM:SS" UTC string - append "Z" so Date parses it as UTC
// and converts to the viewer's local time instead of misreading it as local.
function formatEditedAt(sqlUtcString) {
  const d = new Date(sqlUtcString.replace(" ", "T") + "Z");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// ---- Cycle tab: "Strength by phase" chart ----
// This is deliberately the same date-on-the-x-axis, phase-colored-fill
// chart the old standalone "Your Performance" tab used (renderPerformanceChart) -
// a cycle-day x-axis (1-28, ignoring calendar gaps between sessions) was
// tried here and replaced back to this on user feedback: plotting by actual
// date, with each line/fill segment tinted by that date's cycle phase, reads
// better than bucketing everything onto a 28-day ruler.
const CYCLE_PERF_CHART_W = 340;
const CYCLE_PERF_CHART_H = 200;
const CYCLE_PERF_PAD = { left: 34, right: 20, top: 28, bottom: 28 };

let cyclePerfExercise = null;

function formatPerfDate(dateStr) {
  return new Date(dateStr + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// Color for a single point's date, reusing the same CYCLE_PHASES colors as
// the History phase dots and Your Cycle cards. Falls back to plain accent
// purple when cycle tracking is off (no phase to color by), so the chart
// still renders sensibly without cycle tracking.
function colorForDate(dateStr) {
  const phase = cyclePhaseForDate(dateStr);
  return phase ? phase.color : "#6d5ef8";
}

function renderCyclePerfChart(series, exerciseName) {
  const svg = document.getElementById("cycle-perf-chart");
  const tooltip = document.getElementById("cycle-perf-tooltip");
  const legendEl = document.getElementById("cycle-perf-phase-legend");
  svg.innerHTML = "";
  tooltip.hidden = true;
  document.getElementById("cycle-perf-exercise-name").textContent = exerciseName;

  const { unit, points } = series;
  if (!points.length) { legendEl.hidden = true; return; }

  const plotLeft = CYCLE_PERF_PAD.left, plotRight = CYCLE_PERF_CHART_W - CYCLE_PERF_PAD.right;
  const plotTop = CYCLE_PERF_PAD.top, plotBottom = CYCLE_PERF_CHART_H - CYCLE_PERF_PAD.bottom;
  const plotW = plotRight - plotLeft, plotH = plotBottom - plotTop;

  const { yMin, yMax, step } = computeYAxis(points.map(p => p.value));
  const dates = points.map(p => new Date(p.date + "T00:00:00").getTime());
  const minDate = dates[0], maxDate = dates[dates.length - 1];
  const dateSpan = Math.max(maxDate - minDate, 1);

  const xFor = i => points.length === 1 ? plotLeft + plotW / 2 : plotLeft + ((dates[i] - minDate) / dateSpan) * plotW;
  const yFor = v => plotTop + plotH - ((v - yMin) / (yMax - yMin || 1)) * plotH;

  const segColors = points.map(p => colorForDate(p.date));
  const tracksCycle = points.some(p => cyclePhaseForDate(p.date));

  // Area fill first (bottom of the stack) so the gridlines drawn next still
  // show through the translucent fill instead of hiding under it. One quad
  // per consecutive pair of points (not one shape per phase run) - grouping
  // same-phase points into a single run left a gap wherever a single
  // differently-phased point sat between two runs. Per-segment coloring is
  // always contiguous: every pair of adjacent points gets its own colored
  // quad, and adjacent quads share an edge so there's never a break.
  for (let i = 0; i < points.length - 1; i++) {
    const x1 = xFor(i), x2 = xFor(i + 1);
    const y1 = yFor(points[i].value), y2 = yFor(points[i + 1].value);
    const d = `M${x1},${plotBottom} L${x1},${y1} L${x2},${y2} L${x2},${plotBottom} Z`;
    svg.appendChild(svgEl("path", { d, fill: segColors[i], "fill-opacity": "0.28", stroke: "none" }));
  }

  // Y gridlines + labels - clean rounded numbers.
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
    const label = svgEl("text", { class: "perf-axis-label", x: xFor(i), y: CYCLE_PERF_CHART_H - 8, "text-anchor": "middle" });
    label.textContent = formatPerfDate(points[i].date);
    svg.appendChild(label);
  });

  // Line: same per-segment coloring as the area fill, for the same
  // never-a-gap reason.
  for (let i = 0; i < points.length - 1; i++) {
    const d = `M${xFor(i)},${yFor(points[i].value)} L${xFor(i + 1)},${yFor(points[i + 1].value)}`;
    svg.appendChild(svgEl("path", { class: "perf-line", d, stroke: segColors[i] }));
  }
  points.forEach((p, i) => {
    svg.appendChild(svgEl("circle", { cx: xFor(i), cy: yFor(p.value), r: 3, fill: segColors[i] }));
  });

  // Dashed ring on every point with an edit behind it (any of that date's
  // sets), distinct from drawMarker's solid current-value/PR rings below.
  points.forEach((p, i) => {
    if (!p.editedAt) return;
    svg.appendChild(svgEl("circle", { class: "perf-edited-ring", cx: xFor(i), cy: yFor(p.value), r: 6 }));
  });

  // Direct-label only the two moments that matter - current value and the
  // all-time PR (same point when currently at peak) - never a number on
  // every dot.
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
    // Abbreviated (no " Phase" suffix) so all 4 fit on the one line the
    // card's width allows - see #cycle-perf-phase-legend's forced nowrap.
    legendEl.innerHTML = getCyclePhases().map(p =>
      `<span class="phase-legend-item"><span class="phase-dot" style="background:${p.color}"></span>${p.label.replace(" Phase", "")}</span>`
    ).join("");
  } else {
    legendEl.hidden = true;
  }

  // Hover: crosshair snaps to the nearest point on X; one tooltip shows
  // that point's date + value. The hit target is the whole plot area, not
  // just the 3px dots, so the pointer only has to be roughly on target.
  const wrap = svg.closest(".cycle-perf-chart-card");
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
    if (p.editedAt) {
      const editedEl = document.createElement("div");
      editedEl.className = "perf-tooltip-edited";
      editedEl.textContent = `Edited ${formatEditedAt(p.editedAt)}`;
      tooltip.appendChild(editedEl);
      if (p.editedPrev != null) {
        const prevEl = document.createElement("div");
        prevEl.className = "perf-tooltip-edited-prev";
        prevEl.textContent = `was ${p.editedPrev} ${unit}`;
        tooltip.appendChild(prevEl);
      }
    }
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
    const scaleX = CYCLE_PERF_CHART_W / svgRect.width;
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

async function chooseCyclePerfExercise() {
  const history = await getExerciseHistory();
  const exercises = [...new Set(history.map(x => x.exercise))].sort();
  if (!exercises.length) return;
  // A detached field object (never inserted into the DOM) drives the
  // shared option-picker modal the same way the log screen's date field
  // does - there's no visible dropdown button here, just the "Change" link.
  // Needs the same .option-field-btn/.option-field-value shape the real
  // muscle/exercise fields have (see addExerciseBlock) - setOptionFieldOptions
  // and openOptionPicker both look up a real ".option-field-btn" button
  // inside the container, not just a bare hidden input + value span.
  const field = document.createElement("div");
  field.dataset.title = "Exercise";
  field.innerHTML = `<button type="button" class="option-field-btn"><span class="option-field-value placeholder">Select...</span></button><input type="hidden">`;
  const hidden = field.querySelector("input[type=hidden]");
  hidden.value = cyclePerfExercise || "";
  setOptionFieldOptions(field, exercises);
  hidden.addEventListener("change", () => {
    cyclePerfExercise = hidden.value;
    renderCyclePerfSection();
  }, { once: true });
  openOptionPicker(field);
}
document.getElementById("cycle-perf-change-btn").addEventListener("click", chooseCyclePerfExercise);
initTogglePopover(document.getElementById("cycle-perf-info-btn"), document.getElementById("cycle-perf-info-popover"));

// Average energy per cycle phase, keyed by phase.key - feeds the "Avg
// Energy" line in each PRs-by-phase row below. A phase with no
// energy-logged workouts maps to null rather than 0, so the row can tell
// "no data" apart from "logged a real low energy".
function computeEnergyByPhase(workoutLog) {
  const sums = {}, counts = {};
  workoutLog.forEach(w => {
    if (w.energy_level == null) return;
    const phase = cyclePhaseForDate(w.date);
    if (!phase) return;
    sums[phase.key] = (sums[phase.key] || 0) + Number(w.energy_level);
    counts[phase.key] = (counts[phase.key] || 0) + 1;
  });
  const byPhase = {};
  getCyclePhases().forEach(p => {
    byPhase[p.key] = counts[p.key] ? { value: sums[p.key] / counts[p.key], count: counts[p.key] } : null;
  });
  return byPhase;
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
  getCyclePhases().forEach(p => { byPhase[p.key] = []; });

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
// is relative to the phase with the most PRs. The exercise names that used
// to run on underneath every bar as one comma-joined paragraph got
// unreadable once a phase had more than a couple of PRs (e.g. 8 exercises
// wrapping across several lines) - now that list is tucked behind a
// tap-to-expand row instead, so the default view stays scannable and the
// detail is still one tap away. Avg energy rides alongside the PR count
// since it's the other half of "how did this phase go" - both are per-phase
// summaries of the same underlying workout log, just different metrics.
function renderPRPhaseBreakdown(history, workoutLog) {
  const byPhase = computePRPhaseBreakdown(history);
  const energyByPhase = computeEnergyByPhase(workoutLog);
  const contentEl = document.getElementById("cycle-perf-prphase-content");

  // Sorted by PR count descending, not the fixed menstrual->luteal order -
  // that's the point of this card (see the design handoff).
  const phases = [...getCyclePhases()].sort((a, b) => byPhase[b.key].length - byPhase[a.key].length);
  const maxCount = Math.max(...phases.map(p => byPhase[p.key].length), 1);
  contentEl.innerHTML = phases.map(p => {
    const items = byPhase[p.key];
    const energy = energyByPhase[p.key];
    const pct = items.length ? Math.max((items.length / maxCount) * 100, 6) : 2;
    const energyText = energy
      ? `Avg Energy: ${energy.value.toFixed(1)}/10 <span class="prphase-energy-count">(${energy.count} workout${energy.count === 1 ? "" : "s"})</span>`
      : "No energy logged yet";
    const detailsHtml = items.length
      ? `<div class="prphase-details" hidden><ul class="prphase-exercise-list">${
          items.map(it => `<li class="prphase-exercise-item"><span>${it.name}</span><span class="prphase-exercise-value">${it.value} ${it.unit}</span></li>`).join("")
        }</ul></div>`
      : `<p class="prphase-exercises-empty">No PRs yet</p>`;
    return `
      <div class="prphase-row">
        <button type="button" class="prphase-row-top${items.length ? " prphase-expandable" : ""}">
          <span class="prphase-name"><span class="phase-dot" style="background:${p.color}"></span>${p.label}</span>
          <span class="prphase-count">${items.length} PR${items.length === 1 ? "" : "s"}${items.length ? '<span class="prphase-chevron">&#9662;</span>' : ""}</span>
        </button>
        <div class="prphase-bar-track">
          <div class="prphase-bar-fill" style="width:${pct}%; background:${p.color};"></div>
        </div>
        <p class="prphase-energy${energy ? "" : " placeholder"}">${energyText}</p>
        ${detailsHtml}
      </div>`;
  }).join("");
}

document.getElementById("cycle-perf-prphase-content").addEventListener("click", (e) => {
  const btn = e.target.closest(".prphase-expandable");
  if (!btn) return;
  const details = btn.closest(".prphase-row").querySelector(".prphase-details");
  details.hidden = !details.hidden;
  btn.classList.toggle("expanded", !details.hidden);
});

// Every set logged for one exercise, bucketed by the cycle phase its date
// fell in (not just the single all-time-best per phase computePRPhaseBreakdown
// tracks) - feeds the insight card's "peaked at ..." claim and its
// "which phase has the most data for this exercise" heuristic.
function computeExercisePhaseBests(history, exerciseName) {
  const rows = history.filter(x => x.exercise === exerciseName);
  const weightCount = rows.filter(x => x.weight_kg != null).length;
  const durationCount = rows.filter(x => x.duration_minutes != null).length;
  const metricKey = durationCount > weightCount ? "duration_minutes" : "weight_kg";
  const unit = metricKey === "weight_kg" ? "kg" : "min";
  const byPhase = {};
  getCyclePhases().forEach(p => { byPhase[p.key] = []; });
  rows.forEach(x => {
    const v = x[metricKey];
    if (v == null) return;
    const phase = cyclePhaseForDate(x.date);
    if (!phase) return;
    byPhase[phase.key].push({ value: v, unit, date: x.date });
  });
  return byPhase;
}

function renderCyclePerfInsight(exerciseName, byPhaseForExercise, workoutLog) {
  const cardEl = document.getElementById("cycle-perf-insight-card");
  const cycleDay = cycleDayForDate(todayStr);
  const phases = getCyclePhases();
  const currentPhase = cycleDay != null ? (phases.find(p => cycleDay >= p.startDay && cycleDay <= p.endDay) || phases[phases.length - 1]) : null;

  let bestPhaseEntry = null;
  phases.forEach(p => {
    const rows = byPhaseForExercise[p.key] || [];
    if (rows.length && (!bestPhaseEntry || rows.length > bestPhaseEntry.rows.length)) bestPhaseEntry = { phase: p, rows };
  });

  // No confident claim to make - render nothing rather than filler (per the
  // design handoff's explicit rule for this card).
  if (!currentPhase || !bestPhaseEntry) { cardEl.hidden = true; return; }

  const currentIndex = phases.indexOf(currentPhase);
  const nextPhase = phases[(currentIndex + 1) % phases.length];
  const daysUntilNext = nextPhase.startDay > cycleDay ? nextPhase.startDay - cycleDay : (CYCLE_LENGTH_DAYS - cycleDay) + nextPhase.startDay;
  const best = bestPhaseEntry.rows.reduce((m, r) => Math.max(m, r.value), 0);
  const unit = bestPhaseEntry.rows[0].unit;
  const nextLabel = nextPhase.label.replace(" Phase", "").toLowerCase();

  cardEl.hidden = false;
  document.getElementById("cycle-perf-insight-body").textContent =
    `You're ${daysUntilNext} day${daysUntilNext === 1 ? "" : "s"} from ${nextLabel}, where ${exerciseName} has peaked at ${best} ${unit}.`;

  const energyByPhase = computeEnergyByPhase(workoutLog);
  const e = energyByPhase[bestPhaseEntry.phase.key];
  const footnoteEl = document.getElementById("cycle-perf-insight-footnote");
  footnoteEl.hidden = !e;
  if (e) {
    footnoteEl.innerHTML = `Energy on ${bestPhaseEntry.phase.label.replace(" Phase", "").toLowerCase()} days averages <strong>${e.value.toFixed(1)}</strong>`;
  }
}

async function renderCyclePerfSection() {
  const emptyEl = document.getElementById("cycle-perf-empty");
  const contentEl = document.getElementById("cycle-perf-content");
  // Only needs exercise history, not cycle tracking - the chart itself
  // (colorForDate) and its legend already degrade gracefully to an
  // uncolored line when there's no cycle to plot against, same as the old
  // standalone "Your Performance" tab this was ported from.
  const history = await getExerciseHistory();
  const exercises = [...new Set(history.map(x => x.exercise))].sort();
  if (!exercises.length) {
    emptyEl.hidden = false;
    contentEl.hidden = true;
    return;
  }
  emptyEl.hidden = true;
  contentEl.hidden = false;

  if (!cyclePerfExercise || !exercises.includes(cyclePerfExercise)) {
    const counts = {};
    history.forEach(x => { counts[x.exercise] = (counts[x.exercise] || 0) + 1; });
    cyclePerfExercise = exercises.reduce((best, ex) => (counts[ex] > (counts[best] || 0) ? ex : best), exercises[0]);
  }
  renderCyclePerfChart(computeExerciseSeries(history, cyclePerfExercise), cyclePerfExercise);

  let workoutLog = [];
  try { workoutLog = await api.get("/api/workout-log"); } catch (err) { /* insight/PR-phase cards just show their empty states */ }
  renderPRPhaseBreakdown(history, workoutLog);
  renderCyclePerfInsight(cyclePerfExercise, computeExercisePhaseBests(history, cyclePerfExercise), workoutLog);
}

// ---- Exercise detail table ----
// A row has either intensity_level or speed_kmh (extra_attributes),
// never both - see the Level/Speed toggle in the logging form.
function levelSpeedDisplay(x) {
  // Treadmill/Cycling/Cross Trainer (see EXERCISE_EXTRA_FIELDS) can have
  // both set at once - show both rather than just whichever comes first.
  const parts = [];
  if (x.intensity_level != null) parts.push(`${x.intensity_level}`);
  if (x.speed_kmh != null) parts.push(`${x.speed_kmh} km/h`);
  return parts.join(" / ");
}

// Consecutive-or-not sets sharing the same Muscle Group + Exercise get
// grouped into one card, so that pair only needs to be shown once instead
// of repeated on every set - preserves first-seen group order and each
// group's original (API) set order.
function groupExerciseLogs(logs) {
  const groups = [];
  const byKey = new Map();
  for (const x of logs) {
    const key = `${x.muscle_group} ${x.exercise}`;
    let group = byKey.get(key);
    if (!group) {
      group = { muscle_group: x.muscle_group, exercise: x.exercise, sets: [] };
      byKey.set(key, group);
      groups.push(group);
    }
    group.sets.push(x);
  }
  return groups;
}

// One line per set instead of a label per field - joins whichever of
// reps/weight/duration/level-speed/notes actually apply to this set.
function exerciseSetSummary(x) {
  const parts = [];
  if (x.reps != null) parts.push(`${x.reps} reps`);
  // weight_kg === 0 is the bodyweight sentinel (see the BW toggle in
  // addSetRow) - a real, meaningful value, not "no weight recorded", so it
  // gets its own label instead of printing the confusing "0 kg".
  if (x.weight_kg != null) parts.push(x.weight_kg === 0 ? "BW" : `${x.weight_kg} kg`);
  if (x.duration_minutes != null) parts.push(`${x.duration_minutes} min`);
  const ls = levelSpeedDisplay(x);
  if (ls) parts.push(ls);
  if (x.notes) parts.push(x.notes);
  return parts.join(" · ") || "—";
}

function exerciseSetRowView(x) {
  // previous_values is only present once a row has actually been edited at
  // least once since this snapshot mechanism shipped - older edits (or a
  // never-edited set) just get the plain "Edited <when>" badge with no
  // "was ..." detail rather than a misleading blank one.
  const prevSummary = x.previous_values ? exerciseSetSummary(x.previous_values) : null;
  // A set added later (via the group editor's +Add Set, see
  // startGroupEdit/saveGroupEdit) gets an "Added" tag instead of "Edited" -
  // if it's since also been edited, Edited (with its "was ..." diff) is the
  // more relevant/recent info, so it takes priority rather than showing both.
  const badge = x.edited_at
    ? `<span class="edited-badge">Edited ${formatEditedAt(x.edited_at)}${prevSummary ? ` · was ${prevSummary}` : ""}</span>`
    : (x.added_at ? `<span class="edited-badge added-tag">Added ${formatEditedAt(x.added_at)}</span>` : "");
  return `
    <div class="exercise-set-row" data-id="${x.id}">
      <span class="exercise-set-number">Set ${x.set_number ?? ""}</span>
      <span class="exercise-set-summary">${exerciseSetSummary(x)}</span>
      ${badge}
    </div>`;
}

// A set removed via the group editor (see saveGroupEdit) is soft-deleted,
// not actually gone from the API response (see include_deleted=1 in
// loadExerciseDetail) - shown as its own line, struck through, instead of
// disappearing without a trace.
function exerciseSetDeletedRowView(x) {
  return `
    <div class="exercise-set-row exercise-set-row-deleted" data-id="${x.id}">
      <span class="exercise-set-number">Set ${x.set_number ?? ""}</span>
      <span class="exercise-set-summary deleted-summary">${exerciseSetSummary(x)}</span>
      <span class="edited-badge deleted-tag">Deleted ${formatEditedAt(x.deleted_at)}</span>
    </div>`;
}

// One Edit/Delete pair per exercise group (not per set, see startGroupEdit/
// the group-del-btn handler in bindExerciseRowEvents) - reuses the same
// .edit-btn/.del-btn classes/styling the old per-set buttons used.
function exerciseGroupView(group) {
  const activeSets = group.sets.filter(s => !s.deleted_at);
  const deletedSets = group.sets.filter(s => s.deleted_at);
  return `
    <div class="exercise-detail-group">
      <div class="exercise-detail-group-header">
        <span class="exercise-detail-group-title">${group.muscle_group} — ${group.exercise}</span>
        <span class="exercise-detail-group-actions">
          <button type="button" class="edit-btn group-edit-btn">Edit</button>
          <button type="button" class="del-btn group-del-btn">Delete</button>
        </span>
      </div>
      <div class="exercise-detail-group-body">${activeSets.map(exerciseSetRowView).join("")}${deletedSets.map(exerciseSetDeletedRowView).join("")}</div>
    </div>`;
}

function renderExerciseTable() {
  const groups = groupExerciseLogs(currentExerciseLogs);
  document.getElementById("exercise-detail-list").innerHTML = groups.map(exerciseGroupView).join("");
  bindExerciseRowEvents(groups);
}

function bindExerciseRowEvents(groups) {
  const list = document.getElementById("exercise-detail-list");
  list.querySelectorAll(".exercise-detail-group").forEach((groupEl, i) => {
    const group = groups[i];
    groupEl.querySelector(".group-edit-btn").addEventListener("click", () => startGroupEdit(groupEl, group));
    groupEl.querySelector(".group-del-btn").addEventListener("click", async () => {
      const ok = await confirmModal(`Delete all sets logged for ${group.muscle_group} – ${group.exercise} on ${currentDetailDate}?`, "Yes, Delete");
      if (!ok) return;
      await Promise.all(group.sets.map(s => api.del(`/api/exercise-log/${s.id}`)));
      exerciseHistoryCache = null; // stale after this delete - Your Performance re-fetches next time it's opened
      toast("Deleted");
      loadExerciseDetail(currentDetailDate);
    });
  });
}

// Swaps an exercise group's card into the exact same block used to log
// exercises in the first place (see addExerciseBlock/addSetRow) - built
// into a detached holder instead of the real Log Workout form, and
// prefilled from this group's existing sets rather than starting blank.
async function startGroupEdit(groupEl, group) {
  groupEl.innerHTML = `
    <div class="group-edit-holder"></div>
    <div class="exercise-set-actions group-edit-save-actions">
      <button type="button" class="save-btn">Save</button>
      <button type="button" class="cancel-btn">Cancel</button>
    </div>`;
  const holder = groupEl.querySelector(".group-edit-holder");
  const block = addExerciseBlock(holder);
  // Hides the block's own header (collapse chevron/title/✕ Remove) via CSS
  // - this group's own header above already shows the exercise name, and
  // Save/Cancel (not a per-exercise remove-block button) is what belongs here.
  block.classList.add("group-edit-mode");

  // Set the muscle field directly and await onBlockMuscleChange ourselves
  // (rather than relying on its fire-and-forget change-listener call) so
  // the exercise dropdown + block.__exerciseTypes are populated before
  // picking the exercise below.
  const muscleField = block.querySelector(".ex-muscle-field");
  block.querySelector(".ex-muscle").value = group.muscle_group;
  muscleField.querySelector(".option-field-value").textContent = group.muscle_group;
  muscleField.querySelector(".option-field-value").classList.remove("placeholder");
  await onBlockMuscleChange(block);
  setOptionFieldValue(block.querySelector(".ex-exercise-field"), group.exercise);

  // The exercise-change listener just guessed a default Level/Speed mode -
  // override it with what this group's sets actually use. Skipped for
  // Treadmill/Cycling/Cross Trainer, where Level and Speed are both always
  // captured at once (see EXERCISE_EXTRA_FIELDS) rather than being a choice.
  // Deleted sets (see exerciseGroupView/the "you deleted this set" line)
  // aren't editable - only ever prefill from what's still active.
  const activeSets = group.sets.filter(s => !s.deleted_at);

  const speedIsExtra = EXERCISE_EXTRA_FIELDS[group.exercise] === CARDIO_SPEED_FIELD;
  if (!speedIsExtra) {
    applyLevelMode(block, activeSets.some(s => s.speed_kmh != null) ? "speed" : "level");
  }

  const isCardio = block.dataset.exerciseType === "cardio";
  activeSets.forEach(s => {
    const row = addSetRow(block);
    row.dataset.existingId = s.id;
    // Setting .value directly (no "input" event dispatch) is deliberate -
    // addSetRow wires a debounced PR-guard on weight/duration that would
    // otherwise fire spurious "new PR" prompts while we're just populating
    // existing data, not entering a new one.
    if (isCardio) {
      row.querySelector(".set-duration").value = s.duration_minutes ?? "";
      const speedInput = row.querySelector(".set-speed");
      if (speedInput) speedInput.value = s.speed_kmh ?? "";
      else row.querySelector(".set-level").value = s.intensity_level ?? "";
    } else {
      row.querySelector(".set-reps").value = s.reps ?? "";
      row.querySelector(".set-weight").value = s.weight_kg ?? "";
      const bwBtn = row.querySelector(".set-bodyweight-btn");
      if (bwBtn) bwBtn.classList.toggle("active", String(s.weight_kg) === "0");
    }
    const extraInput = row.querySelector(".set-extra");
    if (extraInput) {
      const extraField = EXERCISE_EXTRA_FIELDS[group.exercise];
      extraInput.value = (extraField && s[extraField.key] != null) ? s[extraField.key] : "";
    }
  });
  if (block.querySelector(".ex-notes")) {
    block.querySelector(".ex-notes").value = activeSets[0]?.notes || "";
  }

  groupEl.querySelector(".group-edit-save-actions .save-btn").addEventListener("click", () => saveGroupEdit(block, group));
  groupEl.querySelector(".group-edit-save-actions .cancel-btn").addEventListener("click", () => {
    renderExerciseTable();
  });
}

// Loose per-field comparison - DB values are number|null, form values are
// parsed number|null too, but this avoids false positives from type
// mismatches (e.g. "0" vs 0) that would wrongly flag an untouched set as
// changed (see groupSetChanged/saveGroupEdit).
function valuesEqual(a, b) {
  if ((a == null || a === "") && (b == null || b === "")) return true;
  if (typeof a === "number" || typeof b === "number") return Number(a) === Number(b);
  return String(a) === String(b);
}

// Whether a set's about-to-be-saved body actually differs from what it
// already was - the backend unconditionally stamps edited_at/previous_values
// on every PUT (see update_exercise_log in app.py), so saving the whole
// group on every edit (even rows nobody touched) would wrongly mark every
// set in it "Edited" instead of just the one the user actually changed.
function groupSetChanged(original, setBody, extraFieldKey) {
  if ((original.muscle_group || "") !== (setBody.muscle_group || "")) return true;
  if ((original.exercise || "") !== (setBody.exercise || "")) return true;
  const keys = ["set_number", "notes", "reps", "weight_kg", "duration_minutes", "intensity_level", "speed_kmh"];
  if (extraFieldKey && !keys.includes(extraFieldKey)) keys.push(extraFieldKey);
  return keys.some(key => !valuesEqual(original[key], setBody[key]));
}

async function saveGroupEdit(block, group) {
  const isCardio = block.dataset.exerciseType === "cardio";
  const muscle_group = block.querySelector(".ex-muscle").value;
  const exercise = block.querySelector(".ex-exercise").value;
  const notes = block.querySelector(".ex-notes") ? block.querySelector(".ex-notes").value : "";
  const levelOverride = block.dataset.levelMode === "speed" ? CARDIO_SPEED_FIELD : null;
  const extraField = isCardio ? EXERCISE_EXTRA_FIELDS[exercise] : null;
  const rows = [...block.querySelectorAll(".set-row")];
  if (!muscle_group || !exercise || rows.length === 0) {
    toast("Pick a muscle group, exercise, and at least one set");
    return;
  }
  // Deleted sets aren't part of this reconciliation at all - they're not
  // rendered as editable rows (see startGroupEdit), so they can never show
  // up as "kept" or "removed" here.
  const activeSets = group.sets.filter(s => !s.deleted_at);
  const byId = new Map(activeSets.map(s => [String(s.id), s]));
  const keptIds = new Set();
  const newSets = [];
  try {
    for (const [i, row] of rows.entries()) {
      const setBody = {
        muscle_group, exercise, set_number: i + 1, notes: i === 0 ? notes : "",
        ...(isCardio ? {
          duration_minutes: parseFloat(row.querySelector(".set-duration").value) || null,
          ...(levelOverride
            ? { [levelOverride.key]: parseFloat(row.querySelector(".set-speed").value) || null }
            : { intensity_level: parseInt(row.querySelector(".set-level").value, 10) || null }),
        } : {
          reps: parseInt(row.querySelector(".set-reps").value, 10) || null,
          weight_kg: parseWeightKg(row.querySelector(".set-weight").value),
        }),
      };
      if (extraField) {
        const v = parseFloat(row.querySelector(".set-extra").value);
        setBody[extraField.key] = isNaN(v) ? null : v;
      }
      const existingId = row.dataset.existingId;
      if (existingId) {
        keptIds.add(existingId);
        const original = byId.get(existingId);
        if (original && !groupSetChanged(original, setBody, extraField && extraField.key)) continue;
        await api.put(`/api/exercise-log/${existingId}`, setBody);
      } else {
        newSets.push(setBody);
      }
    }
    if (newSets.length) {
      // mark_edited - this is a new set added to an already-logged exercise
      // (startGroupEdit only ever runs on a pre-existing group), not the
      // day's original entry, so it should cascade to the Workout Log
      // table's Edited badge the same way a value edit or a removed set does.
      await api.post("/api/exercise-log", { date: currentDetailDate, exercises: [{ muscle_group, exercise, sets: newSets }], mark_edited: true });
    }
    const removedIds = activeSets.map(s => String(s.id)).filter(id => !keptIds.has(id));
    // soft=1 - keeps the row (marked deleted, hidden everywhere else) so
    // the group still shows a "you deleted this set" line for it (see
    // exerciseSetDeletedRowView) instead of vanishing without a trace.
    await Promise.all(removedIds.map(id => api.del(`/api/exercise-log/${id}?soft=1`)));
    exerciseHistoryCache = null; // stale after this save - Your Performance re-fetches next time it's opened
    toast("Updated");
    loadExerciseDetail(currentDetailDate);
  } catch (err) {
    toast(err.message);
  }
}

// Callers (save/delete handlers, showExerciseDetail) don't await
// loadExerciseDetail, so a burst of edits/navigation can have several
// requests in flight at once - a generation counter (not just comparing
// dates) is what's needed to only ever apply the most recently *issued*
// request's result, since two requests for the very same date can still
// resolve out of order (e.g. two quick edits saved back to back).
let exerciseDetailRequestId = 0;

async function loadExerciseDetail(date) {
  const requestId = ++exerciseDetailRequestId;
  // include_deleted=1 - the only view that needs soft-deleted sets (see
  // delete_exercise_log/list_exercise_log in app.py) so it can show a
  // "you deleted this set" line for them (see exerciseGroupView).
  const logs = await api.get(`/api/exercise-log?date=${encodeURIComponent(date)}&include_deleted=1`);
  if (requestId !== exerciseDetailRequestId) return;
  currentExerciseLogs = logs;
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

// Only blocks with both a muscle group and an exercise chosen are "real" -
// promptAddExercise appends its block to the container the moment the
// muscle picker opens, before the exercise is picked, so a block abandoned
// between those two steps (app closed/backgrounded mid-pick, not just an
// explicit Cancel) can sit here with muscle_group set and exercise still
// empty. Saving that phantom entry into the draft is what let a stale
// "Start today's workout" silently skip the energy/food check-in on a later
// day - restoreDraft would recreate the empty block, its zero real sets
// would fall back to one blank set row, and exercisesContainer.children
// would read as "already in progress" even though nothing was ever
// actually logged. Dropping incomplete blocks here stops that at the
// source, instead of only patching it up on restore.
function collectExerciseBlocksDraft() {
  return [...exercisesContainer.querySelectorAll(".exercise-block")]
    .filter(block => block.querySelector(".ex-muscle").value && block.querySelector(".ex-exercise").value)
    .map(block => {
      const isCardio = block.dataset.exerciseType === "cardio";
      return {
        muscle_group: block.querySelector(".ex-muscle").value,
        exercise: block.querySelector(".ex-exercise").value,
        type: block.dataset.exerciseType || "strength",
        levelMode: block.dataset.levelMode || "level",
        notes: block.querySelector(".ex-notes").value,
        sets: [...block.querySelectorAll(".set-row")].map(row => {
          // levelValue holds whichever the 2nd cardio field currently is
          // (the generic Level wheel-picker, or the Speed stepper when the
          // block's levelMode is "speed") - restoreDraft figures out which
          // one to write back to the same way, based on what addSetRow
          // actually rendered for it.
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
  writeDraft({ date: logSessionDate, sessionFields, workoutId: savedWorkoutId });
}

function saveExerciseDraft() {
  if (restoringDraft) return;
  writeDraft({ exercises: collectExerciseBlocksDraft() });
}

document.getElementById("log-exercises-container").addEventListener("input", saveExerciseDraft);
document.getElementById("log-exercises-container").addEventListener("change", saveExerciseDraft);

async function restoreDraft() {
  const draft = readDraft();
  if (!draft) {
    restoringDraft = false;
    return;
  }

  try {
    if (draft.date) logSessionDate = draft.date;
    if (draft.sessionFields) sessionFields = { ...sessionFields, ...draft.sessionFields };
    if (draft.workoutId) savedWorkoutId = draft.workoutId;
    renderSessionStrip();

    if (draft.exercises && draft.exercises.length) {
      exercisesContainer.innerHTML = "";
      // Self-heals a draft saved before collectExerciseBlocksDraft started
      // filtering these out - an entry with no muscle/exercise never had
      // anything real logged against it, so recreating it here would just
      // reintroduce the phantom "already in progress" block the filter
      // above was added to prevent.
      for (const ex of draft.exercises.filter(e => e.muscle_group && e.exercise)) {
        const block = addExerciseBlock();
        block.classList.add("log-set-block");
        block.hidden = true;
        if (ex.muscle_group) {
          setOptionFieldValue(block.querySelector(".ex-muscle-field"), ex.muscle_group);
          await onBlockMuscleChange(block);
          setOptionFieldValue(block.querySelector(".ex-exercise-field"), ex.exercise || "");
        }
        block.dataset.exerciseType = ex.type || "strength";
        updateSetTypeToggle(block);
        block.dataset.levelMode = ex.levelMode || "level";
        block.dataset.extraFieldKey = (EXERCISE_EXTRA_FIELDS[ex.exercise] || {}).key || "";
        updateLevelModeToggle(block);
        block.querySelector(".ex-notes").value = ex.notes || "";
        const isCardio = block.dataset.exerciseType === "cardio";
        block.querySelector(".ex-sets").innerHTML = "";
        const sets = ex.sets && ex.sets.length ? ex.sets : [{}];
        sets.forEach(() => addSetRow(block));
        const rows = block.querySelectorAll(".set-row");
        sets.forEach((s, i) => {
          if (isCardio) {
            rows[i].querySelector(".set-duration").value = s.duration_minutes || "";
            const speedInput = rows[i].querySelector(".set-speed");
            if (speedInput) speedInput.value = s.levelValue || "";
            else rows[i].querySelector(".set-level").value = s.levelValue || "";
          } else {
            rows[i].querySelector(".set-reps").value = s.reps || "";
            rows[i].querySelector(".set-weight").value = s.weight_kg || "";
          }
          const extraInput = rows[i].querySelector(".set-extra");
          if (extraInput && s.extraValue != null) extraInput.value = s.extraValue;
        });
      }
      currentExerciseIndex = 0;
      toast("Restored your unsaved entry");
    }
  } finally {
    restoringDraft = false;
    setActiveExerciseIndex(exercisesContainer.children.length ? 0 : -1);
  }
}

// loadMuscleOptions()/checkOnboarding() already kicked off earlier
// (see "Onboarding / profile picker"); restoreDraft() runs per-profile
// from inside selectProfile() once we know who's using the app.

