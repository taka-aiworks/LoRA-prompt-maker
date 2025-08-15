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
const EMBED_SFW  = { hair_style:[], eyes:[], outfit:[], face:[], skin_body:[], art_style:[], background:[], pose_composition:[], expressions:[], accessories:[], lighting:[], age:[], gender:[], body_type:[], height:[], personality:[], relationship:[], worldview:[], speech_tone:[]};
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
  "関係性":"relationship",
  "世界観":"worldview",
  "口調":"speech_tone"
};
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
const SKIN_LAB = [[95,0,8],[88,6,12],[78,10,18],[65,15,20],[50,12,15],[38,8,10]];
function toneToHex(v){
  const t=v/100, seg=t*(SKIN_LAB.length-1);
  const i=Math.min(SKIN_LAB.length-2, Math.floor(seg)), k=seg-i;
  const L = SKIN_LAB[i][0]*(1-k)+SKIN_LAB[i+1][0]*k;
  const A = SKIN_LAB[i][1]*(1-k)+SKIN_LAB[i+1][1]*k;
  const B = SKIN_LAB[i][2]*(1-k)+SKIN_LAB[i+1][2]*k;
  return hexFromLab(L,A,B);
}
function toneToTag(v){
  if(v<=15) return "very fair skin";
  if(v<=35) return "fair skin";
  if(v<=55) return "light skin";
  if(v<=75) return "tan skin";
  if(v<=90) return "dark skin";
  return "very dark skin";
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
  const t = document.getElementById("tag_"+idBase);
  if (!t) return "";
  const txt = (t.textContent || "").trim();
  return (txt && txt !== "—") ? txt : "";
}
function isOnePieceOutfit(tag){
  return /\b(dress|one[-\s]?piece|gown|kimono)\b/i.test(tag || "");
}
function getLearningWearColorParts(selectedOutfitTag){
  const parts = [];
  const top   = getWearColorTag("top");
  const bottom= getWearColorTag("bottom");
  const shoes = getWearColorTag("shoes");
  if (isOnePieceOutfit(selectedOutfitTag)) {
    if (top) {
      const noun = (/\bkimono\b/i.test(selectedOutfitTag)) ? "kimono"
                 : (/\bgown\b/i.test(selectedOutfitTag))   ? "gown"
                 : "dress";
      parts.push(`${top} ${noun}`);
    }
  } else {
    if (top)    parts.push(`${top} top`);
    if (bottom) parts.push(`${bottom} bottom`);
  }
  if (shoes)    parts.push(`${shoes} shoes`);
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
  return ()=> $(tagId).textContent;
}

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
  const items = normList(list);
  el.innerHTML = items.map((it,i)=>{
    const showMini = it.tag && it.label && it.tag !== it.label;
    return `<label class="chip"><input type="radio" name="${name}" value="${it.tag}" ${i===0?"checked":""}> ${it.label}${showMini?`<span class="mini"> ${it.tag}</span>`:""}</label>`;
  }).join("");
}
function checkList(el, list, name){
  const items = normList(list);
  el.innerHTML = items.map(it=>{
    const showMini = it.tag && it.label && it.tag !== it.label;
    return `<label class="chip"><input type="checkbox" name="${name}" value="${it.tag}"> ${it.label}${showMini?`<span class="mini"> ${it.tag}</span>`:""}</label>`;
  }).join("");
}
const getOne  = (name) => document.querySelector(`input[name="${name}"]:checked`)?.value || "";
const getMany = (name) => $$(`input[name="${name}"]:checked`).map(x=>x.value);

