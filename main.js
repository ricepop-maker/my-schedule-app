// ===== [미리보기 버전] =====
// 지금은 디자인/동작 흐름 확인용 임시 버전입니다.
// 로그인은 실제 인증 없이 화면만 전환하고, 일정 데이터는 메모리에만 저장됩니다(새로고침하면 초기화).
// 디자인 확정 후 Firebase Authentication + Firestore 연동으로 교체될 예정입니다.

// ===== 기본 카테고리 (사용자가 추가한 것처럼 목록에 계속 쌓임) =====
let categories = [
  { id: "work", name: "업무", color: "#4dabf7" },
  { id: "personal", name: "개인", color: "#51cf66" },
  { id: "appointment", name: "약속", color: "#ff922b" },
  { id: "etc", name: "기타", color: "#adb5bd" }
];

// ===== 우선순위 레벨 (고정 3단계, 레벨별 색상) =====
const PRIORITY_COLORS = { low: "#51cf66", medium: "#f5c518", high: "#ff6b6b" };
const PRIORITY_LABELS = { low: "낮음", medium: "보통", high: "높음" };

// ===== 샘플 일정 데이터 (디자인 확인용) =====
const today = new Date();
function sampleDate(offsetDays) {
  const d = new Date(today);
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

let schedules = [
  {
    id: "s1", title: "팀 주간회의", date: sampleDate(0), startTime: "10:00", endTime: "11:00",
    allDay: false, categoryId: "work", priority: "high", memo: "주간 업무 공유", repeat: "weekly", repeatEndDate: "",
    alarm: "10min"
  },
  {
    id: "s2", title: "치과 예약", date: sampleDate(2), startTime: "15:30", endTime: "16:00",
    allDay: false, categoryId: "appointment", priority: "medium", memo: "정기 검진", repeat: "none", repeatEndDate: "",
    alarm: "1hour"
  },
  {
    id: "s3", title: "친구 생일", date: sampleDate(5), startTime: "", endTime: "",
    allDay: true, categoryId: "personal", priority: "low", memo: "선물 준비하기", repeat: "none", repeatEndDate: "",
    alarm: "1day"
  },
  {
    id: "s4", title: "헬스장", date: sampleDate(-1), startTime: "07:00", endTime: "08:00",
    allDay: false, categoryId: "personal", priority: "low", memo: "", repeat: "daily", repeatEndDate: "",
    alarm: "none"
  }
];

// ===== 상태 =====
const state = {
  loggedIn: false,
  currentView: localStorage.getItem("currentView") || "calendar",
  currentMonth: new Date(today.getFullYear(), today.getMonth(), 1),
  selectedDate: null,
  categoryFilter: "all"
};

// ===== 엘리먼트 참조 =====
const el = (id) => document.getElementById(id);

const authScreen = el("authScreen");
const appScreen = el("appScreen");
const authForm = el("authForm");
const authError = el("authError");
const loginBtn = el("loginBtn");
const signupBtn = el("signupBtn");
const logoutBtn = el("logoutBtn");

const tabBtns = document.querySelectorAll(".tab-btn");
const calendarView = el("calendarView");
const listView = el("listView");
const calendarGrid = el("calendarGrid");
const currentMonthLabel = el("currentMonthLabel");
const prevMonthBtn = el("prevMonthBtn");
const nextMonthBtn = el("nextMonthBtn");
const todayBtn = el("todayBtn");
const categoryFilter = el("categoryFilter");
const addScheduleBtn = el("addScheduleBtn");

const dayDetailPanel = el("dayDetailPanel");
const dayDetailTitle = el("dayDetailTitle");
const dayDetailList = el("dayDetailList");
const closeDayDetailBtn = el("closeDayDetailBtn");

const scheduleList = el("scheduleList");
const listEmptyMsg = el("listEmptyMsg");

const statusBar = el("statusBar");

const scheduleModal = el("scheduleModal");
const modalTitle = el("modalTitle");
const scheduleForm = el("scheduleForm");
const scheduleIdInput = el("scheduleId");
const titleInput = el("titleInput");
const dateInput = el("dateInput");
const allDayInput = el("allDayInput");
const timeFields = el("timeFields");
const startTimeInput = el("startTimeInput");
const endTimeInput = el("endTimeInput");
const categorySearchInput = el("categorySearchInput");
const categoryInput = el("categoryInput");
const categoryOptionsList = el("categoryOptionsList");
const newCategoryBtn = el("newCategoryBtn");
const newCategoryFields = el("newCategoryFields");
const newCategoryName = el("newCategoryName");
const newCategoryColor = el("newCategoryColor");
const priorityBtns = document.querySelectorAll(".priority-btn");
const priorityInput = el("priorityInput");
const memoInput = el("memoInput");
const repeatInput = el("repeatInput");
const customDaysField = el("customDaysField");
const weekdayBtns = document.querySelectorAll(".weekday-btn");
const repeatEndField = el("repeatEndField");
const repeatEndInput = el("repeatEndInput");
const alarmInput = el("alarmInput");
const deleteScheduleBtn = el("deleteScheduleBtn");
const cancelModalBtn = el("cancelModalBtn");
const closeModalBtn = el("closeModalBtn");

// ===== 상태 메시지 표시 =====
let statusTimer = null;
function showStatus(message) {
  statusBar.textContent = message;
  statusBar.classList.remove("hidden");
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => statusBar.classList.add("hidden"), 2200);
}

