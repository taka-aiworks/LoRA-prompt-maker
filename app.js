/* =========================
   LoRA Prompt Maker – app.js
   （分割版 / 軽量化込み）
   ========================= */

/* ========= ユーティリティ & 状態 ========= */
const $  = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));

const toast = (msg) => {
  const t = $("#toast");
  if (!t) { console.log(msg); return; }
  t.textContent = msg;
  t.hidden = false;
  setTimeout(() => (t.hidden = true), 1500);
};

function dl(filename, text) {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 500);
}
const uniq = (a) => [...new Set(a.filter(Boolean))];
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
function nowStamp() {
  const d = new Date(), z = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${z(d.getMonth() + 1)}${z(d.getDate())}_${z(d.getHours())}${z(d.getMinutes())}`;
}
function seedFromName(nm, extra = 0) {
  if (!nm) return Math.floor(Math.random() * 1e9);
  let h = 2166136261 >>> 0;
  for (let i = 0; i < nm.length; i++) { h ^= nm.charCodeAt(i); h = (h >>> 0) * 16777619 >>> 0; }
  if (extra) h = (h + (extra * 2654435761 >>> 0)) >>> 0;
  return h >>> 0;
}

// --- BF系（age/gender/…）の取得：ラジオ優先＋datasetフォールバック
function getBFValue(name){
  // name: "age" | "gender" | "body" | "height" | "person" | "world" | "tone"
  const sel = document.querySelector(`input[name="bf_${name}"]:checked`);
  if (sel && sel.value) return sel.value;

  // UIが無い/未レンダ時は dataset を見る（applyCharacterPreset が書き込む）
  const host = document.body || document.documentElement;
  const key  = `bf${name[0].toUpperCase()}${name.slice(1)}`; // bfAge, bfGender, ...
  return (host?.dataset?.[key] || "").trim();
}

// --- 学習モード専用: 性別から 1girl / 1boy を決める ---
function getGenderCountTag() {
  const g = document.querySelector('input[name="bf_gender"]:checked')?.value?.toLowerCase() || "";
  if (!g) return ""; // 未選択なら何もしない
  // 候補語にゆるくマッチ
  if (/\b(female|girl|woman|feminine|女子|女性)\b/.test(g)) return "1girl";
  if (/\b(male|boy|man|masculine|男子|男性)\b/.test(g))     return "1boy";
  return ""; // 中立系（androgynous 等）は solo のみで制御
}

// --- 学習モード専用: 複数人を抑止するネガティブを付足 ---
function withSoloNegatives(negText) {
  const add = [
    "2girls", "2boys", "two people", "multiple people", "group",
    "crowd", "duo", "trio"
  ];
  const base = (negText || "").split(",").map(s=>s.trim()).filter(Boolean);
  return uniq([...base, ...add]).join(", ");
}

/* === ソロ強制ガード（複数人対策） ======================= */
const SOLO_POS = ["solo"]; // 1人明示
const SOLO_NEG = [
  "multiple people",   // 複数人
  "group",             // グループ・集合
  "crowd",             // 群衆
  "background people", // 背景にいる人
  "text on clothes"    // シャツに余計な文字が含まれないようにする
];

// 背景が人混みに寄りやすいタグ → “無人化”の弱い補正を足す
const MULTI_RISK_BG = new Set([
  "festival stalls","shrine festival","street at night","classroom",
  "train platform","beach","rooftop","library","caf\u00e9","snowy town",
]);

function forceSoloPos(parts){
  // ソロ系の明示タグを必ず入れる
  const s = new Set(parts.filter(Boolean));
  SOLO_POS.forEach(t => s.add(t));
  // 背景が “人を呼ぶ” ときは「no crowd/empty background」を添える
  for (const t of parts) {
    if (MULTI_RISK_BG.has(String(t))) {
      s.add("no crowd");
      s.add("empty background");
      break;
    }
  }
  return [...s];
}

// ネガに複数人ブロックを必ず混ぜる
function withSoloNeg(neg){
  const base = (neg || "").split(",").map(s=>s.trim()).filter(Boolean);
  const merged = new Set([...base, ...SOLO_NEG]);
  return [...merged].join(", ");
}

// 複数人を示唆しがちな語を“念のため”落とす（プロンプト側）
const MULTI_HINT_RE = /\b(duo|trio|group|crowd|pair|couple|twins?|roommates|bandmates|classmates|teammates|mentor and pupil|master and servant|idol and fan|two people|three people|multiple people)\b/i;
function stripMultiHints(parts){
  return parts.filter(t => !MULTI_HINT_RE.test(String(t)));
}


/* ========= 設定（LocalStorage） ========= */
const LS_KEY = "LPM_SETTINGS_V1";
const Settings = { gasUrl: "", gasToken: "" };

function loadSettings() {
  try {
    const j = JSON.parse(localStorage.getItem(LS_KEY) || "{}");
    Object.assign(Settings, j || {});
  } catch {}
  $("#set_gasUrl") && ($("#set_gasUrl").value   = Settings.gasUrl || "");
  $("#set_gasToken") && ($("#set_gasToken").value = Settings.gasToken || "");
}
function saveSettings() {
  Settings.gasUrl   = ($("#set_gasUrl")?.value || "").trim();
  Settings.gasToken = ($("#set_gasToken")?.value || "").trim();
  localStorage.setItem(LS_KEY, JSON.stringify(Settings));
}
function resetSettings() {
  Object.keys(localStorage).forEach(k => { if (/^LPM_/.test(k) || k === LS_KEY) localStorage.removeItem(k); });
  $("#gasTestResult") && ($("#gasTestResult").textContent = "初期化しました");
}

/* ========= 内蔵辞書（空で開始） ========= */
const EMBED_SFW = { hair_style:[], eyes:[], outfit:[], face:[], skin_body:[], art_style:[], background:[], pose_composition:[], expressions:[], accessories:[], lighting:[], age:[], gender:[], body_type:[], height:[], personality:[], worldview:[], speech_tone:[] };
const EMBED_NSFW = { categories:{ expression:[], exposure:[], situation:[], lighting:[] } };

let SFW  = JSON.parse(JSON.stringify(EMBED_SFW));
let NSFW = normNSFW(EMBED_NSFW);

/* ========= 正規化 ========= */
function normItem(x) {
  if (typeof x === "string") return { tag: x, label: x, level: "L1" };
  if (!x || typeof x !== "object") return null;
  const tag   = x.tag || x.en || x.keyword || x.value || x.name || "";
  const ja    = x.ja || x.jp || x["name_ja"] || x["label_ja"] || x.desc || x.label;
  const label = (ja && String(ja).trim()) ? String(ja).trim() : (tag || "");
  const level = (x.level || "L1").toUpperCase();
  return tag ? { tag, label, level } : null;
}
function normList(arr){ return (arr || []).map(normItem).filter(Boolean); }

const KEYMAP = {
  "髪型":"hair_style","目の形":"eyes","服":"outfit","顔の特徴":"face","体型":"skin_body",
  "画風":"art_style","背景":"background","ポーズ":"pose_composition","ポーズ・構図":"pose_composition",
  "表情":"expressions","アクセサリー":"accessories","ライティング":"lighting","年齢":"age","性別":"gender",
  "体型(基本)":"body_type",   // 好きな日本語キーに合わせて
  "身長":"height",
  "性格":"personality",
  "世界観":"worldview",
  "口調":"speech_tone"
};

// === outfit をカテゴリ分配 ===
function categorizeOutfit(list){
  const L = normList(list||[]);
  const has = (t, re) => re.test(t.tag);
  const top = L.filter(t => /\b(t-?shirt|shirt|blouse|hoodie|sweater|cardigan|jacket|coat|trench\ coat|tank\ top|camisole|turtleneck|off-shoulder\ top|crop\ top|sweatshirt|blazer|puffer\ jacket|parka|windbreaker|raincoat)\b/i.test(t.tag));
  const pants = L.filter(t=> has(t, /\b(jeans|pants|trousers|shorts|cargo pants|leggings|overalls|bermuda shorts)\b/i));
  const skirt = L.filter(t=> has(t, /\b(skirt|pleated skirt|long skirt|hakama)\b/i));
  const dress = L.filter(t => /\b(dress|one[-\s]?piece|sundress|gown|kimono(?:\s+dress)?|yukata|cheongsam|qipao|hanbok|sari|lolita dress|kimono dress|swimsuit|bikini|leotard|(?:school|sailor|blazer|nurse|maid|waitress)\s+uniform|maid\s+outfit|nurse\s+uniform|tracksuit|sportswear|jersey|robe|poncho|cape|witch\s+outfit|idol\s+costume|stage\s+costume)\b/i.test(t.tag));
  const shoes = L.filter(t => /\b(shoes|boots|heels|sandals|sneakers|loafers|mary\ janes|geta|zori|thigh-high\ socks|knee-high\ socks)\b/i.test(t.tag));
   return { top, pants, skirt, dress, shoes }; // ← 追加
}

function normNSFW(ns) {
  // --- 新: nsfw_tags 形式を吸収 ---
  if (ns?.nsfw_tags) {
    const m = ns.nsfw_tags;
    const pack = (arr, lv) => (arr || []).map(t => ({ tag: String(t), label: String(t), level: lv }));
    // とりあえず “カテゴリー未分割” のフラットなタグなので、situation に寄せる（UI で使えるようになる）
    const situation = [
      ...pack(m.R15,  "L1"),
      ...pack(m.R18,  "L2"),
      ...pack(m.R18G, "L3"),
    ];
    // ライティング/表情/露出は空のまま
    return {
      expression: [],
      exposure:   [],
      situation,
      lighting:   [],
      // ここでは NEGATIVE_* は触らない（必要なら getNeg に統合する）
    };
  }

  // --- 従来: categories or 直接キー形式 ---
  const src = (ns && ns.categories) ? ns.categories : (ns || {});
  const JP2EN = { "表情":"expression", "露出":"exposure", "シチュ":"situation", "ライティング":"lighting" };
  const keys = ["expression","exposure","situation","lighting"];
  const out = {};
  keys.forEach(k=>{
    const jpKey = Object.keys(JP2EN).find(j=>JP2EN[j]===k);
    out[k] = normList(src[k] || (jpKey ? src[jpKey] : []) || []);
  });
  return out;
}
/* ========= 追記マージ ========= */
function dedupeByTag(list) {
  const seen = new Set(); const out=[];
  for (const it of normList(list)) { if (seen.has(it.tag)) continue; seen.add(it.tag); out.push(it); }
  return out;
}
function mergeIntoSFW(json) {
  const src = json?.SFW || json || {};
  const next = { ...SFW };
  for (const [k,v] of Object.entries(src||{})) {
    const key = KEYMAP[k] || k;
    if (next[key] === undefined) continue;
    next[key] = dedupeByTag([...(next[key] || []), ...normList(v)]);
  }
  SFW = next;
}
function mergeIntoNSFW(json) {
  const src = json?.NSFW ? normNSFW(json.NSFW) : normNSFW(json);
  NSFW = {
    expression: dedupeByTag([...(NSFW.expression||[]), ...src.expression]),
    exposure:   dedupeByTag([...(NSFW.exposure||[]),   ...src.exposure]),
    situation:  dedupeByTag([...(NSFW.situation||[]),  ...src.situation]),
    lighting:   dedupeByTag([...(NSFW.lighting||[]),   ...src.lighting]),
  };
}
let __bottomCat = "pants"; // 既定はパンツ
// ▼ 下カテゴリ（パンツ/スカート）切替：fieldset だけで制御
function bindBottomCategoryRadios(){
  const rPants = document.getElementById('bottomCat_pants');
  const rSkirt = document.getElementById('bottomCat_skirt');
  const fsP = document.getElementById('fsBottom_pants');
  const fsS = document.getElementById('fsBottom_skirt');

  const swap = () => {
    const isSkirt = !!rSkirt?.checked;

    // 見た目は fieldset 自身だけグレーアウト（親パネルは触らない）
    fsP?.classList.toggle('is-disabled',  isSkirt);
    fsS?.classList.toggle('is-disabled', !isSkirt);

    // 実際の入力停止も fieldset だけ
    if (fsP) fsP.disabled = isSkirt;
    if (fsS) fsS.disabled = !isSkirt;

// 直近カテゴリを記録（関数スコープ変数 & 参照用に window にも）
     __bottomCat = isSkirt ? 'skirt' : 'pants';
     window.__bottomCat = __bottomCat;
  };

  rPants?.addEventListener('change', swap);
  rSkirt?.addEventListener('change', swap);

  // 他からも再適用できるように公開
  window.__applyBottomCatSwap = swap;

  swap(); // 初期反映（パンツ既定→スカート側を無効）
}

// ===== 1枚テスト: 必須チェック =====
function listMissingForOneTest() {
  const miss = [];

  // 名前（seed固定用）
  const name = ($("#charName")?.value || "").trim();
  if (!name) miss.push("キャラ名");

  // 色タグ（髪・瞳・肌）
  const hairTag = ($("#tagH")?.textContent || "").trim();
  const eyeTag  = ($("#tagE")?.textContent || "").trim();
  const skinTag = ($("#tagSkin")?.textContent || "").trim();
  if (!hairTag) miss.push("髪色");
  if (!eyeTag)  miss.push("瞳色");
  if (!skinTag) miss.push("肌トーン");

  // 形状1択（髪型・目の形）
  if (!getOne("hairStyle")) miss.push("髪型");
  if (!getOne("eyeShape"))  miss.push("目の形");

  // 推奨（任意に変更）
  if (!getOne("skinBody"))  miss.push("体型（任意）");
  if (!getOne("face"))      miss.push("顔の特徴（任意）");
  if (!getOne("artStyle"))  miss.push("画風（任意）");

  // 服は“任意”にする（未選択ならプロンプトに入らないだけ）
  // const sel = getBasicSelectedOutfit(); ← 必須チェックを削除
  // ★ 背景/ポーズ/表情は“必須にしない”のでチェック削除

  return miss.filter(x => !/（任意）$/.test(x)); // 任意は不足扱いにしない
}

function isBasicReadyForOneTest(){ return listMissingForOneTest().length === 0; }

function updateOneTestReady(){
  const btn = $("#btnOneLearn");
  if (!btn) return;
  const miss = listMissingForOneTest();
  const ok = miss.length === 0;
  btn.disabled = !ok;
  btn.classList.toggle("disabled", !ok);
  btn.title = ok ? "" : ("不足: " + miss.join(" / "));
}

// ===== 1枚テスト: 生成 & 描画 =====
let __lastOneTestRows = []; // フォーマット切替再描画用

function runOneTest() {
  const lack = listMissingForOneTest();
  if (lack.length) { toast("1枚テスト 未入力: " + lack.join(" / ")); return; }

  const one = buildOneLearning(); // 既存（BG/PO/EXが無いとerrorを返す）
  if (one?.error) { toast(one.error); return; }

  // 既存レンダラを使って、1枚テスト用テーブル/テキストへ
  __lastOneTestRows = [one];
  renderLearnTableTo("#tblLearnTest tbody", __lastOneTestRows);
  // #fmtLearn の選択に従ってテキスト化（第3引数はセレクトID）
  renderLearnTextTo("#outLearnTest", __lastOneTestRows, "fmtLearn");
}

function copyOneTestText(){
  const el = $("#outLearnTest");
  if (!el) return;
  const txt = el.textContent || "";
  if (!txt) { toast("コピーするテキストがありません"); return; }
  navigator.clipboard.writeText(txt).then(()=> toast("コピーしました"));
}

// 固定で常に入れたいネガティブ（必要になったらここに増やす）
const DEFAULT_NEG = "extra fingers, blurry, lowres, bad anatomy, bad hands, bad feet, text, watermark";

// チェックボックスのON/OFFを読む（要素が無ければtrue扱い＝互換）
function isDefaultNegOn() {
  const el = document.getElementById("useDefaultNeg");
  return el ? !!el.checked : true;
}

/* ========= カラーユーティリティ ========= */
function hslToRgb(h,s,l){
  s/=100; l/=100;
  const c=(1-Math.abs(2*l-1))*s, x=c*(1-Math.abs((h/60)%2-1)), m=l-c/2;
  let r=0,g=0,b=0;
  if(h<60){[r,g,b]=[c,x,0]} else if(h<120){[r,g,b]=[x,c,0]} else if(h<180){[r,g,b]=[0,c,x]}
  else if(h<240){[r,g,b]=[0,x,c]} else if(h<300){[r,g,b]=[x,0,c]} else {[r,g,b]=[c,0,x]}
  return [(r+m)*255,(g+m)*255,(b+m)*255].map(v=>Math.round(v));
}
function labToXyz(L,a,b){ const Yn=1,Xn=0.95047, Zn=1.08883;
  const fy=(L+16)/116, fx=a/500+fy, fz=fy-b/200;
  const f=t=> t**3>0.008856 ? t**3 : (t-16/116)/7.787;
  return [Xn*f(fx), Yn*f(fy), Zn*f(fz)];
}
function xyzToRgb(X,Y,Z){
  let [R,G,B]=[ 3.2406*X -1.5372*Y -0.4986*Z, -0.9689*X +1.8758*Y +0.0415*Z, 0.0557*X -0.2040*Y +1.0570*Z];
  const g=t=> t<=0.0031308? 12.92*t : 1.055*t**(1/2.4)-0.055;
  return [R,G,B].map(v=>Math.round(Math.min(1,Math.max(0,g(v)))*255));
}
function hexFromLab(L,a,b){ const [X,Y,Z]=labToXyz(L,a,b); const [r,g,b2]=xyzToRgb(X,Y,Z);
  return `#${[r,g,b2].map(v=>v.toString(16).padStart(2,"0")).join("")}`;
}
const SKIN_LAB = [
  //    L,  a,  b   ← 明るい……→暗い（最後はかなりディープ）
  [96,  0,  6],   // porcelain
  [88,  4, 10],   // very fair
  [78,  8, 16],   // fair-light
  [66, 13, 20],   // medium
  [56, 15, 22],   // tan
  [46, 14, 20],   // brown
  [34, 12, 18],   // dark brown
  [20, 10, 16],   // very dark / deep
  [14,  8, 12],   // near-ebony（ほぼ黒に近い深いトーン）
];
const SKIN_GAMMA_DARK = 1.25; // 数字↑で暗側を強調（1.15～1.35あたりが使いやすい）

