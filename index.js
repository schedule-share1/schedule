// =====================================================================
//  スケジュール共有（編集用）  プログラム本体
//  ・各行の右側の「//」から後ろは説明です（コンピュータは読み飛ばします）
//  ・大きく 1〜12 のブロックに分かれています
// =====================================================================


// ---------- 1. Firebase（予定を保存するクラウドのデータベース）の接続情報 ----------
const firebaseConfig = {                                                  // Firebaseの管理画面からコピーした「接続先の住所」のようなもの
  apiKey: "AIzaSyCn9ynoMkceF_4oucSsuyJk2MR63rXoL78",
  authDomain: "school-schedule-8806e.firebaseapp.com",
  databaseURL: "https://school-schedule-8806e-default-rtdb.firebaseio.com",
  projectId: "school-schedule-8806e",
  storageBucket: "school-schedule-8806e.firebasestorage.app",
  messagingSenderId: "520405731274",
  appId: "1:520405731274:web:1c7f98a459bdce3dbab133"
};


// ---------- 2. 設定（ここを書き換えると画面全体に反映されます） ----------
// ★ 先生ごとの「初期パスワード」（先生が画面から変更した場合は、変更後のパスワードが優先されます）
const teacherPasswords = {                                                // 「先生の名前: パスワード」の対応表
  "小松先生":     "komatsu-1111",
  "中塚先生":     "nakatsuka-2222",
  "塩沢誉先生":   "shiozawa-ho-3333",
  "塩澤仁士先生": "shiozawa-h-4444",
  "福澤先生":     "fukuzawa-5555",
  "丸山先生":     "maruyama-6666",
  "清水先生":     "shimizu-7777"
};
const teacherList = Object.keys(teacherPasswords);                        // 上の表から先生の名前だけを取り出した一覧（先生を増やすときは上の表に足すだけでOK）
const typeList = ["会議", "行事", "部活", "資格指導", "出張", "その他"];  // 予定の種別の一覧（選択欄と絞り込みタブはここから自動で作られる）
const MASTER_KEY = "0";                                                   // ★マスターキー：入力すると全員の予定を操作できる管理者になる（必ず変更！）
const STORAGE_KEY = "teacher_schedules_v2";                               // ネットにつながらないとき、ブラウザ内に保存する場所の名前
const TIME_CHECKS = ["allDayStart", "undecidedStart", "allDayEnd", "undecidedEnd"];  // 「一日」「未定」「終日」「未定」の4つのチェックボックスのID
const TIME_INPUTS = ["startHourInput", "startMinuteInput", "endHourInput", "endMinuteInput"];  // 「時」「分」を打ち込む4つの入力欄のID
const PASSWORD_STORAGE_KEY = "teacher_passwords_v1";                      // 変更したパスワードを、この端末のブラウザ内に保存する場所の名前
const MIN_PASSWORD_LENGTH = 4;                                            // パスワードの最低文字数


// ---------- 3. アプリの「今の状態」を覚えておく変数 ----------
let db = null;                                                            // Firebaseのデータベース本体（つながったら入る）
let tasksRef = null;                                                      // データベースの中の「tasks（予定）」の場所
let isFirebaseConnected = false;                                          // Firebaseにつながっているか（true / false）
let tasks = [];                                                           // 全ての予定を入れておく配列（リスト）
const filters = { teacher: 'ALL', date: 'ALL', type: 'ALL' };             // 絞り込みの状態（'ALL' は「すべて表示」の意味）
let lastCheckedDate = null;                                               // 最後に確認した「今日」の日付（0時を過ぎたか調べるため）
let lastEndedSignature = "";                                              // 終了済みの予定IDをつなげた文字列（変化に気づくため）
let editingTaskId = null;                                                 // いま編集している予定のID（編集していなければ null）
let pendingDuplicateId = null;                                            // 複製したけど、まだ保存していない予定のID
let authContext = null;                                                   // パスワード入力画面を「何のために」開いたか（ログイン／本人確認）

const el = id => document.getElementById(id);                             // 「HTMLの部品をIDで探す」を短く書くための道具

const session = {                                                         // sessionStorage（タブを閉じるまで覚えておく場所）を安全に使う道具
  get: key => { try { return sessionStorage.getItem(key); } catch (e) { return null; } },  // 読み出す（使えない環境ではエラーにせず null）
  set: (key, value) => {                                                  // 書き込む（null を渡すと消す）
    try { value === null ? sessionStorage.removeItem(key) : sessionStorage.setItem(key, value); } catch (e) {}
  }
};

let isMaster = session.get("isMaster") === "1";                           // 管理者（マスターキー）でログイン中か ※再読み込みしても保持
let currentTeacher = isMaster ? null : session.get("loggedInTeacher");    // ログイン中の先生の名前
if (!teacherPasswords[currentTeacher]) currentTeacher = null;             // 一覧にない名前が残っていたらログアウト扱いにする


// ---------- 4. ページを開いたときに最初に1回だけ動く処理 ----------
document.addEventListener("DOMContentLoaded", () => {                     // HTMLの読み込みが終わったら、中の処理を実行
  el("teacherSelect").innerHTML += teacherList.map(t => `<option value="${t}">${t}</option>`).join("");  // 先生の選択肢を一覧から自動で作る
  el("typeSelect").innerHTML = typeList.map(t => `<option value="${t}">${t}</option>`).join("");  // 種別の選択肢を一覧から自動で作る
  
  // 時・分の入力欄：キーボードで直接打てる。右の▼を押すと候補の一覧も出る
  TIME_INPUTS.forEach(setupTimeInput);                                    // 4つの入力欄に「数字だけ」「範囲チェック」の仕組みをつける
  el("scheduleForm").addEventListener("reset", () => setTimeout(() => TIME_INPUTS.forEach(updateTimeValidity), 0));  // フォームをリセットしたら、エラー表示も消す
  el("targetTeacher").innerHTML += teacherList.map(t => `<option value="${t}">${t}</option>`).join("");  // パスワード変更画面（管理者用）の先生の選択肢を作る
  loadSavedPasswords();                                                   // 画面から変更されたパスワードがあれば読み込む

  el("dateInput").value = getTodayFormatted();                            // 日付の入力欄に今日を入れておく

  updateTaskRequired();                                                   // 「予定・内容」が必須かどうかの表示を整える
  updateLoginUI();                                                        // ログインボタンの表示を整える
  renderFilterTabs();                                                     // 絞り込みタブ（先生・日にち・種別）を作る

  setInterval(checkDateChange, 30 * 1000);                                // 30秒ごとに「日付が変わったか」「予定が終わったか」を確認
  document.addEventListener("visibilitychange", () => {                   // 別のタブから戻ってきたときも…
    if (!document.hidden) checkDateChange();                              // …すぐに確認する
  });

  connectFirebase();                                                      // データベースにつなぐ
});