function renderSFW(){
  radioList($("#hairStyle"),   SFW.hair_style,      "hairStyle");
  radioList($("#eyeShape"),    SFW.eyes,            "eyeShape");
  radioList($("#outfit"),      SFW.outfit,          "outfit");
  radioList($("#face"),        SFW.face,            "face");
  radioList($("#skinBody"),    SFW.skin_body,       "skinBody");
  radioList($("#artStyle"),    SFW.art_style,       "artStyle");
  checkList($("#bg"),          SFW.background,      "bg");
  checkList($("#pose"),        SFW.pose_composition,"pose");
  checkList($("#expr"),        SFW.expressions,     "expr");
  checkList($("#p_outfit"),    SFW.outfit,          "p_outfit");
  checkList($("#p_bg"),        SFW.background,      "p_bg");
  checkList($("#p_pose"),      SFW.pose_composition,"p_pose");
  checkList($("#p_expr"),      SFW.expressions,     "p_expr");
  radioList($("#p_light"),     SFW.lighting,        "p_light");
  checkList($("#lightLearn"),  SFW.lighting,        "lightLearn");

  // ★ 基本情報（ID / name をHTMLに合わせる）
  radioList($("#bf_age"),            SFW.age,             "bf_age");
  radioList($("#bf_gender"),         SFW.gender,          "bf_gender");
  radioList($("#bf_body_type"),      SFW.body_type,       "bf_body_type");
  radioList($("#bf_height"),         SFW.height,          "bf_height");
  radioList($("#bf_personality"),    SFW.personality,     "bf_personality");
  radioList($("#bf_relationship"),   SFW.relationship,    "bf_relationship");
  radioList($("#bf_world"),          SFW.worldview,       "bf_world");
  radioList($("#bf_speech_style"),   SFW.speech_tone,     "bf_speech_style");
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
  setVal("#charName", cfg.charName || cfg.characterName || "");
  setVal("#loraTag",  cfg.loraTag   || cfg.lora || "");
  setVal("#fixedManual", cfg.fixed || cfg.fixedTags || "");
  setVal("#negGlobal",   cfg.negative || cfg.negativeTags || "");
  if(cfg.hairStyle) setRadio("hairStyle", String(cfg.hairStyle));
  if(cfg.eyeShape)  setRadio("eyeShape",  String(cfg.eyeShape));
  if(cfg.outfit)    setRadio("outfit",    String(cfg.outfit));
  if(cfg.face)      setRadio("face",      String(cfg.face));
  if(cfg.skinBody)  setRadio("skinBody",  String(cfg.skinBody));
  if(cfg.artStyle)  setRadio("artStyle",  String(cfg.artStyle));
  if(cfg.background) setChecks("bg", Array.isArray(cfg.background)? cfg.background : [cfg.background]);
  if(cfg.pose || cfg.composition){
    const poses = cfg.pose || cfg.composition; setChecks("pose", Array.isArray(poses)? poses : [poses]);
  }
  if(cfg.expressions) setChecks("expr", Array.isArray(cfg.expressions)? cfg.expressions : [cfg.expressions]);
  if(cfg.hairColorTag) setColorTag("#tagH", String(cfg.hairColorTag));
  if(cfg.eyeColorTag)  setColorTag("#tagE", String(cfg.eyeColorTag));
  if(typeof cfg.skinTone==="number") setSkinTone(cfg.skinTone);
  if(cfg.learnAccessory) applyLearnAccessoryPreset(cfg.learnAccessory);
  if(cfg.nsfwLearn) applyNSFWLearningPreset(cfg.nsfwLearn);
  toast("キャラ設定を読み込みました");
}
function collectCharacterPreset(){
  return {
    charName: $("#charName")?.value || "",
    loraTag:  $("#loraTag")?.value  || "",
    fixed:    $("#fixedManual")?.value || "",
    negative: $("#negGlobal")?.value   || "",
    hairStyle: getOne("hairStyle"), eyeShape: getOne("eyeShape"), outfit:getOne("outfit"),
    face:getOne("face"), skinBody:getOne("skinBody"), artStyle:getOne("artStyle"),
    background:getMany("bg"), pose:getMany("pose"), expressions:getMany("expr"),
    hairColorTag: $("#tagH")?.textContent || "", eyeColorTag: $("#tagE")?.textContent || "",
    skinTone:Number($("#skinTone")?.value || 0),
    learnAccessory:{ tag:$("#learn_acc")?.value||"", color:$("#tag_learnAcc")?.textContent||"" },
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
  const v = +($("#skinTone").value||0);
  const hex = toneToHex(v), tag = toneToTag(v);
  $("#swSkin").style.background = hex;
  $("#tagSkin").textContent = tag;
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
  const base = "extra fingers, blurry, lowres, bad anatomy";
  const g = ($("#negGlobal").value||"").split(",").map(s=>s.trim()).filter(Boolean);
  return uniq([...base.split(",").map(s=>s.trim()), ...g]).join(", ");
}

function assembleFixedLearning(){
  const arr=[];
  arr.push($("#loraTag").value.trim());
  arr.push($("#charName").value.trim());
  arr.push(getHairColorTag && getHairColorTag());
  arr.push(getEyeColorTag && getEyeColorTag());
  arr.push($("#tagSkin").textContent);

  // 基本の単一選択要素（name を修正）
  ["hairStyle","eyeShape","face","skinBody","artStyle","outfit",
   "bf_age","bf_gender","bf_body_type","bf_height",
   "bf_personality","bf_relationship","bf_world","bf_speech_style"].forEach(n=>{
    const v=document.querySelector(`input[name="${n}"]:checked`)?.value; if(v) arr.push(v);
  });

  // 服色（top/bottom/shoes）
  const selectedOutfit = getOne("outfit");
  if (selectedOutfit) {
    const wearColors = getLearningWearColorParts(selectedOutfit);
    arr.push(...wearColors);
  }

  // アクセ（恒常1種）
  const acc = $("#learn_acc")?.value || "";
  if (acc) arr.push(`${getLearnAccColor && getLearnAccColor()} ${acc}`);

  // 手動固定
  const fixedManual = $("#fixedManual").value.split(",").map(s=>s.trim()).filter(Boolean);
  arr.push(...fixedManual);

  return uniq(arr).filter(Boolean);
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
function buildOneLearning(){
  const fixed = assembleFixedLearning();
  const BG = getMany("bg"), PO=getMany("pose"), EX=getMany("expr"), LI=getMany("lightLearn");
  if(BG.length===0 || PO.length===0 || EX.length===0) return {error:"背景・ポーズ・表情は最低1つずつ選択してください。"};
  const addon = getSelectedNSFW_Learn();
  const b = pick(BG), p = pick(PO), e=pick(EX), l = LI.length ? pick(LI) : "";
  let parts = uniq([...fixed, b, p, e, l, ...addon]).filter(Boolean);
  parts = applyNudePriority(parts);
  const pos = ensurePromptOrder(parts);
  const seed = seedFromName($("#charName").value||"", 0);
  return {seed, pos, neg:getNeg(), text:`${pos.join(", ")} --neg ${getNeg()} seed:${seed}`};
}
function buildBatchLearning(n){
  const used=new Set(), out=[]; let guard=0;
  while(out.length<n && guard < n*300){
    guard++; const o = buildOneLearning(); if(o.error){ return {error:o.error}; }
    const key = o.pos.join("|"); if(used.has(key)) continue; used.add(key); out.push(o);
  }
  return out;
}

/* === 追加: プロンプト並べ替え（正規順） ===*/
function ensurePromptOrder(parts) {
  const set = new Set(parts.filter(Boolean));
  const asSet = (arr) => new Set((arr||[]).map(x => (typeof x==='string'? x : x.tag)));
  const S = {
    age:        asSet(SFW.age),
    gender:     asSet(SFW.gender),
    body_basic: asSet(SFW.body_type),
    height:     asSet(SFW.height),
    person:     asSet(SFW.personality),
    relation:   asSet(SFW.relationship),
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
  const isWearColor = (t)=> /\b(top|bottom|dress|gown|kimono|shoes)\b/i.test(t) && !S.outfit.has(t);
  const isHairColor = (t)=> /\bhair$/.test(t) && !S.hair_style.has(t);
  const isEyeColor  = (t)=> /\beyes$/.test(t) && !S.eyes_shape.has(t);
  const isSkinTone  = (t)=> /\bskin$/.test(t) && !S.skin_body.has(t);

  const B = {
    lora: [], name: [],
    basic: { age:[], gender:[], body:[], height:[], person:[], relation:[], world:[], tone:[] },
    hairColor: [], eyeColor: [], skin: [],
    hairStyle: [], eyeShape: [], face: [], body: [], art: [], outfit: [],
    wearColor: [],
    acc: [], bg: [], pose: [], expr: [], light: [],
    nsfw_expr: [], nsfw_expo: [], nsfw_situ: [], nsfw_light: [],
    other: []
  };

  for (const t of set) {
    if (!t) continue;
    if (t.startsWith("<lora:") || t.includes("<lyco:") || /LoRA/i.test(t)) { B.lora.push(t); continue; }
    if (t === (document.querySelector("#charName")?.value||"").trim()) { B.name.push(t); continue; }

    if (S.age.has(t))      { B.basic.age.push(t);      continue; }
    if (S.gender.has(t))   { B.basic.gender.push(t);   continue; }
    if (S.body_basic.has(t)){ B.basic.body.push(t);    continue; }
    if (S.height.has(t))   { B.basic.height.push(t);   continue; }
    if (S.person.has(t))   { B.basic.person.push(t);   continue; }
    if (S.relation.has(t)) { B.basic.relation.push(t); continue; }
    if (S.world.has(t))    { B.basic.world.push(t);    continue; }
    if (S.tone.has(t))     { B.basic.tone.push(t);     continue; }

    if (isHairColor(t)) { B.hairColor.push(t); continue; }
    if (isEyeColor(t))  { B.eyeColor.push(t);  continue; }
    if (isSkinTone(t))  { B.skin.push(t);      continue; }

    if (S.hair_style.has(t)) { B.hairStyle.push(t); continue; }
    if (S.eyes_shape.has(t)) { B.eyeShape.push(t);  continue; }
    if (S.face.has(t))       { B.face.push(t);      continue; }
    if (S.skin_body.has(t))  { B.body.push(t);      continue; }
    if (S.art_style.has(t))  { B.art.push(t);       continue; }
    if (S.outfit.has(t))     { B.outfit.push(t);    continue; }

    if (isWearColor(t)) { B.wearColor.push(t); continue; }

    if (S.acc.has(t))        { B.acc.push(t);  continue; }
    if (S.background.has(t)) { B.bg.push(t);   continue; }
    if (S.pose.has(t))       { B.pose.push(t); continue; }
    if (S.expr.has(t))       { B.expr.push(t); continue; }
    if (S.light.has(t))      { B.light.push(t);continue; }

    if (S.nsfw_expr.has(t))  { B.nsfw_expr.push(t);  continue; }
    if (S.nsfw_expo.has(t))  { B.nsfw_expo.push(t);  continue; }
    if (S.nsfw_situ.has(t))  { B.nsfw_situ.push(t);  continue; }
    if (S.nsfw_light.has(t)) { B.nsfw_light.push(t); continue; }

    B.other.push(t);
  }

  return [
    ...B.lora, ...B.name,
    ...B.basic.age, ...B.basic.gender, ...B.basic.body, ...B.basic.height,
    ...B.basic.person, ...B.basic.relation, ...B.basic.world, ...B.basic.tone,
    ...B.hairColor, ...B.eyeColor, ...B.skin,
    ...B.hairStyle, ...B.eyeShape, ...B.face, ...B.body, ...B.art, ...B.outfit,
    ...B.wearColor,
    ...B.acc,
    ...B.bg, ...B.pose, ...B.expr, ...B.light,
    ...B.nsfw_expr, ...B.nsfw_expo, ...B.nsfw_situ, ...B.nsfw_light,
    ...B.other
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
  const RE_ONEPIECE = /\b(dress|one[-\s]?piece|gown|kimono|robe|yukata|cheongsam|qipao)\b/i;
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
  const pack = (noun,color)=> noun ? `${color} ${noun}` : "";
  return [pack(A,Ac), pack(B,Bc), pack(C,Cc)].filter(Boolean);
}

function buildBatchProduction(n){
  const seedMode = document.querySelector('input[name="seedMode"]:checked')?.value || "fixed";
  const fixed = ($("#p_fixed").value||"").split(",").map(s=>s.trim()).filter(Boolean);
  const neg   = ($("#p_neg").value||"").trim();
  const outfits = getMany("p_outfit");
  const bgs  = getMany("p_bg");
  const poses= getMany("p_pose");
  const exprs= getMany("p_expr");
  const light= getOne("p_light");
  const acc  = readAccessorySlots();

  const nsfwOn = $("#nsfwProd").checked;
  let nsfwAdd = [];
  if (nsfwOn){
    nsfwAdd = uniq([
      ...getMany("nsfwP_expr"),
      ...getMany("nsfwP_expo"),
      ...getMany("nsfwP_situ"),
      ...getMany("nsfwP_light")
    ]);
  }

  const baseSeed = seedFromName($("#charName").value||"", 0);
  const out=[]; let guard=0;
  while(out.length<n && guard<n*400){
    guard++;
    const o = [];
    if(outfits.length){
      const rawOutfit = pick(outfits);
      const colored   = maybeColorizeOutfit(rawOutfit);
      o.push(colored);
    }
    if(acc.length)     o.push(...acc);
    if(bgs.length)     o.push(pick(bgs));
    if(poses.length)   o.push(pick(poses));
    if(exprs.length)   o.push(pick(exprs));
    if(light)          o.push(light);
    if(nsfwAdd.length) o.push(...nsfwAdd);

    let parts = uniq([...fixed, ...o]).filter(Boolean);
    parts = applyNudePriority(parts);

    const prompt = ensurePromptOrder(parts).join(", ");
    const seed = seedMode==="fixed" ? baseSeed : seedFromName($("#charName").value||"", out.length+1);
    const key = `${prompt}|${seed}`;
    if(out.some(x=>x.key===key)) continue;
    out.push({key, seed, prompt, neg});
  }
  return out;
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

function bindSettings(){
  $("#btnSaveSettings")?.addEventListener("click", ()=>{ saveSettings(); toast("設定を保存しました"); });
  $("#btnResetSettings")?.addEventListener("click", ()=>{ resetSettings(); loadSettings(); });
}

/* ========= 画面上部にキャラ設定IOを固定 ========= */
function pinCharImportToTop(){
  const inp = document.getElementById("importChar");
  const btnExport = document.getElementById("btnExportChar");
  if (!inp) return; // インポートinputが無ければ何もしない

  // 置き場所（あれば #topBar / #header / .toolbar、なければ <body> 先頭）
  const host = document.getElementById("topBar")
            || document.getElementById("header")
            || document.querySelector(".toolbar")
            || document.body;

  // スタイル注入（軽く見栄え＆追従）
  if (!document.getElementById("charImportPinnedStyle")) {
    const style = document.createElement("style");
    style.id = "charImportPinnedStyle";
    style.textContent = `
      #charImportPinned{position:sticky;top:0;z-index:50;display:flex;gap:.5rem;align-items:center;
        padding:.5rem .75rem;background:var(--panel-bg, rgba(255,255,255,.85));
        backdrop-filter:saturate(150%) blur(6px); border-bottom:1px solid rgba(0,0,0,.06)}
      #charImportPinned .btn{padding:.45rem .8rem;border:1px solid rgba(0,0,0,.15);border-radius:.4rem;cursor:pointer}
    `;
    document.head.appendChild(style);
  }

  // 固定バー生成
  const box = document.createElement("div");
  box.id = "charImportPinned";
  box.innerHTML = `
    <button id="btnImportCharTop" class="btn">キャラ設定を読み込む</button>
    <button id="btnExportCharTop" class="btn">キャラ設定を保存</button>
  `;

  // 先頭に配置
  if (host === document.body) {
    document.body.insertBefore(box, document.body.firstChild);
  } else {
    host.prepend(box);
  }

  // クリックで既存のIOを呼ぶ（inputは元の場所のまま）
  box.querySelector("#btnImportCharTop")?.addEventListener("click", ()=> inp.click());
  box.querySelector("#btnExportCharTop")?.addEventListener("click", ()=> {
    // 既存ボタンがあればそれをクリック、無ければ処理を直呼び
    if (btnExport) btnExport.click();
    else {
      const preset = collectCharacterPreset();
      dl("character_preset.json", JSON.stringify(preset, null, 2));
      toast("キャラ設定をローカル（JSON）に保存しました");
    }
  });
}

/* ========= 初期化 ========= */
window.addEventListener("DOMContentLoaded", async ()=>{
  loadSettings();
  initTabs();
  bindDictIO();
  bindCharIO();
  bindNSFWToggles();
  bindGASTools();
  bindLearnTest();
  bindLearnBatch();
  bindProduction();
  bindSettings();
  pinCharImportToTop();

  renderSFW(); renderNSFWProduction(); renderNSFWLearning(); fillAccessorySlots();

  $("#skinTone")?.addEventListener("input", paintSkin);
  paintSkin();

  if (typeof requestIdleCallback === "function") {
    requestIdleCallback(setupColorPickers, { timeout: 300 });
  } else {
    setTimeout(setupColorPickers, 0);
  }

  await loadDefaultDicts();

  bindOutfitDisableBottomUI();
  function bindOutfitDisableBottomUI(){
    const panel = document.getElementById("bottomWearPanel");
    if (!panel) return;
    const update = ()=>{
      const tag = getOne("outfit");
      panel.classList.toggle('is-disabled', isOnePieceOutfit(tag));
    };
    document.addEventListener("change", (e)=>{
      if (e.target && e.target.name === "outfit") update();
    });
    update();
  }
   
  $("#nsfwState").textContent = "OFF";
  $("#nsfwLearn")?.addEventListener("change", e=> $("#nsfwState").textContent = e.target.checked ? "ON（学習）" : "OFF");
  $("#nsfwProd")?.addEventListener("change", e=> $("#nsfwState").textContent = e.target.checked ? "ON（量産）" : "OFF");
});

/* === カラーピッカー初期化（アイドル時） === */
function setupColorPickers(){
  getHairColorTag   = initWheel("#wheelH","#thumbH","#satH","#litH","#swH","#tagH","hair");
  getEyeColorTag    = initWheel("#wheelE","#thumbE","#satE","#litE","#swE","#tagE","eyes");
  getLearnAccColor  = initColorWheel("learnAcc", 0,   75, 50);
  getAccAColor      = initColorWheel("accA",     0,   80, 50);
  getAccBColor      = initColorWheel("accB",   220,   80, 50);
  getAccCColor      = initColorWheel("accC",   130,   80, 50);

  initColorWheel("top",    35, 80, 55);
  initColorWheel("bottom",210, 70, 50);
  initColorWheel("shoes",   0,  0, 30);

  getOutfitBaseColor = initColorWheel("outfitBase", 35, 80, 50);
}