function toneToHex(v){
  // v: 0..100（UIのスライダ値）
  const raw = Math.max(0, Math.min(100, v)) / 100;
  const t   = Math.pow(raw, SKIN_GAMMA_DARK);   // 暗い側にグッと寄せる
  const seg = t * (SKIN_LAB.length - 1);
  const i = Math.min(SKIN_LAB.length - 2, Math.floor(seg));
  const k = seg - i;

  const L = SKIN_LAB[i][0] * (1-k) + SKIN_LAB[i+1][0] * k;
  const A = SKIN_LAB[i][1] * (1-k) + SKIN_LAB[i+1][1] * k;
  const B = SKIN_LAB[i][2] * (1-k) + SKIN_LAB[i+1][2] * k;
  return hexFromLab(L, A, B);
}
function toneToTag(v){
  if (v <= 10) return "porcelain skin";
  if (v <= 25) return "very fair skin";
  if (v <= 40) return "light skin";
  if (v <= 55) return "medium skin";
  if (v <= 70) return "tan skin";
  if (v <= 85) return "brown skin";
  if (v <= 95) return "dark brown skin";
  return "deep / ebony skin";
}

// === 色名ユーティリティ（アクセ & 髪/瞳で共用可） ===
function colorNameFromHSL(h, s, l) {
  if (l < 12) return "black";
  if (l > 92 && s < 20) return "white";
  if (s < 10) {
    if (l < 30) return "dark gray";
    if (l > 70) return "light gray";
    return "gray";
  }
  const table = [
    { h:   0, name: "red" },
    { h:  12, name: "crimson" },
    { h:  22, name: "vermilion" },
    { h:  32, name: "orange" },
    { h:  45, name: "gold" },
    { h:  60, name: "yellow" },
    { h:  75, name: "lime" },
    { h:  90, name: "green" },
    { h: 110, name: "emerald" },
    { h: 150, name: "teal" },
    { h: 180, name: "cyan" },
    { h: 200, name: "aqua" },
    { h: 210, name: "sky blue" },
    { h: 225, name: "azure" },
    { h: 240, name: "blue" },
    { h: 255, name: "indigo" },
    { h: 270, name: "violet" },
    { h: 285, name: "purple" },
    { h: 300, name: "magenta" },
    { h: 320, name: "fuchsia" },
    { h: 335, name: "rose" },
    { h: 350, name: "pink" },
    { h: 360, name: "red" }
  ];
  let base = table[0].name, min = 360;
  for (const t of table) {
    let d = Math.abs(h - t.h); if (d > 180) d = 360 - d;
    if (d < min) { min = d; base = t.name; }
  }
  let prefix = "";
  if (s >= 70 && l <= 40) prefix = "deep";
  else if (s >= 70 && l >= 70) prefix = "bright";
  else if (l >= 85 && s >= 20 && s <= 60) prefix = "pastel";
  else if (s <= 35) prefix = "muted";
  else if (l <= 30) prefix = "dark";
  else if (l >= 80) prefix = "light";
  return prefix ? `${prefix} ${base}` : base;
}

/* ========= 服色ユーティリティ（学習） ========= */
function getWearColorTag(idBase){
  // idBase: "top" | "bottom" | "shoes"
  let use = document.getElementById("use_"+idBase);
  /*if (idBase === "bottom") {
    use = document.getElementById("useBottomColor") || document.getElementById("use_bottom");
  }
  */
  if (idBase === "bottom") use = document.getElementById("useBottomColor");

   
  if (use && !use.checked) return "";

  const t = document.getElementById("tag_"+idBase);
  if (!t) return "";
  const txt = (t.textContent || "").trim();
  return (txt && txt !== "—") ? txt : "";
}

// 追加：部位の有効/無効を見た目＆入力に反映
function updateWearPanelEnabled(idBase){
   const panel = (idBase === "bottom")
     ? document.getElementById("panel_bottom")
     : document.getElementById("panel_"+idBase);
   const use   = (idBase === "bottom")
     ? document.getElementById("useBottomColor")
    : document.getElementById("use_"+idBase);


  const disabled = !!(use && !use.checked);

  if (panel) panel.classList.toggle("is-disabled", disabled);

  // スライダは操作不可に
  const sat = document.getElementById("sat_"+idBase);
  const lit = document.getElementById("lit_"+idBase);
  if (sat) sat.disabled = disabled;
  if (lit) lit.disabled = disabled;

  // 末尾付近に追記（disabledでもpointerは戻す）
   const cb = (idBase === "bottom")
     ? document.getElementById("useBottomColor")
     : document.getElementById("use_" + idBase);
  if (cb) {
    cb.disabled = false; // 常に再チェックできる
}
}


