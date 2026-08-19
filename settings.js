// ===== 설정 페이지 스크립트 =====

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

let currentUser = null;

auth.onAuthStateChanged((user) => {
  if (!user) {
    window.location.href = "index.html";
    return;
  }
  currentUser = user;
  initSettings();
});

function initSettings() {

const schedulesRef = db.collection("users").doc(currentUser.uid).collection("schedules");
const categoriesRef = db.collection("users").doc(currentUser.uid).collection("categories");
const userProfileRef = db.collection("users").doc(currentUser.uid);

let schedules = [];
let categories = [];

const el = (id) => document.getElementById(id);

const backBtn = el("backBtn");
const accountInfo = el("accountInfo");
const nicknameInput = el("nicknameInput");
const saveNicknameBtn = el("saveNicknameBtn");
const themeToggleBtn = el("themeToggleBtn");
const timezoneInput = el("timezoneInput");
const saveTimezoneBtn = el("saveTimezoneBtn");
const passwordSection = el("passwordSection");
const passwordForm = el("passwordForm");
const currentPasswordInput = el("currentPasswordInput");
const newPasswordInput = el("newPasswordInput");
const confirmPasswordInput = el("confirmPasswordInput");
const passwordError = el("passwordError");
const categoryManageList = el("categoryManageList");
const manageNewCategoryColor = el("manageNewCategoryColor");
const manageNewCategoryName = el("manageNewCategoryName");
const manageAddCategoryBtn = el("manageAddCategoryBtn");
const statusBar = el("statusBar");

// ===== 상태 메시지 =====
let statusTimer = null;
function showStatus(message) {
  statusBar.textContent = message;
  statusBar.classList.remove("hidden");
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => statusBar.classList.add("hidden"), 2200);
}

backBtn.addEventListener("click", () => {
  window.location.href = "app.html";
});

// ===== 계정 정보 =====
const isPasswordAccount = currentUser.providerData.some((p) => p.providerId === "password");
const loginMethodLabel = isPasswordAccount ? "이메일/비밀번호" : "구글 계정";
accountInfo.textContent = `${currentUser.email} · ${loginMethodLabel} 로그인`;
passwordSection.classList.toggle("hidden", !isPasswordAccount);

// ===== 사용자 프로필 (닉네임/타임존) =====
userProfileRef.onSnapshot((doc) => {
  const profile = doc.data() || {};
  nicknameInput.value = profile.nickname || "";
  timezoneInput.value = profile.timezone || "Asia/Seoul";
});

saveNicknameBtn.addEventListener("click", () => {
  const nickname = nicknameInput.value.trim();
  userProfileRef.set({ nickname }, { merge: true })
    .then(() => showStatus("닉네임이 저장되었습니다"))
    .catch(() => showStatus("닉네임 저장에 실패했습니다"));
});

saveTimezoneBtn.addEventListener("click", () => {
  userProfileRef.set({ timezone: timezoneInput.value }, { merge: true })
    .then(() => showStatus("타임존이 저장되었습니다"))
    .catch(() => showStatus("타임존 저장에 실패했습니다"));
});

// ===== 다크 모드 =====
function applyThemeButton() {
  const isDark = document.documentElement.getAttribute("data-theme") === "dark";
  themeToggleBtn.textContent = isDark ? "🌙 다크 모드 사용 중 (끄려면 클릭)" : "☀️ 라이트 모드 사용 중 (켜려면 클릭)";
}
applyThemeButton();

themeToggleBtn.addEventListener("click", () => {
  const isDark = document.documentElement.getAttribute("data-theme") === "dark";
  if (isDark) {
    document.documentElement.removeAttribute("data-theme");
    localStorage.setItem("theme", "light");
  } else {
    document.documentElement.setAttribute("data-theme", "dark");
    localStorage.setItem("theme", "dark");
  }
  applyThemeButton();
});