// ---------- 5. データの保存・読み込み ----------
function connectFirebase() {                                              // Firebaseにつないで、予定の変化を見張る
  try {
    if (typeof firebase === 'undefined') return initLocalStorageFallback();  // Firebaseの部品が読み込めていなければ、ブラウザ保存に切り替え
    firebase.initializeApp(firebaseConfig);                               // 接続情報を使って Firebase を準備
    db = firebase.database();                                             // データベースを取り出す
    tasksRef = db.ref("tasks");                                           // 「tasks」という場所を使う

    db.ref("passwords").on("value", snap => applyPasswordOverrides(snap.val()), () => {});  // 変更されたパスワードも見張る（読めない設定でも、エラーにはしない）

    tasksRef.on("value", snapshot => {                                    // データが変わるたびに（他の先生が書き込んだときも）ここが動く
      isFirebaseConnected = true;
      const data = snapshot.val() || {};                                  // 中身を取り出す（空なら空のオブジェクト）
      tasks = Object.keys(data).map(key => ({ id: key, ...data[key] }));  // { ID: 予定 } の形を [予定, 予定, …] の配列に変換
      renderSchedule();                                                   // 画面を描き直す
    }, error => {                                                         // 接続できない・権限がないときは…
      console.warn("Firebaseに接続できないため、ブラウザ内保存に切り替えます:", error);
      initLocalStorageFallback();                                         // …ブラウザ内保存に切り替え
    });
  } catch (e) {
    console.warn("Firebaseの準備に失敗したため、ブラウザ内保存に切り替えます:", e);
    initLocalStorageFallback();
  }
}

function initLocalStorageFallback() {                                     // ネットが使えないときの予備：ブラウザ内（localStorage）に保存する
  isFirebaseConnected = false;
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(STORAGE_KEY)); } catch (e) {}  // 保存してある文字列を予定のデータに戻す
  tasks = Array.isArray(saved) ? saved : getSampleData();                 // 保存がなければ見本データを使う
  saveTasksToStorage();
  renderSchedule();
}

function saveTasksToStorage() {                                           // ブラウザ内に保存（Firebase使用中は不要なので何もしない）
  if (!isFirebaseConnected) localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
}

function removeTasks(ids) {                                               // 指定したIDの予定をまとめて削除する（1件でも複数でもOK）
  if (ids.length === 0) return;
  if (isFirebaseConnected && db) {
    const updates = {};
    ids.forEach(id => { updates["tasks/" + id] = null; });                // Firebaseでは「null を書き込む」＝削除
    db.ref().update(updates);                                             // まとめて1回で送る
  }
  tasks = tasks.filter(t => !ids.includes(t.id));                         // 手元の配列からも取り除く
  saveTasksToStorage();
}

function getSampleData() {                                                // 初めて使うとき用の見本データ（昨日・今日・明日の3件）
  const day = n => formatLocalDate(daysFromToday(n));                     // n日後の日付文字列を作る小さな道具
  return [
    { id: "task_sample_1", teacher: "小松先生",   type: "会議", date: day(-1), time: "15:30", endTime: "16:30", text: "第2回 校内研修準備会" },
    { id: "task_sample_2", teacher: "塩沢誉先生", type: "部活", date: day(0),  time: "16:00", endTime: "18:00", text: "サッカー部 グラウンド技術指導" },
    { id: "task_sample_3", teacher: "中塚先生",   type: "行事", date: day(1),  time: "10:00", endTime: "12:00", text: "生徒会選挙 リハーサル進行" }
  ];
}


// ---------- 6. 日付・時間の計算 ----------
function formatLocalDate(d) {                                             // 日付を「2026-11-10」の形の文字列にする（日本時間のまま）
  const m = String(d.getMonth() + 1).padStart(2, '0');                    // 月は0から数えるので +1。1桁なら前に0をつける
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

function getTodayFormatted() {                                            // 今日の日付文字列
  return formatLocalDate(new Date());
}

function daysFromToday(n) {                                               // 今日から n 日後の日付（マイナスなら n 日前）
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + n);
}

