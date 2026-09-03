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
let authDraft = { email: "", signup: {} };

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

// Just the email/signup/login/name steps — leaves the landing page alone,
// since those steps sit on top of it (it's their backdrop, not a screen
// they replace).
function hideAuthModalsOnly() {
  document.getElementById("auth-name-modal").hidden = true;
  document.getElementById("auth-email-modal").hidden = true;
  document.getElementById("auth-otp-modal").hidden = true;
  document.getElementById("auth-signup-modal").hidden = true;
  document.getElementById("auth-login-modal").hidden = true;
  document.getElementById("auth-reset-otp-modal").hidden = true;
  document.getElementById("auth-reset-pin-modal").hidden = true;
}

function hideAllAuthModals() {
  document.getElementById("landing-page").hidden = true;
  hideAuthModalsOnly();
}

// Moves between the email/signup/login/name steps. The landing page stays
// visible underneath throughout — these modals are meant to appear over the
// hero screen, not over whatever the logged-in app happens to be showing.
function showAuthModal(id) {
  hideAuthModalsOnly();
  document.getElementById(id).hidden = false;
}

function showAuthStep(id) {
  hideAllAuthModals();
  document.getElementById(id).hidden = false;
}

function prefersReducedMotion() {
  return window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

// Re-shows the landing page with its entrance transition (used after a
// logout, when it had actually been hidden behind the logged-in app).
function presentLandingPage() {
  showAuthStep("landing-page");
  const landingPage = document.getElementById("landing-page");
  if (prefersReducedMotion()) return;
  landingPage.classList.add("landing-page-entering");
  landingPage.addEventListener("animationend", () => {
    landingPage.classList.remove("landing-page-entering");
  }, { once: true });
}

async function onLoggedIn(user, { isNewSignup = false } = {}) {
  // Block autosave while we tear down whatever was on screen before (e.g. a
  // previous session on a shared device): it's a reset, not something that
  // should overwrite the incoming user's own draft.
  restoringDraft = true;
  resetWorkoutFlowUI();

  currentUser = user;
  currentUserId = user.id;
  // Stale otherwise on a shared device: this in-memory cache survives a
  // login/logout pair (no full page reload happens between them), so
  // without this the incoming user could see the previous account's
  // exercise history - or, if the previous account had none, an empty
  // Performance chart despite this user having real logged sets.
  exerciseHistoryCache = null;

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
  await autoFinalizeStaleDraft(); // a leftover draft from a previous day gets saved to History, not kept "in progress" forever

  switchTab("today");

  if (isNewSignup) {
    // Give the Today screen a moment to finish rendering (streak ring,
    // cycle card, etc.) before measuring elements for the tour spotlight.
    setTimeout(startTour, 400);
  }
}

const landingTrack = document.getElementById("landing-track");
const landingSplash = document.getElementById("landing-splash");

function openLandingMain() {
  landingTrack.classList.add("is-open");
}

landingSplash.addEventListener("click", openLandingMain);

// Auto-advance past the splash after a few seconds even with no tap/
// swipe - it's a brief brand moment, not something a first-time visitor
// should have to know to dismiss. Guarded on landing-page still being the
// visible screen (not hidden by a fast checkAuth() login, and not already
// past the splash) so this can't fire the transition after the user's
// moved on some other way.
setTimeout(() => {
  const landingPage = document.getElementById("landing-page");
  if (!landingPage.hidden && !landingTrack.classList.contains("is-open")) {
    openLandingMain();
  }
}, 5000);

let landingTouchStartX = null;
landingSplash.addEventListener("touchstart", (e) => {
  landingTouchStartX = e.touches[0].clientX;
}, { passive: true });
landingSplash.addEventListener("touchend", (e) => {
  if (landingTouchStartX === null) return;
  const dx = e.changedTouches[0].clientX - landingTouchStartX;
  landingTouchStartX = null;
  if (Math.abs(dx) > 20) openLandingMain();
});

document.getElementById("landing-start-btn").addEventListener("click", () => {
  showAuthModal("auth-email-modal");
});

document.getElementById("auth-email-back").addEventListener("click", () => {
  hideAuthModalsOnly();
});

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function goToSignupDetails() {
  const signupForm = document.getElementById("form-auth-signup");
  signupForm.reset();
  setDateFieldValue(signupForm.querySelector('[name="last_period_date"]').closest(".date-field"), "");
  document.getElementById("signup-period-date-label").hidden = true;
  showAuthModal("auth-signup-modal");
}

document.getElementById("form-auth-email").addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = new FormData(e.target).get("email").trim();
  if (!EMAIL_RE.test(email)) {
    toast("Enter a valid email address");
    return;
  }
  try {
    const res = await api.post("/api/check-email", { email });
    authDraft.email = email;
    if (res.exists) {
      document.getElementById("form-auth-login").reset();
      document.getElementById("auth-login-name").textContent = res.name;
      showAuthModal("auth-login-modal");
    } else {
      await api.post("/api/send-otp", { email });
      document.getElementById("form-auth-otp").reset();
      document.getElementById("auth-otp-email").textContent = email;
      showAuthModal("auth-otp-modal");
      startOtpResendCooldown(30);
    }
  } catch (err) {
    toast(err.message);
  }
});

let otpResendCooldownTimer = null;

function startOtpResendCooldown(seconds) {
  const btn = document.getElementById("auth-otp-resend");
  clearInterval(otpResendCooldownTimer);
  let remaining = seconds;
  btn.disabled = true;
  btn.textContent = `Resend code (${remaining}s)`;
  otpResendCooldownTimer = setInterval(() => {
    remaining -= 1;
    if (remaining <= 0) {
      clearInterval(otpResendCooldownTimer);
      btn.disabled = false;
      btn.textContent = "Resend code";
    } else {
      btn.textContent = `Resend code (${remaining}s)`;
    }
  }, 1000);
}

document.getElementById("form-auth-otp").addEventListener("submit", async (e) => {
  e.preventDefault();
  const code = new FormData(e.target).get("code").trim();
  try {
    await api.post("/api/verify-otp", { email: authDraft.email, code });
    clearInterval(otpResendCooldownTimer);
    goToSignupDetails();
  } catch (err) {
    toast(err.message);
  }
});

document.getElementById("auth-otp-resend").addEventListener("click", async () => {
  try {
    await api.post("/api/send-otp", { email: authDraft.email });
    toast("Code resent");
    startOtpResendCooldown(30);
  } catch (err) {
    toast(err.message);
  }
});

document.getElementById("auth-otp-back").addEventListener("click", () => {
  clearInterval(otpResendCooldownTimer);
  showAuthModal("auth-email-modal");
});