// 追加：チェックボックスのバインド
function bindWearToggles(){
  // 既存：チェックボックス → パネル有効/無効
  ["top","bottom","shoes"].forEach(idBase=>{
     const cb = (idBase === "bottom")
     ? document.getElementById("useBottomColor")
     : document.getElementById("use_"+idBase);

    if (!cb) return;
    cb.addEventListener("change", ()=> updateWearPanelEnabled(idBase));
    updateWearPanelEnabled(idBase);
  });

// outfitモードに応じて、ワンピ/上下のUIと「下カラー」チェックを同期させる
const syncBottomForOutfit = ()=>{
  const mode = document.querySelector('input[name="outfitMode"]:checked')?.value || "separate";

  const fsDress = document.getElementById('fsDress');
  const topPanel    = document.getElementById('outfit_top')?.closest('.panel');
  const bottomPanel = document.getElementById('bottomCategoryRadios')?.closest('.panel');

  // 入力を一括で止める/戻すヘルパ（※ 使うのは onepiece の時だけ）
  const setInputsDisabled = (root, on) => {
    if (!root) return;
    root.querySelectorAll('input, select, button').forEach(el => { el.disabled = !!on; });
    root.classList.toggle('is-disabled', !!on);
  };

  if (mode === "onepiece") {
    if (fsDress) fsDress.disabled = false;   // ワンピ選択可
    setInputsDisabled(topPanel,    true);    // 上下は触れない
    setInputsDisabled(bottomPanel, true);    // 下カテゴリも触れない

    // 下カラーを自動OFF
    const cb = document.getElementById("useBottomColor");
    if (cb) { cb.checked = false; updateWearPanelEnabled("bottom"); }

  } else {
    // separate：
    if (fsDress) fsDress.disabled = true;    // ワンピを無効化
    // 見た目だけ有効化（内部の input は触らない：fieldset の有効/無効は swap に任せる）
    topPanel?.classList.remove('is-disabled');
    bottomPanel?.classList.remove('is-disabled');

    // カテゴリラジオは必ず押せるように
    const rP = document.getElementById('bottomCat_pants');
    const rS = document.getElementById('bottomCat_skirt');
    if (rP) rP.disabled = false;
    if (rS) rS.disabled = false;

    // 現在の選択に従って fieldset の enable/disable を再適用
    if (typeof window.__applyBottomCatSwap === 'function') window.__applyBottomCatSwap();

    // どちらかの“下”が選ばれてたら、下カラーを自動ON（既存ロジック）
    const cb = document.getElementById("useBottomColor");
    const pantsSel = document.querySelector('input[name="outfit_pants"]:checked');
    const skirtSel = document.querySelector('input[name="outfit_skirt"]:checked');
    if (cb && (pantsSel || skirtSel) && !cb.checked) {
      cb.checked = true;
      updateWearPanelEnabled("bottom");
    }
  }
};
// 既存のバインドでOK（差し替え後もこのまま使う）
$$('input[name="outfitMode"]').forEach(el=> el.addEventListener("change", syncBottomForOutfit));


  // ★ パンツ/スカート選択に連動してボトム色を自動ON
  const autoEnableBottomColor = ()=>{
    const mode = document.querySelector('input[name="outfitMode"]:checked')?.value || "separate";
    if (mode !== "separate") return;
    const cb = document.getElementById("useBottomColor");
    if (cb && !cb.checked) {
      cb.checked = true;
      updateWearPanelEnabled("bottom");
    }
  };
  // ラップ要素でも、内側のラジオでも OK なように両方へバインド
  $$('input[name="outfit_pants"]').forEach(r=> r.addEventListener("change", autoEnableBottomColor));
  $$('input[name="outfit_skirt"]').forEach(r=> r.addEventListener("change", autoEnableBottomColor));

  // 初期同期
  syncBottomForOutfit();
}

 function isOnePieceOutfitTag(tag){
   return /\b(dress|one[-\s]?piece|sundress|gown|kimono(?:\s+dress)?|yukata|cheongsam|qipao|lolita\s+dress)\b/i
     .test(tag || "");
 }

function getLearningWearColorParts(sel){
  // sel: {mode, top, bottom, dress}
  const parts = [];
  const top   = getWearColorTag("top");
  const bottom= getWearColorTag("bottom");
  const shoes = getWearColorTag("shoes");

   if (sel.mode === "onepiece") {
     if (sel.dress && top) {
      // そのまま実体タグに色を被せる → "orange sailor uniform" など
      parts.push(`${top} ${sel.dress}`);
    }
  } else {
    if (sel.top && top)       parts.push(`${top} top`);
    if (sel.bottom && bottom) parts.push(`${bottom} bottom`);
  }
  if (shoes) parts.push(`${shoes} shoes`);
  return parts;
}

/* ========= 服色ユーティリティ（量産） ========= */
const COLOR_RATE = 0.5;
function maybeColorizeOutfit(tag){
  if (!tag) return tag;
  const base = (typeof getOutfitBaseColor === "function" ? getOutfitBaseColor() : "").trim();
  if (base && base !== "—") return `${base} ${tag}`;
  if (Math.random() >= COLOR_RATE) return tag;
  const c = randomOutfitColorName();
  return `${c} ${tag}`;
}
function randomInt(a,b){ return Math.floor(Math.random()*(b-a+1))+a; }
function randomOutfitColorName(){
  const h = randomInt(0,359);
  const s = randomInt(60,90);
  const l = randomInt(35,65);
  return colorNameFromHSL(h,s,l);
}

/* 角度ドラッグ共通 */
function addHueDrag(wheelEl, thumbEl, onHueChange){
  if(!wheelEl || !thumbEl) return;
  const getCenter = () => {
    const r = wheelEl.getBoundingClientRect();
    return { cx: r.left + r.width/2, cy: r.top + r.height/2, rOuter: r.width/2 - 7 };
  };
  const setThumb = (hue) => {
    const { rOuter } = getCenter();
    const rad = (hue - 90) * Math.PI / 180;
    thumbEl.style.left = (wheelEl.clientWidth/2 + rOuter*Math.cos(rad) - 7) + "px";
    thumbEl.style.top  = (wheelEl.clientHeight/2 + rOuter*Math.sin(rad) - 7) + "px";
  };
  let dragging = false;
  const updateFromEvent = (e) => {
    const { cx, cy } = getCenter();
    const x = (e.clientX ?? (e.touches && e.touches[0]?.clientX)) - cx;
    const y = (e.clientY ?? (e.touches && e.touches[0]?.clientY)) - cy;
    const ang = Math.atan2(y, x);
    const hue = (ang * 180 / Math.PI + 360 + 90) % 360;
    setThumb(hue);
    onHueChange(hue);
  };
  const onDown = (e) => {
    e.preventDefault();
    dragging = true;
    updateFromEvent(e);
  };
  const onMove = (e) => { if (dragging) updateFromEvent(e); };
  const onUp   = () => { dragging = false; };
  wheelEl.addEventListener("pointerdown", onDown);
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup",   onUp);
  const ro = new ResizeObserver(()=> {
    const h = (onHueChange.__lastHue != null) ? onHueChange.__lastHue : 0;
    setThumb(h)
  });
  ro.observe(wheelEl);
  return setThumb;
}

/* ======= 色ホイール（髪/瞳） ======= */
function initWheel(wId,tId,sId,lId,swId,tagId,baseTag){
  const wheel=$(wId), thumb=$(tId), sat=$(sId), lit=$(lId), sw=$(swId), tagEl=$(tagId);

  // 追加: どれか欠けてたら安全に抜ける
  if (!wheel || !thumb || !sat || !lit || !sw || !tagEl) {
    return () => (document.querySelector(tagId)?.textContent || "").trim();
  }
   
  let hue = 35;
  function paint(){
    const s = +sat.value, l = +lit.value;
    const [r,g,b] = hslToRgb(hue, s, l);
    sw.style.background = `#${[r,g,b].map(v=>v.toString(16).padStart(2,"0")).join("")}`;
    const cname = colorNameFromHSL(hue, s, l);
    tagEl.textContent = `${cname} ${baseTag}`;
  }
  const onHue = (h)=>{ hue = h; onHue.__lastHue = h; paint(); };
  onHue.__lastHue = hue;
  addHueDrag(wheel, thumb, onHue);
  sat.addEventListener("input", paint);
  lit.addEventListener("input", paint);
  requestAnimationFrame(()=>{
    paint();
    const rect = wheel.getBoundingClientRect();
    const r = rect.width/2 - 7;
    const rad = (hue - 90) * Math.PI/180;
    thumb.style.left = (rect.width/2  + r*Math.cos(rad) - 7) + "px";
    thumb.style.top  = (rect.height/2 + r*Math.sin(rad) - 7) + "px";
  });
  return ()=> (($(tagId).textContent) || "").trim();
}

/*
  // --- SLスクエア（DOMを動的追加） ---
  // wheel の直後に 200x140 のキャンバスとサムを生成
  const slWrap = document.createElement("div");
  slWrap.style.position = "relative";
  slWrap.style.width = "200px"; slWrap.style.height = "140px";
  slWrap.style.marginTop = "8px";
  const slCanvas = document.createElement("canvas");
  slCanvas.width = 200; slCanvas.height = 140;
  slCanvas.style.width="200px"; slCanvas.style.height="140px";
  slCanvas.style.borderRadius="8px";
  slCanvas.style.cursor="crosshair";
  const slThumb = document.createElement("div");
  Object.assign(slThumb.style, {
    position:"absolute", width:"10px", height:"10px", border:"2px solid #fff",
    borderRadius:"50%", boxShadow:"0 0 0 1px #0006", transform:"translate(-50%,-50%)",
    pointerEvents:"none"
  });
  slWrap.appendChild(slCanvas); slWrap.appendChild(slThumb);
  wheel.parentElement.insertBefore(slWrap, wheel.nextSibling);

  // --- 状態 ---
  let H = defaultHue, S = defaultS, L = defaultL;

  // --- 共通描画 ---
  function paintPreviewAndLabel(){
    const [r,g,b] = hslToRgb(H, S, L);
    sw.style.background = `rgb(${r},${g},${b})`;
    tagEl.textContent = `${colorNameFromHSL(H, S, L)} ${baseTag}`;
  }

  // --- SLスクエアの塗り（Hue変更時に更新） ---
  function paintSL(){
    const ctx = slCanvas.getContext("2d");
    // 横: saturation 0→100
    const gS = ctx.createLinearGradient(0, 0, slCanvas.width, 0);
    gS.addColorStop(0, `hsl(${H} 0% 50%)`);
    gS.addColorStop(1, `hsl(${H} 100% 50%)`);
    ctx.fillStyle = gS; ctx.fillRect(0, 0, slCanvas.width, slCanvas.height);

    // 縦: lightness 100→0（白→透明→黒）を重ねる
    const gL = ctx.createLinearGradient(0, 0, 0, slCanvas.height);
    gL.addColorStop(0, "rgba(255,255,255,1)");
    gL.addColorStop(0.5, "rgba(255,255,255,0)");
    gL.addColorStop(0.5, "rgba(0,0,0,0)");
    gL.addColorStop(1, "rgba(0,0,0,1)");
    ctx.fillStyle = gL; ctx.fillRect(0, 0, slCanvas.width, slCanvas.height);
  }

  function moveSLThumb(){
    const x = (S/100) * slCanvas.width;
    const y = (1 - L/100) * slCanvas.height;
    slThumb.style.left = `${x}px`;
    slThumb.style.top  = `${y}px`;
  }

  // --- Hueリング（既存のドラッグを流用） ---
  const onHue = (h)=>{
    H = h; onHue.__lastHue = h;
    paintSL(); paintPreviewAndLabel();
  };
  onHue.__lastHue = H;
  addHueDrag(wheel, thumb, onHue);

  // --- SLドラッグ ---
  let dragging = false;
  const pickSL = (clientX, clientY)=>{
    const r = slCanvas.getBoundingClientRect();
    let x = Math.max(0, Math.min(r.width,  clientX - r.left));
    let y = Math.max(0, Math.min(r.height, clientY - r.top));
    S = Math.round((x / r.width) * 100);
    L = Math.round((1 - y / r.height) * 100);
    moveSLThumb(); paintPreviewAndLabel();
  };
  slCanvas.addEventListener("pointerdown", (e)=>{ dragging = true; slCanvas.setPointerCapture(e.pointerId); pickSL(e.clientX, e.clientY); });
  slCanvas.addEventListener("pointermove", (e)=>{ if (dragging) pickSL(e.clientX, e.clientY); });
  slCanvas.addEventListener("pointerup",   ()=>{ dragging = false; });

  // --- 初期描画（リングのつまみ位置も） ---
  requestAnimationFrame(()=>{
    paintSL(); moveSLThumb(); paintPreviewAndLabel();
    const rect = wheel.getBoundingClientRect();
    const rOuter = rect.width/2 - 7;
    const rad = (H - 90) * Math.PI/180;
    thumb.style.left = (rect.width/2  + rOuter*Math.cos(rad) - 7) + "px";
    thumb.style.top  = (rect.height/2 + rOuter*Math.sin(rad) - 7) + "px";
  });

  // 取得用：タグ文字列（例: "deep blue hair"）
  return ()=> tagEl.textContent;
}
*/

/* ======= 色ホイール（アクセ） ======= */
function initColorWheel(idBase, defaultHue=0, defaultS=80, defaultL=50){
  const wheel = document.getElementById("wheel_"+idBase);
  const thumb = document.getElementById("thumb_"+idBase);
  const sat   = document.getElementById("sat_"+idBase);
  const lit   = document.getElementById("lit_"+idBase);
  const sw    = document.getElementById("sw_"+idBase);
  const tag   = document.getElementById("tag_"+idBase);
  if (!wheel || !thumb || !sat || !lit || !sw || !tag) {
    return () => (document.getElementById("tag_"+idBase)?.textContent || "").trim();
  }
  let hue = defaultHue; sat.value = defaultS; lit.value = defaultL;
  function paint(){
    const s=+sat.value, l=+lit.value;
    const [r,g,b]=hslToRgb(hue,s,l);
    sw.style.background = `rgb(${r},${g},${b})`;
    tag.textContent = colorNameFromHSL(hue,s,l);
  }
  const onHue = (h)=>{ hue = h; onHue.__lastHue = h; paint(); };
  onHue.__lastHue = hue;
  addHueDrag(wheel, thumb, onHue);
  sat.addEventListener("input", paint);
  lit.addEventListener("input", paint);
  requestAnimationFrame(()=>{
    paint();
    const rect = wheel.getBoundingClientRect();
    const r = rect.width/2 - 7;
    const rad = (hue - 90) * Math.PI/180;
    thumb.style.left = (rect.width/2  + r*Math.cos(rad) - 7) + "px";
    thumb.style.top  = (rect.height/2 + r*Math.sin(rad) - 7) + "px";
  });
  return ()=> tag.textContent.trim();
}