function parseTime(str) {                                                 // "15:30" → 930（0時からの分数）。時刻でなければ null
  const m = /^(\d{1,2}):(\d{2})$/.exec(str || "");                        // 「数字:数字」の形かチェック（正規表現）
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

function isAllDayValue(v) {                                               // 「一日」か（昔のデータの「１日中」も一日として扱う）
  return v === "一日" || v === "１日中";
}

function isTaskEnded(task, now = new Date()) {                            // 予定が終わっているか
  const today = formatLocalDate(now);
  if (task.date !== today) return task.date < today;                      // 今日以外なら「昨日以前＝終了」「明日以降＝まだ」
  const end = parseTime(task.endTime);                                    // 今日の予定なら終了時間を見る
  return end !== null && now.getHours() * 60 + now.getMinutes() >= end;   // 終了時間を過ぎたら終了（「終日」「未定」は日付が変わるまで終わらない）
}

function getTaskEndDateTime(task) {                                       // 予定が終わる日時を返す
  const [y, mo, d] = (task.date || "").split("-").map(Number);            // "2026-11-10" を 年・月・日 の数字に分ける
  if (!y || !mo || !d) return null;                                       // 日付がおかしければ null
  const end = parseTime(task.endTime);
  return end !== null
    ? new Date(y, mo - 1, d, 0, end)                                      // 時刻があれば、その日の0時＋終了時間（分）
    : new Date(y, mo - 1, d + 1);                                         // 時刻がなければ（終日・未定）翌日の0時
}

function isTaskExpiredOverOneDay(task, now = new Date()) {                // 終わってから24時間以上たったか
  const end = getTaskEndDateTime(task);
  return !!end && now - end >= 24 * 60 * 60 * 1000;                       // 日時の引き算はミリ秒（1/1000秒）で計算される
}

function purgeExpiredTasks() {                                            // 終わって1日以上たった予定を自動で削除（削除したら true を返す）
  const now = new Date();
  const ids = tasks
    .filter(t => t.id !== editingTaskId && t.id !== pendingDuplicateId && isTaskExpiredOverOneDay(t, now))  // 編集中の予定は消さない
    .map(t => t.id);
  removeTasks(ids);
  return ids.length > 0;
}

function getEndedSignature() {                                            // 終了済み予定のIDをつなげた文字列（前回と違えば、何かが終了したとわかる）
  const now = new Date();
  return tasks.filter(t => isTaskEnded(t, now)).map(t => t.id).join("|");
}

function checkDateChange() {                                              // 30秒ごとに呼ばれ、必要なときだけ画面を描き直す
  if (purgeExpiredTasks() || getTodayFormatted() !== lastCheckedDate) {   // 古い予定を消した、または日付が変わった →
    renderFilterTabs();                                                   // 日にちタブも作り直す
    renderSchedule();
  } else if (getEndedSignature() !== lastEndedSignature) {                // 終了時間を過ぎた予定が出た →
    renderSchedule();                                                     // 一覧だけ描き直す
  }
}


// ---------- 7. ログイン・パスワード確認 ----------
function setLogin(teacher, master) {                                      // ログイン状態を変えて、タブを閉じるまで覚えておく
  currentTeacher = teacher;
  isMaster = master;
  session.set("loggedInTeacher", teacher);
  session.set("isMaster", master ? "1" : null);
  updateLoginUI();
}

function logout() {                                                       // ログアウト（ヘッダーのボタンから呼ばれる）
  setLogin(null, false);
}

function updateLoginUI() {                                                // ログイン状態に合わせて、ヘッダーの表示を切り替える
  const loggedIn = !!currentTeacher || isMaster;
  el("loginBtn").classList.toggle("hidden", loggedIn);                    // ログイン中は「ログイン」ボタンを隠す
  el("loggedInInfo").classList.toggle("hidden", !loggedIn);               // ログイン中は「○○でログイン中」を見せる
  el("loggedInName").textContent = isMaster ? "管理者"                     // 名前だけ入れる（「でログイン中」はHTMLの .login-suffix で、スマホでは隠す）
    : currentTeacher ? currentTeacher : "";
  el("changePwBtn").classList.toggle("hidden", !loggedIn);                // ログイン中（先生・管理者）だけ「パスワード変更」ボタンを出す
  applyTeacherLock();
  renderSchedule();
}

function applyTeacherLock() {                                             // ログイン中は「担当」の欄を本人に固定（他の先生の名前で登録できないように）
  const select = el("teacherSelect");
  if (currentTeacher) select.value = currentTeacher;
  select.disabled = !!currentTeacher;                                     // 選べなくする
  select.classList.toggle("is-locked", !!currentTeacher);                 // 見た目も薄くする
}

function openAuthModal(ctx) {                                             // パスワード入力画面を開く（ctx＝何のために開くかの情報）
  authContext = ctx;
  el("authTitle").textContent = ctx.title;
  el("authMessage").textContent = ctx.message;
  el("authPassword").value = "";
  el("authError").classList.add("hidden");
  el("authModal").classList.remove("hidden");
  setTimeout(() => el("authPassword").focus(), 50);                       // 少し待ってから入力欄にカーソルを置く
}

function closeAuthModal() {                                               // パスワード入力画面を閉じる
  el("authModal").classList.add("hidden");
  authContext = null;
}

function openLoginModal() {                                               // 「ログイン」ボタンを押したとき
  openAuthModal({ mode: "login", title: "ログイン", message: "先生のパスワードを入力してください" });
}

function submitAuth() {                                                   // パスワード入力画面で「確認」を押したとき
  if (!authContext) return;
  const pw = el("authPassword").value;
  const showError = () => el("authError").classList.remove("hidden");     // 「パスワードが違います」を表示する道具

  if (authContext.mode === "login") {                                     // ―― ログインの場合 ――
    if (pw && pw === MASTER_KEY) {                                        // マスターキーなら管理者としてログイン
      closeAuthModal();
      return setLogin(null, true);
    }
    const teacher = pw && teacherList.find(t => teacherPasswords[t] === pw);  // パスワードが一致する先生を探す
    if (!teacher) return showError();
    closeAuthModal();
    setLogin(teacher, false);
  } else {                                                                // ―― 本人確認の場合 ――
    const ok = pw && (teacherPasswords[authContext.teacher] === pw || pw === MASTER_KEY);  // その先生のパスワード、またはマスターキーならOK
    if (!ok) return showError();
    const onSuccess = authContext.onSuccess;                              // 閉じると authContext が消えるので、先に取っておく
    closeAuthModal();
    onSuccess();                                                          // 本来やりたかった処理を実行
  }
}

function runWithAuth(teacher, message, action) {                          // 権限があればすぐ実行、なければパスワードを聞いてから実行
  if (isMaster || currentTeacher === teacher) return action();            // 管理者、または本人でログイン中ならパスワード不要
  openAuthModal({ mode: "verify", teacher, title: "パスワードの確認", message, onSuccess: action });
}

function tryTaskAction(action, id) {                                      // 予定カードの「編集・複製・削除」ボタンから呼ばれる
  const task = tasks.find(t => t.id === id);
  if (!task) return;
  const actions = { edit: startEditTask, duplicate: duplicateTask, delete: requestDeleteTask };  // ボタンの種類 → 実行する関数 の対応表
  runWithAuth(task.teacher, `${task.teacher}のパスワードを入力してください`, () => actions[action](id));
}


// ---------- 7-2. パスワードの変更（先生は自分の分、管理者は全員の分を変えられる） ----------
function loadSavedPasswords() {                                           // この端末に保存してある「変更後のパスワード」を読み込む
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(PASSWORD_STORAGE_KEY)); } catch (e) {}
  applyPasswordOverrides(saved, false);
}

function applyPasswordOverrides(data, saveLocal = true) {                 // 変更後のパスワードを、現在の対応表に上書きする
  if (!data || typeof data !== "object") return;
  teacherList.forEach(t => {                                              // 知っている先生の分だけ反映する（余計なデータは無視）
    if (typeof data[t] === "string" && data[t]) teacherPasswords[t] = data[t];
  });
  if (saveLocal) savePasswordsLocally();
}

function savePasswordsLocally() {                                         // 今のパスワード一覧をこの端末に保存する
  try { localStorage.setItem(PASSWORD_STORAGE_KEY, JSON.stringify(teacherPasswords)); } catch (e) {}
}

function openPasswordModal() {                                            // 「パスワード変更」ボタンを押したとき
  if (!currentTeacher && !isMaster) return;                               // ログインしていなければ開かない
  el("pwModalMessage").textContent = isMaster                             // 管理者のときは、どの先生のパスワードを変えるかを選んでもらう
    ? "パスワードを変更する先生を選び、新しいパスワードを入力してください"
    : `${currentTeacher}の新しいパスワードを入力してください`;
  el("targetTeacherWrap").classList.toggle("hidden", !isMaster);          // 先生の選択欄は管理者のときだけ表示
  el("targetTeacher").value = "";
  el("newPassword").value = "";
  el("newPasswordConfirm").value = "";
  el("pwError").classList.add("hidden");
  el("pwSuccess").classList.add("hidden");
  el("pwModal").classList.remove("hidden");
  setTimeout(() => el(isMaster ? "targetTeacher" : "newPassword").focus(), 50);
}