// ===== 비밀번호 변경 (이메일/비밀번호 계정만) =====
passwordForm.addEventListener("submit", (e) => {
  e.preventDefault();
  passwordError.classList.add("hidden");

  const currentPassword = currentPasswordInput.value;
  const newPassword = newPasswordInput.value;
  const confirmPassword = confirmPasswordInput.value;

  if (newPassword.length < 6) {
    passwordError.textContent = "새 비밀번호는 6자 이상이어야 합니다";
    passwordError.classList.remove("hidden");
    return;
  }
  if (newPassword !== confirmPassword) {
    passwordError.textContent = "새 비밀번호가 서로 일치하지 않습니다";
    passwordError.classList.remove("hidden");
    return;
  }

  const credential = firebase.auth.EmailAuthProvider.credential(currentUser.email, currentPassword);
  currentUser.reauthenticateWithCredential(credential)
    .then(() => currentUser.updatePassword(newPassword))
    .then(() => {
      passwordForm.reset();
      showStatus("비밀번호가 변경되었습니다");
    })
    .catch((err) => {
      const messages = {
        "auth/wrong-password": "현재 비밀번호가 올바르지 않습니다",
        "auth/invalid-credential": "현재 비밀번호가 올바르지 않습니다",
        "auth/weak-password": "새 비밀번호는 6자 이상이어야 합니다",
        "auth/too-many-requests": "잠시 후 다시 시도해주세요"
      };
      passwordError.textContent = messages[err.code] || "비밀번호 변경에 실패했습니다";
      passwordError.classList.remove("hidden");
    });
});

// ===== 카테고리 관리 =====
schedulesRef.onSnapshot((snapshot) => {
  schedules = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  renderCategoryManageList();
}, () => showStatus("일정을 불러오지 못했습니다. 네트워크를 확인해주세요"));

categoriesRef.onSnapshot((snapshot) => {
  categories = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  renderCategoryManageList();
}, () => showStatus("카테고리를 불러오지 못했습니다. 네트워크를 확인해주세요"));

function renderCategoryManageList() {
  categoryManageList.innerHTML = "";
  categories.forEach((cat) => {
    const li = document.createElement("li");
    li.className = "category-manage-row";

    const colorInput = document.createElement("input");
    colorInput.type = "color";
    colorInput.value = cat.color;
    colorInput.addEventListener("change", () => {
      categoriesRef.doc(cat.id).update({ color: colorInput.value })
        .then(() => showStatus("카테고리 색상이 변경되었습니다"))
        .catch(() => showStatus("색상 변경에 실패했습니다"));
    });

    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.value = cat.name;
    nameInput.addEventListener("change", () => {
      const newName = nameInput.value.trim();
      if (!newName) {
        nameInput.value = cat.name;
        return;
      }
      const duplicate = categories.find((c) => c.id !== cat.id && c.name.toLowerCase() === newName.toLowerCase());
      if (duplicate) {
        showStatus(`"${duplicate.name}" 카테고리가 이미 있습니다`);
        nameInput.value = cat.name;
        return;
      }
      categoriesRef.doc(cat.id).update({ name: newName })
        .then(() => showStatus("카테고리 이름이 변경되었습니다"))
        .catch(() => showStatus("이름 변경에 실패했습니다"));
    });

    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "icon-btn";
    deleteBtn.textContent = "🗑";
    deleteBtn.setAttribute("aria-label", `${cat.name} 삭제`);
    deleteBtn.addEventListener("click", () => {
      if (categories.length <= 1) {
        showStatus("카테고리가 최소 1개는 있어야 합니다");
        return;
      }
      const inUseCount = schedules.filter((s) => s.categoryId === cat.id).length;
      if (inUseCount > 0) {
        showStatus(`"${cat.name}" 카테고리를 사용 중인 일정이 ${inUseCount}개 있어 삭제할 수 없습니다`);
        return;
      }
      if (!window.confirm(`"${cat.name}" 카테고리를 삭제하시겠습니까?`)) return;
      categoriesRef.doc(cat.id).delete()
        .then(() => showStatus("카테고리가 삭제되었습니다"))
        .catch(() => showStatus("카테고리 삭제에 실패했습니다"));
    });

    li.appendChild(colorInput);
    li.appendChild(nameInput);
    li.appendChild(deleteBtn);
    categoryManageList.appendChild(li);
  });
}

manageAddCategoryBtn.addEventListener("click", () => {
  const name = manageNewCategoryName.value.trim();
  if (!name) {
    showStatus("카테고리 이름을 입력해주세요");
    return;
  }
  const duplicate = categories.find((c) => c.name.toLowerCase() === name.toLowerCase());
  if (duplicate) {
    showStatus(`"${duplicate.name}" 카테고리가 이미 있습니다`);
    return;
  }
  categoriesRef.add({ name, color: manageNewCategoryColor.value })
    .then(() => {
      manageNewCategoryName.value = "";
      manageNewCategoryColor.value = "#4dabf7";
      showStatus("카테고리가 추가되었습니다");
    })
    .catch(() => showStatus("카테고리 저장에 실패했습니다"));
});

}
