// ===== 앱 본 화면 스크립트 (Firebase Authentication + Firestore 연동) =====

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();
db.enablePersistence().catch(() => {}); // 오프라인 캐시. 같은 브라우저에 탭이 여러 개 열려 있으면 실패할 수 있어 조용히 무시

let currentUser = null;

auth.onAuthStateChanged((user) => {
  if (!user) {
    window.location.href = "index.html";
    return;
  }
  currentUser = user;
  initApp();
});

function initApp() {

const schedulesRef = db.collection("users").doc(currentUser.uid).collection("schedules");
const categoriesRef = db.collection("users").doc(currentUser.uid).collection("categories");
const userProfileRef = db.collection("users").doc(currentUser.uid);

let categories = [];
let schedules = [];
let userProfile = {};

// ===== 우선순위 레벨 (고정 3단계, 레벨별 색상) =====
const PRIORITY_COLORS = { low: "#51cf66", medium: "#f5c518", high: "#ff6b6b" };
const PRIORITY_LABELS = { low: "낮음", medium: "보통", high: "높음" };

// ===== 날짜 <-> YYYY-MM-DD 문자열 변환 =====
// toISOString()은 UTC 기준이라 한국(UTC+9)처럼 UTC보다 빠른 시간대에서는
// 로컬 자정 날짜가 하루 전날로 밀려서 나옴 (예: 8/20 00:00 KST → "2026-08-19"Z).
// 반드시 로컬 연/월/일 기준으로 직접 문자열을 만들어야 함.
function toDateStr(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

const today = new Date();

// ===== 일정 CRUD (Firestore 연동, 그룹/AI 기능 확장 대비) =====
// 나중에 자연어 파싱("다음주 화요일 3시에 미팅" 등)이나 그룹 일정 동기화 로직이 들어와도
// 폼 제출/JSON 가져오기와 동일하게 이 함수들만 호출하면 되도록 일정 생성/수정/삭제를 한 곳으로 모음.
function addSchedule(data) {
  const { id, ...rest } = data; // Firestore가 문서 id를 자동 부여하므로, 넘어온 id(예: JSON 가져오기)는 무시
  return schedulesRef.add({
    doneDates: [],
    groupId: null, // 그룹 공유 일정이면 그룹 id, 개인 일정이면 null (그룹 기능 자리만 미리 확보)
    ...rest,
    ownerId: currentUser.uid,
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  }).catch(() => showStatus("일정 저장에 실패했습니다. 네트워크를 확인해주세요"));
}

function updateSchedule(id, changes) {
  return schedulesRef.doc(id).update(changes)
    .catch(() => showStatus("일정 저장에 실패했습니다. 네트워크를 확인해주세요"));
}

function deleteSchedule(id) {
  return schedulesRef.doc(id).delete()
    .catch(() => showStatus("일정 삭제에 실패했습니다. 네트워크를 확인해주세요"));
}

function addCategory(data) {
  return categoriesRef.add(data)
    .catch(() => { showStatus("카테고리 저장에 실패했습니다"); throw new Error("category-add-failed"); });
}

function deleteCategory(id) {
  return categoriesRef.doc(id).delete()
    .then(() => showStatus("카테고리가 삭제되었습니다"))
    .catch(() => showStatus("카테고리 삭제에 실패했습니다"));
}

// ===== Firestore 실시간 구독 =====
let schedulesReady = false;
schedulesRef.onSnapshot((snapshot) => {
  schedules = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  schedulesReady = true;
  // 모달이 열려 있는 동안 다른 곳에서(다른 탭 등) 같은 일정이 바뀌어도 모달 내용이 최신 상태를 반영하도록 동기화
  if (currentEditingSchedule && !scheduleModal.classList.contains("hidden")) {
    const fresh = schedules.find((s) => s.id === currentEditingSchedule.id);
    if (fresh) {
      currentEditingSchedule = fresh;
      doneInput.checked = isOccurrenceDone(currentEditingSchedule, currentOccurrenceDate);
      updateMarkAllDoneButton();
    }
  }
  renderAll();
  renderUserGreeting();
}, () => showStatus("일정을 불러오지 못했습니다. 네트워크를 확인해주세요"));

let defaultCategoriesSeeded = false;
categoriesRef.onSnapshot((snapshot) => {
  categories = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  if (categories.length === 0 && !defaultCategoriesSeeded) {
    defaultCategoriesSeeded = true; // 초기 스냅샷이 캐시/서버 두 번 도착해도 기본 카테고리가 중복 생성되지 않도록 함
    seedDefaultCategories();
  }
  renderAll();
}, () => showStatus("카테고리를 불러오지 못했습니다. 네트워크를 확인해주세요"));

// ===== 사용자 프로필 (닉네임 등 설정 페이지에서 관리하는 값) =====
let profileReady = false;
userProfileRef.onSnapshot((doc) => {
  userProfile = doc.data() || {};
  profileReady = true;
  renderUserGreeting();
});

function getDisplayName() {
  return userProfile.nickname || currentUser.displayName || currentUser.email;
}

let cachedGreetingTemplate = null;

function renderUserGreeting() {
  appTitle.textContent = `${getDisplayName()}의 일정`;

  // 일정 데이터와 프로필이 둘 다 최소 한 번은 로딩된 뒤에만 인사말 문구를 무작위로 고르고 캐시함.
  // (스케줄이 아직 안 실렸을 때 "오늘 일정 없음" 문구로 잘못 굳어버리는 걸 방지)
  // 이후로는 세션 동안 같은 문구를 유지하고 이름만("{name}" 치환) 최신화함 — 체크박스 클릭 같은
  // 사소한 변경마다 인사말이 계속 바뀌면 산만하기 때문
  if (!cachedGreetingTemplate && schedulesReady && profileReady) {
    cachedGreetingTemplate = pickGreetingTemplate();
  }
  userGreeting.textContent = (cachedGreetingTemplate || "{name}님, 안녕하세요").replace("{name}", getDisplayName());
}

// ===== 일정 상황을 반영한 인사말 (규칙 기반 — 실제 LLM 호출 없이 조건별로 다양한 문구 중 무작위 선택) =====
function getTodaySchedules() {
  const todayStr = toDateStr(today);
  const rangeStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return schedules.filter((s) => expandRecurring(s, rangeStart, rangeStart).includes(todayStr));
}

function pickGreetingTemplate() {
  const hour = today.getHours();
  const timeGreeting = hour < 12 ? "좋은 아침이에요" : hour < 18 ? "좋은 오후예요" : hour < 22 ? "좋은 저녁이에요" : "늦은 시간이네요";

  const todayStr = toDateStr(today);
  const undone = getTodaySchedules().filter((s) => !isOccurrenceDone(s, todayStr));
  const hasUrgent = undone.some((s) => s.priority === "high");
  const count = undone.length;

  let pool;
  if (count === 0) {
    pool = [
      `{name}님, ${timeGreeting}! 오늘은 예정된 일정이 없어요. 여유롭게 보내세요 ☕`,
      `{name}님, 오늘 일정이 텅 비어있네요. 푹 쉬어가는 것도 좋아요`,
      `{name}님, 오늘 하루는 자유롭게 쓰실 수 있어요!`
    ];
  } else if (hasUrgent) {
    pool = [
      `{name}님, 오늘 중요한 일정이 있어요. 화이팅이에요 💪`,
      `{name}님, 오늘 우선순위 높은 일정부터 챙겨보세요`,
      `{name}님, 오늘은 중요한 하루예요. 차근차근 해내실 거예요`
    ];
  } else if (count >= 4) {
    pool = [
      `{name}님, 오늘 남은 일정이 ${count}개예요. 무리하지 마세요!`,
      `{name}님, 오늘은 꽤 바쁜 하루네요. 하나씩 차근차근이요`,
      `{name}님, 일정이 많은 날이에요. 틈틈이 숨 돌리는 것도 잊지 마세요`
    ];
  } else {
    pool = [
      `{name}님, ${timeGreeting}! 오늘 남은 일정 ${count}개 확인해보세요`,
      `{name}님, 오늘도 좋은 하루 되세요`,
      `{name}님, 오늘 일정 잘 챙기시길 바라요`
    ];
  }

  return pool[Math.floor(Math.random() * pool.length)];
}

function seedDefaultCategories() {
  const defaults = [
    { name: "업무", color: "#4dabf7" },
    { name: "개인", color: "#51cf66" },
    { name: "약속", color: "#ff922b" },
    { name: "기타", color: "#adb5bd" }
  ];
  const batch = db.batch();
  defaults.forEach((cat) => batch.set(categoriesRef.doc(), cat));
  batch.commit().catch(() => showStatus("기본 카테고리 생성에 실패했습니다"));
}

// ===== 상태 =====
const state = {
  currentView: localStorage.getItem("currentView") || "calendar",
  currentMonth: new Date(today.getFullYear(), today.getMonth(), 1),
  selectedDate: null,
  categoryFilter: "all",
  searchQuery: ""
};

// ===== 엘리먼트 참조 =====
const el = (id) => document.getElementById(id);

const logoutBtn = el("logoutBtn");
const settingsBtn = el("settingsBtn");
const userGreeting = el("userGreeting");
const appTitle = el("appTitle");
const exportBtn = el("exportBtn");
const importBtn = el("importBtn");
const importFileInput = el("importFileInput");
const searchInput = el("searchInput");
const searchClearBtn = el("searchClearBtn");
const dataManageBtn = el("dataManageBtn");
const dataModal = el("dataModal");
const closeDataModalBtn = el("closeDataModalBtn");

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
const hoverPreview = el("hoverPreview");

const scheduleModal = el("scheduleModal");
const modalTitle = el("modalTitle");
const scheduleForm = el("scheduleForm");
const scheduleIdInput = el("scheduleId");
const titleInput = el("titleInput");
const datePickerWrap = el("datePickerWrap");
const dateInput = el("dateInput");
const miniCalendar = el("miniCalendar");
const miniCalLabel = el("miniCalLabel");
const miniCalPrevBtn = el("miniCalPrevBtn");
const miniCalNextBtn = el("miniCalNextBtn");
const miniCalendarGrid = el("miniCalendarGrid");
const allDayInput = el("allDayInput");
const timeFields = el("timeFields");
const startTimeInput = el("startTimeInput");
const endTimeInput = el("endTimeInput");
const categoryInput = el("categoryInput");
const newCategoryBtn = el("newCategoryBtn");
const deleteCategoryBtn = el("deleteCategoryBtn");
const newCategoryFields = el("newCategoryFields");
const newCategoryName = el("newCategoryName");
const newCategoryColor = el("newCategoryColor");
const saveNewCategoryBtn = el("saveNewCategoryBtn");
const priorityBtns = document.querySelectorAll(".priority-btn");
const priorityInput = el("priorityInput");
const memoInput = el("memoInput");
const repeatInput = el("repeatInput");
const customDaysField = el("customDaysField");
const weekdayBtns = document.querySelectorAll(".weekday-btn");
const repeatEndField = el("repeatEndField");
const repeatEndBtns = document.querySelectorAll(".repeat-end-btn");
const repeatEndInput = el("repeatEndInput");
const alarmInput = el("alarmInput");
const doneInput = el("doneInput");
const markAllDoneBtn = el("markAllDoneBtn");
const scheduleFieldset = el("scheduleFieldset");
const viewModeActions = el("viewModeActions");
const editModeActions = el("editModeActions");
const editScheduleBtn = el("editScheduleBtn");
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

// ===== 일정 호버 미리보기 =====
let hoverHideTimer = null;
function showHoverPreview(e, s) {
  clearTimeout(hoverHideTimer);
  const cat = getCategory(s.categoryId);
  const priority = s.priority || "medium";
  const timeText = s.allDay ? "종일" : [s.startTime, s.endTime].filter(Boolean).join(" ~ ");

  hoverPreview.innerHTML = `
    <div class="hover-preview-title">${s.title}</div>
    <div class="hover-preview-row"><span>${s.date}${timeText ? " · " + timeText : ""}</span></div>
    <div class="hover-preview-row">
      <span class="hover-preview-dot" style="background:${cat.color}"></span>
      <span>${cat.name}</span>
      <span class="hover-preview-dot" style="background:${PRIORITY_COLORS[priority]}"></span>
      <span>${PRIORITY_LABELS[priority]}</span>
    </div>
    ${s.memo ? `<div class="hover-preview-memo">${s.memo}</div>` : ""}
  `;
  hoverPreview.classList.remove("hidden");
  requestAnimationFrame(() => hoverPreview.classList.add("visible"));
  positionHoverPreview(e);
}

function positionHoverPreview(e) {
  const offset = 14;
  let x = e.clientX + offset;
  let y = e.clientY + offset;
  const rect = hoverPreview.getBoundingClientRect();
  if (x + rect.width > window.innerWidth - 8) x = e.clientX - rect.width - offset;
  if (y + rect.height > window.innerHeight - 8) y = e.clientY - rect.height - offset;
  hoverPreview.style.left = `${x}px`;
  hoverPreview.style.top = `${y}px`;
}

function hideHoverPreview() {
  hoverPreview.classList.remove("visible");
  hoverHideTimer = setTimeout(() => hoverPreview.classList.add("hidden"), 120);
}

// ===== 로그아웃 =====
logoutBtn.addEventListener("click", () => {
  auth.signOut().then(() => {
    window.location.href = "index.html";
  });
});

// ===== 설정 페이지 이동 =====
settingsBtn.addEventListener("click", () => {
  window.location.href = "settings.html";
});

// ===== 일정 데이터 관리 모달 (내보내기/가져오기) =====
dataManageBtn.addEventListener("click", () => {
  dataModal.classList.remove("hidden");
  requestAnimationFrame(() => dataModal.classList.add("modal-open"));
});

function closeDataModal() {
  dataModal.classList.remove("modal-open");
  setTimeout(() => dataModal.classList.add("hidden"), 180);
}

closeDataModalBtn.addEventListener("click", closeDataModal);
dataModal.addEventListener("click", (e) => {
  if (e.target === dataModal) closeDataModal();
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
  if (state.searchQuery.trim()) {
    calendarView.classList.add("hidden");
    listView.classList.remove("hidden");
    renderList();
    return;
  }
  const isCalendar = state.currentView === "calendar";
  calendarView.classList.toggle("hidden", !isCalendar);
  listView.classList.toggle("hidden", isCalendar);
  if (!isCalendar) renderList();
}

// ===== 일정 검색 =====
function getMatchingSchedules(query) {
  const q = query.trim().toLowerCase();
  return schedules.filter((s) => {
    if (state.categoryFilter !== "all" && s.categoryId !== state.categoryFilter) return false;
    const cat = getCategory(s.categoryId);
    return s.title.toLowerCase().includes(q)
      || (s.memo || "").toLowerCase().includes(q)
      || cat.name.toLowerCase().includes(q);
  });
}

searchInput.addEventListener("input", () => {
  state.searchQuery = searchInput.value;
  searchClearBtn.classList.toggle("hidden", !state.searchQuery.trim());
  renderAll();
});

searchClearBtn.addEventListener("click", () => {
  searchInput.value = "";
  state.searchQuery = "";
  searchClearBtn.classList.add("hidden");
  renderAll();
});

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
  return categories.find((c) => c.id === id)
    || categories[categories.length - 1]
    || { id: "unknown", name: "미분류", color: "#adb5bd" }; // 카테고리가 아직 로딩되기 전 대비
}

// ===== 대한민국 공휴일 (Nager.Date API, 연도 단위로 캐싱) =====
const HOLIDAY_API_BASE = "https://date.nager.at/api/v3/PublicHolidays";
let holidayCache = {}; // { [year]: { 'YYYY-MM-DD': localName } }

// 양력 고정 공휴일의 원래 날짜(MM-DD). Nager.Date는 대체공휴일의 실제 날짜는 정확히 계산해 주지만
// 이름에 "대체공휴일" 표시는 안 붙여주므로, 원래 날짜와 다르면 여기서 보정해줌.
const FIXED_HOLIDAY_MMDD = {
  "새해": "01-01",
  "3·1절": "03-01",
  "어린이날": "05-05",
  "현충일": "06-06",
  "제헌절": "07-17",
  "광복절": "08-15",
  "개천절": "10-03",
  "한글날": "10-09",
  "크리스마스": "12-25"
};

async function fetchHolidays(year) {
  if (holidayCache[year]) return;
  try {
    const res = await fetch(`${HOLIDAY_API_BASE}/${year}/KR`);
    if (!res.ok) throw new Error("공휴일 조회 실패");
    const list = await res.json();
    const map = {};
    list.forEach((h) => {
      const mmdd = h.date.slice(5);
      const originalMmdd = FIXED_HOLIDAY_MMDD[h.localName];
      const isSubstitute = originalMmdd && originalMmdd !== mmdd;
      map[h.date] = isSubstitute ? `대체공휴일(${h.localName})` : h.localName;
    });
    holidayCache[year] = map;
  } catch (err) {
    holidayCache[year] = {}; // 실패해도 캐싱해서 매 렌더링마다 재요청하지 않도록 함
    showStatus("공휴일 정보를 불러오지 못했습니다");
  }
  if (!calendarView.classList.contains("hidden")) renderCalendar();
  if (!miniCalendar.classList.contains("hidden")) renderMiniCalendar();
}

function getHolidayName(dateStr) {
  const year = dateStr.slice(0, 4);
  return holidayCache[year] ? holidayCache[year][dateStr] : undefined;
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
      occurrences.push(toDateStr(cursor));
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
  const todayStr = toDateStr(today);

  const yearsInView = new Set(cells.map(({ cellDate }) => cellDate.getFullYear()));
  yearsInView.forEach((y) => fetchHolidays(y));

  cells.forEach(({ cellDate, otherMonth }) => {
    const dateStr = toDateStr(cellDate);
    const dayEvents = occByDate[dateStr] || [];
    const dayOfWeek = cellDate.getDay();
    const holidayName = getHolidayName(dateStr);

    const cell = document.createElement("div");
    cell.className = "calendar-cell";
    if (otherMonth) cell.classList.add("other-month");
    if (dateStr === todayStr) cell.classList.add("is-today");
    if (state.selectedDate === dateStr) cell.classList.add("is-selected");

    if (holidayName) cell.classList.add("is-holiday");
    else if (dayOfWeek === 0) cell.classList.add("is-sunday");
    else if (dayOfWeek === 6) cell.classList.add("is-saturday");

    const dateEl = document.createElement("div");
    dateEl.className = "cell-date";
    dateEl.textContent = cellDate.getDate();
    cell.appendChild(dateEl);

    if (holidayName) {
      const holidayLabel = document.createElement("div");
      holidayLabel.className = "holiday-label";
      holidayLabel.textContent = holidayName;
      holidayLabel.title = holidayName;
      cell.appendChild(holidayLabel);
    }

    const eventsEl = document.createElement("div");
    eventsEl.className = "cell-events";
    dayEvents.slice(0, 3).forEach((s) => {
      const chip = document.createElement("div");
      chip.className = "event-chip";
      if (isOccurrenceDone(s, dateStr)) chip.classList.add("is-done");
      chip.style.background = getCategory(s.categoryId).color;

      const dot = document.createElement("span");
      dot.className = "priority-dot";
      dot.style.background = PRIORITY_COLORS[s.priority] || PRIORITY_COLORS.medium;
      chip.appendChild(dot);
      chip.appendChild(document.createTextNode(s.title));

      chip.addEventListener("click", (e) => {
        e.stopPropagation();
        openModal(s, dateStr);
      });
      chip.addEventListener("mouseenter", (e) => showHoverPreview(e, s));
      chip.addEventListener("mousemove", positionHoverPreview);
      chip.addEventListener("mouseleave", hideHoverPreview);

      // 반복 없는 일정만 드래그로 날짜 이동 가능 (반복 일정은 데이터 모델상 특정 회차만 옮기는 게 불가능해서 제외)
      if (s.repeat === "none") {
        chip.classList.add("is-draggable");
        chip.draggable = true;
        chip.addEventListener("dragstart", (e) => {
          e.stopPropagation();
          e.dataTransfer.setData("text/plain", s.id);
          e.dataTransfer.effectAllowed = "move";
          chip.classList.add("dragging");
          hideHoverPreview();
        });
        chip.addEventListener("dragend", () => {
          chip.classList.remove("dragging");
        });
      }

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

    cell.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      cell.classList.add("drag-over");
    });
    cell.addEventListener("dragleave", () => {
      cell.classList.remove("drag-over");
    });
    cell.addEventListener("drop", (e) => {
      e.preventDefault();
      cell.classList.remove("drag-over");
      const draggedId = e.dataTransfer.getData("text/plain");
      moveScheduleToDate(draggedId, dateStr);
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
    dayEvents.forEach((s) => dayDetailList.appendChild(buildScheduleCard({ ...s, date: dateStr })));
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
  const query = state.searchQuery.trim();
  let items;

  if (query) {
    items = getMatchingSchedules(query).map((s) => ({ ...s }));
    items.sort((a, b) => (a.date + (a.startTime || "")).localeCompare(b.date + (b.startTime || "")));
  } else {
    const year = state.currentMonth.getFullYear();
    const month = state.currentMonth.getMonth();
    const occByDate = getMonthOccurrences(year, month);

    items = [];
    Object.keys(occByDate).forEach((date) => {
      occByDate[date].forEach((s) => items.push({ ...s, date }));
    });
    items.sort((a, b) => (a.date + (a.startTime || "")).localeCompare(b.date + (b.startTime || "")));
  }

  scheduleList.innerHTML = "";
  listEmptyMsg.textContent = query ? "검색 결과가 없습니다" : "이 달에 등록된 일정이 없습니다";
  listEmptyMsg.classList.toggle("hidden", items.length > 0);

  items.forEach((s) => scheduleList.appendChild(buildScheduleCard(s)));
}

// ===== 완료 여부 (회차 단위로 관리) =====
// 반복 없는 일정은 doneDates에 자기 날짜 하나만 들어있거나 비어있음.
// 반복 일정은 회차(occurrence)별 날짜를 doneDates에 개별 기록 — 한 회차 완료가 전체에 영향 주지 않음.
function isOccurrenceDone(schedule, date) {
  return (schedule.doneDates || []).includes(date);
}

function toggleOccurrenceDone(scheduleId, date) {
  const schedule = schedules.find((s) => s.id === scheduleId);
  if (!schedule) return;
  const set = new Set(schedule.doneDates || []);
  const nowDone = !set.has(date);
  if (nowDone) set.add(date); else set.delete(date);
  updateSchedule(scheduleId, { doneDates: [...set] });
  showStatus(nowDone ? "완료로 표시했습니다" : "완료 표시를 해제했습니다");
}

// ===== 드래그 앤 드롭으로 날짜 이동 (반복 없는 일정만) =====
function moveScheduleToDate(scheduleId, newDate) {
  const schedule = schedules.find((s) => s.id === scheduleId);
  if (!schedule || schedule.repeat !== "none") return;
  if (schedule.date === newDate) return;
  const wasDone = isOccurrenceDone(schedule, schedule.date);
  updateSchedule(scheduleId, { date: newDate, doneDates: wasDone ? [newDate] : [] });
  showStatus("일정을 이동했습니다");
}

// "전체 완료"의 적용 범위: 반복 종료일이 있으면 그때까지, 없으면(무한) 시작일로부터 1년치까지만 실질 적용
function getAllOccurrenceDates(schedule) {
  const rangeStart = new Date(schedule.date + "T00:00:00");
  const boundEnd = schedule.repeatEndDate
    ? new Date(schedule.repeatEndDate + "T00:00:00")
    : new Date(rangeStart.getFullYear() + 1, rangeStart.getMonth(), rangeStart.getDate());
  return expandRecurring(schedule, rangeStart, boundEnd);
}

function areAllOccurrencesDone(schedule) {
  const dates = getAllOccurrenceDates(schedule);
  return dates.length > 0 && dates.every((d) => isOccurrenceDone(schedule, d));
}

function toggleAllOccurrencesDone(scheduleId) {
  const schedule = schedules.find((s) => s.id === scheduleId);
  if (!schedule) return;
  const allDone = areAllOccurrencesDone(schedule);

  if (allDone) {
    if (!window.confirm("이 반복 일정의 완료 표시를 모두 해제하시겠습니까?")) return;
    updateSchedule(scheduleId, { doneDates: [] });
    showStatus("모든 회차의 완료 표시를 해제했습니다");
  } else {
    if (!window.confirm("이 반복 일정의 모든 회차를 완료로 표시하시겠습니까?\n(반복 종료일이 없으면 1년치까지만 적용됩니다)")) return;
    updateSchedule(scheduleId, { doneDates: getAllOccurrenceDates(schedule) });
    showStatus("모든 회차를 완료로 표시했습니다");
  }
}

function updateMarkAllDoneButton() {
  if (!currentEditingSchedule || currentEditingSchedule.repeat === "none") {
    markAllDoneBtn.classList.add("hidden");
    return;
  }
  markAllDoneBtn.classList.remove("hidden");
  markAllDoneBtn.textContent = areAllOccurrencesDone(currentEditingSchedule) ? "전체 완료 해제" : "전체 완료";
}

function buildScheduleCard(s) {
  const card = document.createElement("li");
  card.className = "schedule-card";
  const cat = getCategory(s.categoryId);
  card.style.borderLeftColor = cat.color;

  const isPast = s.date < toDateStr(today);
  if (isPast) card.classList.add("is-past");
  const occurrenceDone = isOccurrenceDone(s, s.date);
  if (occurrenceDone) card.classList.add("is-done");

  const doneCheckbox = document.createElement("input");
  doneCheckbox.type = "checkbox";
  doneCheckbox.className = "done-checkbox";
  doneCheckbox.checked = occurrenceDone;
  doneCheckbox.title = s.repeat !== "none" ? "이 회차만 완료 표시" : "완료 표시";
  doneCheckbox.addEventListener("click", (e) => e.stopPropagation());
  doneCheckbox.addEventListener("change", () => {
    const nextDone = doneCheckbox.checked;
    const confirmMsg = nextDone ? "이 일정을 완료로 표시하시겠습니까?" : "완료 표시를 해제하시겠습니까?";
    if (window.confirm(confirmMsg)) {
      toggleOccurrenceDone(s.id, s.date);
    } else {
      doneCheckbox.checked = !nextDone;
    }
  });
  card.appendChild(doneCheckbox);

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
  card.addEventListener("click", () => {
    const master = schedules.find((sch) => sch.id === s.id) || s;
    openModal(master, s.date);
  });
  card.addEventListener("mouseenter", (e) => showHoverPreview(e, s));
  card.addEventListener("mousemove", positionHoverPreview);
  card.addEventListener("mouseleave", hideHoverPreview);
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
let currentEditingSchedule = null;
let currentOccurrenceDate = null; // 모달에서 보고 있는 회차의 날짜 (완료 토글에 사용, 반복 마스터의 date와 다를 수 있음)

function setModalMode(mode) {
  const isView = mode === "view";
  scheduleFieldset.disabled = isView;
  viewModeActions.classList.toggle("hidden", !isView);
  editModeActions.classList.toggle("hidden", isView);
  if (currentEditingSchedule) {
    modalTitle.textContent = isView ? "일정 상세" : "일정 수정";
  }
}

function openModal(schedule, occurrenceDate) {
  scheduleForm.reset();
  newCategoryFields.classList.add("hidden");
  renderCategoryModalOptions();
  currentEditingSchedule = schedule || null;
  currentOccurrenceDate = schedule ? (occurrenceDate || schedule.date) : null;

  if (schedule) {
    modalTitle.textContent = "일정 상세";
    scheduleIdInput.value = schedule.id;
    titleInput.value = schedule.title;
    dateInput.value = schedule.date;
    allDayInput.checked = schedule.allDay;
    startTimeInput.value = schedule.startTime || "";
    endTimeInput.value = schedule.endTime || "";
    categoryInput.value = schedule.categoryId;
    setPrioritySelection(schedule.priority || "medium");
    memoInput.value = schedule.memo || "";
    repeatInput.value = schedule.repeat;
    setRepeatEndPreset(inferRepeatEndPreset(schedule), schedule.date, schedule.repeatEndDate);
    alarmInput.value = schedule.alarm;
    doneInput.checked = isOccurrenceDone(schedule, currentOccurrenceDate);
    setCustomDaysSelection(schedule.customDays || []);
    deleteScheduleBtn.classList.remove("hidden");
    setModalMode("view");
  } else {
    modalTitle.textContent = "일정 추가";
    scheduleIdInput.value = "";
    dateInput.value = state.selectedDate || toDateStr(today);
    if (categories[0]) categoryInput.value = categories[0].id;
    setPrioritySelection("medium");
    repeatInput.value = "none"; // 새 일정은 항상 반복 없음이 기본값
    setRepeatEndPreset("infinite", dateInput.value);
    doneInput.checked = false;
    setCustomDaysSelection([]);
    deleteScheduleBtn.classList.add("hidden");
    setModalMode("edit");
  }

  toggleTimeFields();
  toggleRepeatEndField();
  toggleCustomDaysField();
  updateMarkAllDoneButton();

  hideHoverPreview();
  scheduleModal.classList.remove("hidden");
  requestAnimationFrame(() => scheduleModal.classList.add("modal-open"));
}

function closeModal() {
  scheduleModal.classList.remove("modal-open");
  setTimeout(() => scheduleModal.classList.add("hidden"), 180);
  closeMiniCalendar();
}

// ===== 날짜 입력용 미니 달력 =====
let miniCalMonth = new Date();

function openMiniCalendar() {
  const base = dateInput.value ? new Date(dateInput.value + "T00:00:00") : new Date();
  miniCalMonth = new Date(base.getFullYear(), base.getMonth(), 1);
  renderMiniCalendar();
  miniCalendar.classList.remove("hidden");
}

function closeMiniCalendar() {
  miniCalendar.classList.add("hidden");
}

function renderMiniCalendar() {
  const year = miniCalMonth.getFullYear();
  const month = miniCalMonth.getMonth();
  miniCalLabel.textContent = `${year}년 ${month + 1}월`;
  fetchHolidays(year);

  const firstDay = new Date(year, month, 1);
  const startOffset = firstDay.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const daysInPrevMonth = new Date(year, month, 0).getDate();
  const totalCells = Math.ceil((startOffset + daysInMonth) / 7) * 7;

  const todayStr = toDateStr(today);
  const selectedStr = dateInput.value;

  miniCalendarGrid.innerHTML = "";
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
    const dateStr = toDateStr(cellDate);
    const dayOfWeek = cellDate.getDay();
    const holidayName = getHolidayName(dateStr);

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "mini-cal-day";
    btn.textContent = cellDate.getDate();
    if (otherMonth) btn.classList.add("other-month");
    if (dateStr === todayStr) btn.classList.add("is-today");
    if (dateStr === selectedStr) btn.classList.add("is-selected");
    if (holidayName) btn.classList.add("is-holiday");
    else if (dayOfWeek === 0) btn.classList.add("is-sunday");
    else if (dayOfWeek === 6) btn.classList.add("is-saturday");
    if (holidayName) btn.title = holidayName;

    btn.addEventListener("click", () => {
      dateInput.value = dateStr;
      dateInput.dispatchEvent(new Event("change"));
      closeMiniCalendar();
    });

    miniCalendarGrid.appendChild(btn);
  }
}

dateInput.addEventListener("click", () => {
  if (miniCalendar.classList.contains("hidden")) openMiniCalendar();
  else closeMiniCalendar();
});

miniCalPrevBtn.addEventListener("click", () => {
  miniCalMonth = new Date(miniCalMonth.getFullYear(), miniCalMonth.getMonth() - 1, 1);
  renderMiniCalendar();
});

miniCalNextBtn.addEventListener("click", () => {
  miniCalMonth = new Date(miniCalMonth.getFullYear(), miniCalMonth.getMonth() + 1, 1);
  renderMiniCalendar();
});

document.addEventListener("click", (e) => {
  if (!datePickerWrap.contains(e.target)) closeMiniCalendar();
});

addScheduleBtn.addEventListener("click", () => openModal(null));
editScheduleBtn.addEventListener("click", () => setModalMode("edit"));

// 완료 여부는 fieldset 밖에 있어서 보기 모드에서도 바로 토글 가능. 기존 일정이면 즉시 반영(확인 팝업, 이 회차만), 새 일정이면 저장 시점에만 반영.
doneInput.addEventListener("change", () => {
  if (!currentEditingSchedule) return;
  const nextDone = doneInput.checked;
  const confirmMsg = nextDone ? "이 일정을 완료로 표시하시겠습니까?" : "완료 표시를 해제하시겠습니까?";
  if (window.confirm(confirmMsg)) {
    toggleOccurrenceDone(currentEditingSchedule.id, currentOccurrenceDate);
  } else {
    doneInput.checked = !nextDone;
  }
});

markAllDoneBtn.addEventListener("click", () => {
  if (!currentEditingSchedule) return;
  toggleAllOccurrencesDone(currentEditingSchedule.id);
});

cancelModalBtn.addEventListener("click", () => {
  if (currentEditingSchedule) {
    openModal(currentEditingSchedule, currentOccurrenceDate); // 변경사항 취소하고 원래 값 + 보기 모드로 복원
  } else {
    closeModal();
  }
});
closeModalBtn.addEventListener("click", closeModal);
scheduleModal.addEventListener("click", (e) => {
  if (e.target === scheduleModal) closeModal();
});

// ===== 카테고리 선택(셀렉트박스) + 새 카테고리 즉시 저장 =====
function renderCategoryModalOptions() {
  const current = categoryInput.value;
  categoryInput.innerHTML = "";
  categories.forEach((c) => {
    const opt = document.createElement("option");
    opt.value = c.id;
    opt.textContent = c.name;
    categoryInput.appendChild(opt);
  });
  if (current && categories.some((c) => c.id === current)) categoryInput.value = current;
}

saveNewCategoryBtn.addEventListener("click", async () => {
  const name = newCategoryName.value.trim();
  if (!name) {
    showStatus("카테고리 이름을 입력해주세요");
    return;
  }

  const duplicate = categories.find((c) => c.name.toLowerCase() === name.toLowerCase());
  if (duplicate) {
    showStatus(`"${duplicate.name}" 카테고리가 이미 있습니다`);
    renderCategoryModalOptions();
    categoryInput.value = duplicate.id; // 중복 대신 기존 카테고리를 바로 선택해줌
    newCategoryFields.classList.add("hidden");
    newCategoryName.value = "";
    newCategoryColor.value = "#4dabf7";
    return;
  }

  try {
    const newCatRef = await addCategory({ name, color: newCategoryColor.value });
    renderCategoryModalOptions();
    categoryInput.value = newCatRef.id;
    newCategoryFields.classList.add("hidden");
    newCategoryName.value = "";
    newCategoryColor.value = "#4dabf7";
    showStatus("카테고리가 저장되었습니다");
  } catch (err) {
    // addCategory 내부에서 이미 실패 메시지를 표시함
  }
});

deleteCategoryBtn.addEventListener("click", () => {
  const catId = categoryInput.value;
  if (!catId) return;
  const cat = getCategory(catId);

  if (categories.length <= 1) {
    showStatus("카테고리가 최소 1개는 있어야 합니다");
    return;
  }

  const inUseCount = schedules.filter((s) => s.categoryId === catId).length;
  if (inUseCount > 0) {
    showStatus(`"${cat.name}" 카테고리를 사용 중인 일정이 ${inUseCount}개 있어 삭제할 수 없습니다`);
    return;
  }

  if (!window.confirm(`"${cat.name}" 카테고리를 삭제하시겠습니까?`)) return;

  deleteCategory(catId).then(() => {
    renderCategoryModalOptions(); // 목록이 갱신되면서 자동으로 남은 카테고리 중 첫 번째가 선택됨
  });
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
  if (repeatInput.value !== "none") setRepeatEndPreset("infinite", dateInput.value);
});

function toggleRepeatEndField() {
  repeatEndField.classList.toggle("hidden", repeatInput.value === "none");
}

function toggleCustomDaysField() {
  customDaysField.classList.toggle("hidden", repeatInput.value !== "custom");
}

// ===== 반복 종료 프리셋 (무한 / 1주일 / 한달 / 1년 / 직접 선택) =====
let repeatEndPreset = "infinite";

function computeRepeatEndDate(preset, startDateStr) {
  if (!startDateStr) return "";
  const d = new Date(startDateStr + "T00:00:00");
  if (preset === "1week") d.setDate(d.getDate() + 7);
  else if (preset === "1month") d.setMonth(d.getMonth() + 1);
  else if (preset === "1year") d.setFullYear(d.getFullYear() + 1);
  else return "";
  return toDateStr(d);
}

function setRepeatEndPreset(preset, startDateStr, customEndDate) {
  repeatEndPreset = preset;
  repeatEndBtns.forEach((b) => b.classList.toggle("selected", b.dataset.preset === preset));

  if (preset === "infinite") {
    repeatEndInput.value = "";
    repeatEndInput.classList.add("hidden");
    repeatEndInput.disabled = true;
  } else if (preset === "custom") {
    repeatEndInput.value = customEndDate || repeatEndInput.value || "";
    repeatEndInput.classList.remove("hidden");
    repeatEndInput.disabled = false;
  } else {
    repeatEndInput.value = computeRepeatEndDate(preset, startDateStr);
    repeatEndInput.classList.remove("hidden");
    repeatEndInput.disabled = true;
  }
}

function inferRepeatEndPreset(schedule) {
  if (!schedule.repeatEndDate) return "infinite";
  if (schedule.repeatEndDate === computeRepeatEndDate("1week", schedule.date)) return "1week";
  if (schedule.repeatEndDate === computeRepeatEndDate("1month", schedule.date)) return "1month";
  if (schedule.repeatEndDate === computeRepeatEndDate("1year", schedule.date)) return "1year";
  return "custom";
}

repeatEndBtns.forEach((btn) => {
  btn.addEventListener("click", () => setRepeatEndPreset(btn.dataset.preset, dateInput.value));
});

dateInput.addEventListener("change", () => {
  if (repeatEndPreset !== "infinite" && repeatEndPreset !== "custom") {
    setRepeatEndPreset(repeatEndPreset, dateInput.value);
  }
});

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
  if (!categoryId && categories[0]) categoryId = categories[0].id; // 방어적 대비 (평소엔 select에 항상 값이 있음)

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
  // doneDates는 여기 포함하지 않음: 완료 여부는 체크박스에서 회차 단위로 별도 반영되므로,
  // 저장 시 기존 일정의 doneDates를 통째로 덮어쓰지 않도록 함

  const id = scheduleIdInput.value;
  if (id) {
    updateSchedule(id, data);
  } else {
    addSchedule({ ...data, doneDates: doneInput.checked ? [dateInput.value] : [] });
  }

  closeModal();
  showStatus("일정이 저장되었습니다");
});

deleteScheduleBtn.addEventListener("click", () => {
  const id = scheduleIdInput.value;
  deleteSchedule(id);
  closeModal();
  showStatus("일정이 삭제되었습니다");
});

// ===== 일정 데이터 내보내기/가져오기 (JSON) =====
exportBtn.addEventListener("click", () => {
  const payload = { schedules, categories, exportedAt: new Date().toISOString() };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `일정백업_${toDateStr(today)}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showStatus("일정을 내보냈습니다");
});

importBtn.addEventListener("click", () => {
  importFileInput.click();
});

importFileInput.addEventListener("change", () => {
  const file = importFileInput.files[0];
  importFileInput.value = ""; // 같은 파일 다시 선택해도 change가 뜨도록 초기화
  if (!file) return;

  const reader = new FileReader();
  reader.onload = async () => {
    try {
      const data = JSON.parse(reader.result);
      if (!Array.isArray(data.schedules) || !Array.isArray(data.categories)) {
        throw new Error("형식이 올바르지 않습니다");
      }

      // 가져온 카테고리를 기존 카테고리와 이름 기준으로 병합 (이름 같으면 재사용, 다르면 새로 추가)
      const categoryIdMap = {};
      for (const cat of data.categories) {
        const existing = categories.find((c) => c.name === cat.name);
        if (existing) {
          categoryIdMap[cat.id] = existing.id;
        } else {
          const newCatRef = await addCategory({ name: cat.name, color: cat.color || "#adb5bd" });
          categoryIdMap[cat.id] = newCatRef.id;
        }
      }

      // 가져온 일정은 기존 일정에 추가로 병합 (addSchedule이 id를 항상 새로 발급해줌)
      data.schedules.forEach((s) => {
        addSchedule({
          ...s,
          categoryId: categoryIdMap[s.categoryId] || categories[0].id,
          doneDates: Array.isArray(s.doneDates) ? s.doneDates : []
        });
      });

      showStatus(`일정 ${data.schedules.length}개를 가져왔습니다`);
    } catch (err) {
      showStatus("파일을 가져오는 데 실패했습니다");
    }
  };
  reader.readAsText(file);
});

// ===== 시작 =====
renderAll();

const pendingMessage = sessionStorage.getItem("pendingStatusMessage");
if (pendingMessage) {
  sessionStorage.removeItem("pendingStatusMessage");
  showStatus(pendingMessage);
}

}