function closePasswordModal() {                                           // パスワード変更画面を閉じる
  el("pwModal").classList.add("hidden");
}

function submitPasswordChange() {                                         // 「変更する」を押したとき
  if (!currentTeacher && !isMaster) return closePasswordModal();
  const pw1 = el("newPassword").value;
  const pw2 = el("newPasswordConfirm").value;
  el("pwSuccess").classList.add("hidden");
  const showError = msg => { el("pwError").textContent = msg; el("pwError").classList.remove("hidden"); };

  let target = currentTeacher;                                            // パスワードを変える先生（先生本人でログイン中なら自分）
  if (isMaster) {                                                         // 管理者の場合：選択欄で選んだ先生のパスワードを変える
    target = el("targetTeacher").value;
    if (!teacherList.includes(target)) return showError("パスワードを変更する先生を選んでください");
  }

  if (pw1.length < MIN_PASSWORD_LENGTH) return showError(`${MIN_PASSWORD_LENGTH}文字以上で入力してください`);
  if (pw1 !== pw2) return showError("確認用のパスワードが一致しません");
  const used = pw1 === MASTER_KEY || teacherList.some(t => t !== target && teacherPasswords[t] === pw1);  // ログインは「パスワードから先生を探す」しくみなので、他の人と同じものは使えない
  if (used) return showError("このパスワードは使えません。別のパスワードにしてください");
  el("pwError").classList.add("hidden");

  teacherPasswords[target] = pw1;                                         // 対応表を新しいパスワードに更新
  savePasswordsLocally();                                                 // この端末に保存
  if (isFirebaseConnected && db) {                                        // Firebaseにもつながっていれば、他の端末でも使えるように保存
    db.ref("passwords/" + target).set(pw1).catch(() => {
      showError("この端末では変更できましたが、他の端末への共有に失敗しました");
    });
  }
  el("pwSuccessText").textContent = `${target}のパスワードを変更しました`;  // 誰のパスワードを変えたか表示して、少し待ってから閉じる
  el("pwSuccess").classList.remove("hidden");
  setTimeout(closePasswordModal, 1200);
}


// ---------- 8. 絞り込み（先生・日にち・種別） ----------
function toggleFilterPanel() {                                            // 「絞り込み」ボタンでパネルを開け閉めする
  const isHidden = el("filterPanel").classList.toggle("hidden");
  el("filterChevron").classList.toggle("is-open", !isHidden);             // 矢印の向きも変える
}

function selectFilter(kind, value) {                                      // タブを押したとき（kind＝teacher / date / type）
  filters[kind] = (value === 'ALL' || filters[kind] === value) ? 'ALL' : value;  // 同じタブをもう一度押すと解除して「すべて」に戻る
  renderFilterTabs();
  renderSchedule();
}

function renderFilterTabs() {                                             // 3種類の絞り込みタブをまとめて作る
  const weekdays = ['日', '月', '火', '水', '木', '金', '土'];
  const days = [];
  for (let i = 0; i < 8; i++) {                                           // 今日から7日後までの8日分
    const d = daysFromToday(i);
    days.push({
      value: formatLocalDate(d),                                          // "2026-11-10"
      md: `${d.getMonth() + 1}/${d.getDate()}`,                           // "11/10"
      weekday: weekdays[d.getDay()],                                      // "火"
      sub: i === 0 ? '今日' : i === 1 ? '明日' : `(${weekdays[d.getDay()]})`  // タブの下段に出す文字
    });
  }
  lastCheckedDate = days[0].value;                                        // 「今日」を覚えておく
  if (!days.some(day => day.value === filters.date)) filters.date = 'ALL';  // 選んでいた日が範囲外になったら「すべて」に戻す

  const tab = (kind, value, inner, cls = "") =>                           // タブのボタン1個分のHTMLを作る道具（選択中なら is-active をつける）
    `<button type="button" onclick="selectFilter('${kind}', '${value}')" class="tab${cls}${filters[kind] === value ? ' is-active' : ''}">${inner}</button>`;
  const dateInner = day => `<span class="tab-date-main">${day.md}</span><span class="tab-date-sub">${day.sub}</span>`;  // 日にちタブは2段表示

  el("teacherTabs").innerHTML = tab('teacher', 'ALL', '👥 全員') + teacherList.map(t => tab('teacher', t, t)).join("");
  el("dateTabs").innerHTML = tab('date', 'ALL', '<span>📅 すべて</span>', ' tab--date')
    + days.map(day => tab('date', day.value, dateInner(day), ' tab--date')).join("");
  el("typeTabs").innerHTML = tab('type', 'ALL', '🏷️ すべて') + typeList.map(t => tab('type', t, t)).join("");

  const selDay = days.find(day => day.value === filters.date);            // 各見出しの右の「表示中: ○○」を更新
  el("currentTeacherLabel").textContent = filters.teacher === 'ALL' ? "表示中: 全員" : `表示中: ${filters.teacher}`;
  el("currentDateLabel").textContent = selDay ? `表示中: ${selDay.md}（${selDay.weekday}）` : "表示中: すべての日";
  el("currentTypeLabel").textContent = filters.type === 'ALL' ? "表示中: すべての種別" : `表示中: ${filters.type}`;
}

function updateFilterBadge() {                                            // 「絞り込み」ボタンの数字バッジ（いくつ条件を選んでいるか）
  const count = Object.values(filters).filter(v => v !== 'ALL').length;
  el("filterActiveBadge").textContent = count;
  el("filterActiveBadge").classList.toggle("hidden", count === 0);        // 0個なら隠す
}


// ---------- 9. 入力フォーム ----------
function updateTaskRequired() {                                           // 種別が「その他」のときだけ「予定・内容」を必須にする
  const required = el("typeSelect").value === "その他";
  el("taskInput").required = required;
  el("taskRequiredMark").className = required ? "mark-required" : "mark-optional";
  el("taskRequiredMark").textContent = required ? "*" : "(任意)";
}