/* ========= UI生成 ========= */
function radioList(el, list, name){
   if (!el) return;
   const items = normList(list);
   el.innerHTML = items.map((it,i)=>{
    const showMini = it.tag && it.label && it.tag !== it.label;
    return `<label class="chip"><input type="radio" name="${name}" value="${it.tag}" ${i===0?"checked":""}> ${it.label}${showMini?`<span class="mini"> ${it.tag}</span>`:""}</label>`;
  }).join("");
}
function checkList(el, list, name){
   if (!el) return;
   const items = normList(list);
   el.innerHTML = items.map(it=>{
    const showMini = it.tag && it.label && it.tag !== it.label;
    return `<label class="chip"><input type="checkbox" name="${name}" value="${it.tag}"> ${it.label}${showMini?`<span class="mini"> ${it.tag}</span>`:""}</label>`;
  }).join("");
}
const getOne  = (name) => document.querySelector(`input[name="${name}"]:checked`)?.value || "";
const getMany = (name) => $$(`input[name="${name}"]:checked`).map(x=>x.value);

function renderSFW(){
  // 基本（従来）
  radioList($("#hairStyle"),   SFW.hair_style,      "hairStyle");
  radioList($("#eyeShape"),    SFW.eyes,            "eyeShape");
  radioList($("#face"),        SFW.face,            "face");
  radioList($("#skinBody"),    SFW.skin_body,       "skinBody");
  radioList($("#artStyle"),    SFW.art_style,       "artStyle");
  checkList($("#bg"),          SFW.background,      "bg");
  checkList($("#pose"),        SFW.pose_composition,"pose");
  checkList($("#expr"),        SFW.expressions,     "expr");
  checkList($("#p_bg"),        SFW.background,      "p_bg");
  checkList($("#p_pose"),      SFW.pose_composition,"p_pose");
  checkList($("#p_expr"),      SFW.expressions,     "p_expr");
  checkList($("#p_light"),     SFW.lighting,        "p_light");
  checkList($("#lightLearn"),  SFW.lighting,        "lightLearn");

  // ★ outfit をカテゴリに分配して描画
  const C = categorizeOutfit(SFW.outfit);
  radioList($("#outfit_top"),    C.top,   "outfit_top");
  radioList($("#outfit_pants"),  C.pants, "outfit_pants");
  radioList($("#outfit_skirt"),  C.skirt, "outfit_skirt");
  radioList($("#outfit_dress"),  C.dress, "outfit_dress");
  checkList($("#p_outfit_shoes"), C.shoes, "p_outfit_shoes");

  // 量産側（カテゴリ別のチェック群）
  checkList($("#p_outfit_top"),   C.top,   "p_outfit_top");
  checkList($("#p_outfit_pants"), C.pants, "p_outfit_pants");
  checkList($("#p_outfit_skirt"), C.skirt, "p_outfit_skirt");
  checkList($("#p_outfit_dress"), C.dress, "p_outfit_dress");

  // ★ 基本情報（ID / name をHTMLに合わせて）
  radioList($("#bf_age"),      SFW.age,          "bf_age");
  radioList($("#bf_gender"),   SFW.gender,       "bf_gender");
  radioList($("#bf_body"),     SFW.body_type,    "bf_body");
  radioList($("#bf_height"),   SFW.height,       "bf_height");
  radioList($("#bf_person"),   SFW.personality,  "bf_person");
  radioList($("#bf_world"),    SFW.worldview,    "bf_world");
  radioList($("#bf_tone"),     SFW.speech_tone,  "bf_tone");

   // ★ ここを追加：動的生成後に有効/無効を更新
  if (typeof updateOneTestReady === "function") updateOneTestReady();

}

function bindBottomCategoryGuess(){
  const pan = document.getElementById("outfit_pants");
  const skl = document.getElementById("outfit_skirt");
  pan && pan.addEventListener("click", ()=> __bottomCat = "pants");
  skl && skl.addEventListener("click", ()=> __bottomCat = "skirt");
}

function getBasicSelectedOutfit(){
  const mode = document.querySelector('input[name="outfitMode"]:checked')?.value || "separate";
  if (mode === "onepiece") {
    const d = getOne("outfit_dress");
    return { mode, top:null, bottom:null, dress:d || "" };
  }
  // separate：直近で触られたカテゴリを優先し、無ければ“選べている方”
  const top = getOne("outfit_top") || "";

  const pantsVal = getOne("outfit_pants") || "";
  const skirtVal = getOne("outfit_skirt") || "";

  let bottom = "";
  if (pantsVal && skirtVal){
    bottom = (__bottomCat === "skirt") ? skirtVal : pantsVal;
  } else {
    bottom = skirtVal || pantsVal; // どちらかだけ選ばれている場合
  }
  return { mode, top, bottom, dress:null, bottomCat: (bottom===skirtVal ? "skirt" : "pants") };
}

/* ========= タブ切替 ========= */
function initTabs(){
  $$(".tab").forEach(t=> t.addEventListener("click", ()=>{
    $$(".tab").forEach(x=>x.classList.remove("active"));
    t.classList.add("active");
    const m=t.dataset.mode;
    $("#panelBasic").hidden      = (m !== "basic");
    $("#panelLearning").hidden   = (m!=="learning");
    $("#panelProduction").hidden = (m!=="production");
    $("#panelSettings").hidden   = (m!=="settings");
  }));
}

/* ========= 辞書 I/O ========= */
function isNSFWDict(json){
  const j = json?.NSFW || json || {};
  return !!(
    j.categories ||
    j.expression || j.exposure || j.situation || j.lighting ||
    j["表情"] || j["露出"] || j["シチュ"] || j["ライティング"] ||
    j.nsfw_tags
  );
}
function bindDictIO(){
  const input = document.getElementById("importDict");
  if (!input) return;
  input.addEventListener("change", async (e)=>{
    const f = e.target.files[0]; if (!f) return;
    try {
      const raw = await f.text();
      const json = JSON.parse(raw);
      if (isNSFWDict(json)) {
        mergeIntoNSFW(json);
        renderNSFWProduction(); renderNSFWLearning();
        toast("NSFW辞書を追記しました");
      } else {
        mergeIntoSFW(json);
        renderSFW(); fillAccessorySlots();
        toast("SFW辞書を追記しました");
      }
    } catch { toast("辞書の読み込みに失敗（JSONを確認）"); }
    finally { e.target.value = ""; }
  });

  $("#btnExport")?.addEventListener("click", ()=>{
    const save = {
      __meta:{ app:"LoRA Prompt Maker", version:"1.0", exported_at:new Date().toISOString() },
      sfw:SFW, nsfw:NSFW, settings:Settings
    };
    dl("lora_prompt_maker_settings.json", JSON.stringify(save,null,2));
  });
}

/* ========= キャラ設定 I/O ========= */
function setRadio(name, value){
  const els = $$(`input[name="${name}"]`); let hit=false;
  els.forEach(el=>{ const ok=(el.value===String(value)); el.checked=ok; if(ok) hit=true; });
  return hit;
}
function setChecks(name, values){
  const set = new Set((values||[]).map(String));
  $$(`input[name="${name}"]`).forEach(el=> el.checked = set.has(el.value));
}
function setVal(sel, v){ const el=$(sel); if(el!=null && typeof v==="string") el.value=v; }
function setColorTag(tagSel, text){ const el=$(tagSel); if(el && text) el.textContent = text; }
function setSkinTone(v){
  if(typeof v!=="number") return;
  const inp=$("#skinTone"); if(!inp) return;
  const c=Math.max(0, Math.min(100, Math.round(v)));
  inp.value=c; inp.dispatchEvent(new Event("input",{bubbles:true}));
}
function applyLearnAccessoryPreset(obj){
  if(!obj) return;
  if(obj.tag){ const sel=$("#learn_acc"); if(sel) sel.value = obj.tag; }
  if(obj.color){ setColorTag("#tag_learnAcc", obj.color); }
}
function applyNSFWLearningPreset(p){
  if(!p) return;
  if(typeof p.on==="boolean"){ $("#nsfwLearn").checked=p.on; $("#nsfwLearnPanel").style.display=p.on?"":"none"; }
  if(p.level) setRadio("nsfwLevelLearn", p.level);
  renderNSFWLearning();
  if(p.selected){
    if(p.selected.expression) setChecks("nsfwL_expr", p.selected.expression);
    if(p.selected.exposure)   setChecks("nsfwL_expo", p.selected.exposure);
    if(p.selected.situation)  setChecks("nsfwL_situ", p.selected.situation);
  }
}

function applyCharacterPreset(cfg){
  // 文字列系
  setVal("#charName", cfg.charName || cfg.characterName || "");
  setVal("#loraTag",  cfg.loraTag   || cfg.lora || "");
  setVal("#fixedManual", cfg.fixed || cfg.fixedTags || "");
  setVal("#negGlobal",   cfg.negative || cfg.negativeTags || "");

  // 形状
  if(cfg.hairStyle) setRadio("hairStyle", String(cfg.hairStyle));
  if(cfg.eyeShape)  setRadio("eyeShape",  String(cfg.eyeShape));
  if(cfg.face)      setRadio("face",      String(cfg.face));
  if(cfg.skinBody)  setRadio("skinBody",  String(cfg.skinBody));
  if(cfg.artStyle)  setRadio("artStyle",  String(cfg.artStyle));

  // シーン
  if(cfg.background) setChecks("bg", Array.isArray(cfg.background)? cfg.background : [cfg.background]);
  if(cfg.pose || cfg.composition){
    const poses = cfg.pose || cfg.composition; setChecks("pose", Array.isArray(poses)? poses : [poses]);
  }
  if(cfg.expressions) setChecks("expr", Array.isArray(cfg.expressions)? cfg.expressions : [cfg.expressions]);

  // 色（髪/瞳/肌）
  if(cfg.hairColorTag) setColorTag("#tagH", String(cfg.hairColorTag));
  if(cfg.eyeColorTag)  setColorTag("#tagE", String(cfg.eyeColorTag));
  if(typeof cfg.skinTone==="number") setSkinTone(cfg.skinTone);

    // ★ 基本情報（bf_*）
  const bf = cfg.bf || {};
  if (bf.age)         setRadio("bf_age",    String(bf.age));
  if (bf.gender)      setRadio("bf_gender", String(bf.gender));
  if (bf.body)        setRadio("bf_body",   String(bf.body));
  if (bf.height)      setRadio("bf_height", String(bf.height));
  if (bf.personality) setRadio("bf_person", String(bf.personality));
  if (bf.worldview)   setRadio("bf_world",  String(bf.worldview));
  if (bf.tone)        setRadio("bf_tone",   String(bf.tone));

  // ✅ 追記：UIが無い/未描画でも拾えるよう dataset にも保持
  {
    const host = document.body || document.documentElement;
    if (host && host.dataset) {
      if (bf.age)         host.dataset.bfAge    = String(bf.age);
      if (bf.gender)      host.dataset.bfGender = String(bf.gender);
      if (bf.body)        host.dataset.bfBody   = String(bf.body);
      if (bf.height)      host.dataset.bfHeight = String(bf.height);
      if (bf.personality) host.dataset.bfPerson = String(bf.personality);
      if (bf.worldview)   host.dataset.bfWorld  = String(bf.worldview);
      if (bf.tone)        host.dataset.bfTone   = String(bf.tone);
    }
  }
   
  // ★ outfit（分割&モード）
  const outf = cfg.outfit || cfg.outfitSel || cfg.outfits;
  if (typeof outf === "string") {
    // 互換: 旧フォーマットが1語だけのときの推測
    if (isOnePieceOutfitTag(outf)) {
      setRadio("outfitMode", "onepiece");
      setRadio("outfit_dress", outf);
    } else {
      setRadio("outfitMode", "separate");
      // ざっくり top 側へ入れる（必要なら KEYMAP で吸収）
      setRadio("outfit_top", outf);
    }
  } else if (outf && typeof outf === "object") {
    const mode = outf.mode || "separate";
    setRadio("outfitMode", mode);

    if (mode === "onepiece") {
      if (outf.dress) setRadio("outfit_dress", String(outf.dress));
    } else {
      if (outf.top) setRadio("outfit_top", String(outf.top));
      // bottom は pants / skirt を bottomCat で振り分け
      const cat = (outf.bottomCat || "pants").toLowerCase();
      if (cat === "skirt") {
        setRadio("outfit_skirt", String(outf.bottom||""));
        __bottomCat = "skirt";
      } else {
        setRadio("outfit_pants", String(outf.bottom||""));
        __bottomCat = "pants";
      }
    }
    // ラジオの有効/無効再適用
    if (typeof window.__applyBottomCatSwap === 'function') window.__applyBottomCatSwap();
  }

  // ★ 服カラー（学習タブ固定色）＋ON/OFF
  const wc = cfg.wearColors || {};
  const wu = cfg.wearColorUse || {};
  const applyWear = (idBase, text, useOn) => {
    const useEl = (idBase === "bottom") ? document.getElementById("useBottomColor") : document.getElementById("use_"+idBase);
    if (useEl) { useEl.checked = !!useOn; }
    if (text)  { setColorTag("#tag_"+idBase, String(text)); }
    updateWearPanelEnabled(idBase);
  };
  applyWear("top",    wc.top,    (wu.top    ?? !!wc.top));
  applyWear("bottom", wc.bottom, (wu.bottom ?? !!wc.bottom));
  applyWear("shoes",  wc.shoes,  (wu.shoes  ?? !!wc.shoes));

  // アクセ（学習）
  if(cfg.learnAccessory){
    applyLearnAccessoryPreset(cfg.learnAccessory);
  }

  // NSFW（学習）
  if(cfg.nsfwLearn) applyNSFWLearningPreset(cfg.nsfwLearn);

  // 最終：UI再描画の依存関係を軽く叩く
  if (typeof updateOneTestReady === "function") updateOneTestReady();
  toast("キャラ設定を読み込みました");
}