document.getElementById("auth-signup-back").addEventListener("click", () => {
  showAuthModal("auth-email-modal");
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

document.getElementById("form-auth-signup").addEventListener("submit", (e) => {
  e.preventDefault();
  if (signupTrackCycle.checked && !e.target.querySelector('[name="last_period_date"]').value) {
    toast("Add your last period date, or turn off cycle tracking");
    return;
  }
  authDraft.signup = Object.fromEntries(new FormData(e.target).entries());
  document.getElementById("form-auth-name").reset();
  showAuthModal("auth-name-modal");
});

document.getElementById("auth-name-back").addEventListener("click", () => {
  showAuthModal("auth-signup-modal");
});

document.getElementById("form-auth-name").addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = new FormData(e.target).get("name").trim();
  const body = { ...authDraft.signup, name, email: authDraft.email };
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
  showAuthModal("auth-email-modal");
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

let resetOtpResendCooldownTimer = null;

function startResetOtpResendCooldown(seconds) {
  const btn = document.getElementById("auth-reset-otp-resend");
  clearInterval(resetOtpResendCooldownTimer);
  let remaining = seconds;
  btn.disabled = true;
  btn.textContent = `Resend code (${remaining}s)`;
  resetOtpResendCooldownTimer = setInterval(() => {
    remaining -= 1;
    if (remaining <= 0) {
      clearInterval(resetOtpResendCooldownTimer);
      btn.disabled = false;
      btn.textContent = "Resend code";
    } else {
      btn.textContent = `Resend code (${remaining}s)`;
    }
  }, 1000);
}

document.getElementById("auth-login-forgot").addEventListener("click", async () => {
  try {
    await api.post("/api/forgot-pin", { email: authDraft.email });
    document.getElementById("form-auth-reset-otp").reset();
    document.getElementById("auth-reset-otp-email").textContent = authDraft.email;
    showAuthModal("auth-reset-otp-modal");
    startResetOtpResendCooldown(30);
  } catch (err) {
    toast(err.message);
  }
});

document.getElementById("form-auth-reset-otp").addEventListener("submit", async (e) => {
  e.preventDefault();
  const code = new FormData(e.target).get("code").trim();
  try {
    await api.post("/api/verify-reset-otp", { email: authDraft.email, code });
    clearInterval(resetOtpResendCooldownTimer);
    document.getElementById("form-auth-reset-pin").reset();
    showAuthModal("auth-reset-pin-modal");
  } catch (err) {
    toast(err.message);
  }
});

document.getElementById("auth-reset-otp-resend").addEventListener("click", async () => {
  try {
    await api.post("/api/forgot-pin", { email: authDraft.email });
    toast("Code resent");
    startResetOtpResendCooldown(30);
  } catch (err) {
    toast(err.message);
  }
});

document.getElementById("auth-reset-otp-back").addEventListener("click", () => {
  clearInterval(resetOtpResendCooldownTimer);
  showAuthModal("auth-login-modal");
});

document.getElementById("form-auth-reset-pin").addEventListener("submit", async (e) => {
  e.preventDefault();
  const pin = new FormData(e.target).get("pin");
  try {
    await api.post("/api/reset-pin", { email: authDraft.email, pin });
    toast("PIN reset - log in with your new PIN");
    document.getElementById("form-auth-login").reset();
    showAuthModal("auth-login-modal");
  } catch (err) {
    toast(err.message);
  }
});

async function handleLogout() {
  document.getElementById("streak-info-modal").hidden = true;
  await api.post("/api/logout", {});
  currentUser = null;
  currentUserId = null;
  exerciseHistoryCache = null;
  authDraft = { email: "", signup: {} };
  restoringDraft = true;
  resetWorkoutFlowUI();
  presentLandingPage();
}

async function checkAuth() {
  const user = await api.get("/api/me");
  if (user) {
    await onLoggedIn(user);
  } else {
    showAuthStep("landing-page");
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

// ---------------- Phase info modal ----------------
const phaseInfoModal = document.getElementById("phase-info-modal");
function openPhaseInfoModal() {
  renderPhaseList();
  phaseInfoModal.hidden = false;
}
document.getElementById("today-cycle-phase").addEventListener("click", (e) => {
  e.stopPropagation();
  openPhaseInfoModal();
});
document.getElementById("phase-info-close").addEventListener("click", () => { phaseInfoModal.hidden = true; });
phaseInfoModal.addEventListener("click", (e) => { if (e.target === phaseInfoModal) phaseInfoModal.hidden = true; });
// Same reference modal as Today's phase tap above - the Cycle tab's own
// Current/Next Phase values are just as good a place to reach it from,
// now that they're color-coded per phase and read as tappable.
document.getElementById("cycle-current-phase").addEventListener("click", openPhaseInfoModal);
document.getElementById("cycle-next-phase").addEventListener("click", openPhaseInfoModal);

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
function setProfileWeightUnitToggle(unit) {
  document.getElementById("profile-weight-unit-input").value = unit;
  document.querySelectorAll("#profile-weight-unit-toggle .set-type-btn").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.unit === unit);
  });
}

function openProfileEditModal() {
  document.getElementById("profile-name").value = currentUser.name || "";
  document.getElementById("profile-age").value = currentUser.age ?? "";
  setProfileWeightUnitToggle(currentUser.weight_unit || "kg");
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
document.getElementById("today-avatar-contact-btn").addEventListener("click", () => {
  closeAvatarMenu();
  document.getElementById("contact-us-modal").hidden = false;
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

// ---------------- Privacy info modal ----------------
const contactUsModal = document.getElementById("contact-us-modal");
document.getElementById("contact-us-close").addEventListener("click", () => { contactUsModal.hidden = true; });
contactUsModal.addEventListener("click", (e) => { if (e.target === contactUsModal) contactUsModal.hidden = true; });

const privacyInfoModal = document.getElementById("privacy-info-modal");
document.getElementById("profile-privacy-link-btn").addEventListener("click", () => { privacyInfoModal.hidden = false; });
document.getElementById("privacy-info-close").addEventListener("click", () => { privacyInfoModal.hidden = true; });
privacyInfoModal.addEventListener("click", (e) => { if (e.target === privacyInfoModal) privacyInfoModal.hidden = true; });

// ---------------- Delete account ----------------
// Two-step, not one: a plain confirmModal first (catches "I didn't mean to
// tap that"), then a second modal that re-checks the PIN itself (catches a
// session left open on a shared/unlocked phone) - the same "measure twice"
// treatment reset-pin's OTP re-verification gets, for the one action here
// that can't be undone afterward.
document.getElementById("profile-delete-account-btn").addEventListener("click", async () => {
  const ok = await confirmModal(
    "This permanently deletes your account and everything logged under it — workouts, PRs, cycle history, streaks. This can't be undone.",
    "Continue"
  );
  if (!ok) return;
  document.getElementById("form-delete-account").reset();
  document.getElementById("delete-account-modal").hidden = false;
});

document.getElementById("delete-account-cancel").addEventListener("click", () => {
  document.getElementById("delete-account-modal").hidden = true;
});

document.getElementById("form-delete-account").addEventListener("submit", async (e) => {
  e.preventDefault();
  const pin = new FormData(e.target).get("pin");
  try {
    await api.post(`/api/user/${currentUser.id}/delete-account`, { pin });
    document.getElementById("delete-account-modal").hidden = true;
    closeProfileEditModal();
    toast("Account deleted");
    await handleLogout();
  } catch (err) {
    toast(err.message);
  }
});

// ---------------- Discover tab (data-maintab/id stay "you" - see the HTML
// comment above #maintab-you for why) ----------------
function renderYouTab() {
  document.getElementById("card-pending-exercises").hidden = !currentUser.is_admin;
  if (currentUser.is_admin) loadPendingExercises();
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

// Now a modal-overlay (relocated out of Discover's tab content, see the
// HTML comment by #card-pending-exercises) rather than an always-inline
// card, so it needs its own close affordance - same click-outside-to-close
// pattern as the other modal-overlays (e.g. phaseInfoModal above).
const pendingExercisesModal = document.getElementById("card-pending-exercises");
document.getElementById("pending-exercises-close").addEventListener("click", () => { pendingExercisesModal.hidden = true; });
pendingExercisesModal.addEventListener("click", (e) => { if (e.target === pendingExercisesModal) pendingExercisesModal.hidden = true; });

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

document.querySelectorAll("#profile-weight-unit-toggle .set-type-btn").forEach(btn => {
  btn.addEventListener("click", () => setProfileWeightUnitToggle(btn.dataset.unit));
});

// ---------------- Your Cycle ----------------
// Every cycle is still estimated as a standard 28 days - the simplified
// 4-phase model most consumer cycle-tracking apps use absent more history.
// Period (menstrual phase) length is NOT one constant across all cycles
// though - each period the user actually logs (currentUser.period_logs,
// one row per Log Period save, see routes/auth.py's log_period) keeps its
// own length, so a 7-day period logged this month doesn't repaint any other
// month's phase boundaries. A date that isn't covered by a logged period's
// own ~28-day window (a future cycle nobody's confirmed yet, or before
// tracking started) falls back to DEFAULT_PERIOD_DAYS. Mirrors cycle.py's
// governing_period()/period_length_for_date() so client and server never
// disagree. Phase boundaries are computed per-date rather than once per
// render - call getCyclePhases(dateStr) once per date you need and reuse
// that array/objects (each call builds new objects, so a phase object from
// one call won't === one from another).
const DEFAULT_CYCLE_LENGTH_DAYS = 28;
const DEFAULT_PERIOD_DAYS = 5;
// Mirrors routes/auth.py's MIN/MAX_PERIOD_DAYS - checked client-side before
// Save so a selection spanning two far-apart months gets a clear "why"
// (the gap between the earliest and latest tapped day, not the count of
// days actually tapped) instead of the backend's generic rejection.
const MIN_PERIOD_DAYS = 1;
const MAX_PERIOD_DAYS = 10;

// Per-user (currentUser.cycle_length_days, set via Edit Profile) - a
// function, not a cached const, so it always reflects whatever's currently
// logged in rather than going stale across a profile edit or account switch.
function cycleLengthDays() {
  // Number(...): the profile form's own optimistic merge (see
  // form-profile's submit handler) briefly holds this as a FormData string
  // until the next full user refetch - the phase math below needs a real
  // number, not "30", for its arithmetic to behave.
  const n = currentUser && Number(currentUser.cycle_length_days);
  return n || DEFAULT_CYCLE_LENGTH_DAYS;
}

function daysBetweenIso(fromIso, toIso) {
  const from = new Date(fromIso + "T00:00:00");
  const to = new Date(toIso + "T00:00:00");
  return Math.floor((to - from) / 86400000);
}

// The logged period (from currentUser.period_logs) that governs dateStr -
// the latest one starting on or before it. If dateStr is earlier than every
// logged period, falls back to the *earliest* one instead of null, so a
// date before any tracked period still gets a projected phase (28-day cycle
// math is symmetric - it works extrapolating backward from an anchor the
// same way it works extrapolating forward). null only if nothing's been
// logged at all. Note this means the days-since-start below can come back
// negative - periodLengthForDate/cyclePhaseForDate account for that by only
// trusting the governing period's own logged length when days-since is
// also >= 0.
function governingPeriod(dateStr) {
  const periods = (currentUser && currentUser.period_logs) || [];
  let governing = null;
  for (const p of periods) {
    if (p.start_date > dateStr) break;
    governing = p;
  }
  if (!governing && periods.length) governing = periods[0];
  return governing;
}

// The menstrual-phase length that applies to dateStr's cycle: the governing
// period's own logged length if dateStr falls within *that* period's own
// 28-day window, otherwise DEFAULT_PERIOD_DAYS - a later, unconfirmed
// projected cycle (or an earlier one being extrapolated backward from the
// earliest logged period) never inherits a different cycle's custom length.
function periodLengthForDate(dateStr) {
  const governing = governingPeriod(dateStr);
  if (!governing) return DEFAULT_PERIOD_DAYS;
  const daysSince = daysBetweenIso(governing.start_date, dateStr);
  return daysSince >= 0 && daysSince < cycleLengthDays() ? governing.length_days : DEFAULT_PERIOD_DAYS;
}

// dateStr defaults to today - most callers (phase legends, the phase-key
// scaffolding for a byPhase map, PR-phase sorting) just want "the current
// set of phase boundaries" for display, not a specific date's.
// Ovulation day is pinned 14 days before the cycle's end rather than a
// fixed "day 14" - the luteal phase (ovulation to next period) runs a
// fairly constant ~14 days regardless of overall cycle length, so it's the
// follicular phase that actually absorbs a longer or shorter cycle. For the
// default 28-day cycle this is exactly the original fixed day-14 behavior.
function getCyclePhases(dateStr = todayStr) {
  const periodDays = periodLengthForDate(dateStr);
  const cycleLength = cycleLengthDays();
  const ovulationDay = cycleLength - 14;
  return [
    { key: "menstrual", label: "Menstrual Phase", startDay: 1, endDay: periodDays, color: "#f4436c" },
    { key: "follicular", label: "Follicular Phase", startDay: periodDays + 1, endDay: ovulationDay - 1, color: "#17c993" },
    { key: "ovulation", label: "Ovulation Phase", startDay: ovulationDay, endDay: ovulationDay, color: "#f5a623" },
    { key: "luteal", label: "Luteal Phase", startDay: ovulationDay + 1, endDay: cycleLength, color: "#22d3ee" },
  ];
}

// day/phases must come from the same dateStr (e.g. cycleDayForDate(dateStr)
// and getCyclePhases(dateStr)) - phases aren't looked up internally here so
// a caller that already has both (renderPhaseList/renderCycleTab, both for
// "today") isn't forced to recompute phases twice.
function cyclePhaseForDay(day, phases = getCyclePhases()) {
  return phases.find(p => day >= p.startDay && day <= p.endDay) || phases[phases.length - 1];
}

// Cycle day (1-28) for an arbitrary date, not just today - shared by the
// Your Cycle tab summary and the phase dot next to each date in workout
// history. Returns null if there's no logged period on or before dateStr.
function cycleDayForDate(dateStr) {
  const governing = governingPeriod(dateStr);
  if (!governing) return null;
  const daysSince = daysBetweenIso(governing.start_date, dateStr);
  // +1 so the governing period's start_date itself is cycle day 1, not day 0.
  const len = cycleLengthDays();
  return (((daysSince % len) + len) % len) + 1;
}

function cyclePhaseForDate(dateStr) {
  const day = cycleDayForDate(dateStr);
  return day == null ? null : cyclePhaseForDay(day, getCyclePhases(dateStr));
}

// Kept in sync here (not left as static HTML) since period length is
// per-user and adjustable via Log Period - a fixed "Day 1-5" would go stale
// the moment someone changes it. Shared by the Cycle tab render and the
// phase-info modal (opened from Today's phase label), since both display
// the same four phase cards.
function renderPhaseList() {
  const phasesForList = getCyclePhases(todayStr);
  // Ovulation/luteal used to be safe as static HTML ("Day 14"/"Day 15-28")
  // since a fixed 28-day cycle never moved them - now that cycle length is
  // per-user (see cycleLengthDays()), all four need the same dynamic
  // treatment menstrual/follicular already got, or they'd go stale for
  // anyone whose cycle isn't ~28 days.
  ["menstrual", "follicular", "ovulation", "luteal"].forEach(key => {
    const phase = phasesForList.find(p => p.key === key);
    document.getElementById(`cycle-phase-days-${key}`).textContent =
      phase.startDay === phase.endDay ? `Day ${phase.startDay}` : `Day ${phase.startDay}-${phase.endDay}`;
  });

  const cycleDay = cycleDayForDate(todayStr);
  const currentPhase = cycleDay == null ? null : cyclePhaseForDay(cycleDay, phasesForList);
  document.querySelectorAll(".cycle-phase-card").forEach(c => c.classList.toggle("active", !!currentPhase && c.dataset.phase === currentPhase.key));
}

async function renderCycleTab() {
  await refreshWorkoutVisitDates();
  renderCycleCalendar();
  renderPhaseList();

  const currentBlock = document.getElementById("cycle-current-block");
  const nextBlock = document.getElementById("cycle-next-block");
  const estimateInfoBtn = document.getElementById("cycle-estimate-info-btn");
  const cycleDay = cycleDayForDate(todayStr);
  if (cycleDay == null) {
    currentBlock.hidden = true;
    nextBlock.hidden = true;
    estimateInfoBtn.hidden = true;
    document.getElementById("cycle-estimate-popover").hidden = true;
    return;
  }
  currentBlock.hidden = false;
  nextBlock.hidden = false;
  estimateInfoBtn.hidden = false;
  document.getElementById("cycle-estimate-length").textContent = cycleLengthDays();

  // Looked up against one phases array (not cyclePhaseForDay's own internal
  // call) so currentPhase is === one of this array's own objects - needed
  // for indexOf to find it below.
  const phases = getCyclePhases(todayStr);
  const currentPhase = phases.find(p => cycleDay >= p.startDay && cycleDay <= p.endDay) || phases[phases.length - 1];
  const currentIndex = phases.indexOf(currentPhase);
  const nextPhase = phases[(currentIndex + 1) % phases.length];
  const daysUntilNext = nextPhase.startDay > cycleDay
    ? nextPhase.startDay - cycleDay
    : (cycleLengthDays() - cycleDay) + nextPhase.startDay;

  const nextPhaseDate = new Date(todayStr + "T00:00:00");
  nextPhaseDate.setDate(nextPhaseDate.getDate() + daysUntilNext);
  const nextPhaseDateLabel = nextPhaseDate.toLocaleDateString("en-US", { month: "short", day: "numeric" });

  const currentPhaseEl = document.getElementById("cycle-current-phase");
  currentPhaseEl.textContent = currentPhase.label;
  currentPhaseEl.style.color = currentPhase.color;
  document.getElementById("cycle-current-detail").textContent = `Day ${cycleDay} of ~${cycleLengthDays()}`;
  const nextPhaseEl = document.getElementById("cycle-next-phase");
  nextPhaseEl.textContent = nextPhase.label;
  nextPhaseEl.style.color = nextPhase.color;
  document.getElementById("cycle-next-detail").textContent = `Starts in ${daysUntilNext} day${daysUntilNext === 1 ? "" : "s"} (${nextPhaseDateLabel})`;
}

// ---------------- Period calendar ----------------
// Normally a read-only month view marking every projected menstrual-phase
// day - reuses cyclePhaseForDate so it never drifts from the phase math
// already driving the summary above and the History dots.
//
// Log Period switches it into a logging mode where every day currently
// covered by a real logged period (currentUser.period_logs) starts out
// already selected - solid fill, exactly like a fresh tap - rather than
// some separate "already logged" look. That was tried (an outline, then a
// dot) specifically to avoid this, but both ended up reading as "not
// really selected", so tapping a day to remove it looked like nothing
// happened and got tapped again, re-adding it. One state is simpler and
// can't be misread: solid = currently included, blank = not. Tap a solid
// day to remove it, tap a blank one to add it - identical either way,
// whether the day came from real history or a fresh tap this session.
//
// originalPeriodLogs snapshots currentUser.period_logs at the moment
// logging mode opens, so Save can work out which whole periods got fully
// deselected (delete those rows) versus which still have at least one
// selected day (upsert, same as ever) - see the save handler below.
//
// A gap between selected days (not consecutive dates) means separate
// periods - see clusterPeriodDates - so logging two different past
// periods at once is one Save, not one Log Period trip per period. Only
// the very first tap (when nothing at all is selected yet) is restricted
// to today-or-earlier, since you can't say a period starts in the future;
// with any real history already pre-selected, that restriction naturally
// doesn't apply from the moment logging mode opens.
let cycleCalViewYear, cycleCalViewMonth;
let periodLogging = false;
let periodLogDates = new Set();
let originalPeriodLogs = [];

// Dates (YYYY-MM-DD) with an actual workout logged (has exercises, not just
// a rest-day check-in) - drives the calendar's gym-visit dot. Refetched
// each time the Cycle tab renders so a workout logged elsewhere shows up
// without requiring a full page reload.
let workoutVisitDates = new Set();
async function refreshWorkoutVisitDates() {
  try {
    const rows = await api.get("/api/workout-log");
    workoutVisitDates = new Set(rows.filter(r => r.muscles).map(r => r.date));
  } catch (err) { /* calendar just shows no visit dots */ }
}

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
    if (workoutVisitDates.has(iso)) cell.classList.add("visited");
    if (periodLogging) {
      if (periodLogDates.size === 0 && iso > todayStr) {
        cell.disabled = true;
      } else {
        cell.classList.add("selectable");
        cell.addEventListener("click", () => selectPeriodLogDay(iso));
      }
      // Solid fill = currently included (real history that's still
      // selected, or a fresh tap - no distinction, see the comment above
      // this section). Blank = not included, whether that's a day that was
      // never logged or one that just got deselected. Dashed outline, no
      // fill = not real, just the same 28-day-cycle projection the
      // read-only view below also shows dashed (the "Estimated" legend) -
      // same treatment in both places now, so it can never be mistaken for
      // an actual selection (a solid wash) but still doesn't look like the
      // day went blank for no reason.
      if (periodLogDates.has(iso)) {
        cell.classList.add("period");
      } else {
        const phase = cyclePhaseForDate(iso);
        if (phase && phase.key === "menstrual") cell.classList.add("period-predicted");
      }
    } else if (hasPeriodDate) {
      // Not disabled here (unlike a future day during logging) - just a
      // plain inert button with no click handler, so it reads as normal
      // text rather than the dimmed :disabled style.
      const phase = cyclePhaseForDate(iso);
      if (phase && phase.key === "menstrual") {
        // Solid = an actually-logged day (currentUser.period_logs). Dashed
        // outline, no fill = the same 28-day-cycle projection this whole
        // view is otherwise built on (the "Estimated period" legend) but
        // with nothing real backing this particular day - e.g. the next
        // cycle's guessed-at period before it's actually happened. Was
        // solid red for both until now, which read as "already logged"
        // for a date that's sometimes still days away.
        cell.classList.add(isLoggedPeriodDay(iso) ? "period" : "period-predicted");
      }
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
// Was switchTab("you") - a leftover from before profile editing moved off
// that tab (now "Discover") and into its own modal off the Today avatar
// (see openProfileEditModal). Left un-updated, this sent "Go to Profile"
// to a tab with no profile fields on it at all.
document.getElementById("cycle-calendar-add-date-btn").addEventListener("click", openProfileEditModal);

// True if iso falls inside an actually-saved period (currentUser.period_logs)
// - not the phase-projected estimate every menstrual-phase day otherwise
// gets colored by, a real start_date/length_days row. Used by the
// read-only calendar to tell a real logged day (solid) apart from a purely
// projected one (dashed) - see renderCycleCalendar.
function isLoggedPeriodDay(iso) {
  const periods = (currentUser && currentUser.period_logs) || [];
  return periods.some(p => iso >= p.start_date && iso <= addDaysIso(p.start_date, p.length_days - 1));
}

// ---------------- Log Period ----------------
// Groups a Set of tapped ISO dates into separate periods, splitting on any
// gap (a day not immediately following the previous one) - dates is
// unordered so this sorts first. Each returned {start, end, length} is one
// contiguous run, always <= MAX_PERIOD_DAYS worth of *possible* days by
// construction only if the caller checks it (this just clusters, it
// doesn't validate).
function clusterPeriodDates(dates) {
  const sorted = [...dates].sort();
  const clusters = [];
  let current = [];
  for (const iso of sorted) {
    if (current.length && addDaysIso(current[current.length - 1], 1) !== iso) {
      clusters.push(current);
      current = [];
    }
    current.push(iso);
  }
  if (current.length) clusters.push(current);
  return clusters.map(days => ({ start: days[0], end: days[days.length - 1], length: days.length }));
}

function selectPeriodLogDay(iso) {
  if (periodLogDates.has(iso)) {
    periodLogDates.delete(iso);
  } else {
    periodLogDates.add(iso);
  }
  renderCycleCalendar();
}

document.getElementById("cycle-log-period-btn").addEventListener("click", () => {
  periodLogging = true;
  // Pre-load every day of every already-logged period as selected (see the
  // comment above this section) - a deep-ish copy since length_days gets
  // read from this snapshot after currentUser.period_logs itself may have
  // already moved on (deletes below update it mid-save).
  originalPeriodLogs = (currentUser.period_logs || []).map(p => ({ ...p }));
  periodLogDates = new Set();
  originalPeriodLogs.forEach(p => {
    for (let i = 0; i < p.length_days; i++) periodLogDates.add(addDaysIso(p.start_date, i));
  });
  renderCycleCalendar();
});

document.getElementById("cycle-cal-log-cancel").addEventListener("click", () => {
  periodLogging = false;
  periodLogDates = new Set();
  originalPeriodLogs = [];
  renderCycleCalendar();
});

// Deletes one period_logs row and re-derives last_period_date/
// period_length_days from whatever's now the latest remaining one (mirrors
// the backend's own recompute) - used by Save for every originally-logged
// period that ended up with no selected days left in it at all.
async function deletePeriodRow(startDate) {
  const res = await api.del(`/api/user/${currentUserId}/period/${startDate}`);
  if (!res.ok) throw new Error((await res.json()).error || "Couldn't update that period");
  const data = await res.json();
  currentUser.period_logs = (currentUser.period_logs || []).filter(p => p.start_date !== startDate);
  currentUser.last_period_date = data.last_period_date;
  currentUser.period_length_days = data.period_length_days;
}

// Every phase-aware chart (PR-by-phase, Performance-by-Time, History's
// phase dots, the hormone-pattern day marker) computes phase live from
// cyclePhaseForDate on every render - see the Period calendar comment
// above - rather than storing it on the workout when logged, so it can
// backfill correctly (see Log Period's own "if you missed logging it").
// That means editing or deleting a period can silently reshuffle which
// phase a *past* workout is attributed to, with no chart-side signal that
// it happened. These three make that visible in the Save toast instead.
async function snapshotWorkoutPhasesByDate() {
  const history = await getExerciseHistory();
  const dates = [...new Set(history.map(x => x.date))];
  const map = new Map();
  for (const d of dates) {
    const phase = cyclePhaseForDate(d);
    map.set(d, phase ? phase.key : null);
  }
  return map;
}
function countPhaseChanges(before, after) {
  let count = 0;
  for (const [date, phase] of before) {
    if (after.get(date) !== phase) count++;
  }
  return count;
}
function withPhaseChangeSuffix(baseMessage, changedCount) {
  if (changedCount === 0) return baseMessage;
  // The Cycle tab's charts (Performance by Time, PR-by-phase, ...) aren't
  // part of what Save re-renders (see renderCycleTab vs renderCyclePerfSection)
  // - flagging this is what makes the reload button in their header appear.
  setCyclePerfStale(true);
  return `${baseMessage} - phases recalculated for ${changedCount} past workout${changedCount === 1 ? "" : "s"}`;
}

document.getElementById("cycle-cal-log-save").addEventListener("click", async () => {
  if (periodLogDates.size === 0 && originalPeriodLogs.length === 0) {
    toast("Tap at least one day first");
    return;
  }
  // A gap between selected days (not consecutive dates) means separate
  // periods, not one long one - e.g. a day logged in July and another in
  // September are two different cycles, not a 43-day period. Each
  // contiguous run becomes its own start_date/length_days entry, so
  // logging two (or more) past periods is one Save, not one Log Period
  // trip per period.
  const clusters = clusterPeriodDates(periodLogDates);
  for (const c of clusters) {
    if (c.length > MAX_PERIOD_DAYS) {
      toast(`${formatDateDisplay(c.start)} to ${formatDateDisplay(c.end)} is ${c.length} days - a single period can't span more than ${MAX_PERIOD_DAYS}. Remove the day(s) furthest from the rest, or leave a gap to log it as a separate period.`);
      return;
    }
  }
  const clusterStarts = new Set(clusters.map(c => c.start));
  // Every originally-logged period with no cluster still starting on its
  // exact start_date lost all its selected days (fully deselected, or its
  // first day got deselected which moves what start_date it'd need) -
  // either way that row has to go, or upserting the new clusters would
  // just leave it behind as an orphaned duplicate.
  const toRemove = originalPeriodLogs.filter(p => !clusterStarts.has(p.start_date));
  try {
    const before = await snapshotWorkoutPhasesByDate();
    for (const p of toRemove) {
      await deletePeriodRow(p.start_date);
    }
    if (!currentUser.period_logs) currentUser.period_logs = [];
    // Sequential, not Promise.all - each call re-derives "most recent
    // period" (users.last_period_date) from the full period_logs table on
    // the backend, so they need to land one at a time for that recompute
    // to see every earlier one in this same save.
    for (const c of clusters) {
      const res = await api.put(`/api/user/${currentUserId}/period`, { last_period_date: c.start, period_length_days: c.length });
      currentUser.last_period_date = res.last_period_date;
      currentUser.period_length_days = res.period_length_days;
      // Upsert this cycle's own entry by start_date, mirroring the
      // backend's period_logs row - keeps this specific cycle's length
      // isolated from every other logged cycle (see
      // getCyclePhases/periodLengthForDate).
      const existing = currentUser.period_logs.find(p => p.start_date === c.start);
      if (existing) existing.length_days = c.length;
      else currentUser.period_logs.push({ start_date: c.start, length_days: c.length });
    }
    currentUser.period_logs.sort((a, b) => a.start_date < b.start_date ? -1 : a.start_date > b.start_date ? 1 : 0);
    const changed = countPhaseChanges(before, await snapshotWorkoutPhasesByDate());
    periodLogging = false;
    periodLogDates = new Set();
    originalPeriodLogs = [];
    const baseMsg = clusters.length === 0
      ? "All periods removed"
      : clusters.length > 1 ? `${clusters.length} periods saved` : "Period saved";
    toast(withPhaseChangeSuffix(baseMsg, changed));
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
    // Mirrors the backend's INSERT OR IGNORE: this form has no length
    // field, so a genuinely new last_period_date starts at the same 5-day
    // default every unconfirmed cycle gets, without touching an
    // already-logged date's real length.
    if (body.last_period_date) {
      if (!currentUser.period_logs) currentUser.period_logs = [];
      if (!currentUser.period_logs.some(p => p.start_date === body.last_period_date)) {
        currentUser.period_logs.push({ start_date: body.last_period_date, length_days: 5 });
        currentUser.period_logs.sort((a, b) => a.start_date < b.start_date ? -1 : a.start_date > b.start_date ? 1 : 0);
      }
    }
    showGreeting(currentUser.name);
    closeProfileEditModal();
    toast("Profile updated");
    // Used to only ever be opened from (and close back to) Today, but the
    // Cycle tab's "Go to Profile" banner (see cycle-calendar-add-date-btn)
    // opens this same modal without navigating away from Cycle first - so
    // whichever tab is actually on screen needs refreshing, not just
    // Today, or a first-time last_period_date save leaves Cycle stuck on
    // its "we don't know your last period date yet" banner even though the
    // save succeeded.
    if (activeTab === "today") renderTodayScreen();
    else if (activeTab === "cycle") renderCycleTab();
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
  else if (name === "cycle") { renderCycleTab(); renderCyclePerfSection(); }
  else if (name === "you") renderYouTab();
}

document.querySelectorAll(".bottom-nav-item").forEach(btn => {
  btn.addEventListener("click", () => switchTab(btn.dataset.maintab));
});

// ---------------- Onboarding tour ----------------
const TOUR_STEPS = [
  {
    target: () => document.querySelector(".today-streak-card"),
    title: "Build your streak",
    body: "This ring tracks your weekly workout streak. Fill it up to keep your streak alive and earn shields.",
  },
  {
    target: () => document.getElementById("today-cycle-card-wrap"),
    title: "Cycle-aware training",
    body: "See what cycle day you're on and how your current phase can affect your training and recovery. Tap your phase (e.g. \"Menstrual\") for more details on each phase of the menstrual cycle.",
  },
  {
    target: () => document.getElementById("today-cta-start"),
    title: "Log a workout",
    body: "Tap here to start logging today's workout - add exercises, sets, and reps as you go. Once you've logged a session, \"Repeat\" lets you redo the same exercises again, and \"Log an old workout\" lets you back-log a past day you missed.",
  },
  {
    target: () => document.querySelector('.bottom-nav-item[data-maintab="cycle"]'),
    title: "Cycle tab",
    body: "Log your cycle here and see how each phase has historically affected your performance.",
  },
  {
    target: () => document.querySelector('.bottom-nav-item[data-maintab="you"]'),
    title: "Discover tab",
    body: "See how your hormones typically shift across your cycle, plus what's coming next in Fuel.",
  },
];

let tourStepIndex = 0;

const tourOverlay = document.getElementById("tour-overlay");
const tourSpotlight = document.getElementById("tour-spotlight");
const tourCard = document.getElementById("tour-card");
const tourTitleEl = document.getElementById("tour-title");
const tourBodyEl = document.getElementById("tour-body");
const tourStepLabel = document.getElementById("tour-step-label");
const tourNextBtn = document.getElementById("tour-next-btn");
const tourSkipBtn = document.getElementById("tour-skip-btn");

function isElementVisible(el) {
  return !!el && !el.hidden && el.offsetParent !== null;
}

function positionTourStep() {
  if (tourOverlay.hidden) return;
  const step = TOUR_STEPS[tourStepIndex];
  const el = step.target();
  if (!isElementVisible(el)) {
    advanceTour();
    return;
  }

  el.scrollIntoView({ block: "center", behavior: "smooth" });

  const rect = el.getBoundingClientRect();
  const pad = 8;
  tourSpotlight.style.top = `${rect.top - pad}px`;
  tourSpotlight.style.left = `${rect.left - pad}px`;
  tourSpotlight.style.width = `${rect.width + pad * 2}px`;
  tourSpotlight.style.height = `${rect.height + pad * 2}px`;

  tourTitleEl.textContent = step.title;
  tourBodyEl.textContent = step.body;
  tourStepLabel.textContent = `${tourStepIndex + 1} of ${TOUR_STEPS.length}`;
  tourNextBtn.textContent = tourStepIndex === TOUR_STEPS.length - 1 ? "Got it" : "Next";

  const cardHeight = tourCard.offsetHeight || 160;
  const spaceBelow = window.innerHeight - rect.bottom;
  const cardTop = spaceBelow > cardHeight + 32
    ? rect.bottom + pad + 16
    : Math.max(16, rect.top - pad - cardHeight - 16);
  tourCard.style.top = `${cardTop}px`;
}

function advanceTour() {
  tourStepIndex += 1;
  if (tourStepIndex >= TOUR_STEPS.length) {
    endTour();
    return;
  }
  positionTourStep();
}

function startTour() {
  if (activeTab !== "today") switchTab("today");
  tourStepIndex = 0;
  tourOverlay.hidden = false;
  // Wait a frame so layout (and any tab switch above) has settled before we
  // measure the target element's position.
  requestAnimationFrame(positionTourStep);
}

function endTour() {
  tourOverlay.hidden = true;
}

tourNextBtn.addEventListener("click", advanceTour);
tourSkipBtn.addEventListener("click", endTour);
window.addEventListener("resize", positionTourStep);

document.getElementById("today-give-tour-btn").addEventListener("click", startTour);

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
  { emoji: "🙃", label: "Feeling okay" },
  { emoji: "🙂", label: "Decent energy" },
  { emoji: "😊", label: "Feeling good" },
  { emoji: "💪", label: "Strong and ready" },
  { emoji: "🔥", label: "Highly energized" },
  { emoji: "🚀", label: "Absolutely unstoppable" },
];

const epModal = document.getElementById("energy-picker-modal");
const epLevelsCol = document.getElementById("ep-levels");
let epActiveContainer = null;
let epSelected = null;

// The label only ever shows on whichever row is currently selected/centered
// (see highlightEnergyPickerSelection) - a fixed .time-picker-option-label
// span sits in every row so its width doesn't jump the layout around as
// selection moves, just empty until that row becomes the selected one.
epLevelsCol.innerHTML = ENERGY_LEVELS
  .map((lvl, i) => `<button type="button" class="time-picker-option" data-value="${i + 1}"><span class="time-picker-option-emoji">${lvl.emoji}</span><span class="time-picker-option-value">${i + 1}</span><span class="time-picker-option-label"></span></button>`)
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
  epLevelsCol.querySelectorAll(".time-picker-option").forEach(b => {
    const isSelected = b.dataset.value === String(epSelected);
    b.classList.toggle("selected", isSelected);
    const info = isSelected ? energyLevelInfo(b.dataset.value) : null;
    b.querySelector(".time-picker-option-label").textContent = info ? info.label : "";
  });
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
  applyCheckInCopy();
  epModal.hidden = false;
  requestAnimationFrame(() => jumpToEnergyOption(epSelected));
}

function closeEnergyPicker() {
  epModal.hidden = true;
  epActiveContainer = null;
}

document.getElementById("ep-cancel").addEventListener("click", () => {
  if (checkInFlowActive) checkInCancelled = true;
  closeEnergyPicker();
});
epModal.addEventListener("click", (e) => {
  if (e.target !== epModal) return;
  if (checkInFlowActive) checkInCancelled = true;
  closeEnergyPicker();
});
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
  applyCheckInCopy();
  mtpModal.hidden = false;
  requestAnimationFrame(() => jumpToMealTimingOption(mtpSelected));
}

function closeMealTimingPicker() {
  mtpModal.hidden = true;
  mtpActiveContainer = null;
}

document.getElementById("mtp-cancel").addEventListener("click", () => {
  if (checkInFlowActive) checkInCancelled = true;
  closeMealTimingPicker();
});
mtpModal.addEventListener("click", (e) => {
  if (e.target !== mtpModal) return;
  if (checkInFlowActive) checkInCancelled = true;
  closeMealTimingPicker();
});
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

// The energy/meal/note check-in prompts are shared by every entry point
// (Start today's workout, Log an old workout, and the session-strip chips
// for editing any already-open session) - rather than branching per entry
// point, they just read logSessionDate at the moment each modal opens and
// phrase themselves accordingly, so "today" vs "that day" always matches
// whichever date is actually being logged.
function pastTenseCheckIn() {
  return logSessionDate !== todayStr;
}
function applyCheckInCopy() {
  const past = pastTenseCheckIn();
  document.getElementById("ep-modal-title").textContent = past ? "How did you feel that day?" : "How do you feel?";
  document.getElementById("mtp-modal-title").textContent = past ? "How long before the workout had you eaten?" : "How long ago did you eat?";
  document.getElementById("session-meal-modal-sub").textContent = past ? "Before that session, if anything." : "Before today's session, if anything.";
  document.getElementById("session-note-modal-sub").textContent = past ? "How did that session feel?" : "How did today's session feel?";
}

// True only for the duration of the auto-chained first-open prompt (see
// promptSessionFeelAndFood). Cancel and tap-outside-to-dismiss both still
// work exactly as normal on all three steps - what's mandatory is that
// answering the prompt is the only way to actually *start* the workout:
// canceling any one of the three steps aborts the whole check-in and
// leaves the user back on Today (see checkInCancelled below, checked
// after each step) rather than quietly skipping ahead into the Log screen
// with the rest of the questions unasked. The user can always tap "Start"
// again later - whatever they did answer before canceling is already
// saved (each field's own "change" listener persists it immediately), so
// resuming doesn't lose that partial progress.
let checkInFlowActive = false;
let checkInCancelled = false;
function setCheckInFlowActive(active) {
  checkInFlowActive = active;
  if (active) checkInCancelled = false;
}

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
  // Nothing to attach a visit row to yet - the check-in chips (energy/meal/
  // notes) call this eagerly as each one settles, but answering them alone
  // isn't a gym visit. A "rest day" isn't something the app records; if the
  // user never adds an exercise, there should be no workout_log row at all
  // for the day, not an empty one. submitExerciseLog() calls this again
  // once a real exercise exists, which is when the row actually gets
  // created (or, if one already exists from earlier in this same session,
  // kept up to date below).
  if (!savedWorkoutId && exercisesContainer.children.length === 0) {
    saveWorkoutDraft();
    return;
  }
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
  const rawValue = parseFloat(row.querySelector(inputSelector)?.value);
  if (isNaN(rawValue) || rawValue <= 0) { delete row.dataset.prValue; syncPrBadge(row); return; }
  // Weight is entered/displayed in the user's chosen unit (see weightUnit())
  // but every value compared or stored here - row.dataset.prValue included -
  // is always kg, same as the server's exercise_log.weight_kg, so a unit
  // switch mid-history can never skew a PR comparison.
  const value = isCardio ? rawValue : displayWeightToKg(rawValue);

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
    const rv = parseFloat(r.querySelector(inputSelector)?.value);
    if (!isNaN(rv)) priorBest = Math.max(priorBest, isCardio ? rv : displayWeightToKg(rv));
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
async function guardPrEdit(row, newValue, formatValue) {
  const prValue = row.dataset.prValue;
  if (prValue == null || parseFloat(prValue) === newValue) return true;
  const ok = await confirmModal(
    `This set was recorded as your new PR of ${formatValue(parseFloat(prValue))} — change it to ${formatValue(newValue)}?`,
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
    <span class="set-row-label set-row-label-2">Weight (${weightUnit()})</span>
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
      <div class="stepper stepper-weight stepper-labeled" data-step="${weightUnit() === "lb" ? "5" : "2.5"}" data-min="0">
        <button type="button" class="stepper-btn stepper-minus" aria-label="Decrease weight">&minus;</button>
        <input type="number" step="${weightUnit() === "lb" ? "1" : "0.5"}" class="set-weight stepper-input" placeholder="${weightUnit().toUpperCase()}" aria-label="Weight in ${weightUnit()}">
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
        const enteredValue = parseFloat(weightInput.value);
        if (isNaN(enteredValue)) return;
        const newValueKg = displayWeightToKg(enteredValue);
        const proceed = await guardPrEdit(row, newValueKg, kg => `${formatWeightNumber(kg)}${weightUnit()}`);
        if (!proceed) {
          // Revert without dispatching "input" - that would just re-enter
          // this same debounce loop. "change" still lets the delegated
          // draft-autosave listener pick up the reverted value. prValue is
          // always kg (see checkForPR) - convert back to display unit or a
          // lb-displaying field would revert to a raw kg number.
          weightInput.value = weightInputValue(parseFloat(row.dataset.prValue));
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
        const proceed = await guardPrEdit(row, newValue, min => `${min} min`);
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
    // Recognizes either unit word regardless of the current kg/lb setting
    // (see weightUnit()) - the parsed number is always treated as already
    // being in whatever unit is currently active (same as typing it into
    // the weight field directly), so this doesn't attempt to cross-convert
    // a spoken "30 kg" while lb is selected.
    const weightMatch = t.match(/(\d+(?:\.\d+)?)\s*(?:kgs?|kilos?|kilograms?|lbs?|pounds?)/)
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
// `results` is a plain array of transcript strings (both the native plugin's
// `matches` and the Web Speech API path's mapped alternatives - see
// recognizeSpeechOnce - end up in this same shape).
function bestSpeechParse(results, parseFn) {
  let merged = null;
  for (let i = 0; i < results.length; i++) {
    const parsed = parseFn(results[i]);
    if (!merged) {
      merged = parsed;
    } else {
      for (const key in parsed) {
        if (merged[key] == null && parsed[key] != null) merged[key] = parsed[key];
      }
    }
    if (Object.values(merged).every(v => v != null)) break;
  }
  return merged || parseFn(results[0] || "");
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

// Two recognizer backends, picked once at load: the native plugin only
// exists inside the wrapped app (window.Capacitor.Plugins.SpeechRecognition,
// registered by @capacitor-community/speech-recognition), never in a plain
// browser tab - it talks to the OS's own SpeechRecognizer/Speech framework
// directly, which is what makes it work on Android at all, since Android's
// stock WebView doesn't implement webkitSpeechRecognition (the Web Speech
// API path below) the way Chrome-for-Android or a desktop browser does.
const NativeSpeechRecognition = (window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform() && window.Capacitor.Plugins)
  ? window.Capacitor.Plugins.SpeechRecognition
  : null;
const SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition;
const canRecognizeSpeech = !!NativeSpeechRecognition || !!SpeechRecognitionCtor;

// Every dictation button (session note/meal, per-set voice entry) needs
// mic access under the hood - left to itself, the OS only asks for that
// the first time someone actually taps one of those buttons, mid-workout,
// which reads as a random interruption with no context. Asking once,
// right when the app first opens, up front and out of the way instead.
// Deliberately NOT gated on canRecognizeSpeech - the native plugin above
// requests RECORD_AUDIO itself when it needs to, but priming it via a
// plain getUserMedia call up front (Capacitor's bundled
// BridgeWebChromeClient.onPermissionRequest handles that) means the OS
// dialog shows up right when the app first opens instead of the first time
// a mic button is tapped, on either recognizer backend. Gated on a
// localStorage flag so it only happens once ever on this device, not on
// every open - and immediately stops the stream, since this is only about
// surfacing the permission prompt early, not actually recording anything.
(function requestMicPermissionOnFirstOpen() {
  if (localStorage.getItem("micPermissionRequested")) return;
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return;
  localStorage.setItem("micPermissionRequested", "1");
  navigator.mediaDevices.getUserMedia({ audio: true })
    .then(stream => stream.getTracks().forEach(track => track.stop()))
    .catch(() => { /* denied or no mic available - voice buttons already handle SpeechRecognition failing gracefully */ });
})();

// One-shot "listen, then resolve with what was heard" - the one shape both
// voice buttons need (initVoiceSetButton/initNoteMicButtonGeneric below),
// backed by whichever recognizer this platform actually has. Resolves
// { transcript, alternatives } (alternatives is always a plain array of
// transcript strings, top guess included as alternatives[0]) or rejects
// with { code: "not-allowed" | "no-match" | "error" }.
function recognizeSpeechOnce({ maxAlternatives = 1 } = {}) {
  const attempt = NativeSpeechRecognition ? recognizeSpeechNative(maxAlternatives) : recognizeSpeechWeb(maxAlternatives);
  // Belt-and-suspenders: neither backend is guaranteed to always settle on
  // its own (seen on some platforms when the mic/permission flow stalls
  // instead of erroring out) - force a rejection so the calling button
  // doesn't get stuck in "listening" forever.
  const safety = new Promise((resolve, reject) => setTimeout(() => reject({ code: "error" }), 8000));
  return Promise.race([attempt, safety]);
}

async function recognizeSpeechNative(maxAlternatives) {
  let matches;
  try {
    ({ matches } = await NativeSpeechRecognition.start({
      language: "en-US",
      maxResults: maxAlternatives,
      popup: false, // our own "listening" button state is the UI, not the OS's
      partialResults: false, // only want the final transcript
    }));
  } catch (err) {
    // The plugin rejects with a message string, not a typed error code -
    // spot-checking the wording is the only reliable way to tell "you said
    // no" apart from "something else went wrong".
    const msg = ((err && err.message) || "").toLowerCase();
    throw { code: msg.includes("permission") || msg.includes("denied") ? "not-allowed" : "error" };
  }
  if (!matches || !matches.length) throw { code: "no-match" };
  return { transcript: matches[0], alternatives: matches };
}

function recognizeSpeechWeb(maxAlternatives) {
  return new Promise((resolve, reject) => {
    const recognition = new SpeechRecognitionCtor();
    recognition.lang = "en-US";
    recognition.interimResults = false;
    recognition.maxAlternatives = maxAlternatives;
    let settled = false;
    recognition.addEventListener("result", (e) => {
      settled = true;
      // Force the mic to release the moment we have a final result instead
      // of waiting on the browser's own end-of-speech detection - on iOS
      // Safari that detection can lag well behind the result event, so the
      // "browser is listening" indicator stays lit even though we're done
      // with it.
      try { recognition.stop(); } catch (err) { /* already stopped */ }
      resolve({
        transcript: e.results[0][0].transcript,
        alternatives: [...e.results[0]].map(r => r.transcript),
      });
    });
    recognition.addEventListener("error", (e) => {
      if (settled) return;
      settled = true;
      reject({ code: e.error === "not-allowed" ? "not-allowed" : "error" });
    });
    recognition.addEventListener("end", () => {
      if (settled) return;
      settled = true;
      reject({ code: "no-match" });
    });
    try {
      recognition.start();
    } catch (err) {
      reject({ code: "error" });
    }
  });
}

function initVoiceSetButton(block) {
  const btn = block.querySelector(".add-set-voice");
  if (!canRecognizeSpeech) {
    btn.disabled = true;
    btn.title = "Voice input isn't supported on this device";
    return;
  }
  btn.addEventListener("click", async () => {
    btn.classList.add("listening");
    btn.disabled = true;
    try {
      // maxAlternatives >1 so a mis-transcribed "reps" in the top guess can
      // still be caught by checking the recognizer's other candidate
      // transcripts (bestSpeechParse below) instead of failing outright on
      // whichever one happened to be ranked first. Kept small, not maxed
      // out - alternatives past the first couple are usually low-confidence
      // noise on a phone mic, and bestSpeechParse only consults them to
      // fill in a field the top alternative missed entirely, not to
      // second-guess one it already got.
      const { transcript, alternatives } = await recognizeSpeechOnce({ maxAlternatives: 3 });
      const isCardio = block.dataset.exerciseType === "cardio";
      if (isCardio) {
        const { duration, level } = bestSpeechParse(alternatives, parseSpokenCardioSet);
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
      const { reps, weight } = bestSpeechParse(alternatives, parseSpokenSet);
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
      const parts = [reps != null ? `${reps} reps` : null, weight != null ? `${weight} ${weightUnit()}` : null].filter(Boolean);
      toast(`Added set: ${parts.join(", ")}`);
    } catch (err) {
      const code = err && err.code;
      if (code === "not-allowed") toast("Microphone access denied");
      else if (code === "no-match") toast("Didn't catch that — try again");
      else toast("Couldn't start voice input");
    } finally {
      btn.classList.remove("listening");
      btn.disabled = false;
    }
  });
}

// Dictate-a-note button on the shared per-exercise note field. Mirrors
// initVoiceSetButton's pattern (listening/disabled state) but just appends
// the transcript to the note text instead of parsing it.
function initNoteMicButton(block) {
  initNoteMicButtonGeneric(block.querySelector(".note-mic-btn"), block.querySelector(".ex-notes"));
}

// Generalized for any text input outside an exercise block too - the
// session note/meal modals (see renderSessionStrip) reuse this same
// dictation behavior on their own plain inputs.
function initNoteMicButtonGeneric(btn, input) {
  if (!canRecognizeSpeech) {
    btn.disabled = true;
    btn.title = "Voice input isn't supported on this device";
    return;
  }
  btn.addEventListener("click", async () => {
    btn.classList.add("listening");
    btn.disabled = true;
    try {
      const { transcript } = await recognizeSpeechOnce({ maxAlternatives: 1 });
      input.value = input.value ? `${input.value} ${transcript}` : transcript;
      input.dispatchEvent(new Event("input", { bubbles: true }));
    } catch (err) {
      const code = err && err.code;
      toast(code === "not-allowed" ? "Microphone access denied" : "Didn't catch that — try again");
    } finally {
      btn.classList.remove("listening");
      btn.disabled = false;
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
        <button type="button" class="add-set-voice secondary" aria-label="Add a set by voice" title="Say something like &quot;20 reps with 30 ${weightUnit()}${weightUnit() === "kg" ? "s" : ""}&quot;"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0"/><path d="M12 18v3"/><path d="M9 21h6"/></svg></button>
      </div>
    </div>
    <label class="full">Notes for this exercise
      <div class="note-field">
        <input type="text" class="ex-notes" placeholder="optional">
        <button type="button" class="note-mic-btn secondary" aria-label="Dictate note" title="Speak your note"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0"/><path d="M12 18v3"/><path d="M9 21h6"/></svg></button>
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

// ---------------- Weight unit (kg/lb) ----------------
// Every stored weight (exercise_log.weight_kg, PR history, chart data) is
// always kg - this is purely a display/entry preference (currentUser.weight_unit,
// set via Edit Profile). Converting at the two boundaries (parseWeightKg on
// the way in, kgToDisplayWeight on the way out) keeps every internal
// comparison - PR detection, chart scales, cross-session history - working
// in one consistent unit regardless of what the user currently has the UI
// set to display.
function weightUnit() {
  return (currentUser && currentUser.weight_unit) || "kg";
}
const KG_PER_LB = 0.45359237;
function kgToDisplayWeight(kg) {
  if (kg == null) return kg;
  if (weightUnit() !== "lb") return kg;
  // Rounded here (not left to each display site) since this return value
  // also feeds chart axis math (niceStep, SVG point positions), not just
  // text labels - an unrounded kg/lb conversion (e.g. 134.90124...) would
  // otherwise show up as label noise in every chart, not just one spot.
  return Math.round((kg / KG_PER_LB) * 10) / 10;
}
function displayWeightToKg(value) {
  if (value == null || isNaN(value)) return value;
  return weightUnit() === "lb" ? value * KG_PER_LB : value;
}
// Rounds for display so a kg<->lb round-trip's inevitable float noise
// (e.g. 61.234999999999996) never shows up in the UI - kg entries are
// typically 0.5kg increments, lb entries typically whole numbers, so 1
// decimal covers both with trailing ".0" trimmed.
function formatWeightNumber(kg) {
  if (kg == null) return "";
  const rounded = Math.round(kgToDisplayWeight(kg) * 10) / 10;
  return rounded % 1 === 0 ? String(rounded) : rounded.toFixed(1);
}
function weightInputValue(kg) {
  return kg == null ? "" : formatWeightNumber(kg);
}

// weight_kg=0 is the bodyweight sentinel (see the BW toggle in addSetRow,
// which sets the input's value to the string "0") - `parseFloat(...) ||
// null` would collapse that back to null since 0 is falsy in JS, silently
// losing the "explicitly bodyweight" signal and making it indistinguishable
// from "no weight entered". Only a truly empty input means null. The entered
// string is in the user's display unit (see weightUnit()) - converted here,
// not at the call site, so every caller of parseWeightKg gets a real kg
// value back without having to remember to convert.
function parseWeightKg(str) {
  if (str === "") return null;
  const value = parseFloat(str);
  if (isNaN(value)) return null;
  return Math.round(displayWeightToKg(value) * 100) / 100;
}

async function submitExerciseLog({ auto = false } = {}) {
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
    if (!auto) {
      const dateLabel = logSessionDate === todayStr ? "today" : formatDateDisplay(logSessionDate);
      toast(`No workout was logged for ${dateLabel}`);
    }
    clearDraft();
    resetWorkoutFlowUI();
    switchTab("today");
    return;
  }
  try {
    await ensureVisitSaved();
    const res = await api.post("/api/exercise-log", { date, exercises });
    exerciseHistoryCache = null; // stale after this submit - refetch next time a PR check needs it
    if (auto) {
      toast(res.duplicate ? "Your last workout was already saved — check History" : "Your last workout was saved automatically — check History");
    } else {
      toast(res.duplicate ? "This exact session already exists for this day" : "Workout logged");
    }
    clearDraft();
    resetWorkoutFlowUI();
    switchTab("today");
  } catch (err) {
    if (!auto) toast(err.message);
    throw err;
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
    mealValueEl.textContent = parts.join(" · ");
    mealValueEl.classList.remove("placeholder");
  } else {
    mealValueEl.textContent = "Add fuel";
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
  applyCheckInCopy();
  modal.hidden = false;
});
document.getElementById("session-meal-cancel").addEventListener("click", () => {
  if (checkInFlowActive) checkInCancelled = true;
  document.getElementById("session-meal-modal").hidden = true;
});
document.getElementById("session-meal-modal").addEventListener("click", (e) => {
  if (e.target !== e.currentTarget) return;
  if (checkInFlowActive) checkInCancelled = true;
  e.currentTarget.hidden = true;
});
document.getElementById("session-meal-next").addEventListener("click", () => {
  const mealInput = document.getElementById("session-meal-input");
  const meal = mealInput.value.trim();
  if (!meal) {
    toast("Enter what you ate (or \"nothing\" if you haven't)");
    mealInput.focus();
    return;
  }
  sessionFields.pre_workout_meal = meal;
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
  applyCheckInCopy();
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
  const summary = lastSets.map(s => isCardio ? `${s.duration_minutes}min` : `${s.reps}×${formatWeightNumber(s.weight_kg)}`).join(", ");
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
  document.getElementById("sets-card-delete-btn").hidden = !active;
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
let restPaused = false;

function updateRestButtonUI() {
  const label = document.getElementById("log-footer-btn-label");
  const fill = document.getElementById("log-footer-btn-fill");
  const resetBtn = document.getElementById("log-footer-reset-btn");
  if (restRemaining > 0) {
    const m = Math.floor(restRemaining / 60), s = restRemaining % 60;
    label.textContent = `${restPaused ? "Paused" : "Rest"} ${m}:${String(s).padStart(2, "0")}`;
    fill.style.width = `${((REST_DURATION - restRemaining) / REST_DURATION) * 100}%`;
    resetBtn.hidden = false;
  } else {
    label.textContent = "Start rest";
    fill.style.width = "0%";
    resetBtn.hidden = true;
  }
}

function tickRest() {
  restRemaining--;
  if (restRemaining <= 0) { stopRestTimer(); return; }
  updateRestButtonUI();
}

// Full reset back to idle - also what resetWorkoutFlowUI() calls to tear
// the timer down entirely (e.g. on logout, finishing a session).
function stopRestTimer() {
  clearInterval(restInterval);
  restInterval = null;
  restRemaining = 0;
  restPaused = false;
  updateRestButtonUI();
}

function startRestTimer() {
  clearInterval(restInterval);
  restRemaining = REST_DURATION;
  restPaused = false;
  updateRestButtonUI();
  restInterval = setInterval(tickRest, 1000);
}

function pauseRestTimer() {
  clearInterval(restInterval);
  restInterval = null;
  restPaused = true;
  updateRestButtonUI();
}

function resumeRestTimer() {
  restPaused = false;
  updateRestButtonUI();
  restInterval = setInterval(tickRest, 1000);
}

document.getElementById("log-footer-btn").addEventListener("click", () => {
  if (restRemaining <= 0) startRestTimer();
  else if (restPaused) resumeRestTimer();
  else pauseRestTimer();
});

document.getElementById("log-footer-reset-btn").addEventListener("click", () => {
  stopRestTimer();
});

document.getElementById("log-close-btn").addEventListener("click", () => switchTab("today"));
document.getElementById("log-done-btn").addEventListener("click", submitExerciseLog);
document.getElementById("log-add-exercise-btn").addEventListener("click", promptAddExercise);
document.getElementById("sets-card-delete-btn").addEventListener("click", async () => {
  const block = exercisesContainer.children[currentExerciseIndex];
  if (!block) return;
  const exerciseName = block.querySelector(".ex-exercise").value;
  const ok = await confirmModal(`Delete ${exerciseName || "this exercise"} and all its sets?`, "Yes, Delete");
  if (!ok) return;
  block.remove();
  renumberExerciseBlocks();
  saveExerciseDraft();
  const blocks = [...exercisesContainer.children];
  setActiveExerciseIndex(blocks.length ? Math.min(currentExerciseIndex, blocks.length - 1) : -1);
  toast(exerciseName ? `Removed ${exerciseName}` : "Exercise removed");
});

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
  const daysUntilNext = nextPhase.startDay > cycleDay ? nextPhase.startDay - cycleDay : (cycleLengthDays() - cycleDay) + nextPhase.startDay;
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
  if (bestWeight > 0) statParts.push(`<span>Best <strong>${formatWeightNumber(bestWeight)} ${weightUnit()}</strong></span>`);
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
//
// Returns true if the check-in was completed (all three steps answered),
// false if the user canceled out of any one of them - the caller uses that
// to decide whether to actually enter the Log screen (see the
// today-cta-start click handler) or leave them on Today instead.
// Which of the two check-in questions still needs asking - hours_since_meal
// is the food question's true completion marker (not pre_workout_meal):
// the meal-name field commits the instant "Next" is tapped, mid-chain,
// before the hours-since wheel even opens, so a cancel on *that* second
// half would otherwise look "answered" if this checked the name field
// instead.
function checkInStepsRemaining() {
  return {
    energy: !sessionFields.energy_level,
    food: sessionFields.hours_since_meal == null || sessionFields.hours_since_meal === "",
  };
}

async function promptSessionFeelAndFood() {
  const remaining = checkInStepsRemaining();
  if (!remaining.energy && !remaining.food) return true; // nothing left to ask - e.g. resuming after a previous cancel that got this far

  setCheckInFlowActive(true);
  try {
    if (remaining.energy) {
      const energyField = document.querySelector("#session-strip .energy-field");
      openEnergyPicker(energyField);
      await waitUntilHidden(epModal);
      if (checkInCancelled) return false;
    }

    if (remaining.food) {
      document.getElementById("session-meal-input").value = sessionFields.pre_workout_meal || "";
      applyCheckInCopy();
      document.getElementById("session-meal-modal").hidden = false;
      await waitUntilHidden(document.getElementById("session-meal-modal"));
      if (checkInCancelled) return false;
      // "Next" on the meal-name modal chains straight into the hours-since
      // wheel (see the session-meal-next handler) - "Cancel" doesn't, so
      // only wait on it if it's actually open.
      if (!mtpModal.hidden) await waitUntilHidden(mtpModal);
      if (checkInCancelled) return false;
    }
  } finally {
    setCheckInFlowActive(false);
  }

  renderSessionStrip();
  ensureVisitSaved();
  return true;
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
        row.querySelector(".set-weight") && (row.querySelector(".set-weight").value = weightInputValue(s.weight_kg));
        row.querySelector(".set-duration") && (row.querySelector(".set-duration").value = s.duration_minutes ?? "");
      });
    }
    currentExerciseIndex = 0;
    setActiveExerciseIndex(0);
  }
  switchTab("log");
}

// Shared by both "start"/"resume" entry points below: runs whatever's left
// of the energy/food check-in (promptSessionFeelAndFood already skips a
// question that's already answered, so resuming after a cancel picks up
// right where it left off instead of re-asking everything or asking
// nothing) and only then enters the Log screen.
async function startLogSessionAfterCheckIn(opts) {
  const completed = await promptSessionFeelAndFood();
  if (!completed) { renderTodayCtaState(); return; } // canceled out of the check-in - stay on Today (refresh the CTA in case a step got answered before the cancel)
  startLogSession(opts);
}

document.getElementById("today-cta-start").addEventListener("click", async () => {
  await startLogSessionAfterCheckIn();
});
document.getElementById("today-cta-log-old").addEventListener("click", async () => {
  // Only one workout can be "in progress" at a time (single-draft model).
  // An old-workout log that's already mid-flight (from a previous, e.g.
  // interrupted, use of this same button) just gets resumed - that IS the
  // old-workout flow, so no explanation needed. But if it's *today's*
  // workout that's in progress, silently dropping into it here would look
  // like this button did nothing (no date picker, no prompts) - say why
  // instead of just redirecting.
  if (isWorkoutInProgress()) {
    if (logSessionDate === todayStr) toast("Finish or save today's workout first");
    await startLogSessionAfterCheckIn();
    return;
  }
  const maxDate = addDaysIso(todayStr, -1);
  const beforeDate = logSessionDate;
  logDateHiddenInput.value = maxDate;
  openDatePicker({ container: logDateCarrier, max: maxDate });
  await waitUntilHidden(dpModal);
  if (logSessionDate === beforeDate) return; // closed without picking a date
  await startLogSessionAfterCheckIn();
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
  // The one in-progress draft belongs to whichever date logSessionDate
  // currently holds - only today's own draft resumes via the main CTA;
  // an old-workout draft (started via "Log an old workout") resumes via
  // that button instead, so the main CTA stays "Start" in that case.
  const inProgressToday = inProgress && logSessionDate === todayStr;
  const inProgressOldDate = inProgress && logSessionDate !== todayStr;

  document.getElementById("today-cta-start-label").textContent = inProgressToday ? "Continue today's workout" : "Start today's workout";
  const hint = document.getElementById("today-cta-hint");
  if (inProgressToday) {
    hint.hidden = false;
    hint.textContent = namedCount > 0
      ? `Workout in progress — ${namedCount} exercise${namedCount === 1 ? "" : "s"} added, not yet saved`
      : "Workout in progress — not yet saved";
  } else {
    hint.hidden = true;
  }

  const oldDateLabel = inProgressOldDate
    ? new Date(logSessionDate + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })
    : null;
  document.getElementById("today-cta-log-old").textContent = inProgressOldDate
    ? `Continue logging ${oldDateLabel} workout`
    : "Log an old workout";
}

// ---------------- History ----------------
const cardWorkoutLog = document.getElementById("card-workout-log");
const cardExerciseDetail = document.getElementById("card-exercise-detail");
let currentWorkouts = [];
let currentExerciseLogs = [];
let currentDetailDate = null;
let historyPhaseFilter = null; // null = All, else a CYCLE_PHASES key
let historyExerciseFilter = null; // null = off, else an exercise name - shows only that exercise's own PR days
let historyHighlightDate = null; // ISO date to scroll to, set by the date-search field
let currentExerciseHistory = []; // full exercise_log history, cached each showWorkoutLog() for the PR filter to compute from without a re-fetch

// Monday-start week containing dateStr, as a local midnight Date.
function weekStartDate(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  const day = (d.getDay() + 6) % 7; // Mon=0 ... Sun=6
  d.setDate(d.getDate() - day);
  return d;
}

// "This Week (Aug 31 – Sep 6)" or, for any earlier week, just the range -
// the small header dropped into the timeline wherever a new week starts
// (see renderTimelineList), now that the list is one continuous scroll
// instead of paged a week at a time.
function formatWeekLabelForDate(dateStr) {
  const start = weekStartDate(dateStr);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  const fmt = d => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const isThisWeek = start.getTime() === weekStartDate(todayStr).getTime();
  return isThisWeek ? `This Week (${fmt(start)} – ${fmt(end)})` : `${fmt(start)} – ${fmt(end)}`;
}

// Re-fetches rather than reusing whatever was already rendered - editing a
// set from the detail view cascades an edited_at onto its parent
// workout_log row (see update_exercise_log in app.py), and simply toggling
// visibility back to the already-rendered table would leave that badge
// (and any other edit made while in the detail view) stale until a full
// page reload.
async function showWorkoutLog({ resetCollapse = false } = {}) {
  cardExerciseDetail.hidden = true;
  cardWorkoutLog.hidden = false;
  const [workouts, history] = await Promise.all([api.get("/api/workout-log"), getExerciseHistory()]);
  currentWorkouts = workouts;
  currentExerciseHistory = history;
  currentPRDaysByDate = computePRDaysByDate(history);
  // Only on a fresh entry into the tab (loadHistory), not when this just
  // re-fetches to come back from exercise detail - otherwise returning
  // from a detail view would silently re-collapse whatever the user had
  // manually expanded.
  if (resetCollapse) collapsedWeeks = defaultCollapsedWeeks(currentWorkouts);
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

// This one exercise's own PR days - same "beats every strictly earlier
// day's best" rule as computePRDaysByDate above, just scoped to a single
// exercise instead of bucketed by muscle group, for the "PRs for..." filter
// (a user picks one exercise and sees only the days it hit a new best).
function computeExercisePRDates(history, exerciseName) {
  const rows = history.filter(x => x.exercise === exerciseName);
  const weightCount = rows.filter(x => x.weight_kg != null).length;
  const durationCount = rows.filter(x => x.duration_minutes != null).length;
  const metricKey = durationCount > weightCount ? "duration_minutes" : "weight_kg";

  const byDate = {};
  rows.forEach(x => {
    const v = x[metricKey];
    if (v == null) return;
    if (!byDate[x.date] || v > byDate[x.date]) byDate[x.date] = v;
  });

  const prDates = new Set();
  let runningMax = null;
  Object.keys(byDate).sort().forEach(date => {
    const v = byDate[date];
    if (runningMax != null && v > runningMax) prDates.add(date);
    if (runningMax == null || v > runningMax) runningMax = v;
  });
  return prDates;
}

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

// Small static tags for a session's one-line summary - energy/edited, or
// a "no details logged" placeholder when there's nothing else to show.
// Notes render on their own line below (sessionNoteHtml) since they're
// free text and can run long, unlike these fixed-width tags.
function sessionChipsHtml(w) {
  const chips = [];
  if (w.energy_level != null) chips.push(`<span class="history-chip">&#9889; ${w.energy_level}/10</span>`);
  if (w.edited_at) chips.push(`<span class="history-chip history-chip-edited">edited</span>`);
  if (!chips.length && !w.notes) chips.push(`<span class="history-chip">no details logged</span>`);
  return chips.join("");
}

function sessionNoteHtml(w) {
  return w.notes ? `<span class="history-session-note">&ldquo;${escapeHtml(w.notes)}&rdquo;</span>` : "";
}

// Timeline rail: a continuous vertical line down the whole list (built from
// each row's own top/bottom half-segment via .tl-rail::before, so it reads
// as one unbroken line, not a border per card) with a phase-colored dot per
// session. A day is a plain text header, not its own boxed card - the rail
// is what groups sessions visually now, so a day with several sessions
// doesn't need "Session 1/2" labels or a day-level box to read as a unit.
function timelineDayHeaderHtml(date) {
  const prMuscles = currentPRDaysByDate.get(date);
  const prTags = prMuscles
    ? [...prMuscles].map(m => `<span class="pr-day-tag">${escapeHtml(m)}-PR</span>`).join("")
    : "";
  return `
    <div class="tl-day">
      <span class="tl-day-date">${formatHistoryCardDate(date)}</span>
      <span class="history-card-badges">${prTags}</span>
    </div>`;
}

function timelineRowHtml(date, w, posClass) {
  const phase = cyclePhaseForDate(date);
  const dotColor = phase ? phase.color : "var(--border)";

  // A date-searched day with nothing logged still needs a row to render, so
  // the searched date has something to scroll to - see
  // jumpToHistoryDate/renderWorkoutTable.
  if (!w) {
    return `
      <div class="tl-row ${posClass}" data-date="${date}">
        <div class="tl-rail"><div class="tl-dot" style="background:${dotColor}"></div></div>
        <div class="tl-content">
          <div class="tl-line tl-line-empty">No workout logged</div>
        </div>
      </div>`;
  }

  return `
    <div class="tl-row clickable-row ${posClass}" data-date="${date}" data-id="${w.id}">
      <div class="tl-rail"><div class="tl-dot" style="background:${dotColor}"></div></div>
      <div class="tl-content">
        <div class="tl-line">
          <span class="muscle">${formatMuscles(w.muscles) || "&mdash;"}</span>
          <span class="history-session-chips">${sessionChipsHtml(w)}</span>
          ${sessionNoteHtml(w)}
        </div>
      </div>
      <button class="edit-btn edit-btn-icon" data-id="${w.id}" aria-label="Edit">&#9998;</button>
    </div>`;
}

// Week keys the collapsed/expanded state persists across re-renders (see
// collapsedWeeks) - built by hand rather than Date#toISOString(), which
// converts to UTC and can shift the date by a day depending on the user's
// timezone offset (same reason addDaysIso below does its own formatting).
function weekKeyFor(dateStr) {
  const d = weekStartDate(dateStr);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

let collapsedWeeks = new Set();

// Only the last month's worth of weeks start expanded - older history is
// still one tap away, but a year of logging shouldn't all be open (and
// scrolled through) by default the moment you land on the tab.
function defaultCollapsedWeeks(workouts) {
  const cutoff = new Date(todayStr + "T00:00:00");
  cutoff.setMonth(cutoff.getMonth() - 1);
  const keys = new Set();
  workouts.forEach(w => {
    const key = weekKeyFor(w.date);
    if (new Date(key + "T00:00:00") < cutoff) keys.add(key);
  });
  return keys;
}

function dayGroupHtml(date, sessions) {
  const rows = sessions.length ? sessions : [null];
  const rowsHtml = rows.map((w, i) => {
    const posClass = [i === 0 ? "tl-row-first" : "", i === rows.length - 1 ? "tl-row-last" : ""].filter(Boolean).join(" ");
    return timelineRowHtml(date, w, posClass);
  }).join("");
  return timelineDayHeaderHtml(date) + rowsHtml;
}

// One flat list of day headers + rail rows, in the same order groups
// already come in (descending by date) - the point of the rail is that it
// runs continuously across the whole list, day boundaries included. Each
// day's own first/last row is marked (tl-row-first/tl-row-last) so the
// rail trims cleanly at that day's own dots instead of bleeding into the
// header above/below it - see the CSS.
// weeklyHeaders: false for the phase/exercise filters, whose results skip
// around in time (a collapsible "This Week" section sitting between two
// PRs 3 months apart would be misleading, not useful) - only the plain,
// chronological default view gets grouped into (collapsible) weeks.
function renderTimelineList(groups, weeklyHeaders) {
  if (!weeklyHeaders) {
    return groups.map(({ date, sessions }) => dayGroupHtml(date, sessions)).join("");
  }

  // Bucket the already-ordered day groups into weeks without disturbing
  // that order, then render each week as a collapsible section.
  const weeks = [];
  groups.forEach(g => {
    const key = weekKeyFor(g.date);
    let week = weeks[weeks.length - 1];
    if (!week || week.key !== key) {
      week = { key, label: formatWeekLabelForDate(g.date), dayGroups: [] };
      weeks.push(week);
    }
    week.dayGroups.push(g);
  });

  return weeks.map(week => {
    const collapsed = collapsedWeeks.has(week.key);
    const bodyHtml = week.dayGroups.map(g => dayGroupHtml(g.date, g.sessions)).join("");
    return `
      <div class="tl-week">
        <button type="button" class="tl-week-header${collapsed ? " collapsed" : ""}" data-week="${week.key}">
          <span class="tl-week-chevron" aria-hidden="true">&#9662;</span>${week.label}
        </button>
        <div class="tl-week-body"${collapsed ? " hidden" : ""}>${bodyHtml}</div>
      </div>`;
  }).join("");
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
          <span class="meal-timing-field-value placeholder">How long ago?</span>
          <span class="meal-timing-field-icon" aria-hidden="true"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="3.5"/></svg></span>
        </button>
        <input type="hidden" class="edit-hours-since-meal" value="${w.hours_since_meal ?? ""}">
      </div>
    </div>
    <input type="text" class="edit-meal" placeholder="What'd you eat before?" value="${escapeHtml(w.pre_workout_meal || "")}">
    <input type="text" class="edit-notes" placeholder="Notes" value="${escapeHtml(w.notes || "")}">`;
}

// Every session is its own rail row now (never a whole-day card), so
// there's just one edit-row shape regardless of how many sessions a day
// has - unlike the old sessionEditRow/workoutCardEdit split.
function timelineEditRowHtml(w, posClass = "") {
  return `
    <div class="tl-row tl-row-edit ${posClass}" data-id="${w.id}">
      <div class="tl-rail"><div class="tl-dot" style="background:var(--border)"></div></div>
      <div class="tl-content">
        ${workoutEditFieldsHtml(w)}
        <div class="history-card-actions">
          <button class="save-btn" data-id="${w.id}">Save</button>
          <button class="cancel-btn" data-id="${w.id}">Cancel</button>
        </div>
      </div>
    </div>`;
}

// Plain dot+label pills, no button chrome (background/border) - just a
// legend that also happens to be tappable. No "All" pill either: tapping
// the already-active phase again clears the filter, so there's no need for
// a 5th item just to reset it. Dropping both the box styling and the "All"
// label is what gets 4 phases onto one line without cutting off.
function renderPhaseLegend() {
  const legend = document.getElementById("workout-log-phase-legend");
  if (!currentUser || !currentUser.last_period_date) {
    legend.hidden = true;
    return;
  }
  legend.hidden = false;
  const allPill = `<button type="button" class="history-phase-pill${historyPhaseFilter === null ? " active" : ""}" data-phase="">All</button>`;
  const phasePills = getCyclePhases().map(p =>
    `<button type="button" class="history-phase-pill${historyPhaseFilter === p.key ? " active" : ""}" data-phase="${p.key}"><span class="phase-dot" style="background:${p.color}"></span>${p.label.replace(" Phase", "")}</button>`
  ).join("");
  legend.innerHTML = allPill + phasePills;
  legend.querySelectorAll(".history-phase-pill").forEach(btn => {
    btn.addEventListener("click", () => {
      historyPhaseFilter = btn.dataset.phase || null;
      historyExerciseFilter = null;
      historyHighlightDate = null;
      renderWorkoutTable();
    });
  });
}

// The "PRs for..." exercise chip - the phase filter shows its own active
// state via the pill row above, but the exercise filter has no fixed set of
// buttons to highlight, so it gets this one summary row instead (with a
// clear button, since there's no "All" pill to tap back to).
function renderActiveFilterChip() {
  const el = document.getElementById("history-active-filter");
  if (!historyExerciseFilter) {
    el.hidden = true;
    return;
  }
  el.hidden = false;
  document.getElementById("history-active-filter-label").textContent = `Showing PR days for ${historyExerciseFilter}`;
}

document.getElementById("history-active-filter-clear").addEventListener("click", () => {
  historyExerciseFilter = null;
  renderWorkoutTable();
});

// One continuous scroll of everything ever logged, not a week at a time -
// a short history was mostly empty space below a Newer/Older pager; a long
// one just scrolls, with small week headers (see renderTimelineList)
// dropped in so it's still obvious which week you're looking at.
function renderWorkoutTable() {
  let pageWorkouts;
  let weeklyHeaders = true;
  if (historyExerciseFilter) {
    const prDates = computeExercisePRDates(currentExerciseHistory, historyExerciseFilter);
    pageWorkouts = currentWorkouts.filter(w => prDates.has(w.date));
    weeklyHeaders = false;
  } else if (historyPhaseFilter) {
    pageWorkouts = currentWorkouts.filter(w => cyclePhaseForDate(w.date)?.key === historyPhaseFilter);
    weeklyHeaders = false;
  } else {
    pageWorkouts = currentWorkouts;
  }

  const groups = groupWorkoutsByDate(pageWorkouts);
  // A date search that landed on a day with nothing logged still needs a
  // card to scroll to, so the search always lands somewhere visible - see
  // jumpToHistoryDate. Doesn't apply once a phase/exercise filter is active
  // (those skip around in time - there's no single "day" to insert one at).
  if (historyHighlightDate && weeklyHeaders && !groups.some(g => g.date === historyHighlightDate)) {
    const insertAt = groups.findIndex(g => g.date < historyHighlightDate);
    const emptyGroup = { date: historyHighlightDate, sessions: [] };
    if (insertAt === -1) groups.push(emptyGroup); else groups.splice(insertAt, 0, emptyGroup);
  }

  const wBody = document.getElementById("history-list");
  wBody.innerHTML = renderTimelineList(groups, weeklyHeaders);
  bindWorkoutRowEvents();
  renderPhaseLegend();
  renderActiveFilterChip();

  const emptyEl = document.getElementById("history-empty");
  if (historyExerciseFilter && pageWorkouts.length === 0) {
    emptyEl.textContent = `No PRs yet for ${historyExerciseFilter}.`;
    emptyEl.hidden = false;
  } else if (historyPhaseFilter && pageWorkouts.length === 0) {
    const phase = getCyclePhases().find(p => p.key === historyPhaseFilter);
    emptyEl.textContent = `No workouts logged during your ${phase.label} yet.`;
    emptyEl.hidden = false;
  } else {
    emptyEl.hidden = true;
  }

  if (historyHighlightDate) {
    wBody.querySelector(`.tl-row[data-date="${historyHighlightDate}"]`)
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
  }
}

// Scrolls straight to the searched date in the full list - synthesizing an
// empty placeholder row for it first if nothing was logged that day (see
// renderWorkoutTable), so the search always lands somewhere visible
// instead of silently doing nothing.
function jumpToHistoryDate(iso) {
  if (!iso) return;
  historyPhaseFilter = null;
  historyExerciseFilter = null;
  historyHighlightDate = iso;
  collapsedWeeks.delete(weekKeyFor(iso)); // the searched date might be in a week that's collapsed by default - expand it so there's something to scroll to
  renderWorkoutTable();
}
document.getElementById("history-search-date").addEventListener("change", (e) => {
  jumpToHistoryDate(e.target.value);
});

// Reuses the same detached-field + openOptionPicker pattern as
// chooseCyclePerfExercise (Your Body's exercise switcher) - a single-select
// modal listing every exercise ever logged, with no visible dropdown
// button of its own since "PRs for..." is a plain trigger, not a field.
async function chooseHistoryPRExercise() {
  const exercises = [...new Set(currentExerciseHistory.map(x => x.exercise))].sort();
  if (!exercises.length) { toast("Log a few sets first"); return; }
  const field = document.createElement("div");
  field.dataset.title = "PRs for which exercise?";
  field.innerHTML = `<button type="button" class="option-field-btn"><span class="option-field-value placeholder">Select...</span></button><input type="hidden">`;
  const hidden = field.querySelector("input[type=hidden]");
  hidden.value = historyExerciseFilter || "";
  setOptionFieldOptions(field, exercises);
  hidden.addEventListener("change", () => {
    historyExerciseFilter = hidden.value;
    historyPhaseFilter = null;
    historyHighlightDate = null;
    renderWorkoutTable();
  }, { once: true });
  openOptionPicker(field);
}
document.getElementById("history-pr-filter-btn").addEventListener("click", chooseHistoryPRExercise);

function bindWorkoutRowEvents() {
  const wBody = document.getElementById("history-list");
  wBody.querySelectorAll(".tl-row.clickable-row").forEach(row => {
    row.addEventListener("click", () => showExerciseDetail(row.dataset.date));
  });
  // Toggling is a plain DOM flip (not a full re-render) so it's instant -
  // collapsedWeeks just needs to stay in sync so the state survives the
  // next real re-render (e.g. after saving an edit).
  wBody.querySelectorAll(".tl-week-header").forEach(btn => {
    btn.addEventListener("click", () => {
      const key = btn.dataset.week;
      const body = btn.nextElementSibling;
      const collapsing = !body.hidden;
      body.hidden = collapsing;
      btn.classList.toggle("collapsed", collapsing);
      if (collapsing) collapsedWeeks.add(key); else collapsedWeeks.delete(key);
    });
  });
  wBody.querySelectorAll(".edit-btn").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const w = currentWorkouts.find(x => x.id == btn.dataset.id);
      const row = btn.closest(".tl-row");
      const posClass = ["tl-row-first", "tl-row-last"].filter(c => row.classList.contains(c)).join(" ");
      row.outerHTML = timelineEditRowHtml(w, posClass);
      bindWorkoutEditRowEvents(w.id);
    });
  });
}

function bindWorkoutEditRowEvents(id) {
  const row = document.querySelector(`#history-list .tl-row[data-id="${id}"]`);
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
  historyPhaseFilter = null;
  historyExerciseFilter = null;
  historyHighlightDate = null;
  await showWorkoutLog({ resetCollapse: true });
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

// Shared by every chart's hover crosshair (hormone reference, Performance/
// Energy-by-Time): a touch that starts on the chart must scroll the page
// when it's a vertical drag, and only drive the hover tooltip when it's a
// horizontal one. CSS touch-action: pan-y is the "correct" way to say that,
// but isn't reliably honored on an SVG hit target across WebView versions,
// so the axis is instead decided here in JS on the first move - a touch
// pointerdown doesn't claim the gesture (no preventDefault, no pointer
// capture) until movement shows which way it's going, so an undecided
// touch never blocks the browser's own scroll handling. A mouse (real
// hover, or an emulator's clean click that never fires pointermove) is
// handled immediately, same as before this existed.
function attachChartHoverGesture(hitRect, handlePointer, hideTooltip) {
  let drag = null; // { startX, startY, pointerId, decided: null | "scroll" | "hover" }
  hitRect.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse") {
      e.preventDefault();
      hitRect.setPointerCapture(e.pointerId);
      handlePointer(e);
      return;
    }
    drag = { startX: e.clientX, startY: e.clientY, pointerId: e.pointerId, decided: null };
  });
  hitRect.addEventListener("pointermove", (e) => {
    if (e.pointerType === "mouse") { handlePointer(e); return; }
    if (!drag || drag.pointerId !== e.pointerId || drag.decided === "scroll") return;
    if (drag.decided === "hover") { handlePointer(e); return; }
    const dx = e.clientX - drag.startX, dy = e.clientY - drag.startY;
    if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return; // too little movement to tell yet
    if (Math.abs(dy) > Math.abs(dx)) { drag.decided = "scroll"; hideTooltip(); return; }
    // Horizontal drag: claim the gesture now, same as the old immediate
    // pointerdown handling - beats Android's long-press-to-select from here on.
    drag.decided = "hover";
    e.preventDefault();
    try { hitRect.setPointerCapture(e.pointerId); } catch { /* already released */ }
    handlePointer(e);
  });
  const release = (e) => {
    // A tap that never moved enough to be classified still shows its point,
    // same as the old pointerdown-shows/pointerup-hides behavior.
    if (e.pointerType !== "mouse" && drag && drag.pointerId === e.pointerId && drag.decided === null) {
      handlePointer(e);
    }
    drag = null;
    hideTooltip();
  };
  hitRect.addEventListener("pointerup", release);
  hitRect.addEventListener("pointercancel", () => { drag = null; hideTooltip(); });
  hitRect.addEventListener("pointerleave", () => { hideTooltip(); });
}

// Used by the Performance/Energy-by-Time charts instead of the drag-crosshair
// above: tap a point to show its tooltip, tap it again to close it, tap a
// different point to move the tooltip there. A plain "click" sidesteps the
// swipe-vs-hover conflict for free - the browser only fires it when the
// touch never turned into a scroll, so there's no gesture arbitration to
// get wrong here, and no touch-action/preventDefault dance needed either.
function attachChartClickToggle(hitRect, indexForClientX, showTooltip, hideTooltip) {
  let selectedIndex = null;
  hitRect.addEventListener("click", (e) => {
    const i = indexForClientX(e.clientX);
    if (selectedIndex === i) {
      hideTooltip();
      selectedIndex = null;
    } else {
      showTooltip(i, e.clientX, e.clientY);
      selectedIndex = i;
    }
  });
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
  // touch-action: pan-y - a vertical drag that starts on the chart is a page
  // scroll, not a hover, so let the browser handle it natively rather than
  // have our pointerdown preventDefault() (needed below to beat Android's
  // long-press-to-select) swallow it. Browsers resolve the scroll-vs-custom-
  // gesture question from this CSS before JS runs, so it wins over
  // preventDefault() for the axis it allows.
  const hitRect = svgEl("rect", { x: plotLeft, y: plotTop, width: plotW, height: plotH, fill: "transparent", style: "touch-action: pan-y" });
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
  const handlePointer = (e) => {
    const svgRect = svg.getBoundingClientRect();
    const scaleX = PERF_CHART_W / svgRect.width;
    const localX = (e.clientX - svgRect.left) * scaleX;
    const day = Math.min(28, Math.max(1, Math.round(1 + ((localX - plotLeft) / plotW) * 27)));
    showTooltip(day, e.clientX, e.clientY);
  };
  attachChartHoverGesture(hitRect, handlePointer, hideTooltip);
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
    document.querySelectorAll(".hormone-info-popover:not([hidden]), .hormone-sources-detail:not([hidden]), .cycle-estimate-popover:not([hidden])").forEach(p => {
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
initTogglePopover(document.getElementById("cycle-estimate-info-btn"), document.getElementById("cycle-estimate-popover"));

// Cycle length is locked behind a confirm - it's a once-in-a-while setting
// most people should never touch (the 28-day default already works for
// most cycles), so editing it takes a deliberate second step rather than
// being a plain always-open field.
document.getElementById("cycle-length-edit-btn").addEventListener("click", async () => {
  document.getElementById("cycle-estimate-popover").hidden = true;
  const ok = await confirmModal(
    "Only change this if you know your actual cycle length - the default (28 days) already works well for most people. If you're unsure, it's best to leave it as is.",
    "Yes, Edit"
  );
  if (!ok) return;
  document.getElementById("cycle-length-input").value = cycleLengthDays();
  document.getElementById("cycle-length-modal").hidden = false;
});

document.getElementById("cycle-length-cancel").addEventListener("click", () => {
  document.getElementById("cycle-length-modal").hidden = true;
});

document.getElementById("form-cycle-length").addEventListener("submit", async (e) => {
  e.preventDefault();
  const cycle_length_days = new FormData(e.target).get("cycle_length_days");
  try {
    // update_user requires the full profile shape (see routes/auth.py) -
    // sending just cycle_length_days would fail its "name is required"
    // check, so the rest of the payload is currentUser's own current
    // values, unchanged.
    await api.put(`/api/user/${currentUser.id}`, {
      name: currentUser.name,
      age: currentUser.age,
      last_period_date: currentUser.last_period_date || "",
      cycle_length_days,
    });
    currentUser.cycle_length_days = cycle_length_days;
    document.getElementById("cycle-length-modal").hidden = true;
    toast("Cycle length updated");
    if (activeTab === "cycle") renderCycleTab();
    if (activeTab === "today") renderTodayScreen();
  } catch (err) {
    toast(err.message);
  }
});

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
  const isWeight = metricKey === "weight_kg";
  const unit = isWeight ? weightUnit() : "min";

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
  // byDate/editedPrevByDate stay in kg (server truth) the whole way through
  // above - converted to the display unit only here, at the boundary into
  // what the chart actually renders.
  const points = Object.keys(byDate).sort().map(date => ({
    date, value: isWeight ? kgToDisplayWeight(byDate[date]) : byDate[date],
    editedAt: editedAtByDate[date] || null,
    editedPrev: editedAtByDate[date] ? (isWeight ? kgToDisplayWeight(editedPrevByDate[date] ?? null) : (editedPrevByDate[date] ?? null)) : null,
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

// The x-axis window for both Performance-by-Time and Energy-by-Time - the
// "zoom" the two charts share (see the range row's HTML comment). A number
// of months back from today, or "all" for no cutoff. Both charts stay in
// sync on the same picked range since they're two views of the same
// "how has this changed over time" question.
let cyclePerfRangeMonths = 3;

// A finer window *within* whichever coarse range is picked above, set by a
// two-finger pinch/drag on either chart (see attachChartPinchZoomPan) - null
// means "no pinch zoom active, show the full picked range". {start, end} are
// millisecond timestamps. Shared between both charts, same as
// cyclePerfRangeMonths, so pinching one keeps the other in sync; reset
// whenever the coarse range changes since the old fine window may no longer
// make sense against a different coarse range (e.g. it picked a window
// inside "1Y" that "1M" doesn't even contain).
let cyclePerfZoomDomain = null;

function updateZoomResetButton() {
  document.getElementById("cycle-perf-zoom-reset-btn").hidden = !cyclePerfZoomDomain;
}
document.getElementById("cycle-perf-zoom-reset-btn").addEventListener("click", () => {
  cyclePerfZoomDomain = null;
  updateZoomResetButton();
  renderCyclePerfSection();
});

document.querySelectorAll(".cycle-perf-range-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    const val = btn.dataset.range;
    cyclePerfRangeMonths = val === "all" ? "all" : Number(val);
    cyclePerfZoomDomain = null;
    updateZoomResetButton();
    document.querySelectorAll(".cycle-perf-range-btn").forEach(b => {
      const active = b === btn;
      b.classList.toggle("active", active);
      b.setAttribute("aria-selected", String(active));
    });
    renderCyclePerfSection();
  });
});

// null (not "all") reads oddly as a cutoff, so this returns null for "no
// cutoff" and an ISO date string otherwise - callers just compare
// point.date >= cutoff, skipping the comparison entirely when null.
function cyclePerfRangeCutoff() {
  if (cyclePerfRangeMonths === "all") return null;
  const d = new Date(todayStr + "T00:00:00");
  d.setMonth(d.getMonth() - cyclePerfRangeMonths);
  return d.toISOString().slice(0, 10);
}
// Applies only the coarse range-button window - the pinch-zoom domain is
// applied separately, inside each chart's own draw(), since it needs to stay
// live-adjustable during a gesture without re-running the whole section
// (see renderCyclePerfChart/renderCycleEnergyChart).
function filterPointsByMonths(points) {
  const cutoff = cyclePerfRangeCutoff();
  return cutoff ? points.filter(p => p.date >= cutoff) : points;
}

// Set true when a period edit changes at least one past workout's phase
// (see withPhaseChangeSuffix in the Log Period section above) while this
// section's charts are already showing the old, now-stale phase coloring -
// shows the reload button in the "Time based analysis" header so that can
// be fixed with one tap in place, instead of needing to leave the Cycle
// tab and come back to force a re-render.
let cyclePerfStale = false;
function setCyclePerfStale(stale) {
  cyclePerfStale = stale;
  const btn = document.getElementById("cycle-perf-reload-btn");
  if (btn) btn.hidden = !stale;
}
document.getElementById("cycle-perf-reload-btn").addEventListener("click", () => renderCyclePerfSection());

// Shared by both subtab switchers on this tab - "Time based analysis"
// (Performance by Time / Energy by Time) and "Phase based analysis" (Where
// your PRs happen / Energy by Meal). Each button/view pair is found by id
// as `${prefix}-subtab-${key}` / `${prefix}-view-${key}`.
function initSubtabSwitcher(prefix, keys) {
  function setView(key) {
    keys.forEach(k => {
      const btn = document.getElementById(`${prefix}-subtab-${k}`);
      btn.classList.toggle("active", k === key);
      btn.setAttribute("aria-selected", String(k === key));
      document.getElementById(`${prefix}-view-${k}`).hidden = k !== key;
    });
  }
  keys.forEach(k => {
    document.getElementById(`${prefix}-subtab-${k}`).addEventListener("click", () => setView(k));
  });
}
initSubtabSwitcher("cycle-perf", ["performance", "energy"]);
initSubtabSwitcher("cycle-phase", ["prs", "meal"]);

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

// ---- Pinch-to-zoom / two-finger pan for the Performance/Energy-by-Time
// charts (see cyclePerfZoomDomain above) ----
// {start, end} millisecond bounds spanning every point - the outer clamp a
// pinch can never zoom out past, since that's still governed by whichever
// range button (1M/3M/.../All) is picked.
function chartDateBounds(points) {
  const first = new Date(points[0].date + "T00:00:00").getTime();
  const last = new Date(points[points.length - 1].date + "T00:00:00").getTime();
  return { start: first, end: Math.max(last, first + 1) };
}
function pointsInDomain(points, domain) {
  return points.filter(p => {
    const t = new Date(p.date + "T00:00:00").getTime();
    return t >= domain.start && t <= domain.end;
  });
}
// A saved zoom domain only makes sense against the fullBounds it was picked
// from - e.g. switching the range buttons from "All" to "1M" can leave a
// stale domain that no longer overlaps at all. Falls back to the full range
// whenever that happens, same as having no zoom active.
function clampZoomDomain(domain, fullBounds) {
  if (!domain || domain.end <= fullBounds.start || domain.start >= fullBounds.end) return fullBounds;
  return { start: Math.max(domain.start, fullBounds.start), end: Math.min(domain.end, fullBounds.end) };
}

const CYCLE_PERF_MIN_ZOOM_SPAN_MS = 3 * 24 * 60 * 60 * 1000; // 3 days - keeps an extreme pinch from collapsing to nothing

// Two-finger pinch (zoom) + two-finger drag (pan), layered on top of the
// range buttons. Deliberately gated on exactly two active touches, never
// one: a single touch on this element must always fall through to page
// scroll untouched (see attachChartClickToggle's comment above - a
// one-finger drag here is exactly the swipe-vs-hover conflict this chart
// already needed two rounds of fixes for), and two simultaneous touches can
// never be mistaken for a scroll gesture, so there's no arbitration needed.
// `host` is the stable per-chart view container (survives the svg.innerHTML
// rebuild every draw() does) - its `_chartZoom` property is refreshed by
// every render call, but the listeners themselves are attached only once.
function attachChartPinchZoomPan(host) {
  if (host.dataset.pinchZoomAttached) return;
  host.dataset.pinchZoomAttached = "1";

  const pointers = new Map(); // pointerId -> {x, y}
  let gesture = null; // { startDist, startMidX, domainAtStart, lastDomain }

  function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
  function midX(a, b) { return (a.x + b.x) / 2; }
  function toLocalX(clientX) {
    const svg = host.querySelector("svg");
    const rect = svg.getBoundingClientRect();
    const scaleX = CYCLE_PERF_CHART_W / rect.width;
    return (clientX - rect.left) * scaleX;
  }
  function timeAtLocalX(localX, domain) {
    const plotLeft = CYCLE_PERF_PAD.left, plotRight = CYCLE_PERF_CHART_W - CYCLE_PERF_PAD.right;
    const frac = (localX - plotLeft) / (plotRight - plotLeft);
    return domain.start + frac * (domain.end - domain.start);
  }

  host.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse") return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    try { host.setPointerCapture(e.pointerId); } catch { /* already released */ }
    if (pointers.size === 2 && host._chartZoom) {
      const [p1, p2] = [...pointers.values()];
      const domainAtStart = host._chartZoom.getDomain();
      gesture = {
        startDist: Math.max(dist(p1, p2), 1),
        startMidX: midX(p1, p2),
        domainAtStart,
        lastDomain: domainAtStart,
      };
    }
  });

  host.addEventListener("pointermove", (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size !== 2 || !gesture || !host._chartZoom) return;
    e.preventDefault();

    const [p1, p2] = [...pointers.values()];
    const curDist = Math.max(dist(p1, p2), 1);
    const curMidX = midX(p1, p2);
    const { domainAtStart } = gesture;
    const fullBounds = host._chartZoom.getFullBounds();
    const fullSpan = fullBounds.end - fullBounds.start;
    const startSpan = domainAtStart.end - domainAtStart.start;

    // Zoom: scale the span by how much the two fingers' distance has
    // changed, keeping the point under the pinch's starting midpoint fixed.
    const scale = curDist / gesture.startDist;
    const newSpan = Math.min(Math.max(startSpan / scale, CYCLE_PERF_MIN_ZOOM_SPAN_MS), fullSpan);
    const pivotTime = timeAtLocalX(toLocalX(gesture.startMidX), domainAtStart);
    const pivotFraction = startSpan > 0 ? (pivotTime - domainAtStart.start) / startSpan : 0.5;
    let newStart = pivotTime - pivotFraction * newSpan;

    // Pan: shift by how far the midpoint itself has moved since gesture
    // start, converted from screen px to ms at the new (post-pinch) scale.
    const plotLeft = CYCLE_PERF_PAD.left, plotRight = CYCLE_PERF_CHART_W - CYCLE_PERF_PAD.right;
    const panPx = toLocalX(curMidX) - toLocalX(gesture.startMidX);
    newStart -= (panPx / (plotRight - plotLeft)) * newSpan;

    newStart = Math.min(Math.max(newStart, fullBounds.start), fullBounds.end - newSpan);
    const domain = { start: newStart, end: newStart + newSpan };
    gesture.lastDomain = domain;
    host._chartZoom.draw(domain);
  });

  function endPointer(e) {
    pointers.delete(e.pointerId);
    if (pointers.size < 2 && gesture) {
      const finalDomain = gesture.lastDomain;
      gesture = null;
      host._chartZoom?.commit(finalDomain);
    }
  }
  host.addEventListener("pointerup", endPointer);
  host.addEventListener("pointercancel", endPointer);
}

function renderCyclePerfChart(series, exerciseName, workoutByDate = {}) {
  const svg = document.getElementById("cycle-perf-chart");
  const tooltip = document.getElementById("cycle-perf-tooltip");
  const legendEl = document.getElementById("cycle-perf-phase-legend");
  const rangeEmptyEl = document.getElementById("cycle-perf-range-empty");
  const host = document.getElementById("cycle-perf-view-performance");
  document.getElementById("cycle-perf-exercise-name").textContent = exerciseName;

  const { unit, points: fullPoints } = series;
  // Distinct from #cycle-perf-empty (no logged sets for this exercise at
  // all, handled by the caller) - this is "the exercise has history, just
  // none inside the currently picked time range."
  if (!fullPoints.length) {
    svg.innerHTML = "";
    tooltip.hidden = true;
    legendEl.hidden = true;
    svg.hidden = true;
    rangeEmptyEl.hidden = false;
    host._chartZoom = null;
    return;
  }

  const fullBounds = chartDateBounds(fullPoints);
  let currentDomain = clampZoomDomain(cyclePerfZoomDomain, fullBounds);

  // Everything below redraws from scratch on every call - not just once per
  // renderCyclePerfSection(), but on every pointermove of an active
  // pinch/pan gesture too (see attachChartPinchZoomPan), so it has to stay
  // cheap. `points` here is the domain-sliced subset of fullPoints, never
  // fullPoints itself, so the range-button-picked window is still the outer
  // clamp on how far a pinch can zoom out.
  function draw(domain) {
    currentDomain = domain;
    const points = pointsInDomain(fullPoints, domain);
    svg.innerHTML = "";
    tooltip.hidden = true;

    if (!points.length) {
      legendEl.hidden = true;
      svg.hidden = true;
      rangeEmptyEl.hidden = false;
      return;
    }
    svg.hidden = false;
    rangeEmptyEl.hidden = true;

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

    // Tap a point to see its date + value; the hit target is the whole plot
    // area, not just the 3px dots, so a tap only has to be roughly on target.
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

      // Same "what was going on that day" context the Energy-by-Time tooltip
      // shows - energy alone doesn't explain a good or bad lift day, but
      // energy + what/when she ate together might.
      const dayLog = workoutByDate[p.date];
      if (dayLog) {
        if (dayLog.energy_level != null) {
          const energyEl = document.createElement("div");
          energyEl.className = "perf-tooltip-context";
          energyEl.textContent = `Energy ${dayLog.energy_level}/10`;
          tooltip.appendChild(energyEl);
        }
        const mealEl = document.createElement("div");
        mealEl.className = "perf-tooltip-context";
        mealEl.textContent = dayLog.pre_workout_meal ? `Ate: ${dayLog.pre_workout_meal}` : "No meal logged";
        tooltip.appendChild(mealEl);
        if (dayLog.hours_since_meal != null && dayLog.hours_since_meal !== "") {
          const timingEl = document.createElement("div");
          timingEl.className = "perf-tooltip-context";
          timingEl.textContent = `Ate ${formatMealTimingLabel(dayLog.hours_since_meal)}`;
          tooltip.appendChild(timingEl);
        }
      }

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
      // Well clear of a fingertip on touch, not just a mouse cursor - 12px
      // (fine for a mouse pointer) left the tooltip hidden under the finger
      // that triggered it on phones (same fix as the hormone chart's tooltip).
      tooltip.style.top = `${clientY - wrapRect.top - 44}px`;
      tooltip.hidden = false;
      crosshair.setAttribute("x1", xFor(i));
      crosshair.setAttribute("x2", xFor(i));
      crosshair.style.opacity = 1;
    }
    function hideTooltip() {
      tooltip.hidden = true;
      crosshair.style.opacity = 0;
    }
    function indexForClientX(clientX) {
      const svgRect = svg.getBoundingClientRect();
      const scaleX = CYCLE_PERF_CHART_W / svgRect.width;
      const localX = (clientX - svgRect.left) * scaleX;
      let nearest = 0, nearestDist = Infinity;
      points.forEach((p, i) => {
        const d = Math.abs(xFor(i) - localX);
        if (d < nearestDist) { nearestDist = d; nearest = i; }
      });
      return nearest;
    }
    attachChartClickToggle(hitRect, indexForClientX, showTooltip, hideTooltip);
  }

  draw(currentDomain);
  host._chartZoom = {
    getDomain: () => currentDomain,
    getFullBounds: () => fullBounds,
    draw,
    commit: (domain) => {
      currentDomain = domain;
      cyclePerfZoomDomain = domain;
      updateZoomResetButton();
      // Keep Energy-by-Time in sync, same as the range buttons already do -
      // it's the sibling view of "how has this changed over time", not a
      // separately-zoomed chart, even though only one is visible at once.
      document.getElementById("cycle-perf-view-energy")._chartZoom?.draw(domain);
    },
  };
  attachChartPinchZoomPan(host);
}

// One point per calendar date that has a logged energy level - averaged in
// the rare case a date has more than one workout_log row (e.g. logged via
// the date picker twice). Meal/timing come from that date's most recent
// entry (workoutLog is already date DESC, id DESC, so the first row seen
// per date here is the latest) - context for the tap-to-see-detail
// behavior, since a bare energy number alone doesn't explain a dip or spike.
function computeEnergySeries(workoutLog) {
  const byDate = {};
  workoutLog.forEach(w => {
    if (w.energy_level == null) return;
    if (!byDate[w.date]) {
      byDate[w.date] = { sum: 0, count: 0, meal: w.pre_workout_meal, hoursSinceMeal: w.hours_since_meal };
    }
    byDate[w.date].sum += Number(w.energy_level);
    byDate[w.date].count += 1;
  });
  return Object.keys(byDate).sort().map(date => {
    const d = byDate[date];
    return { date, value: Math.round((d.sum / d.count) * 10) / 10, meal: d.meal, hoursSinceMeal: d.hoursSinceMeal };
  });
}

// Same visual language as renderCyclePerfChart (per-segment phase coloring,
// tap/hover crosshair + tooltip) but a fixed 1-10 axis (energy is always
// that scale, unlike weight/duration) and no PR marker - "peaked" doesn't
// mean anything for a subjective energy rating. The tooltip trades the
// weight/duration + edited-set details for what she ate that day and how
// long before the workout, which is the whole point of tapping a point here.
function renderCycleEnergyChart(fullPoints, hasAnyData = fullPoints.length > 0) {
  const svg = document.getElementById("cycle-energy-chart");
  const tooltip = document.getElementById("cycle-energy-tooltip");
  const legendEl = document.getElementById("cycle-energy-phase-legend");
  const emptyEl = document.getElementById("cycle-energy-empty");
  const host = document.getElementById("cycle-perf-view-energy");

  if (!fullPoints.length) {
    svg.innerHTML = "";
    tooltip.hidden = true;
    // Distinguishes "never logged energy at all" from "just none in the
    // currently picked time range" (hasAnyData is against the unfiltered
    // series, so the caller can tell the two apart).
    emptyEl.textContent = hasAnyData
      ? "No energy logged in this time range."
      : "Log your energy level during a workout to see this chart.";
    emptyEl.hidden = false;
    svg.hidden = true;
    legendEl.hidden = true;
    host._chartZoom = null;
    return;
  }

  const fullBounds = chartDateBounds(fullPoints);
  let currentDomain = clampZoomDomain(cyclePerfZoomDomain, fullBounds);

  // See renderCyclePerfChart's draw() for why this redraws from scratch on
  // every call, including every pointermove of an active pinch/pan gesture.
  function draw(domain) {
    currentDomain = domain;
    const points = pointsInDomain(fullPoints, domain);
    svg.innerHTML = "";
    tooltip.hidden = true;

    if (!points.length) {
      emptyEl.textContent = "No energy logged in this time range.";
      emptyEl.hidden = false;
      svg.hidden = true;
      legendEl.hidden = true;
      return;
    }
    emptyEl.hidden = true;
    svg.hidden = false;

    const plotLeft = CYCLE_PERF_PAD.left, plotRight = CYCLE_PERF_CHART_W - CYCLE_PERF_PAD.right;
    const plotTop = CYCLE_PERF_PAD.top, plotBottom = CYCLE_PERF_CHART_H - CYCLE_PERF_PAD.bottom;
    const plotW = plotRight - plotLeft, plotH = plotBottom - plotTop;

    const yMin = 1, yMax = 10, step = 3;
    const dates = points.map(p => new Date(p.date + "T00:00:00").getTime());
    const minDate = dates[0], maxDate = dates[dates.length - 1];
    const dateSpan = Math.max(maxDate - minDate, 1);

    const xFor = i => points.length === 1 ? plotLeft + plotW / 2 : plotLeft + ((dates[i] - minDate) / dateSpan) * plotW;
    const yFor = v => plotTop + plotH - ((v - yMin) / (yMax - yMin || 1)) * plotH;

    const segColors = points.map(p => colorForDate(p.date));
    const tracksCycle = points.some(p => cyclePhaseForDate(p.date));

    for (let i = 0; i < points.length - 1; i++) {
      const x1 = xFor(i), x2 = xFor(i + 1);
      const y1 = yFor(points[i].value), y2 = yFor(points[i + 1].value);
      const d = `M${x1},${plotBottom} L${x1},${y1} L${x2},${y2} L${x2},${plotBottom} Z`;
      svg.appendChild(svgEl("path", { d, fill: segColors[i], "fill-opacity": "0.28", stroke: "none" }));
    }

    for (let v = yMin; v <= yMax + 0.001; v += step) {
      const y = yFor(v);
      svg.appendChild(svgEl("line", { class: "perf-gridline", x1: plotLeft, x2: plotRight, y1: y, y2: y }));
      const label = svgEl("text", { class: "perf-axis-label", x: plotLeft - 8, y: y + 4, "text-anchor": "end" });
      label.textContent = String(Math.round(v));
      svg.appendChild(label);
    }

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

    for (let i = 0; i < points.length - 1; i++) {
      const d = `M${xFor(i)},${yFor(points[i].value)} L${xFor(i + 1)},${yFor(points[i + 1].value)}`;
      svg.appendChild(svgEl("path", { class: "perf-line", d, stroke: segColors[i] }));
    }
    points.forEach((p, i) => {
      svg.appendChild(svgEl("circle", { cx: xFor(i), cy: yFor(p.value), r: 3, fill: segColors[i] }));
    });

    const lastIndex = points.length - 1;
    const lastCx = xFor(lastIndex), lastCy = yFor(points[lastIndex].value);
    svg.appendChild(svgEl("circle", { class: "perf-dot-ring", cx: lastCx, cy: lastCy, r: 6 }));
    svg.appendChild(svgEl("circle", { cx: lastCx, cy: lastCy, r: 4, fill: segColors[lastIndex] }));
    const lastLabel = svgEl("text", { class: "perf-value-label", x: lastCx, y: lastCy - 14, "text-anchor": "middle" });
    lastLabel.textContent = `${points[lastIndex].value}/10`;
    svg.appendChild(lastLabel);

    if (tracksCycle) {
      legendEl.hidden = false;
      legendEl.innerHTML = getCyclePhases().map(p =>
        `<span class="phase-legend-item"><span class="phase-dot" style="background:${p.color}"></span>${p.label.replace(" Phase", "")}</span>`
      ).join("");
    } else {
      legendEl.hidden = true;
    }

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
      valueEl.textContent = `Energy ${p.value}/10`;
      const dateEl = document.createElement("div");
      dateEl.className = "perf-tooltip-date";
      const phase = cyclePhaseForDate(p.date);
      dateEl.textContent = phase ? `${formatPerfDate(p.date)} — ${phase.label}` : formatPerfDate(p.date);
      tooltip.appendChild(valueEl);
      tooltip.appendChild(dateEl);

      const mealEl = document.createElement("div");
      mealEl.className = "perf-tooltip-context";
      mealEl.textContent = p.meal ? `Ate: ${p.meal}` : "No meal logged";
      tooltip.appendChild(mealEl);

      if (p.hoursSinceMeal != null && p.hoursSinceMeal !== "") {
        const timingEl = document.createElement("div");
        timingEl.className = "perf-tooltip-context";
        timingEl.textContent = `Ate ${formatMealTimingLabel(p.hoursSinceMeal)}`;
        tooltip.appendChild(timingEl);
      }

      const wrapRect = wrap.getBoundingClientRect();
      tooltip.style.left = `${clientX - wrapRect.left}px`;
      // Well clear of a fingertip on touch, not just a mouse cursor - 12px
      // (fine for a mouse pointer) left the tooltip hidden under the finger
      // that triggered it on phones (same fix as the hormone chart's tooltip).
      tooltip.style.top = `${clientY - wrapRect.top - 44}px`;
      tooltip.hidden = false;
      crosshair.setAttribute("x1", xFor(i));
      crosshair.setAttribute("x2", xFor(i));
      crosshair.style.opacity = 1;
    }
    function hideTooltip() {
      tooltip.hidden = true;
      crosshair.style.opacity = 0;
    }
    function indexForClientX(clientX) {
      const svgRect = svg.getBoundingClientRect();
      const scaleX = CYCLE_PERF_CHART_W / svgRect.width;
      const localX = (clientX - svgRect.left) * scaleX;
      let nearest = 0, nearestDist = Infinity;
      points.forEach((p, i) => {
        const d = Math.abs(xFor(i) - localX);
        if (d < nearestDist) { nearestDist = d; nearest = i; }
      });
      return nearest;
    }
    attachChartClickToggle(hitRect, indexForClientX, showTooltip, hideTooltip);
  }

  draw(currentDomain);
  host._chartZoom = {
    getDomain: () => currentDomain,
    getFullBounds: () => fullBounds,
    draw,
    commit: (domain) => {
      currentDomain = domain;
      cyclePerfZoomDomain = domain;
      updateZoomResetButton();
      document.getElementById("cycle-perf-view-performance")._chartZoom?.draw(domain);
    },
  };
  attachChartPinchZoomPan(host);
}
initTogglePopover(document.getElementById("cycle-energy-info-btn"), document.getElementById("cycle-energy-info-popover"));

// Average energy for each distinct food logged before a workout - grouped
// case/whitespace-insensitively (typing "Banana" one day and "banana"
// another shouldn't split into two rows) but displayed using whichever
// casing was typed first for that group. Only entries with both a meal and
// a logged energy level count - "No meal logged" days have nothing to
// compare here. Sorted highest-energy-first since that's the point of the
// chart: which foods this exercise/day pairing actually correlates with
// feeling good, not which food comes up most often.
function computeEnergyByMeal(workoutLog) {
  const groups = {};
  workoutLog.forEach(w => {
    const meal = (w.pre_workout_meal || "").trim();
    if (!meal || w.energy_level == null) return;
    const key = meal.toLowerCase();
    if (!groups[key]) groups[key] = { key, label: meal, sum: 0, count: 0 };
    groups[key].sum += Number(w.energy_level);
    groups[key].count += 1;
  });
  return Object.values(groups)
    .map(g => ({ key: g.key, label: g.label, value: g.sum / g.count, count: g.count }))
    .sort((a, b) => b.value - a.value);
}

// Full list is usually longer than is useful to show at once - defaults to
// just the top 4 (highest average energy), with "Choose foods to compare"
// letting her pick a specific subset instead (e.g. only the foods she's
// actually deciding between, ignoring the rest). null means "no custom
// pick yet, show the default top 4"; picking zero foods in the modal resets
// back to null rather than rendering an empty list.
let mealCompareSelection = null;
let lastEnergyByMealItems = [];

// Reuses the "Where your PRs happen" row styling (.prphase-*) - a labeled
// horizontal bar per category is the same right form here (compare a value
// across a handful of foods), just on a fixed 1-10 scale instead of
// relative to the biggest bar.
function renderEnergyByMealList(items) {
  lastEnergyByMealItems = items;
  const contentEl = document.getElementById("cycle-energy-meal-content");
  const emptyEl = document.getElementById("cycle-energy-meal-empty");
  const compareBtn = document.getElementById("cycle-meal-compare-btn");
  if (!items.length) {
    contentEl.innerHTML = "";
    emptyEl.hidden = false;
    compareBtn.hidden = true;
    return;
  }
  emptyEl.hidden = true;
  compareBtn.hidden = items.length <= 4 && !mealCompareSelection;

  const visible = mealCompareSelection
    ? items.filter(it => mealCompareSelection.has(it.key))
    : items.slice(0, 4);
  contentEl.innerHTML = visible.map(it => {
    const pct = Math.max((it.value / 10) * 100, 4);
    return `
      <div class="prphase-row">
        <div class="prphase-row-top">
          <span class="prphase-name">${escapeHtml(it.label)}</span>
          <span class="prphase-count">${it.value.toFixed(1)}/10</span>
        </div>
        <div class="prphase-bar-track">
          <div class="prphase-bar-fill" style="width:${pct}%; background:var(--accent-purple);"></div>
        </div>
        <p class="prphase-energy">${it.count} workout${it.count === 1 ? "" : "s"}</p>
      </div>`;
  }).join("");
}
initTogglePopover(document.getElementById("cycle-meal-info-btn"), document.getElementById("cycle-meal-info-popover"));

// ---------------- Choose foods to compare (Energy by Meal) ----------------
const mealCompareModal = document.getElementById("meal-compare-modal");
document.getElementById("cycle-meal-compare-btn").addEventListener("click", () => {
  // Pre-checks whatever's currently shown - the top 4 if no custom pick
  // yet, otherwise the existing selection - so opening the picker starts
  // from what she's already looking at, not a blank slate.
  const preChecked = mealCompareSelection || new Set(lastEnergyByMealItems.slice(0, 4).map(it => it.key));
  document.getElementById("meal-compare-list").innerHTML = lastEnergyByMealItems.map(it => `
    <label class="meal-compare-item">
      <input type="checkbox" value="${escapeHtml(it.key)}" ${preChecked.has(it.key) ? "checked" : ""}>
      <span class="meal-compare-item-name">${escapeHtml(it.label)}</span>
      <span class="meal-compare-item-value">${it.value.toFixed(1)}/10</span>
    </label>`).join("");
  mealCompareModal.hidden = false;
});
mealCompareModal.addEventListener("click", (e) => { if (e.target === mealCompareModal) mealCompareModal.hidden = true; });
document.getElementById("meal-compare-reset").addEventListener("click", () => {
  mealCompareSelection = null;
  renderEnergyByMealList(lastEnergyByMealItems);
  mealCompareModal.hidden = true;
});
document.getElementById("meal-compare-done").addEventListener("click", () => {
  const checked = [...document.querySelectorAll("#meal-compare-list input:checked")].map(el => el.value);
  mealCompareSelection = checked.length ? new Set(checked) : null;
  renderEnergyByMealList(lastEnergyByMealItems);
  mealCompareModal.hidden = true;
});

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
    const isWeight = metricKey === "weight_kg";
    const metricCount = isWeight ? weightCount : durationCount;
    if (metricCount < 2) return;
    const unit = isWeight ? weightUnit() : "min";
    let best = null;
    rows.forEach(x => {
      const v = x[metricKey];
      if (v == null) return;
      if (!best || v > best.value) best = { value: v, date: x.date };
    });
    if (!best) return;
    const phase = cyclePhaseForDate(best.date);
    if (!phase) return;
    byPhase[phase.key].push({ name, unit, value: isWeight ? kgToDisplayWeight(best.value) : best.value });
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

// ---------------- Cycle tab: rotating insights ----------------
// Four independent, timing/behavior-based takes on the same underlying
// data (never magnitude/"peaked at" claims - those read as trivia, not
// insight, since a single all-time best rarely says anything about *now*).
// Each compute*Insight function returns a slide object or null if there
// isn't enough data for THAT one to say something meaningful - "no
// confident claim to make, don't show filler" now applies per slide
// instead of to the card as a whole, so a data-light account still gets
// whichever of the four it has enough history for, rather than none at all.

// N of your last M PRs (any exercise) landed in the phase you're in right
// now - computePRDaysByDate gives every PR *event* across history (unlike
// computePRPhaseBreakdown's single all-time-best per exercise), which is
// what a genuine "recent" claim needs.
function computeRecentPrInsight(history) {
  const RECENT_N = 5;
  const prDaysByDate = computePRDaysByDate(history);
  const events = [];
  prDaysByDate.forEach((muscles, date) => muscles.forEach(m => events.push({ date, muscle: m })));
  if (events.length < 3) return null;
  events.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  const currentPhase = cyclePhaseForDate(todayStr);
  if (!currentPhase) return null;
  const recent = events.slice(0, RECENT_N);
  const inCurrentPhase = recent.filter(e => {
    const p = cyclePhaseForDate(e.date);
    return p && p.key === currentPhase.key;
  }).length;
  return { body: `${inCurrentPhase} of your last ${recent.length} PRs happened in ${currentPhase.label.replace(" Phase", "")}.` };
}

// What fraction of this phase's days (across your whole logged history,
// not just the current cycle) actually had a workout, versus your overall
// rate - a consistency signal, not a performance one, so it stays
// meaningful even for someone whose numbers aren't moving.
function computeConsistencyInsight(history) {
  if (!history.length) return null;
  const workoutDates = new Set(history.map(x => x.date));
  const earliest = [...workoutDates].sort()[0];
  const dayCounts = {}, visitCounts = {};
  getCyclePhases().forEach(p => { dayCounts[p.key] = 0; visitCounts[p.key] = 0; });
  let d = earliest;
  let guard = 0;
  while (d <= todayStr && guard < 3650) {
    const phase = cyclePhaseForDate(d);
    if (phase) {
      dayCounts[phase.key]++;
      if (workoutDates.has(d)) visitCounts[phase.key]++;
    }
    d = addDaysIso(d, 1);
    guard++;
  }
  const currentPhase = cyclePhaseForDate(todayStr);
  // Needs a real sample of this phase's days, not a 2-day fluke - 5 is
  // roughly a first full pass through the shortest phase (ovulation aside).
  if (!currentPhase || dayCounts[currentPhase.key] < 5) return null;
  const pct = Math.round((visitCounts[currentPhase.key] / dayCounts[currentPhase.key]) * 100);
  const overallDays = Object.values(dayCounts).reduce((a, b) => a + b, 0);
  const overallVisits = Object.values(visitCounts).reduce((a, b) => a + b, 0);
  const overallPct = overallDays ? Math.round((overallVisits / overallDays) * 100) : 0;
  return { body: `You've worked out on ${pct}% of your ${currentPhase.label.replace(" Phase", "")} days, vs ${overallPct}% overall.` };
}

// Points forward instead of just reporting an average - which phase (by
// average energy) is still ahead of you, and how soon. Needs at least two
// phases with energy data logged, or "highest" is trivially the only one
// with any data at all.
function computeEnergyForecastInsight(workoutLog) {
  const energyByPhase = computeEnergyByPhase(workoutLog);
  const phases = getCyclePhases();
  const withData = phases.filter(p => energyByPhase[p.key]);
  if (withData.length < 2) return null;
  const best = withData.reduce((m, p) => (energyByPhase[p.key].value > energyByPhase[m.key].value ? p : m));
  const cycleDay = cycleDayForDate(todayStr);
  if (cycleDay == null) return null;
  const currentPhase = phases.find(p => cycleDay >= p.startDay && cycleDay <= p.endDay) || phases[phases.length - 1];
  const avg = energyByPhase[best.key].value.toFixed(1);
  if (best.key === currentPhase.key) {
    return { body: `You're in your highest-energy phase right now - ${currentPhase.label.replace(" Phase", "")} averages ${avg}.` };
  }
  const currentIndex = phases.indexOf(currentPhase);
  let daysUntil = null;
  for (let i = 1; i <= phases.length; i++) {
    const p = phases[(currentIndex + i) % phases.length];
    if (p.key === best.key) {
      daysUntil = p.startDay > cycleDay ? p.startDay - cycleDay : (cycleLengthDays() - cycleDay) + p.startDay;
      break;
    }
  }
  if (daysUntil == null) return null;
  return { body: `Your highest-energy phase, ${best.label.replace(" Phase", "")} (avg ${avg}), starts in ${daysUntil} day${daysUntil === 1 ? "" : "s"}.` };
}

// Compares the selected exercise's last session against the most recent
// one before it that fell in a *different* phase - a real, recent
// comparison instead of an all-time-best that might be a year stale.
// series is computeExerciseSeries's own output (already computed for the
// chart above this card, not recomputed here).
function computeRecentTrendInsight(series, exerciseName) {
  if (!series || series.points.length < 2) return null;
  const points = series.points;
  const last = points[points.length - 1];
  const lastPhase = cyclePhaseForDate(last.date);
  if (!lastPhase) return null;
  let prev = null, prevPhase = null;
  for (let i = points.length - 2; i >= 0; i--) {
    const p = cyclePhaseForDate(points[i].date);
    if (p && p.key !== lastPhase.key) { prev = points[i]; prevPhase = p; break; }
  }
  if (!prev) return null;
  const cmp = last.value > prev.value ? "beat" : last.value < prev.value ? "came in under" : "matched";
  return {
    body: `Your last ${escapeHtml(exerciseName)} session (${lastPhase.label.replace(" Phase", "")}, ${last.value} ${series.unit}) ${cmp} the one before it in ${prevPhase.label.replace(" Phase", "")} (${prev.value} ${series.unit}).`,
  };
}

function renderCyclePerfInsight(history, exerciseName, workoutLog, series) {
  const cardEl = document.getElementById("cycle-perf-insight-card");
  const trackEl = document.getElementById("cycle-perf-insight-track");
  const dotsEl = document.getElementById("cycle-perf-insight-dots");

  const slides = [
    computeRecentPrInsight(history),
    computeConsistencyInsight(history),
    computeEnergyForecastInsight(workoutLog),
    computeRecentTrendInsight(series, exerciseName),
  ].filter(Boolean);

  if (!slides.length) { cardEl.hidden = true; return; }
  cardEl.hidden = false;

  const n = slides.length;
  const slideHtml = s => `<div class="cycle-perf-insight-slide"><p class="cycle-perf-insight-body">${s.body}</p></div>`;
  dotsEl.hidden = n < 2;
  dotsEl.innerHTML = slides.map((_, i) => `<span class="cycle-perf-insight-dot${i === 0 ? " active" : ""}"></span>`).join("");
  const setActiveDot = (i) => dotsEl.querySelectorAll(".cycle-perf-insight-dot").forEach((d, idx) => d.classList.toggle("active", idx === i));

  if (n < 2) {
    trackEl.innerHTML = slideHtml(slides[0]);
    trackEl.onscroll = null;
    return;
  }

  // Cyclic swipe: CSS scroll-snap has no native wraparound, so the track is
  // padded with a clone of the last slide before the real first one and a
  // clone of the first slide after the real last one. Swiping past either
  // end lands on a visual duplicate of the opposite end; once scrolling
  // settles there, an instant (no scroll-behavior:smooth, so unanimated)
  // scrollLeft jump swaps it for the real slide before the eye can tell -
  // the standard trick for a "loop" carousel over a plain scroll container.
  trackEl.innerHTML = slideHtml(slides[n - 1]) + slides.map(slideHtml).join("") + slideHtml(slides[0]);
  trackEl.scrollLeft = trackEl.clientWidth; // start on the real first slide, not the leading clone

  let settleTimer = null;
  trackEl.onscroll = () => {
    clearTimeout(settleTimer);
    settleTimer = setTimeout(() => {
      const w = Math.max(trackEl.clientWidth, 1);
      const rawIndex = Math.round(trackEl.scrollLeft / w);
      if (rawIndex === 0) {
        trackEl.scrollLeft = n * w;
        setActiveDot(n - 1);
      } else if (rawIndex === n + 1) {
        trackEl.scrollLeft = w;
        setActiveDot(0);
      } else {
        setActiveDot(rawIndex - 1);
      }
    }, 80);
  };
}

async function renderCyclePerfSection() {
  setCyclePerfStale(false);
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
  let workoutLog = [];
  try { workoutLog = await api.get("/api/workout-log"); } catch (err) { /* insight/PR-phase/energy cards just show their empty states */ }
  // Keyed by date for the Performance-by-Time tooltip's energy/meal/timing
  // lines - workoutLog is already date DESC, id DESC, so the first row seen
  // per date here is that date's latest entry (matches computeEnergySeries).
  const workoutByDate = {};
  workoutLog.forEach(w => { if (!workoutByDate[w.date]) workoutByDate[w.date] = w; });

  // Insights (renderCyclePerfInsight) deliberately look at the full,
  // unfiltered series/history - "N of your last 5 PRs" etc. shouldn't
  // change just because the chart above is zoomed into the last month.
  const exerciseSeries = computeExerciseSeries(history, cyclePerfExercise);
  const energySeries = computeEnergySeries(workoutLog);
  updateZoomResetButton();
  renderCyclePerfChart({ unit: exerciseSeries.unit, points: filterPointsByMonths(exerciseSeries.points) }, cyclePerfExercise, workoutByDate);
  renderCycleEnergyChart(filterPointsByMonths(energySeries), energySeries.length > 0);
  renderEnergyByMealList(computeEnergyByMeal(workoutLog));
  renderPRPhaseBreakdown(history, workoutLog);
  renderCyclePerfInsight(history, cyclePerfExercise, workoutLog, exerciseSeries);
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
  if (x.weight_kg != null) parts.push(x.weight_kg === 0 ? "BW" : `${formatWeightNumber(x.weight_kg)} ${weightUnit()}`);
  if (x.duration_minutes != null) parts.push(`${x.duration_minutes} min`);
  const ls = levelSpeedDisplay(x);
  if (ls) parts.push(ls);
  if (x.notes) parts.push(escapeHtml(x.notes));
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
        <span class="exercise-detail-group-title">${escapeHtml(group.muscle_group)} — ${escapeHtml(group.exercise)}</span>
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
      row.querySelector(".set-weight").value = weightInputValue(s.weight_kg);
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
      // A same-day draft is restored right into today's workout - a
      // previous day's leftover draft gets auto-saved to History instead
      // (see autoFinalizeStaleDraft), so it'd be misleading to call it
      // "restored" here.
      if (draft.date === todayStr) toast("Restored your unsaved entry");
    }
  } finally {
    restoringDraft = false;
    setActiveExerciseIndex(exercisesContainer.children.length ? 0 : -1);
  }
}

// A draft left over from a previous day (app closed mid-workout, or just
// never hit Done) shouldn't linger as "Continue today's workout" forever -
// once the day it belongs to has passed, it's finalized the same way Done
// would: saved to History under its own date, then the Log screen resets so
// Today starts fresh. restoreDraft() above must run first so this can reuse
// its DOM/state, exactly like the manual Done button does.
async function autoFinalizeStaleDraft() {
  if (logSessionDate === todayStr) return;
  try {
    await submitExerciseLog({ auto: true });
  } catch (err) {
    // Save failed (e.g. offline) - leave the draft in place so it's retried
    // on next launch instead of silently losing it.
  }
}

// loadMuscleOptions()/checkOnboarding() already kicked off earlier
// (see "Onboarding / profile picker"); restoreDraft() runs per-profile
// from inside selectProfile() once we know who's using the app.