function onTimeCheckChange(id) {                                          // 「一日」「未定」「終日」のチェックが変わったとき（id＝押されたチェック）
  const partner = { allDayStart: "undecidedStart", undecidedStart: "allDayStart",  // 同じ側（開始／終了）で、同時にはオンにできない相手
                    allDayEnd: "undecidedEnd", undecidedEnd: "allDayEnd" }[id];
  if (el(id).checked) {                                                   // オンにしたとき：
    if (id === "undecidedStart" && el("allDayStart").checked) el("allDayEnd").checked = false;  // 「一日」で自動で入った終了側のチェックも外す
    el(partner).checked = false;                                          // 相手のチェックを外す
  } else if (id === "allDayStart") {                                      // 「一日」をオフにしたとき：
    el("allDayEnd").checked = false;                                      // 自動で入った終了側のチェックも外す
  }
  updateAllDayUI();
}

function updateAllDayUI() {                                               // チェックの状態に合わせて、時間の入力欄を使える／使えないにする
  const isAllDay = el("allDayStart").checked;
  if (isAllDay) {                                                         // 開始が「一日」なら、終了も自動で「一日」にして固定
    el("allDayEnd").checked = true;
    el("undecidedEnd").checked = false;
  }
  el("allDayEnd").disabled = isAllDay;
  el("undecidedEnd").disabled = isAllDay;
  el("allDayEndLabel").textContent = isAllDay ? "一日" : "終日";

  const disableStart = isAllDay || el("undecidedStart").checked;          // 一日・未定なら開始の「時」「分」は選べない
  el("startHourInput").disabled = disableStart;
  el("startMinuteInput").disabled = disableStart;

  const disableEnd = el("allDayEnd").checked || el("undecidedEnd").checked;  // 終日・未定なら終了の「時」「分」は選べない
  el("endHourInput").disabled = disableEnd;
  el("endMinuteInput").disabled = disableEnd;
}

function getSplitTimeValue(hourId, minuteId) {                            // 「時」と「分」の入力をつなげて "15:30" の形にする（入力がおかしければ空文字）
  const h = toHalfWidthDigits(el(hourId).value.trim());                   // 全角数字を半角に直す
  let m = toHalfWidthDigits(el(minuteId).value.trim());
  if (h === "") return "";                                                // 「時」が空なら時間なし
  if (m === "") m = "0";                                                  // 「分」が空なら 00 分として扱う（「9」だけ入力すれば 09:00 になる）
  if (!/^\d{1,2}$/.test(h) || !/^\d{1,2}$/.test(m)) return "";           // 数字（1〜2桁）でなければ無効
  if (Number(h) > 23 || Number(m) > 59) return "";                        // 時は0〜23、分は0〜59 の範囲だけ有効
  return `${h.padStart(2, "0")}:${m.padStart(2, "0")}`;                   // 1桁なら前に0をつけて「09:05」の形にそろえる
}

function setSplitTimeValue(hourId, minuteId, timeStr) {                   // "15:30" を「時」と「分」の入力欄に分けてセットする
  const parts = (timeStr || "").split(":");
  const isTime = parts.length === 2;
  el(hourId).value = isTime ? parts[0].padStart(2, "0") : "";
  el(minuteId).value = isTime ? parts[1].padStart(2, "0") : "";
  updateTimeValidity(hourId);
  updateTimeValidity(minuteId);
}

function toHalfWidthDigits(str) {                                         // 全角の数字（０〜９）を半角（0〜9）に直す
  return (str || "").replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0));
}

function updateTimeValidity(id) {                                         // 入力が範囲外のとき、送信時にブラウザが出す注意文をセットする
  const isHour = id.includes("Hour");
  const max = isHour ? 23 : 59;
  const v = el(id).value;
  el(id).setCustomValidity(v !== "" && Number(v) > max ? `${isHour ? "時" : "分"}は0〜${max}の数字で入力してください` : "");
}

const timeMenus = {};                                                     // 時間欄の候補リスト（<ul>）をIDごとに覚えておく場所

function setMinuteInputMode(id, oneMinute) {                             // 分の候補リストを作り直す（false＝00,15,30,45 の15分刻みに戻す）
  const menu = timeMenus[id];                                             // まだ作られていなければ何もしない
  if (!menu) return;
  const values = oneMinute ? 60 : 4;                                      // true なら00〜59 の1分刻み、false なら15分刻み
  menu.innerHTML = Array.from({ length: values }, (_, i) => {
    const v = String(oneMinute ? i : i * 15).padStart(2, "0");
    return `<li data-value="${v}">${v}</li>`;
  }).join("");
}