function collectCharacterPreset(){
  const outfitSel = getBasicSelectedOutfit(); // {mode, top, bottom, dress, bottomCat}

  return {
    // 基本
    charName: $("#charName")?.value || "",
    loraTag:  $("#loraTag")?.value  || "",
    fixed:    $("#fixedManual")?.value || "",
    negative: $("#negGlobal")?.value   || "",

    // 形状系
    hairStyle: getOne("hairStyle"),
    eyeShape:  getOne("eyeShape"),
    face:      getOne("face"),
    skinBody:  getOne("skinBody"),
    artStyle:  getOne("artStyle"),

    // シーン
    background: getMany("bg"),
    pose:       getMany("pose"),
    expressions:getMany("expr"),

    // 色（髪/瞳/肌）
    hairColorTag: $("#tagH")?.textContent || "",
    eyeColorTag:  $("#tagE")?.textContent || "",
    skinTone: Number($("#skinTone")?.value || 0),

    // ★ 基本情報（bf_*）
    bf: {
      age:        getOne("bf_age"),
      gender:     getOne("bf_gender"),
      body:       getOne("bf_body"),
      height:     getOne("bf_height"),
      personality:getOne("bf_person"),
      worldview:  getOne("bf_world"),
      tone:       getOne("bf_tone"),
    },

    // ★ outfit（分割&モード）
    outfit: {
      mode: outfitSel.mode,
      top: outfitSel.top || "",
      bottom: outfitSel.bottom || "",
      dress: outfitSel.dress || "",
      bottomCat: outfitSel.bottomCat || (__bottomCat || "pants")
    },

    // ★ 服カラー（学習タブの固定色）
    wearColors: {
      top:    getWearColorTag("top"),
      bottom: getWearColorTag("bottom"),
      shoes:  getWearColorTag("shoes")
    },
    wearColorUse: {
      top:    !!document.getElementById("use_top")?.checked,
      bottom: !!document.getElementById("useBottomColor")?.checked,
      shoes:  !!document.getElementById("use_shoes")?.checked
    },

    // アクセ（学習）
    learnAccessory:{ tag:$("#learn_acc")?.value||"", color:$("#tag_learnAcc")?.textContent||"" },

    // NSFW（学習）
    nsfwLearn:{
      on: $("#nsfwLearn")?.checked || false,
      level: (document.querySelector('input[name="nsfwLevelLearn"]:checked')?.value) || "L1",
      selected: {
        expression: $$('input[name="nsfwL_expr"]:checked').map(x=>x.value),
        exposure:   $$('input[name="nsfwL_expo"]:checked').map(x=>x.value),
        situation:  $$('input[name="nsfwL_situ"]:checked').map(x=>x.value)
      }
    }
  };
}

function bindCharIO(){
  const input = document.getElementById("importChar");
  if (input) {
    input.addEventListener("change", async (e)=>{
      const f = e.target.files[0]; if (!f) return;
      try{ const json = JSON.parse(await f.text()); applyCharacterPreset(json); }
      catch{ toast("キャラ設定の読み込みに失敗（JSONを確認）"); }
      finally{ e.target.value=""; }
    });
  }
  $("#btnExportChar")?.addEventListener("click", ()=>{
    const preset = collectCharacterPreset();
    dl("character_preset.json", JSON.stringify(preset, null, 2));
    toast("キャラ設定をローカル（JSON）に保存しました");
  });
}

/* ========= NSFW描画 ========= */
function renderNSFWLearning(){
  const cap = document.querySelector('input[name="nsfwLevelLearn"]:checked')?.value || "L1";
  const order = {L1:1,L2:2,L3:3};
  const allow = (lv)=> order[(lv||"L1")] <= order[cap];
  const lvlLabel = (x)=>({L1:"R-15",L2:"R-18",L3:"R-18G"}[(x||"L1")] || "R-15");
  const toChips = (arr,name)=> normList(arr).filter(it=>allow(it.level)).map(o=>
    `<label class="chip"><input type="checkbox" name="${name}" value="${o.tag}">${o.label}<span class="mini"> ${lvlLabel(o.level)}</span></label>`
  ).join("");
  $("#nsfwL_expr") && ($("#nsfwL_expr").innerHTML = toChips(NSFW.expression,"nsfwL_expr"));
  $("#nsfwL_expo") && ($("#nsfwL_expo").innerHTML = toChips(NSFW.exposure, "nsfwL_expo"));
  $("#nsfwL_situ") && ($("#nsfwL_situ").innerHTML = toChips(NSFW.situation,"nsfwL_situ"));
  $("#nsfwL_light")&& ($("#nsfwL_light").innerHTML= toChips(NSFW.lighting, "nsfwL_light"));
}
function renderNSFWProduction(){
  const cap = document.querySelector('input[name="nsfwLevelProd"]:checked')?.value || "L1";
  const order = {L1:1,L2:2,L3:3};
  const allow = (lv)=> order[(lv||"L1")] <= order[cap];
  const lvl = (x)=>({L1:"R-15",L2:"R-18",L3:"R-18G"}[(x||"L1")] || "R-15");
  const filt = (arr)=> normList(arr).filter(x=> allow(x.level));
  $("#nsfwP_expr")  && ($("#nsfwP_expr").innerHTML  = filt(NSFW.expression).map(o=>`<label class="chip"><input type="checkbox" name="nsfwP_expr" value="${o.tag}">${o.label}<span class="mini"> ${lvl(o.level)}</span></label>`).join(""));
  $("#nsfwP_expo")  && ($("#nsfwP_expo").innerHTML  = filt(NSFW.exposure).map(o=>`<label class="chip"><input type="checkbox" name="nsfwP_expo" value="${o.tag}">${o.label}<span class="mini"> ${lvl(o.level)}</span></label>`).join(""));
  $("#nsfwP_situ")  && ($("#nsfwP_situ").innerHTML  = filt(NSFW.situation).map(o=>`<label class="chip"><input type="checkbox" name="nsfwP_situ" value="${o.tag}">${o.label}<span class="mini"> ${lvl(o.level)}</span></label>`).join(""));
  $("#nsfwP_light") && ($("#nsfwP_light").innerHTML = filt(NSFW.lighting).map(o=>`<label class="chip"><input type="checkbox" name="nsfwP_light" value="${o.tag}">${o.label}<span class="mini"> ${lvl(o.level)}</span></label>`).join(""));
}
function bindNSFWToggles(){
  $("#nsfwLearn")?.addEventListener("change", e=>{
    $("#nsfwLearnPanel").style.display = e.target.checked ? "" : "none";
    if(e.target.checked) renderNSFWLearning();
  });
  $$('input[name="nsfwLevelLearn"]').forEach(x=> x.addEventListener('change', ()=>{
    if ($("#nsfwLearn")?.checked) renderNSFWLearning();
  }));
  $$('input[name="nsfwLevelProd"]').forEach(x=> x.addEventListener('change', renderNSFWProduction));
  $("#nsfwProd")?.addEventListener("change", e=> $("#nsfwProdPanel").style.display = e.target.checked ? "" : "none");
}

/* ========= 肌トーン描画 ========= */
function paintSkin(){
    const v   = +($("#skinTone").value||0);
    const hex = toneToHex(v);
    const tag = toneToTag(v);
    $("#swSkin").style.background = hex;
    const label = $("#tagSkin");
    label.textContent = tag;
    // ← 文字色は変えない（過去につけたインライン色があれば消す）
    label.style.color = "";
    // または label.style.removeProperty("color");
  }

/* ========= アクセ色相環 ========= */
let getHairColorTag, getEyeColorTag, getLearnAccColor, getAccAColor, getAccBColor, getAccCColor;
let getOutfitBaseColor;

/* ========= フォーマッタ & CSV ========= */
const FORMATTERS = {
  a1111:{ label:"Web UI（汎用）",
    line:(p,n,seed)=>`Prompt: ${p}\nNegative prompt: ${n}\nSeed: ${seed}`,
    csvHeader:['"no"','"seed"','"prompt"','"negative"'],
    csvRow:(i,seed,p,n)=>[`"${i}"`,`"${seed}"`,`"${p.replace(/"/g,'""')}"`,`"${n.replace(/"/g,'""')}"`].join(",") },
  invoke:{ label:"InvokeAI",
    line:(p,n,seed)=>`invoke --prompt "${p}" --negative_prompt "${n}" --seed ${seed}`,
    csvHeader:['"no"','"command"'],
    csvRow:(i,seed,p,n)=>[`"${i}"`,`"invoke --prompt \\\"${p.replace(/\"/g,'\"\"')}\\\" --negative_prompt \\\"${n.replace(/\"/g,'\"\"')}\\\" --seed ${seed}"`].join(",") },
  comfy:{ label:"ComfyUI（テキスト）",
    line:(p,n,seed)=>`positive="${p}"\nnegative="${n}"\nseed=${seed}`,
    csvHeader:['"no"','"seed"','"positive"','"negative"'],
    csvRow:(i,seed,p,n)=>[`"${i}"`,`"${seed}"`,`"${p.replace(/"/g,'""')}"`,`"${n.replace(/"/g,'""')}"`].join(",") },
  sdnext:{ label:"SD.Next（dream.py）",
    line:(p,n,seed)=>`python dream.py -p "${p}" -n "${n}" -S ${seed}`,
    csvHeader:['"no"','"command"'],
    csvRow:(i,seed,p,n)=>[`"${i}"`,`"python dream.py -p \\\"${p.replace(/\"/g,'\"\"')}\\\" - n \\\"${n.replace(/\"/g,'\"\"')}\\\" -S ${seed}"`].join(",").replace(" - n "," -n ") },
  nai:{ label:"NovelAI",
    line:(p,n,seed)=>`Prompt: ${p}\nUndesired: ${n}\nSeed: ${seed}`,
    csvHeader:['"no"','"seed"','"prompt"','"undesired"'],
    csvRow:(i,seed,p,n)=>[`"${i}"`,`"${seed}"`,`"${p.replace(/"/g,'""')}"`,`"${n.replace(/"/g,'""')}"`].join(",") }
};
const getFmt = (selId, fallback="a1111") => FORMATTERS[$(selId)?.value || fallback] || FORMATTERS[fallback];