// ===== 로그인 화면 (미리보기: 실제 인증 없음) =====
authForm.addEventListener("submit", (e) => {
  e.preventDefault();
  enterApp("로그인되었습니다", "email");
});

signupBtn.addEventListener("click", () => {
  const email = el("authEmail").value;
  const password = el("authPassword").value;
  if (!email || !password) {
    authError.textContent = "이메일과 비밀번호를 입력해주세요";
    authError.classList.remove("hidden");
    return;
  }
  enterApp("회원가입이 완료되었습니다", "email");
});

el("googleLoginBtn").addEventListener("click", () => {
  enterApp("구글 계정으로 로그인되었습니다", "google");
});

function enterApp(message, method) {
  authError.classList.add("hidden");
  authScreen.classList.add("hidden");
  appScreen.classList.remove("hidden");
  state.loggedIn = true;
  if (method) localStorage.setItem("lastLoginMethod", method);
  showStatus(message);
  renderAll();
}

// ===== 최근 로그인 방법 배지 표시 =====
function showRecentLoginBadge() {
  const method = localStorage.getItem("lastLoginMethod");
  el("emailRecentBadge").classList.toggle("hidden", method !== "email");
  el("googleRecentBadge").classList.toggle("hidden", method !== "google");
}
showRecentLoginBadge();

logoutBtn.addEventListener("click", () => {
  appScreen.classList.add("hidden");
  authScreen.classList.remove("hidden");
  authForm.reset();
  state.loggedIn = false;
  showStatus("로그아웃되었습니다");
});

// ===== 뷰 전환 (캘린더 / 리스트) =====
tabBtns.forEach((btn) => {
  btn.addEventListener("click", () => {
    tabBtns.forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    state.currentView = btn.dataset.view;
    localStorage.setItem("currentView", state.currentView);
    updateViewVisibility();
  });
});

function updateViewVisibility() {
  const isCalendar = state.currentView === "calendar";
  calendarView.classList.toggle("hidden", !isCalendar);
  listView.classList.toggle("hidden", isCalendar);
  if (!isCalendar) renderList();
}

// ===== 월 이동 =====
prevMonthBtn.addEventListener("click", () => changeMonth(-1));
nextMonthBtn.addEventListener("click", () => changeMonth(1));
todayBtn.addEventListener("click", () => {
  state.currentMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  renderAll();
});

function changeMonth(diff) {
  state.currentMonth = new Date(state.currentMonth.getFullYear(), state.currentMonth.getMonth() + diff, 1);
  renderAll();
}