function setupTimeInput(id) {                                             // 時・分の入力欄を「数字だけ打てる」「時を打ち終えたら分へ移る」ようにする
  const input = el(id);
  const isHour = id.includes("Hour");
  const minuteInput = isHour ? el(id.replace("Hour", "Minute")) : null;   // 「時」の欄に対応する「分」の欄（例：startHourInput → startMinuteInput）

  const sanitize = () => {
    input.value = toHalfWidthDigits(input.value).replace(/\D/g, "").slice(0, 2);  // 数字以外を消し、2文字までにする
    updateTimeValidity(id);

    if (!isHour || input.value === "" || Number(input.value) > 23) return;  // 「時」が空、または範囲外ならそのまま（移動しない）
    if (input.value.length === 2) {                                        // 2桁打ち終えた（例：09、15）
      minuteInput.focus();                                                 // 「分」の欄へカーソルを移す
    } else if (Number(input.value) >= 3) {                                 // 1桁で3〜9なら、あとに数字が続かない（30時以上はない）ので…
      input.value = "0" + input.value;                                     // 「9」→「09」にそろえて
      minuteInput.focus();                                                 // すぐ「分」の欄へ移る
    }
  };

  // ---- ▼を押すと出る候補リスト（入力欄に何が書いてあっても、いつも同じ全部の候補を表示する） ----
  const field = input.parentElement;                                       // 入力欄と▼をまとめている箱
  const menu = document.createElement("ul");                               // 候補リスト（<ul>）を作る
  menu.className = "time-menu hidden";
  const values = isHour ? 24 : 4;                                          // 時：00〜23 の24個 ／ 分：00,15,30,45 の4個（15分ごと）
  menu.innerHTML = Array.from({ length: values }, (_, i) => {
    const v = String(isHour ? i : i * 15).padStart(2, "0");
    return `<li data-value="${v}">${v}</li>`;
  }).join("");
  field.appendChild(menu);
  timeMenus[id] = menu;                                                   // setMinuteInputMode が作り直せるように覚えておく

  const closeMenu = () => menu.classList.add("hidden");
  const openMenu = () => {
    if (input.disabled) return;                                            // 「一日」「未定」で使えないときは開かない
    document.querySelectorAll(".time-menu").forEach(m => m.classList.add("hidden"));  // 他の候補リストは閉じる
    [...menu.children].forEach(li => li.classList.toggle("is-selected", li.dataset.value === input.value));  // 今の値の候補に色をつける
    menu.scrollTop = 0;                                                    // いつも先頭（00）から表示する
    menu.classList.remove("hidden");
  };

  field.querySelector(".time-arrow").addEventListener("mousedown", e => e.preventDefault());  // ▼を押しても入力欄のカーソルが動かないように
  field.querySelector(".time-arrow").addEventListener("click", () => menu.classList.contains("hidden") ? openMenu() : closeMenu());  // ▼：開く／閉じる
  menu.addEventListener("mousedown", e => e.preventDefault());             // 候補を押しても入力欄から外れない（閉じてしまわない）ように
  menu.addEventListener("click", e => {                                    // 候補を選んだとき
    const li = e.target.closest("li");
    if (!li) return;
    input.value = li.dataset.value;                                        // 入力欄にその値を入れる
    updateTimeValidity(id);
    closeMenu();
    if (isHour) minuteInput.focus();                                       // 「時」を選んだら「分」の欄へ移る
  });
  document.addEventListener("click", e => { if (!field.contains(e.target)) closeMenu(); });  // 外側を押したら閉じる
  // Enter：フォームの暗黙送信にしない（送信すると handleFormSubmit が走り、入力欄が空にされる）。
  // 分を確定して次の欄へ移るだけにする。開始時→開始分、開始分→終了時、終了時→終了分、終了分→予定・内容。
  const nextTimeInputId = { startHourInput: "startMinuteInput", startMinuteInput: "endHourInput", endHourInput: "endMinuteInput", endMinuteInput: "taskInput" }[id];
  input.addEventListener("keydown", e => {
    if (e.key === "Escape") return closeMenu();                           // Escキーでも閉じる
    if (e.key !== "Enter") return;
    e.preventDefault();                                                   // 暗黙送信（＝フォーム送信）を止める
    closeMenu();
    const next = nextTimeInputId ? el(nextTimeInputId) : null;
    if (next && !next.disabled) next.focus();                             // 次の欄へ移る（blur で1桁は0付きにそろう）
    else input.blur();
  });
  input.addEventListener("input", closeMenu);                                // 文字を打ち始めたら閉じる

  input.addEventListener("input", e => { if (!e.isComposing) sanitize(); });  // 日本語入力の変換中は触らない
  input.addEventListener("compositionend", sanitize);                      // 変換が確定したら整える
  input.addEventListener("focus", () => input.select());                   // 欄に入ったとき中身を選択状態にする（そのまま打てば上書きされる）
  input.addEventListener("blur", () => {                                   // 入力欄から出たとき、1桁なら0をつけて2桁にそろえる
    if (/^\d$/.test(input.value)) input.value = "0" + input.value;
  });
}

function setFormMode(isEdit) {                                            // フォームの見出しとボタンを「追加用」か「編集用」に切り替える
  el("formTitleText").textContent = isEdit ? "予定を編集" : "新しいスケジュールを追加";
  el("formTitleIcon").className = isEdit ? "fa-solid fa-pen" : "fa-solid fa-calendar-plus";
  el("submitBtnIcon").className = isEdit ? "fa-solid fa-check" : "fa-solid fa-plus";
  el("submitBtnText").textContent = isEdit ? "変更を保存" : "スケジュールを追加";
  el("cancelEditBtn").classList.toggle("hidden", !isEdit);                // 編集中だけ「キャンセル」ボタンを出す
}

function handleFormSubmit(event) {                                        // 「スケジュールを追加」「変更を保存」を押したとき
  event.preventDefault();                                                 // ページが再読み込みされるのを止める
  const checked = id => el(id).checked;
  const teacher = el("teacherSelect").value;
  const type = el("typeSelect").value;
  const date = el("dateInput").value;
  const time = checked("allDayStart") ? "一日"                            // 開始時間：チェックがあればその文字、なければ選択した「時:分」
    : checked("undecidedStart") ? "未定"
    : getSplitTimeValue("startHourInput", "startMinuteInput");
  const endTime = checked("allDayStart") ? "一日"                         // 終了時間：同じように決める
    : checked("allDayEnd") ? "終日"
    : checked("undecidedEnd") ? "未定"
    : getSplitTimeValue("endHourInput", "endMinuteInput");
    
  const text = el("taskInput").value.trim();                              // 前後の空白を取り除く

  if (!teacher || !date || !time || !endTime) return;                     // 必須の項目が空なら何もしない
  if (type === "その他" && !text) return;

  const taskData = { teacher, type, date, time, endTime, text, studentSupport: el("studentSupportInput").value };  // 保存する予定のデータ

  if (editingTaskId) {                                                    // ―― 編集中なら、上書き保存 ――
    if (isFirebaseConnected && db) {
      db.ref("tasks/" + editingTaskId).update(taskData);
    } else {
      const task = tasks.find(t => t.id === editingTaskId);
      if (task) Object.assign(task, taskData);                            // 元の予定に新しい内容を上書き
      saveTasksToStorage();
    }
    pendingDuplicateId = null;                                            // 複製した予定も、保存したので確定
    return cancelEdit();                                                  // 編集モードを終わる
  }

  const addTask = () => {                                                 // ―― 新しい予定を追加する処理 ――
    if (isFirebaseConnected && tasksRef) {
      tasksRef.push(taskData);                                            // Firebaseに追加（IDは自動でつく）
    } else {
      tasks.push({ ...taskData, id: "task_" + Date.now() });              // 今の時刻（ミリ秒）をIDにして追加
      saveTasksToStorage();
      renderSchedule();
    }
    ["taskInput", "startHourInput", "startMinuteInput", "endHourInput", "endMinuteInput"].forEach(id => { el(id).value = ""; });  // 入力欄を空に戻す
    setMinuteInputMode("startMinuteInput", false);                      // 分の選択肢を15分刻みに戻す
    setMinuteInputMode("endMinuteInput", false);
    TIME_CHECKS.forEach(id => { el(id).checked = false; });               // チェックを外す
    el("studentSupportInput").value = "不可";
    updateAllDayUI();
  };

  runWithAuth(teacher, `スケジュールを追加するには、${teacher}のパスワードを入力してください`, addTask);  // ログインしていなければパスワードを確認してから追加
}