function csvFromLearn(fmtSelId="#fmtLearnBatch"){
  const fmt = getFmt(fmtSelId);
  const rows = Array.from($("#tblLearn tbody")?.querySelectorAll("tr") || []).map((tr,i)=>{
    const tds = Array.from(tr.children).map(td=>td.textContent);
    const seed = tds[1]||""; const prompt = tds[5]||""; const negative = tds[6]||"";
    return fmt.csvRow(i+1, seed, prompt, negative);
  });
  return [fmt.csvHeader.join(","), ...rows].join("\n");
}
function csvFromProd(fmtSelId="#fmtProd"){
  const fmt = getFmt(fmtSelId);
  const rows = Array.from($("#tblProd tbody")?.querySelectorAll("tr") || []).map(tr=>{
    const tds = Array.from(tr.children).map(td=>td.textContent);
    const i = tds[0]||"", seed = tds[1]||"", prompt = tds[2]||"", negative = tds[3]||"";
    return fmt.csvRow(i, seed, prompt, negative);
  });
  return [fmt.csvHeader.join(","), ...rows].join("\n");
}

/* ========= クラウド送信 ========= */
async function postCSVtoGAS(kind, csv, meta = {}){
  const url = (Settings.gasUrl||"").trim();
  if(!url){ toast("クラウド保存URL（GAS）を設定タブで入力してください"); throw new Error("missing GAS url"); }
  const nameChar = ($("#charName")?.value||"").replace(/[^\w\-]/g,"_") || "noname";
  const body = {
    kind,
    filename: `${kind}_${nameChar}_${nowStamp()}.csv`,
    csv,
    meta: { charName: $("#charName")?.value||"", fmt:(kind==="learning" ? $("#fmtLearnBatch")?.value : $("#fmtProd")?.value)||"", ...meta },
    ts: Date.now()
  };
  const headers = {"Content-Type":"application/json"};
  if(Settings.gasToken) headers["Authorization"] = "Bearer " + Settings.gasToken;
  try{
    const r = await fetch(url, { method:"POST", headers, body: JSON.stringify(body), redirect:"follow" });
    if(!r.ok) throw new Error("bad status:"+r.status);
    const txt = await r.text().catch(()=>"(no text)");
    toast("クラウド（GAS）へ保存しました（応答: " + txt.slice(0,80) + "…）");
  }catch(err){
    try{
      await fetch(url, { method:"POST", mode:"no-cors", body: JSON.stringify(body) });
      toast("クラウド（GAS）へ保存しました（no-cors）");
    }catch(e2){
      console.error(e2); toast("クラウド保存に失敗（URL/公開設定/トークンを確認）"); throw e2;
    }
  }
}
function bindGASTools(){
   document.getElementById("btnSaveSettings")?.addEventListener("click", saveSettings);
   document.getElementById("btnResetSettings")?.addEventListener("click", resetSettings);
  $("#btnTestGAS")?.addEventListener("click", async ()=>{
    saveSettings();
    const url = Settings.gasUrl?.trim();
    if(!url){ $("#gasTestResult").textContent = "URL未設定"; return; }
    $("#gasTestResult").textContent = "テスト中…";
    try{
      const headers = {"Content-Type":"application/json"};
      if(Settings.gasToken) headers["Authorization"]="Bearer "+Settings.gasToken;

      const ctrl = new AbortController();
      const timer = setTimeout(()=>ctrl.abort(), 6000);
      const r = await fetch(url, { method:"POST", headers, body: JSON.stringify({kind:"ping", ts:Date.now()}), signal: ctrl.signal });
      clearTimeout(timer);
      $("#gasTestResult").textContent = r.ok ? "OK" : ("NG ("+r.status+")");
    }catch(e){
      $("#gasTestResult").textContent = "no-cors で送信（レスポンス確認不可）";
    }
  });
}

/* ========= 学習：組み立て ========= */
function getNeg(){
  const base = isDefaultNegOn() ? DEFAULT_NEG : "";
  const custom = ($("#negGlobal").value||"").split(",").map(s=>s.trim()).filter(Boolean);
  const parts = [
    ... (base ? base.split(",").map(s=>s.trim()) : []),
    ... custom
  ];
  return uniq(parts).join(", ");
}

// 置き換え: assembleFixedLearning
function assembleFixedLearning(){
  const out = [];

  // 0) LoRA / キャラ名
  out.push($("#loraTag").value.trim());
  out.push($("#charName").value.trim());

    // 1) 人となり（SFW基礎） ← ここを置き換え
  ["age","gender","body","height","person","world","tone"]
    .forEach(k => {
      const v = getBFValue(k);
      if (v) out.push(v);
    });

  // 2) 色（髪/瞳/肌）
  out.push(getHairColorTag && getHairColorTag());
  out.push(getEyeColorTag && getEyeColorTag());
  out.push($("#tagSkin").textContent);

  // 3) 形（髪型/目の形/顔/体/画風）
  ["hairStyle","eyeShape","face","skinBody","artStyle"].forEach(n=>{
    const v=document.querySelector(`input[name="${n}"]:checked`)?.value;
    if (v) out.push(v);
  });

  // 4) 服（カテゴリ考慮）
  const sel = getBasicSelectedOutfit();
  if (sel.mode === "onepiece") {
    if (sel.dress) out.push(sel.dress);
  } else {
    if (sel.top)    out.push(sel.top);
    if (sel.bottom) out.push(sel.bottom);
  }

  // 5) 服カラー（top/bottom/dress/shoes は後でペア化）
  out.push(...getLearningWearColorParts(sel)); // ex) "orange top", "sky blue bottom", "gray shoes"

  // 6) 恒常アクセ（色付きで）
  const acc = $("#learn_acc")?.value || "";
  if (acc) out.push(`${getLearnAccColor && getLearnAccColor()} ${acc}`);

  // 7) 手動固定
  const fixedManual = $("#fixedManual").value.split(",").map(s=>s.trim()).filter(Boolean);
  out.push(...fixedManual);

 // 危ない箇所
 out.push($("#loraTag")?.value?.trim() || "");
 out.push($("#charName")?.value?.trim() || "");
 out.push($("#tagSkin")?.textContent || "");
 
 // getNeg
 const custom = ($("#negGlobal")?.value || "")
   .split(",").map(s=>s.trim()).filter(Boolean);

 // buildOneLearning / buildBatchProduction
 const nameVal = $("#charName")?.value || "";
 const seed = seedFromName(nameVal, extraSeed); // など
 // buildBatchProduction
 const fixed = ($("#p_fixed")?.value || "")
   .split(",").map(s=>s.trim()).filter(Boolean);

  return uniq(out).filter(Boolean);
}

// 追加: 服色と服名をペア化
function pairWearColors(parts){
  const P = new Set(parts.filter(Boolean));
  const take = (re)=> [...P].find(t=> re.test(String(t)));

  // 服名検出用
  const topRe     = /\b(t-?shirt|shirt|blouse|hoodie|sweater|cardigan|jacket|coat|trench coat|tank top|camisole|turtleneck|off-shoulder top|crop top|sweatshirt)\b/i;
  const bottomRe  = /\b(skirt|pleated skirt|long skirt|hakama|shorts|pants|jeans|trousers|leggings|overalls|bermuda shorts)\b/i;
  const dressRe = /\b(dress|one[-\s]?piece|sundress|gown|kimono(?:\s+dress)?|yukata|cheongsam|qipao|lolita\s+dress|(?:school|sailor|blazer|nurse|maid|waitress)\s+uniform|maid\s+outfit|tracksuit|sportswear|jersey|robe|poncho|cape)\b/i;
  const shoesRe   = /\b(shoes|boots|heels|sandals|sneakers|loafers|mary janes|geta|zori)\b/i;

  // マッチした文字列から「素の名詞」を抜き出す（色や形容は捨てる）
  const nounWord = (s, re) => {
    const m = String(s||"").match(re);
    return m ? m[1].toLowerCase() : ""; // 例: "gray shoes" -> "shoes"
  };

  const topHit    = take(topRe);
  const bottomHit = take(bottomRe);
  const dressHit  = take(dressRe);
  const shoesHit  = take(shoesRe);

  const topWord    = nounWord(topHit, topRe);
  const bottomWord = nounWord(bottomHit, bottomRe);
  const dressWord  = nounWord(dressHit, dressRe);
  const shoesWord  = nounWord(shoesHit, shoesRe);

  const replacePair = (nounWord) => {
    if (!nounWord) return;
    const reColorTag = new RegExp(`^(.+?)\\s+(?:${nounWord})$`, "i"); // ex) "orange top"
    const colorTag = [...P].find(t => reColorTag.test(String(t)));
    if (colorTag) {
      // 色タグ（"orange top" 等）と、服名（"t-shirt" 等/ "top" / "shoes" など）を除去
      P.delete(colorTag);
      // noun は「色付き名詞」かもしれないので、候補を全部消しておく
      [...P].forEach(x => { if (new RegExp(`\\b${nounWord}\\b`, "i").test(String(x))) P.delete(x); });

      const color = String(colorTag).replace(reColorTag, "$1"); // "orange"
      P.add(`${color} ${nounWord}`); // "orange t-shirt" / "orange bottom" / "gray shoes"
    }
  };

  if (dressWord) {
    replacePair(dressWord);
  } else {
    replacePair(topWord);
    replacePair(bottomWord);
  }
  replacePair(shoesWord);

  return [...P];
}

function getSelectedNSFW_Learn(){
  if (!$("#nsfwLearn").checked) return [];
  const pickeds = [
    ...$$('input[name="nsfwL_expr"]:checked').map(x=>x.value),
    ...$$('input[name="nsfwL_expo"]:checked').map(x=>x.value),
    ...$$('input[name="nsfwL_situ"]:checked').map(x=>x.value),
    ...$$('input[name="nsfwL_light"]:checked').map(x=>x.value)
  ];
  return uniq(pickeds);
}

function buildOneLearning(extraSeed = 0){
  const fixed = assembleFixedLearning();
  const BG = getMany("bg"), PO=getMany("pose"), EX=getMany("expr"), LI=getMany("lightLearn");
  const addon = getSelectedNSFW_Learn();
  const b = pick(BG), p = pick(PO), e = pick(EX), l = LI.length ? pick(LI) : "";

  // 学習は常に1人
  const partsSolo = ["solo"];
  const genderCount = getGenderCountTag(); // "1girl" / "1boy" / ""
  if (genderCount) partsSolo.push(genderCount);

  // まとめる
  let parts = uniq([...partsSolo, ...fixed, b, p, e, l, ...addon]).filter(Boolean);
  parts = applyNudePriority(parts);
  parts = pairWearColors(parts);

  // ソロ強制 & 複数人ワード除去
  parts = stripMultiHints(parts);
  parts = forceSoloPos(parts);

  const pos  = ensurePromptOrder(parts);
  const seed = seedFromName($("#charName").value||"", extraSeed);
  const neg  = withSoloNeg(getNeg()); // ← 統一

  return { seed, pos, neg, text: `${pos.join(", ")} --neg ${neg} seed:${seed}` };
}

function buildBatchLearning(n){
  const used = new Set();
  const out = [];
  let guard = 0;

  // まずはユニークで頑張る
  while (out.length < n && guard < n * 300){
    guard++;
    const o = buildOneLearning(out.length + 1); // 行番号で seed 変化
    const key = o.pos.join("|");
    if (used.has(key)) continue;
    used.add(key);
    out.push(o);
  }
  // ユニークが尽きたら重複許容で埋め切る（seed は全部違う）
  while (out.length < n){
    out.push(buildOneLearning(out.length + 1));
  }
  return out;
}