// ===== 카테고리 필터 =====
categoryFilter.addEventListener("change", () => {
  state.categoryFilter = categoryFilter.value;
  renderAll();
});

function renderCategoryFilterOptions() {
  const current = categoryFilter.value || "all";
  categoryFilter.innerHTML = '<option value="all">전체 카테고리</option>';
  categories.forEach((c) => {
    const opt = document.createElement("option");
    opt.value = c.id;
    opt.textContent = c.name;
    categoryFilter.appendChild(opt);
  });
  categoryFilter.value = current;
}

function getCategory(id) {
  return categories.find((c) => c.id === id) || categories[categories.length - 1];
}

// ===== 반복 일정 펼치기 (해당 월 범위 내에서) =====
function expandRecurring(schedule, rangeStart, rangeEnd) {
  const occurrences = [];
  const base = new Date(schedule.date + "T00:00:00");
  if (schedule.repeat === "none") {
    if (base >= rangeStart && base <= rangeEnd) occurrences.push(schedule.date);
    return occurrences;
  }

  const end = schedule.repeatEndDate ? new Date(schedule.repeatEndDate + "T00:00:00") : rangeEnd;
  const loopStart = base > rangeStart ? base : rangeStart;
  const loopEnd = rangeEnd < end ? rangeEnd : end;
  const cursor = new Date(loopStart);

  while (cursor <= loopEnd) {
    if (cursor >= base && matchesRepeat(schedule, base, cursor)) {
      occurrences.push(cursor.toISOString().slice(0, 10));
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return occurrences;
}

function matchesRepeat(schedule, base, cursor) {
  switch (schedule.repeat) {
    case "daily": return true;
    case "weekly": return cursor.getDay() === base.getDay();
    case "monthly": return cursor.getDate() === base.getDate();
    case "weekday": return cursor.getDay() >= 1 && cursor.getDay() <= 5;
    case "custom": return (schedule.customDays || []).includes(cursor.getDay());
    default: return false;
  }
}

function getMonthOccurrences(year, month) {
  const rangeStart = new Date(year, month, 1);
  const rangeEnd = new Date(year, month + 1, 0);
  const filtered = state.categoryFilter === "all"
    ? schedules
    : schedules.filter((s) => s.categoryId === state.categoryFilter);

  const map = {}; // 날짜별 일정 목록
  filtered.forEach((s) => {
    expandRecurring(s, rangeStart, rangeEnd).forEach((date) => {
      if (!map[date]) map[date] = [];
      map[date].push(s);
    });
  });
  return map;
}

// ===== 캘린더 렌더링 =====
function renderCalendar() {
  const year = state.currentMonth.getFullYear();
  const month = state.currentMonth.getMonth();
  currentMonthLabel.textContent = `${year}년 ${month + 1}월`;

  const occByDate = getMonthOccurrences(year, month);

  const firstDay = new Date(year, month, 1);
  const startOffset = firstDay.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const daysInPrevMonth = new Date(year, month, 0).getDate();

  const cells = [];
  const totalCells = Math.ceil((startOffset + daysInMonth) / 7) * 7;

  for (let i = 0; i < totalCells; i++) {
    const dayNum = i - startOffset + 1;
    let cellDate, otherMonth = false;
    if (dayNum < 1) {
      cellDate = new Date(year, month - 1, daysInPrevMonth + dayNum);
      otherMonth = true;
    } else if (dayNum > daysInMonth) {
      cellDate = new Date(year, month + 1, dayNum - daysInMonth);
      otherMonth = true;
    } else {
      cellDate = new Date(year, month, dayNum);
    }
    cells.push({ cellDate, otherMonth });
  }

  calendarGrid.innerHTML = "";
  const todayStr = today.toISOString().slice(0, 10);

  cells.forEach(({ cellDate, otherMonth }) => {
    const dateStr = cellDate.toISOString().slice(0, 10);
    const dayEvents = occByDate[dateStr] || [];

    const cell = document.createElement("div");
    cell.className = "calendar-cell";
    if (otherMonth) cell.classList.add("other-month");
    if (dateStr === todayStr) cell.classList.add("is-today");
    if (state.selectedDate === dateStr) cell.classList.add("is-selected");

    const dateEl = document.createElement("div");
    dateEl.className = "cell-date";
    dateEl.textContent = cellDate.getDate();
    cell.appendChild(dateEl);

    const eventsEl = document.createElement("div");
    eventsEl.className = "cell-events";
    dayEvents.slice(0, 3).forEach((s) => {
      const chip = document.createElement("div");
      chip.className = "event-chip";
      chip.style.background = getCategory(s.categoryId).color;

      const dot = document.createElement("span");
      dot.className = "priority-dot";
      dot.style.background = PRIORITY_COLORS[s.priority] || PRIORITY_COLORS.medium;
      chip.appendChild(dot);
      chip.appendChild(document.createTextNode(s.title));

      eventsEl.appendChild(chip);
    });
    if (dayEvents.length > 3) {
      const more = document.createElement("div");
      more.className = "event-more";
      more.textContent = `+${dayEvents.length - 3}`;
      eventsEl.appendChild(more);
    }
    cell.appendChild(eventsEl);

    cell.addEventListener("click", () => {
      state.selectedDate = dateStr;
      renderCalendar();
      showDayDetail(dateStr, dayEvents);
    });

    calendarGrid.appendChild(cell);
  });
}

function showDayDetail(dateStr, dayEvents) {
  const d = new Date(dateStr + "T00:00:00");
  dayDetailTitle.textContent = `${d.getMonth() + 1}월 ${d.getDate()}일 일정`;
  dayDetailList.innerHTML = "";

  if (dayEvents.length === 0) {
    const li = document.createElement("li");
    li.className = "empty-msg";
    li.textContent = "등록된 일정이 없습니다";
    dayDetailList.appendChild(li);
  } else {
    dayEvents.forEach((s) => dayDetailList.appendChild(buildScheduleCard(s)));
  }

  dayDetailPanel.classList.remove("hidden");
}

closeDayDetailBtn.addEventListener("click", () => {
  dayDetailPanel.classList.add("hidden");
  state.selectedDate = null;
  renderCalendar();
});

// ===== 리스트 뷰 렌더링 =====
function renderList() {
  const year = state.currentMonth.getFullYear();
  const month = state.currentMonth.getMonth();
  const occByDate = getMonthOccurrences(year, month);

  const items = [];
  Object.keys(occByDate).forEach((date) => {
    occByDate[date].forEach((s) => items.push({ ...s, date }));
  });
  items.sort((a, b) => (a.date + (a.startTime || "")).localeCompare(b.date + (b.startTime || "")));

  scheduleList.innerHTML = "";
  listEmptyMsg.classList.toggle("hidden", items.length > 0);

  items.forEach((s) => scheduleList.appendChild(buildScheduleCard(s)));
}

function buildScheduleCard(s) {
  const card = document.createElement("li");
  card.className = "schedule-card";
  const cat = getCategory(s.categoryId);
  card.style.borderLeftColor = cat.color;

  const isPast = s.date < today.toISOString().slice(0, 10);
  if (isPast) card.classList.add("is-past");

  const main = document.createElement("div");
  main.className = "schedule-card-main";

  const titleEl = document.createElement("div");
  titleEl.className = "schedule-card-title";
  titleEl.textContent = s.title;
  main.appendChild(titleEl);

  const metaEl = document.createElement("div");
  metaEl.className = "schedule-card-meta";
  const timeText = s.allDay ? "종일" : [s.startTime, s.endTime].filter(Boolean).join(" ~ ");
  const priority = s.priority || "medium";
  const priorityColor = PRIORITY_COLORS[priority];
  metaEl.innerHTML = `
    <span>${s.date}${timeText ? " · " + timeText : ""}</span>
    <span class="badge" style="color:${cat.color}">${cat.name}</span>
    <span class="badge priority-badge" style="background:${priorityColor}22;color:${priorityColor};border-color:${priorityColor}">${PRIORITY_LABELS[priority]}</span>
    ${s.repeat !== "none" ? '<span class="badge">🔁 반복</span>' : ""}
    ${s.alarm !== "none" ? '<span class="badge">🔔 알림</span>' : ""}
  `;
  main.appendChild(metaEl);

  card.appendChild(main);
  card.addEventListener("click", () => openModal(s));
  return card;
}

// ===== 전체 다시 그리기 =====
function renderAll() {
  renderCategoryFilterOptions();
  renderCalendar();
  updateViewVisibility();
  if (state.selectedDate) {
    const year = state.currentMonth.getFullYear();
    const month = state.currentMonth.getMonth();
    const occByDate = getMonthOccurrences(year, month);
    showDayDetail(state.selectedDate, occByDate[state.selectedDate] || []);
  }
}

// ===== 초기 뷰 탭 상태 반영 =====
tabBtns.forEach((btn) => {
  btn.classList.toggle("active", btn.dataset.view === state.currentView);
});

// ===== 모달: 일정 추가/수정 =====
function openModal(schedule) {
  scheduleForm.reset();
  newCategoryFields.classList.add("hidden");
  categoryOptionsList.classList.add("hidden");

  if (schedule) {
    modalTitle.textContent = "일정 수정";
    scheduleIdInput.value = schedule.id;
    titleInput.value = schedule.title;
    dateInput.value = schedule.date;
    allDayInput.checked = schedule.allDay;
    startTimeInput.value = schedule.startTime || "";
    endTimeInput.value = schedule.endTime || "";
    selectCategory(getCategory(schedule.categoryId));
    setPrioritySelection(schedule.priority || "medium");
    memoInput.value = schedule.memo || "";
    repeatInput.value = schedule.repeat;
    repeatEndInput.value = schedule.repeatEndDate || "";
    alarmInput.value = schedule.alarm;
    setCustomDaysSelection(schedule.customDays || []);
    deleteScheduleBtn.classList.remove("hidden");
  } else {
    modalTitle.textContent = "일정 추가";
    scheduleIdInput.value = "";
    dateInput.value = state.selectedDate || today.toISOString().slice(0, 10);
    selectCategory(categories[0]);
    setPrioritySelection("medium");
    setCustomDaysSelection([]);
    deleteScheduleBtn.classList.add("hidden");
  }

  toggleTimeFields();
  toggleRepeatEndField();
  toggleCustomDaysField();
  scheduleModal.classList.remove("hidden");
}

function closeModal() {
  scheduleModal.classList.add("hidden");
}

addScheduleBtn.addEventListener("click", () => openModal(null));
cancelModalBtn.addEventListener("click", closeModal);
closeModalBtn.addEventListener("click", closeModal);
scheduleModal.addEventListener("click", (e) => {
  if (e.target === scheduleModal) closeModal();
});

// ===== 카테고리 검색형 콤보박스 =====
function selectCategory(cat) {
  categoryInput.value = cat.id;
  categorySearchInput.value = cat.name;
  categoryOptionsList.classList.add("hidden");
}

function renderCategoryOptionsList(filterText) {
  const keyword = (filterText || "").trim().toLowerCase();
  const matched = categories.filter((c) => c.name.toLowerCase().includes(keyword));

  categoryOptionsList.innerHTML = "";
  if (matched.length === 0) {
    const li = document.createElement("li");
    li.className = "no-result";
    li.textContent = "일치하는 카테고리가 없습니다";
    categoryOptionsList.appendChild(li);
    return;
  }

  matched.forEach((c) => {
    const li = document.createElement("li");
    const swatch = document.createElement("span");
    swatch.className = "swatch";
    swatch.style.background = c.color;
    li.appendChild(swatch);
    li.appendChild(document.createTextNode(c.name));
    li.addEventListener("click", () => selectCategory(c));
    categoryOptionsList.appendChild(li);
  });
}

categorySearchInput.addEventListener("input", () => {
  categoryInput.value = "";
  renderCategoryOptionsList(categorySearchInput.value);
  categoryOptionsList.classList.remove("hidden");
});

categorySearchInput.addEventListener("focus", () => {
  renderCategoryOptionsList(categorySearchInput.value);
  categoryOptionsList.classList.remove("hidden");
});

document.addEventListener("click", (e) => {
  if (!el("categoryCombobox").contains(e.target)) {
    categoryOptionsList.classList.add("hidden");
  }
});

// ===== 우선순위 선택 =====
priorityBtns.forEach((btn) => {
  btn.addEventListener("click", () => setPrioritySelection(btn.dataset.priority));
});

function setPrioritySelection(priority) {
  priorityInput.value = priority;
  priorityBtns.forEach((b) => b.classList.toggle("selected", b.dataset.priority === priority));
}

allDayInput.addEventListener("change", toggleTimeFields);
function toggleTimeFields() {
  timeFields.classList.toggle("hidden", allDayInput.checked);
}

repeatInput.addEventListener("change", () => {
  toggleRepeatEndField();
  toggleCustomDaysField();
});

function toggleRepeatEndField() {
  repeatEndField.classList.toggle("hidden", repeatInput.value === "none");
}

function toggleCustomDaysField() {
  customDaysField.classList.toggle("hidden", repeatInput.value !== "custom");
}

let selectedCustomDays = [];
weekdayBtns.forEach((btn) => {
  btn.addEventListener("click", () => {
    const day = Number(btn.dataset.day);
    btn.classList.toggle("selected");
    selectedCustomDays = btn.classList.contains("selected")
      ? [...selectedCustomDays, day]
      : selectedCustomDays.filter((d) => d !== day);
  });
});

function setCustomDaysSelection(days) {
  selectedCustomDays = [...days];
  weekdayBtns.forEach((btn) => {
    btn.classList.toggle("selected", selectedCustomDays.includes(Number(btn.dataset.day)));
  });
}

newCategoryBtn.addEventListener("click", () => {
  newCategoryFields.classList.toggle("hidden");
});

// ===== 일정 저장 =====
scheduleForm.addEventListener("submit", (e) => {
  e.preventDefault();

  let categoryId = categoryInput.value;
  if (!newCategoryFields.classList.contains("hidden") && newCategoryName.value.trim()) {
    const newCat = {
      id: "cat_" + Date.now(),
      name: newCategoryName.value.trim(),
      color: newCategoryColor.value
    };
    categories.push(newCat);
    categoryId = newCat.id;
  }
  if (!categoryId) categoryId = categories[0].id; // 검색만 하고 선택하지 않은 경우 대비

  const data = {
    title: titleInput.value.trim(),
    date: dateInput.value,
    allDay: allDayInput.checked,
    startTime: allDayInput.checked ? "" : startTimeInput.value,
    endTime: allDayInput.checked ? "" : endTimeInput.value,
    categoryId,
    priority: priorityInput.value || "medium",
    memo: memoInput.value.trim(),
    repeat: repeatInput.value,
    repeatEndDate: repeatInput.value === "none" ? "" : repeatEndInput.value,
    customDays: repeatInput.value === "custom" ? [...selectedCustomDays] : [],
    alarm: alarmInput.value
  };

  const id = scheduleIdInput.value;
  if (id) {
    const idx = schedules.findIndex((s) => s.id === id);
    if (idx !== -1) schedules[idx] = { ...schedules[idx], ...data };
  } else {
    schedules.push({ id: "s_" + Date.now(), ...data });
  }

  closeModal();
  renderAll();
  showStatus("일정이 저장되었습니다");
});

deleteScheduleBtn.addEventListener("click", () => {
  const id = scheduleIdInput.value;
  schedules = schedules.filter((s) => s.id !== id);
  closeModal();
  renderAll();
  showStatus("일정이 삭제되었습니다");
});

// ===== 시작 (미리보기는 로그인 화면부터 시작) =====
updateViewVisibility();