// ---------- 10. 編集・複製・削除 ----------
function startEditTask(id) {                                              // 予定をフォームに読み込んで、編集モードにする
  const task = tasks.find(t => t.id === id);
  if (!task) return;

  if (pendingDuplicateId && pendingDuplicateId !== id) {                  // 保存していない複製が残っていたら消す
    removeTasks([pendingDuplicateId]);
    pendingDuplicateId = null;
  }
  editingTaskId = id;

  const allDayStart = isAllDayValue(task.time);                           // 保存されている時間を、チェックと時刻に分けて戻す
  const undecidedStart = task.time === "未定";
  const allDayEnd = task.endTime === "終日" || isAllDayValue(task.endTime);
  const undecidedEnd = task.endTime === "未定";

  el("teacherSelect").value = task.teacher;                               // 各入力欄に予定の内容を入れる
  el("typeSelect").value = task.type;
  el("dateInput").value = task.date;
  el("studentSupportInput").value = normalizeStudentSupport(task.studentSupport);
  el("allDayStart").checked = allDayStart;
  el("undecidedStart").checked = undecidedStart;
  el("allDayEnd").checked = allDayEnd;
  el("undecidedEnd").checked = undecidedEnd;
  setSplitTimeValue("startHourInput", "startMinuteInput", (allDayStart || undecidedStart) ? "" : task.time);
  setSplitTimeValue("endHourInput", "endMinuteInput", (allDayEnd || undecidedEnd) ? "" : task.endTime);
  el("taskInput").value = (task.text || "").trim();

  updateAllDayUI();
  updateTaskRequired();
  setFormMode(true);                                                      // 見出しとボタンを「編集用」に
  renderSchedule();
  el("scheduleForm").scrollIntoView({ behavior: "smooth", block: "start" });  // フォームまでなめらかにスクロール
}

function cancelEdit() {                                                   // 編集をやめて、フォームを「追加用」に戻す
  if (pendingDuplicateId && editingTaskId === pendingDuplicateId) {       // 複製してすぐキャンセルしたら、その複製を消す
    removeTasks([pendingDuplicateId]);
  }
  pendingDuplicateId = null;
  editingTaskId = null;

  el("scheduleForm").reset();                                             // 入力欄を全部初期状態に戻す
  setMinuteInputMode("startMinuteInput", false);                        // 分の選択肢を15分刻みに戻す
  setMinuteInputMode("endMinuteInput", false);
  el("dateInput").value = getTodayFormatted();
  updateAllDayUI();
  updateTaskRequired();
  applyTeacherLock();
  setFormMode(false);
  renderSchedule();
}

function duplicateTask(id) {                                              // 予定をコピーして、そのまま編集画面で開く
  const task = tasks.find(t => t.id === id);
  if (!task) return;

  if (pendingDuplicateId) {                                               // 前回の未保存の複製が残っていれば消す
    removeTasks([pendingDuplicateId]);
    pendingDuplicateId = null;
  }

  const copyData = {                                                      // コピーする中身（IDは新しくつける）
    teacher: task.teacher,
    type: task.type,
    date: task.date,
    time: task.time || "",
    endTime: task.endTime || "",
    text: task.text || "",
    studentSupport: normalizeStudentSupport(task.studentSupport)
  };

  let newId;
  if (isFirebaseConnected && tasksRef) {
    newId = tasksRef.push(copyData).key;                                  // Firebaseに追加して、ついたIDを受け取る
  } else {
    newId = "task_" + Date.now();
    tasks.push({ ...copyData, id: newId });
    saveTasksToStorage();
  }

  pendingDuplicateId = newId;                                             // キャンセルされたら消すので覚えておく
  if (tasks.some(t => t.id === newId)) startEditTask(newId);              // すでに一覧にあればすぐ編集
  else setTimeout(() => startEditTask(newId), 300);                       // Firebaseからの反映を少し待ってから編集
}

function requestDeleteTask(id) {                                          // 1件削除の確認画面を出す
  showModal({
    title: "予定の削除",
    message: "この予定を削除してもよろしいですか？",
    confirmText: "削除する",
    isDanger: true,
    onConfirm: () => { removeTasks([id]); renderSchedule(); }             // 「削除する」を押したら実行
  });
}

function requestDeletePastTasks() {                                       // 「終了した予定を一括削除」ボタンを押したとき
  const pastCount = tasks.filter(t => isTaskEnded(t)).length;
  if (pastCount === 0) {                                                  // 消すものがなければ、お知らせだけ出す
    return showModal({
      title: "終了した予定はありません",
      message: "削除対象となる終了した予定はありませんでした。",
      confirmText: "確認",
      isDanger: false
    });
  }
  showModal({
    title: "終了した予定を一括削除",
    message: `終了した予定（計 ${pastCount} 件）を一括削除しますか？`,
    confirmText: `${pastCount} 件を削除`,
    isDanger: true,
    onConfirm: () => {                                                    // 押した瞬間に終了している予定をまとめて削除
      removeTasks(tasks.filter(t => isTaskEnded(t)).map(t => t.id));
      renderSchedule();
    }
  });
}

function showModal({ title, message, confirmText, isDanger, onConfirm }) {  // 確認ダイアログを開く（onConfirm＝OKで実行する処理）
  el("modalTitle").textContent = title;
  el("modalMessage").textContent = message;
  const btn = el("modalConfirmBtn");
  btn.textContent = confirmText;
  btn.className = "modal-btn " + (isDanger ? "modal-btn--danger" : "modal-btn--primary");  // 危険な操作なら赤いボタン
  btn.onclick = () => {                                                   // OKボタンを押したら…
    if (onConfirm) onConfirm();                                           // …処理を実行して
    closeModal();                                                         // …閉じる
  };
  el("customModal").classList.remove("hidden");
  setTimeout(() => {                                                      // 少し待ってからふわっと表示（アニメーション）
    el("customModal").classList.remove("is-faded");
    el("modalCard").classList.add("is-open");
  }, 10);
}

function closeModal() {                                                   // 確認ダイアログを閉じる
  el("customModal").classList.add("is-faded");                            // まず薄くして
  el("modalCard").classList.remove("is-open");
  setTimeout(() => el("customModal").classList.add("hidden"), 200);       // 0.2秒後に完全に隠す
}