// 置き換え: ensurePromptOrder
function ensurePromptOrder(parts) {
  const set = new Set(parts.filter(Boolean));

  // 所属マップ
  const asSet = (arr) => new Set((arr||[]).map(x => (typeof x==='string'? x : x.tag)));
  const S = {
    age:        asSet(SFW.age),
    gender:     asSet(SFW.gender),
    body_basic: asSet(SFW.body_type),
    height:     asSet(SFW.height),
    person:     asSet(SFW.personality),
    world:      asSet(SFW.worldview),
    tone:       asSet(SFW.speech_tone),

    hair_style: asSet(SFW.hair_style),
    eyes_shape: asSet(SFW.eyes),
    face:       asSet(SFW.face),
    skin_body:  asSet(SFW.skin_body),
    art_style:  asSet(SFW.art_style),
    outfit:     asSet(SFW.outfit),
    acc:        asSet(SFW.accessories),
    background: asSet(SFW.background),
    pose:       asSet(SFW.pose_composition),
    expr:       asSet(SFW.expressions),
    light:      asSet(SFW.lighting),

    nsfw_expr:  asSet(NSFW.expression),
    nsfw_expo:  asSet(NSFW.exposure),
    nsfw_situ:  asSet(NSFW.situation),
    nsfw_light: asSet(NSFW.lighting),
  };

  const isHairColor = (t)=> /\bhair$/.test(t) && !S.hair_style.has(t);
  const isEyeColor  = (t)=> /\beyes$/.test(t) && !S.eyes_shape.has(t);
  const isSkinTone  = (t)=> /\bskin$/.test(t) && !S.skin_body.has(t);

  const buckets = {
    lora:[], name:[],
    // 人となり
    b_age:[], b_gender:[], b_body:[], b_height:[], b_person:[], b_world:[], b_tone:[],
    // 色
    c_hair:[], c_eye:[], c_skin:[],
    // 形
    s_hair:[], s_eye:[], s_face:[], s_body:[], s_art:[],
    // 服・アクセ
    wear:[], acc:[],
    // シーン
    bg:[], pose:[], expr:[], light:[],
    // NSFW
    n_expr:[], n_expo:[], n_situ:[], n_light:[],
    other:[]
  };

  const charName = ($("#charName")?.value || "").trim();

  for (const t of set) {
    if (!t) continue;
    if (t.startsWith("<lora:") || /\b(?:LoRA|<lyco:)/i.test(t)) { buckets.lora.push(t); continue; }
    if (charName && t === charName) { buckets.name.push(t); continue; }

    // 人となり
    if (S.age.has(t))      { buckets.b_age.push(t); continue; }
    if (S.gender.has(t))   { buckets.b_gender.push(t); continue; }
    if (S.body_basic.has(t)){ buckets.b_body.push(t); continue; }
    if (S.height.has(t))   { buckets.b_height.push(t); continue; }
    if (S.person.has(t))   { buckets.b_person.push(t); continue; }
    if (S.world.has(t))    { buckets.b_world.push(t); continue; }
    if (S.tone.has(t))     { buckets.b_tone.push(t); continue; }

    // 色
    if (isHairColor(t)) { buckets.c_hair.push(t); continue; }
    if (isEyeColor(t))  { buckets.c_eye.push(t);  continue; }
    if (isSkinTone(t))  { buckets.c_skin.push(t); continue; }

    // 形
    if (S.hair_style.has(t)) { buckets.s_hair.push(t); continue; }
    if (S.eyes_shape.has(t)) { buckets.s_eye.push(t);  continue; }
    if (S.face.has(t))       { buckets.s_face.push(t); continue; }
    if (S.skin_body.has(t))  { buckets.s_body.push(t); continue; }
    if (S.art_style.has(t))  { buckets.s_art.push(t);  continue; }
   
   // 服・アクセ（色付き服も outfit に寄せる想定）
   const WEAR_NAME_RE = /\b(t-?shirt|shirt|blouse|hoodie|sweater|cardigan|jacket|coat|trench\ coat|tank\ top|camisole|turtleneck|off-shoulder\ top|crop\ top|sweatshirt|blazer|skirt|pleated\ skirt|long\ skirt|hakama|shorts|pants|jeans|trousers|leggings|overalls|bermuda\ shorts|dress|one[-\s]?piece|sundress|gown|kimono(?:\s+dress)?|yukata|cheongsam|qipao|hanbok|sari|lolita\ dress|kimono\ dress|swimsuit|bikini|leotard|(?:school|sailor|blazer|nurse|maid|waitress)\s+uniform|maid\s+outfit|tracksuit|sportswear|jersey|robe|poncho|cape|shoes|boots|heels|sandals|sneakers|loafers|mary\ janes|geta|zori)\b/i;
   if (S.outfit.has(t) || WEAR_NAME_RE.test(t)) { buckets.wear.push(t); continue; }
   if (S.acc.has(t)) { buckets.acc.push(t); continue; }

    // シーン
    if (S.background.has(t)) { buckets.bg.push(t);   continue; }
    if (S.pose.has(t))       { buckets.pose.push(t); continue; }
    if (S.expr.has(t))       { buckets.expr.push(t); continue; }
    if (S.light.has(t))      { buckets.light.push(t);continue; }

    // NSFW
    if (S.nsfw_expr.has(t))  { buckets.n_expr.push(t);  continue; }
    if (S.nsfw_expo.has(t))  { buckets.n_expo.push(t);  continue; }
    if (S.nsfw_situ.has(t))  { buckets.n_situ.push(t);  continue; }
    if (S.nsfw_light.has(t)) { buckets.n_light.push(t); continue; }

    buckets.other.push(t);
  }

  return [
    ...buckets.lora, ...buckets.name,
    // 人となり
    ...buckets.b_age, ...buckets.b_gender, ...buckets.b_body, ...buckets.b_height,
    ...buckets.b_person, ...buckets.b_world, ...buckets.b_tone,
    // 色
    ...buckets.c_hair, ...buckets.c_eye, ...buckets.c_skin,
    // 形
    ...buckets.s_hair, ...buckets.s_eye, ...buckets.s_face, ...buckets.s_body, ...buckets.s_art,
    // 服・アクセ
    ...buckets.wear, ...buckets.acc,
    // シーン
    ...buckets.bg, ...buckets.pose, ...buckets.expr, ...buckets.light,
    // NSFW
    ...buckets.n_expr, ...buckets.n_expo, ...buckets.n_situ, ...buckets.n_light,
    // その他
    ...buckets.other
  ].filter(Boolean);
}

/* === ヌード優先ルール（全裸 / 上半身裸 / 下半身裸） === */
function applyNudePriority(parts){
  let filtered = [...parts];
  const has = (re)=> filtered.some(t => re.test(String(t)));
  const hasNude       = has(/\b(nude|naked|no clothes|全裸|完全に裸)\b/i);
  const hasTopless    = has(/\b(topless|上半身裸)\b/i);
  const hasBottomless = has(/\b(bottomless|下半身裸)\b/i);
  const RE_TOP      = /\b(top|shirt|t[-\s]?shirt|blouse|sweater|hoodie|jacket|coat|cardigan|tank top|camisole|bra|bikini top)\b/i;
  const RE_BOTTOM   = /\b(bottom|skirt|shorts|pants|jeans|trousers|leggings|bikini bottom|panties|underwear|briefs)\b/i;
  const RE_ONEPIECE = /\b(dress|one[-\s]?piece|gown|kimono|robe|yukata|cheongsam|qipao|swimsuit|bikini|leotard|(?:school|sailor|blazer|nurse|maid|waitress)\s+uniform|maid\s+outfit|tracksuit|sportswear|jersey|cape)\b/i;  
  const RE_SHOES    = /\b(shoes|boots|heels|sandals|sneakers)\b/i;
  const removeWhere = (re)=> { filtered = filtered.filter(t => !re.test(String(t))); };
  if (hasNude) {
    removeWhere(RE_TOP);
    removeWhere(RE_BOTTOM);
    removeWhere(RE_ONEPIECE);
    removeWhere(RE_SHOES);
  } else {
    if (hasTopless) removeWhere(RE_TOP);
    if (hasBottomless) {
      removeWhere(RE_BOTTOM);
      removeWhere(RE_ONEPIECE);
    }
  }
  return filtered;
}

/* ========= 量産：アクセ3スロット & 組み立て ========= */
function readAccessorySlots(){
  const A = $("#p_accA")?.value || "", Ac = getAccAColor && getAccAColor();
  const B = $("#p_accB")?.value || "", Bc = getAccBColor && getAccBColor();
  const C = $("#p_accC")?.value || "", Cc = getAccCColor && getAccCColor();
  const pack = (noun,color)=> noun ? (color ? `${color} ${noun}` : noun) : "";
  return [pack(A,Ac), pack(B,Bc), pack(C,Cc)].filter(Boolean);
}

/* ① 量産用：カテゴリ別 outfit を読む */
function readProductionOutfits(){
  return {
    top:   getMany("p_outfit_top"),
    pants: getMany("p_outfit_pants"),
    skirt: getMany("p_outfit_skirt"),
    dress: getMany("p_outfit_dress"),
    shoes: getMany("p_outfit_shoes"),
  };
}

// 服色タグ取得（量産パネル用）
function getProdWearColorTag(idBase){
  // idBase: "top" | "bottom" | "shoes"
  const use = document.getElementById("p_use_"+idBase);
  if (use && !use.checked) return "";
  const t = document.getElementById("tag_p_"+idBase);
  const txt = (t?.textContent || "").trim();
  return (txt && txt !== "—") ? txt : "";
}

/* ② 置き換え版：buildBatchProduction（丸ごと差し替え） */
function buildBatchProduction(n){
  const seedMode = document.querySelector('input[name="seedMode"]:checked')?.value || "fixed";
  const fixed = ($("#p_fixed").value||"").split(",").map(s=>s.trim()).filter(Boolean);

  const neg = getNegProd();
  const O = readProductionOutfits();  // {top, pants, skirt, dress, shoes}

  const bgs    = getMany("p_bg");
  const poses  = getMany("p_pose");
  const exprs  = getMany("p_expr");
  const lights = getMany("p_light");
  const acc    = readAccessorySlots();

  const nsfwOn = $("#nsfwProd").checked;
  const nsfwAdd = nsfwOn ? uniq([
    ...getMany("nsfwP_expr"),
    ...getMany("nsfwP_expo"),
    ...getMany("nsfwP_situ"),
    ...getMany("nsfwP_light")
  ]) : [];

  const PC = {
    top:    getProdWearColorTag("top"),
    bottom: getProdWearColorTag("bottom"),
    shoes:  getProdWearColorTag("shoes"),
  };

  const baseSeed = seedFromName($("#charName").value||"", 0);
  const out = [];
  const seen = new Set();
  let guard = 0;

  const makeOne = (i)=>{
    const parts = [];
    let usedDress = false;

    if (O.dress.length && Math.random() < 0.35) {
      parts.push(pick(O.dress));
      usedDress = true;
    } else {
      if (O.top.length) parts.push(pick(O.top));
      let bottomPool = [];
      if (O.pants.length && O.skirt.length) bottomPool = (Math.random() < 0.5) ? O.pants : O.skirt;
      else if (O.pants.length) bottomPool = O.pants;
      else if (O.skirt.length) bottomPool = O.skirt;
      if (bottomPool.length) parts.push(pick(bottomPool));
    }

    if (O.shoes && O.shoes.length) parts.push(pick(O.shoes));

    if (PC.top)    parts.push(`${PC.top} top`);
    if (!usedDress && PC.bottom) parts.push(`${PC.bottom} bottom`);
    if (PC.shoes)  parts.push(`${PC.shoes} shoes`);

    if (acc.length)    parts.push(...acc);
    if (bgs.length)    parts.push(pick(bgs));
    if (poses.length)  parts.push(pick(poses));
    if (exprs.length)  parts.push(pick(exprs));
    if (lights.length) parts.push(pick(lights));
    if (nsfwAdd.length)parts.push(...nsfwAdd);

    let all = uniq([...fixed, ...parts]).filter(Boolean);
    all = applyNudePriority(all);
    all = pairWearColors(all);

    // --- SOLO ガード（複数人ニュアンスを除去）
    all = stripMultiHints(all);   // 関係性/人数っぽい語を除く
    all = forceSoloPos(all);      // solo, 1girl/1boy を強制

    const prompt = ensurePromptOrder(all).join(", ");

    const seed = (seedMode === "fixed")
      ? baseSeed
      : seedFromName($("#charName").value||"", i);

     return { key: `${prompt}|${seed}`, seed, prompt, neg: withSoloNeg(neg) };
  };

  // ユニーク優先
  while (out.length < n && guard < n * 400) {
    guard++;
    const r = makeOne(out.length + 1);
    if (seen.has(r.key)) continue;
    seen.add(r.key);
    out.push(r);
  }
  // ここからフォールバック：重複を許して埋め切る
  while (out.length < n) {
    out.push(makeOne(out.length + 1));
  }
  return out;
}

function getNegProd(){
  const base = isDefaultNegOn() ? DEFAULT_NEG : "";
  const custom = ($("#p_neg").value||"").split(",").map(s=>s.trim()).filter(Boolean);
  const parts = [
    ... (base ? base.split(",").map(s=>s.trim()) : []),
    ... custom
  ];
  return uniq(parts).join(", ");
}

