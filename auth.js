// ===== 로그인 화면 전용 스크립트 (Firebase Authentication) =====

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const googleProvider = new firebase.auth.GoogleAuthProvider();

const el = (id) => document.getElementById(id);

const authForm = el("authForm");
const authError = el("authError");
const signupBtn = el("signupBtn");

// 이미 로그인된 세션이 남아있으면(자동 로그인) 바로 앱 화면으로 이동
auth.onAuthStateChanged((user) => {
  if (user) {
    window.location.href = "app.html";
  }
});

authForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const email = el("authEmail").value;
  const password = el("authPassword").value;

  auth.signInWithEmailAndPassword(email, password)
    .then(() => goToApp("로그인되었습니다", "email"))
    .catch((err) => showAuthError(err));
});

signupBtn.addEventListener("click", () => {
  const email = el("authEmail").value;
  const password = el("authPassword").value;
  if (!email || !password) {
    authError.textContent = "이메일과 비밀번호를 입력해주세요";
    authError.classList.remove("hidden");
    return;
  }

  auth.createUserWithEmailAndPassword(email, password)
    .then(() => goToApp("회원가입이 완료되었습니다", "email"))
    .catch((err) => showAuthError(err));
});

el("googleLoginBtn").addEventListener("click", () => {
  auth.signInWithPopup(googleProvider)
    .then(() => goToApp("구글 계정으로 로그인되었습니다", "google"))
    .catch((err) => showAuthError(err));
});

function goToApp(message, method) {
  authError.classList.add("hidden");
  if (method) localStorage.setItem("lastLoginMethod", method);
  sessionStorage.setItem("pendingStatusMessage", message);
  window.location.href = "app.html";
}

// ===== Firebase Auth 에러를 한글 메시지로 변환 =====
function showAuthError(err) {
  const messages = {
    "auth/invalid-email": "이메일 형식이 올바르지 않습니다",
    "auth/user-not-found": "이메일 또는 비밀번호가 올바르지 않습니다",
    "auth/wrong-password": "이메일 또는 비밀번호가 올바르지 않습니다",
    "auth/invalid-credential": "이메일 또는 비밀번호가 올바르지 않습니다",
    "auth/email-already-in-use": "이미 가입된 이메일입니다",
    "auth/weak-password": "비밀번호는 6자 이상이어야 합니다",
    "auth/too-many-requests": "잠시 후 다시 시도해주세요",
    "auth/popup-closed-by-user": "구글 로그인 창이 닫혔습니다",
    "auth/network-request-failed": "네트워크를 확인해주세요"
  };
  authError.textContent = messages[err.code] || "로그인에 실패했습니다. 다시 시도해주세요";
  authError.classList.remove("hidden");
}

// ===== 최근 로그인 방법 배지 표시 =====
function showRecentLoginBadge() {
  const method = localStorage.getItem("lastLoginMethod");
  el("emailRecentBadge").classList.toggle("hidden", method !== "email");
  el("googleRecentBadge").classList.toggle("hidden", method !== "google");
}
showRecentLoginBadge();