// ---------- 11. 予定一覧の表示 ----------
function renderSchedule() {                                               // 予定の一覧と、上部の集計を描き直す（いちばん大事な関数）
  purgeExpiredTasks();                                                    // まず古い予定を掃除
  updateFilterBadge();
  const now = new Date();
  const todayStr = formatLocalDate(now);
  const upcomingList = el("upcomingTaskList");                            // 「今後の予定」のリスト
  const pastList = el("pastTaskList");                                    // 「終了した予定」のリスト
  upcomingList.innerHTML = "";                                            // いったん空にする
  pastList.innerHTML = "";

  const timeKey = t => isAllDayValue(t.time) ? "00:00" : t.time === "未定" ? "99:99" : (t.time || "");  // 並べ替え用：一日は先頭、未定は最後
  const shown = tasks
    .filter(t => (filters.teacher === 'ALL' || t.teacher === filters.teacher)  // 絞り込み：先生
              && (filters.type === 'ALL' || t.type === filters.type)      // 絞り込み：種別
              && (filters.date === 'ALL' || t.date === filters.date))     // 絞り込み：日にち
    .sort((a, b) => {                                                     // 並べ替え
      if (a.id === editingTaskId) return -1;                              // 編集中の予定はいちばん上
      if (b.id === editingTaskId) return 1;
      if (a.date !== b.date) return a.date.localeCompare(b.date);         // 日付の早い順
      return timeKey(a).localeCompare(timeKey(b));                        // 同じ日なら時間の早い順
    });

  let upcomingCount = 0;
  let pastCount = 0;
  shown.forEach(task => {                                                 // 1件ずつカードを作って、どちらかのリストに入れる
    const isPast = isTaskEnded(task, now);
    const card = createTaskCardElement(task, isPast, task.date === todayStr);
    if (isPast) { pastCount++; pastList.appendChild(card); }
    else { upcomingCount++; upcomingList.appendChild(card); }
  });

  // 予定が0件のときのメッセージ
  if (upcomingCount === 0) upcomingList.innerHTML = `<li class="empty-card"><i class="fa-solid fa-calendar-check empty-icon"></i><p class="empty-text">該当する今後の予定はありません</p></li>`;
  if (pastCount === 0) pastList.innerHTML = `<li class="empty-small">終了した予定はありません</li>`;

  lastEndedSignature = getEndedSignature();                               // 今の「終了済み」の状態を覚えておく
  el("statTotalCount").textContent = tasks.length;                        // ヘッダーの集計：全予定
  el("statTodayCount").textContent = tasks.filter(t => t.date === todayStr && !isTaskEnded(t, now)).length;  // 本日のまだ終わっていない予定
  el("statPastCount").textContent = tasks.filter(t => isTaskEnded(t, now)).length;  // 終了した予定
  el("upcomingCountText").textContent = `${upcomingCount} 件`;
  el("pastCountText").textContent = `${pastCount} 件`;
}

function normalizeStudentSupport(value) {                                 // 生徒対応の値をそろえる（昔の true/false 形式のデータにも対応）
  if (value === true || value === "可" || value === "可能") return "可";
  if (value === "時間による") return "時間による";
  return "不可";
}

const SUPPORT_MARKS = {                                                   // 生徒対応 → 表示する記号と色
  "可":         { mark: "〇", cls: "support-mark--ok" },
  "時間による": { mark: "△", cls: "support-mark--maybe" },
  "不可":       { mark: "×", cls: "support-mark--ng" }
};

const ACTION_BUTTONS = [                                                  // 予定カード右側のボタン（種類・アイコン・説明・追加の見た目）
  { action: "edit",      icon: "fa-solid fa-pen",       title: "編集", cls: "" },
  { action: "duplicate", icon: "fa-regular fa-copy",    title: "複製", cls: "" },
  { action: "delete",    icon: "fa-solid fa-trash-can", title: "削除", cls: " icon-btn--danger" }
];

function getTimeText(task) {                                              // カードに表示する時間の文字を決める
  if (isAllDayValue(task.time)) return "一日";
  if (task.time === "未定" && task.endTime === "未定") return "未定";
  if (task.time && task.endTime) return `${task.time} 〜 ${task.endTime}`;  // 例：15:30 〜 16:30
  if (task.time) return `${task.time} 〜`;
  return "終日 / 時間未定";
}

function createTaskCardElement(task, isPast, isToday) {                   // 予定1件分のカード（<li>）を作る
  const support = SUPPORT_MARKS[normalizeStudentSupport(task.studentSupport)];
  const isEditing = task.id === editingTaskId;
  const badgeType = typeList.includes(task.type) ? task.type : "その他";  // 知らない種別なら「その他」の色にする
  const canEdit = !currentTeacher || currentTeacher === task.teacher;     // 他の先生でログイン中ならボタンを出さない
  const text = task.text ? escapeHtml(task.text).replace(/\n/g, "<br>") : "";  // 改行を <br> に変えて、画面でも改行されるようにする

  const li = document.createElement("li");
  li.className = ["task-card", `type-card-${task.type || 'その他'}`,      // カードの見た目を決めるクラスを組み立てる
    isPast ? "past-task" : "", isToday ? "task-card--today" : "", isEditing ? "editing-task" : ""
  ].filter(Boolean).join(" ");                                            // 空の文字を取り除いて、スペースでつなぐ

  // ↓ カードの中身のHTML（${ } の部分に予定のデータが入る）
  li.innerHTML = `
    <div class="task-body">
      <div class="task-tags">
        <span class="tag tag-teacher"><i class="fa-solid fa-user-tie tag-icon"></i> ${escapeHtml(task.teacher)}</span>
        <span class="tag tag-type tag-type--${badgeType}">${escapeHtml(task.type)}</span>
        ${isEditing ? `<span class="tag tag-editing"><i class="fa-solid fa-pen"></i> 編集中</span>` : ''}
        ${isToday ? `<span class="tag tag-today"><i class="fa-solid fa-clock"></i> 本日</span>` : ''}
      </div>
      <div class="task-meta">
        <span class="task-meta-item"><i class="fa-regular fa-calendar icon-accent"></i> ${escapeHtml(task.date)}</span>
        <span class="task-meta-item task-meta-item--time"><i class="fa-regular fa-clock icon-muted"></i> ${escapeHtml(getTimeText(task))}</span>
      </div>
      ${text ? `<div class="task-text">${text}</div>` : ''}
    </div>
    <div class="task-actions">
      <div class="support" title="生徒対応">
        <span class="support-label">生徒対応</span>
        <span class="support-mark ${support.cls}">${support.mark}</span>
      </div>
      ${canEdit ? ACTION_BUTTONS.map(b => `
        <button onclick="tryTaskAction('${b.action}', '${task.id}')" title="${b.title}" class="icon-btn${b.cls}"><i class="${b.icon}"></i></button>`).join("") : ''}
    </div>`;
  return li;
}


// ---------- 12. 安全対策 ----------
function escapeHtml(str) {                                                // 入力された文字をそのままHTMLに入れると危険なので、記号を無害な形に変える
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")                                               // & → &amp;
    .replace(/</g, "&lt;")                                                // < → &lt;（タグとして動かないように）
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