/* ========= レンダラ ========= */
function renderLearnTableTo(tbodySel, rows){
  const tb = document.querySelector(tbodySel); if (!tb) return;
  const frag = document.createDocumentFragment();
  rows.forEach((r,i)=>{
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${i+1}</td><td>${r.seed}</td>
      <td>${r.pos.find(t=> normList(SFW.background).map(x=>x.tag).includes(t))||""}</td>
      <td>${r.pos.find(t=> normList(SFW.pose_composition).map(x=>x.tag).includes(t))||""}</td>
      <td>${r.pos.find(t=> normList(SFW.expressions).map(x=>x.tag).includes(t))||""}</td>
      <td>${r.pos.join(", ")}</td><td>${r.neg}</td>`;
    frag.appendChild(tr);
  });
  tb.innerHTML = "";
  tb.appendChild(frag);
}
function formatLines(rows, fmt){
  return rows.map((r,i)=>{
    const p = (r.pos || []).join(", ");
    const line = fmt.line(p, r.neg, r.seed);
    return `[${String(i+1).padStart(2,"0")}] ${line}`;
  }).join("\n\n");
}
function renderLearnTextTo(outSel, rows, selId="fmtLearnBatch"){
  const fmt = getFmt(`#${selId}`);
  const box = document.querySelector(outSel);
  if (box) box.textContent = formatLines(rows, fmt);
}
function renderProdTable(rows){
  const tb=$("#tblProd tbody"); if (!tb) return;
  const frag = document.createDocumentFragment();
  rows.forEach((r,i)=>{ const tr = document.createElement("tr"); tr.innerHTML = `<td>${i+1}</td><td>${r.seed}</td><td>${r.prompt}</td><td>${r.neg}</td>`; frag.appendChild(tr); });
  tb.innerHTML = ""; tb.appendChild(frag);
}
function renderProdText(rows){
  const fmt = getFmt("#fmtProd");
  const lines = rows.map((r,i)=> {
    const p = r.prompt; const n = r.neg; const line = fmt.line(p, n, r.seed);
    return `[${String(i+1).padStart(2,"0")}] ${line}`;
  }).join("\n\n");
  $("#outProd").textContent = lines;
}

/* ========= アクセ選択肢 ========= */
function fillAccessorySlots(){
  const accs = normList(SFW.accessories || []);
  const options = `<option value="">（未選択）</option>` + accs.map(a=>`<option value="${a.tag}">${a.label || a.tag}</option>`).join("");
  ["p_accA","p_accB","p_accC","learn_acc"].forEach(id=>{
    const sel = document.getElementById(id); if (sel) sel.innerHTML = options;
  });
}

/* ========= デフォルト辞書ロード ========= */
async function loadDefaultDicts(){
  const tryFetch = async (path)=>{
    try{
      const r = await fetch(path, {cache:"no-store"});
      if(!r.ok) throw new Error("bad status");
      return await r.json();
    }catch(_){ return null; }
  };
  const sfw = await tryFetch("dict/default_sfw.json");
  if(sfw){ mergeIntoSFW(sfw); renderSFW(); fillAccessorySlots(); toast("SFW辞書を読み込みました"); }
  const nsfw = await tryFetch("dict/default_nsfw.json");
  if(nsfw){ mergeIntoNSFW(nsfw); renderNSFWProduction(); renderNSFWLearning(); toast("NSFW辞書を読み込みました"); }
}

/* ========= ボタン等のイベント ========= */
function bindLearnTest(){
  let __lastOneLearn = null;

  /*
   $("#btnOneLearn")?.addEventListener("click", ()=>{
    const one = buildOneLearning();
    if(one.error){ toast(one.error); return; }
    __lastOneLearn = one;
    renderLearnTableTo("#tblLearnTest tbody", [one]);
    renderLearnTextTo("#outLearnTest", [one], "fmtLearn");
  });

  $("#btnCopyLearnTest")?.addEventListener("click", ()=>{
    const text = __lastOneLearn ? (__lastOneLearn.pos||[]).join(", ")
      : ($("#tblLearnTest tbody tr td:nth-child(6)")?.textContent||"");
    if(!text){ toast("コピー対象がありません"); return; }
    navigator.clipboard?.writeText(text).then(()=> toast("プロンプトのみコピーしました"))
      .catch(()=>{
        const r=document.createRange(); const d=document.createElement("div"); d.textContent=text; document.body.appendChild(d);
        r.selectNodeContents(d); const s=getSelection(); s.removeAllRanges(); s.addRange(r);
        document.execCommand("copy"); s.removeAllRanges(); d.remove(); toast("プロンプトのみコピーしました");
      });
  });
  */
}

function bindLearnBatch(){
  $("#btnBatchLearn")?.addEventListener("click", ()=>{
    const cnt=parseInt($("#countLearn").value,10)||24;
    const rows = buildBatchLearning(cnt);
    if(rows.error){ toast(rows.error); return; }
    renderLearnTableTo("#tblLearn tbody", rows);
    renderLearnTextTo("#outLearn", rows, "fmtLearnBatch");
  });
  $("#btnCopyLearn")?.addEventListener("click", ()=>{
    const r=document.createRange(); r.selectNodeContents($("#outLearn")); const s=getSelection();
    s.removeAllRanges(); s.addRange(r); document.execCommand("copy"); s.removeAllRanges(); toast("学習セットをコピーしました");
  });
  $("#btnCsvLearn")?.addEventListener("click", ()=>{
    const csv = csvFromLearn("#fmtLearnBatch");
    if(!csv || csv.split("\n").length<=1){ toast("学習テーブルが空です"); return; }
    const char = ($("#charName")?.value||"noname").replace(/[^\w\-]/g,"_");
    dl(`learning_${char}_${nowStamp()}.csv`, csv); toast("学習セットをローカル（CSV）に保存しました");
  });
  $("#btnCloudLearn")?.addEventListener("click", async ()=>{
    const csv = csvFromLearn("#fmtLearnBatch");
    if(!csv || csv.split("\n").length<=1){ toast("学習テーブルが空です"); return; }
    await postCSVtoGAS("learning", csv);
  });
}

function bindProduction(){
  $("#btnGenProd")?.addEventListener("click", ()=>{
    const cnt=parseInt($("#countProd").value,10)||50;
    const rows = buildBatchProduction(cnt);
    renderProdTable(rows); renderProdText(rows);
  });
  $("#btnCopyProd")?.addEventListener("click", ()=>{
    const r=document.createRange(); r.selectNodeContents($("#outProd")); const s=getSelection();
    s.removeAllRanges(); s.addRange(r); document.execCommand("copy"); s.removeAllRanges(); toast("量産セットをコピーしました");
  });
  $("#btnCsvProd")?.addEventListener("click", ()=>{
    const csv = csvFromProd("#fmtProd");
    if(!csv || csv.split("\n").length<=1){ toast("量産テーブルが空です"); return; }
    const char = ($("#charName")?.value||"noname").replace(/[^\w\-]/g,"_");
    dl(`production_${char}_${nowStamp()}.csv`, csv); toast("量産セットをローカル（CSV）に保存しました");
  });
  $("#btnCloudProd")?.addEventListener("click", async ()=>{
    const csv = csvFromProd("#fmtProd");
    if(!csv || csv.split("\n").length<=1){ toast("量産テーブルが空です"); return; }
    await postCSVtoGAS("production", csv);
  });
}

/* ===== ここから追記：総合初期化 ===== */
function initHairEyeAndAccWheels(){
  // --- 髪/瞳（スクエア付きHSLピッカー） ---
  // 既定色はお好みで
  /* getHairColorTag = initWheelWithSquare(
    "#wheelH", "#thumbH", "#swH", "#tagH", "hair",
    35, 75, 50
  );
  getEyeColorTag = initWheelWithSquare(
    "#wheelE", "#thumbE", "#swE", "#tagE", "eyes",
    210, 60, 50
  ); */
   
 // ✅ S/Lスライダー版に戻す
  getHairColorTag = initWheel(
    "#wheelH", "#thumbH", "#satH", "#litH", "#swH", "#tagH", "hair"
  );
  getEyeColorTag = initWheel(
    "#wheelE", "#thumbE", "#satE", "#litE", "#swE", "#tagE", "eyes"
  );


  // --- 学習アクセ & 量産アクセ A/B/C ---
  getLearnAccColor = initColorWheel("learnAcc", 0,   75, 50);
  getAccAColor     = initColorWheel("accA",     0,   80, 50);
  getAccBColor     = initColorWheel("accB",   200,   80, 50);
  getAccCColor     = initColorWheel("accC",   120,   80, 50);

  // --- ベース服色（任意。使うUIがあるなら） ---
  getOutfitBaseColor = initColorWheel("outfitBase", 35, 80, 50);

  // --- 服色ON/OFFの連動 ---
  bindWearToggles();
}
function initSkinTone(){
  const s = document.getElementById('skinTone');
  if (s) {
    s.addEventListener('input', paintSkin);
    paintSkin(); // 初回反映
  }
}

function initNSFWStatusBadge(){
  const badge = document.getElementById('nsfwState');
  if (!badge) return;
  const update = () => {
    const on = document.getElementById('nsfwLearn')?.checked || document.getElementById('nsfwProd')?.checked;
    badge.textContent = on ? 'ON' : 'OFF';
  };
  document.getElementById('nsfwLearn')?.addEventListener('change', update);
  document.getElementById('nsfwProd')?.addEventListener('change', update);
  update();
}

function initAll(){
  if (window.__LPM_INITED) return;
  window.__LPM_INITED = true;

  loadSettings();
  initTabs();
  bindDictIO();
  bindCharIO();
  bindNSFWToggles();
  bindLearnTest();
  bindLearnBatch();
  bindProduction();
  bindGASTools();

  bindBottomCategoryRadios();

   
  loadDefaultDicts().then(()=>{
    renderSFW();
    bindBottomCategoryGuess();
    fillAccessorySlots();
    renderNSFWLearning();
    renderNSFWProduction();initHairEyeAndAccWheels(); // ← 髪/瞳/アクセのピッカーとトグル連動をまとめて初期化

    // 色系
    // 基本情報タブの「服カラー（固定）」3つを初期化
     initColorWheel("top",    35, 80, 55);
     initColorWheel("bottom",210, 70, 50); 
     initColorWheel("shoes",   0,  0, 30);

     // 生産タブ（量産の基本色）
    initColorWheel("p_top",    35, 80, 55); // ← 追加
    initColorWheel("p_bottom",210, 70, 50); // ← 追加
    initColorWheel("p_shoes",   0,  0, 30); // ← 追加

    initSkinTone();
    initNSFWStatusBadge();
  });
}

document.addEventListener('DOMContentLoaded', initAll);

function bindOneTestUI(){
  // クリック
  $("#btnOneLearn")?.addEventListener("click", runOneTest);
  $("#btnCopyLearnTest")?.addEventListener("click", copyOneTestText);

  // フォーマット変更時に再整形
  $("#fmtLearn")?.addEventListener("change", ()=>{
    if (__lastOneTestRows.length) renderLearnTextTo("#outLearnTest", __lastOneTestRows, "fmtLearn");
  });

  // 入力監視：基本情報一式が更新されたら判定を更新
  const watchSelectors = [
    "#charName", "#tagH", "#tagE", "#tagSkin",
    'input[name="hairStyle"]','input[name="eyeShape"]','input[name="face"]','input[name="skinBody"]','input[name="artStyle"]',
    'input[name="outfitMode"]','input[name="outfit_top"]','input[name="outfit_pants"]','input[name="outfit_skirt"]','input[name="outfit_dress"]',
    'input[name="bg"]','input[name="pose"]','input[name="expr"]',
    "#use_top","#useBottomColor","#use_shoes",
    "#sat_top","#lit_top","#sat_bottom","#lit_bottom","#sat_shoes","#lit_shoes",
  ];

  // 変化を広めに捕捉（input/change/DOM変化）
  watchSelectors.forEach(sel=>{
    $$(sel).forEach(el=>{
      el.addEventListener("change", updateOneTestReady);
      el.addEventListener("input",  updateOneTestReady);
    });
  });

  // 初回判定
  updateOneTestReady();
}

// 既存の初期化の最後にこれを呼ぶ
document.addEventListener("DOMContentLoaded", ()=>{
  // ...既存の init / bind 系...
  bindOneTestUI();
});
