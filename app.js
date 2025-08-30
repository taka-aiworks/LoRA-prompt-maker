/* =========================
   AI Prompt Maker – app.js (軽量化版)
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

/* ===== Tag Dictionary Bootstrap ===== */
window.TAGMAP = {
  en: new Map(),
  ja2tag: new Map(),
  label2tag: new Map(),
  id2tag: new Map()
};

async function initTagDictionaries(){
  async function safeLoad(url){
    try { const r = await fetch(url); if (!r.ok) throw 0; return await r.json(); }
    catch(_){ return null; }
  }
  const [sfw, nsfw] = await Promise.all([
    safeLoad('dict/default_sfw.json'), safeLoad('dict/default_nsfw.json')
  ]);

  function addAll(obj, nsKey){
    if (!obj) return;
    const root = obj[nsKey]?.categories || obj.categories || {};
    const walk = (v) => {
      if (Array.isArray(v)) v.forEach(addItem);
      else if (v && typeof v==='object') Object.values(v).forEach(walk);
    };
    function addItem(it){
      if (!it || typeof it!=='object') return;
      const tag = String(it.tag||"").trim();
      if (!tag) return;
      const ja = String(it.ja || it.label || "").trim();
      const id = String(it.id || it.key || "").trim();
      const label = String(it.label || "").trim();

      window.TAGMAP.en.set(tag.toLowerCase(), tag);
      if (ja)    window.TAGMAP.ja2tag.set(ja, tag);
      if (label) window.TAGMAP.label2tag.set(label, tag);
      if (id)    window.TAGMAP.id2tag.set(id, tag);
    }
    walk(root);
  }
  addAll(sfw, 'SFW');
  addAll(nsfw, 'NSFW');
}

/* ===== 基本値取得 ===== */
function getBFValue(name){
  const sel = document.querySelector(`input[name="bf_${name}"]:checked`);
  if (sel && sel.value) return sel.value;
  const host = document.body || document.documentElement;
  const key  = `bf${name[0].toUpperCase()}${name.slice(1)}`;
  return (host?.dataset?.[key] || "").trim();
}

function getGenderCountTag() {
  const g = document.querySelector('input[name="bf_gender"]:checked')?.value?.toLowerCase() || "";
  if (!g) return "";
  if (/\b(female|girl|woman|feminine|女子|女性)\b/.test(g)) return "1girl";
  if (/\b(male|boy|man|masculine|男子|男性)\b/.test(g))     return "1boy";
  return "";
}

/* ===== ネガティブ構築 ===== */
const NEG_TIGHT = [
  "multiple people","group","crowd","background people","bystanders","another person",
  "photobomb","reflection","mirror","poster","billboard","tv screen",
  "bad hands","bad anatomy","extra fingers","extra arms","extra legs",
  "fused fingers","malformed hands","long fingers",
  "lowres","blurry","low quality","worst quality","jpeg artifacts",
  "text","watermark","logo"
];

function buildNegative(baseText = "", useDefault = true) {
  const base = useDefault ? [...NEG_TIGHT] : [];
  const custom = baseText
    ? baseText.split(",").map(s => s.trim()).filter(Boolean)
    : [];
  return Array.from(new Set([...base, ...custom])).join(", ");
}

/* ===== 正規化 ===== */
window.normalizeTag = function(t){
  return String(t ?? "").trim();
};

function toTag(txt){
  return normalizeTag(txt);
}

/* ===== 辞書処理 ===== */
let SFW = {
  hair_style:[], eyes:[], outfit:[], face:[], skin_body:[], art_style:[], background:[],
  pose:[], composition:[], view:[], expressions:[], accessories:[], lighting:[],
  age:[], gender:[], body_type:[], height:[], personality:[]
};

let NSFW = {
  expression:[], exposure:[], situation:[], lighting:[], background:[],
  pose:[], accessory:[], outfit:[], body:[], nipples:[], underwear:[]
};

function normItem(x) {
  if (typeof x === "string") return { tag: x, label: x, level: "L1" };
  if (!x || typeof x !== "object") return null;
  const tag   = x.tag ?? x.en ?? x.keyword ?? x.value ?? x.name;
  const ja    = x.ja || x.jp || x["name_ja"] || x["label_ja"] || x.desc || x.label;
  const label = (ja && String(ja).trim()) ? String(ja).trim() : (tag || "");
  const level = (x.level || "L1").toUpperCase();
  if (tag === undefined || tag === null) return null;
  return { ...x, tag: String(tag), label, level };
}

function normList(arr){ return (arr || []).map(normItem).filter(Boolean); }

function dedupeByTag(list) {
  const seen = new Set(); const out=[];
  for (const it of normList(list)) { if (seen.has(it.tag)) continue; seen.add(it.tag); out.push(it); }
  return out;
}

function mergeIntoSFW(json) {
  const src  = json?.SFW || json || {};
  const next = { ...SFW };
  const KEYMAP = {
    "髪型":"hair_style", "目の形":"eyes", "服":"outfit", "顔の特徴":"face",
    "体型":"skin_body", "視点":"view", "画風":"art_style", "背景":"background",
    "ポーズ":"pose", "構図":"composition", "表情":"expressions",
    "アクセサリー":"accessories", "ライティング":"lighting", "年齢":"age",
    "性別":"gender", "体型(基本)":"body_type", "身長":"height", "性格":"personality"
  };

  for (const [k, v] of Object.entries(src || {})) {
    const key = KEYMAP[k] || k;
    if (next[key] === undefined) continue;
    next[key] = dedupeByTag([...(next[key]||[]), ...normList(v)]);
  }
  SFW = next;
}

function normNSFW(ns) {
  const src = (ns && ns.categories) ? ns.categories : (ns || {});
  const ALIAS = {
    expression: ['expression','表情'],
    exposure:   ['exposure','露出'],
    situation:  ['situation','シチュ','scenario','context'],
    lighting:   ['lighting','ライティング','light'],
    background: ['background','背景'],
    pose:       ['pose','poses','ポーズ'],
    accessory:  ['accessory','accessories','acc','アクセ','アクセサリー'],
    outfit:     ['outfit','outfits','costume','clothes','衣装'],
    body:       ['body','anatomy','feature','features','body_features','body_shape','身体','体型'],
    nipples:    ['nipples','nipple','乳首','乳首系'],
    underwear:  ['underwear','lingerie','下着','インナー']
  };
  
  const pickBy = (names)=> {
    for (const k of names) {
      if (Array.isArray(src?.[k])) return normList(src[k]);
    }
    return [];
  };

  return {
    expression: pickBy(ALIAS.expression),
    exposure:   pickBy(ALIAS.exposure),
    situation:  pickBy(ALIAS.situation),
    lighting:   pickBy(ALIAS.lighting),
    background: pickBy(ALIAS.background),
    pose:       pickBy(ALIAS.pose),
    accessory:  pickBy(ALIAS.accessory),
    outfit:     pickBy(ALIAS.outfit),
    body:       pickBy(ALIAS.body),
    nipples:    pickBy(ALIAS.nipples),
    underwear:  pickBy(ALIAS.underwear)
  };
}

function mergeIntoNSFW(json) {
  const src = json?.NSFW ? normNSFW(json.NSFW) : normNSFW(json);
  NSFW = NSFW || {};
  const ensure = (k)=> { if (!Array.isArray(NSFW[k])) NSFW[k] = []; };
  ['expression','exposure','situation','lighting','background','pose','accessory','outfit','body','nipples','underwear'].forEach(ensure);

  NSFW = {
    expression: dedupeByTag([...(NSFW.expression||[]), ...(src.expression||[])]),
    exposure:   dedupeByTag([...(NSFW.exposure||[]),   ...(src.exposure||[])]),
    situation:  dedupeByTag([...(NSFW.situation||[]),  ...(src.situation||[])]),
    lighting:   dedupeByTag([...(NSFW.lighting||[]),   ...(src.lighting||[])]),
    background: dedupeByTag([...(NSFW.background||[]), ...(src.background||[])]),
    pose:       dedupeByTag([...(NSFW.pose||[]),       ...(src.pose||[])]),
    accessory:  dedupeByTag([...(NSFW.accessory||[]),  ...(src.accessory||[])]),
    outfit:     dedupeByTag([...(NSFW.outfit||[]),     ...(src.outfit||[])]),
    body:       dedupeByTag([...(NSFW.body||[]),       ...(src.body||[])]),
    nipples:    dedupeByTag([...(NSFW.nipples||[]),    ...(src.nipples||[])]),
    underwear:  dedupeByTag([...(NSFW.underwear||[]),  ...(src.underwear||[])])
  };
}

/* ===== UI生成 ===== */
function radioList(el, list, name, {checkFirst = true} = {}) {
  if (!el) return;
  const items = normList(list);
  el.innerHTML = items.map((it, i) => {
    const showMini = it.tag && it.label && it.tag !== it.label;
    const checked = (checkFirst && i === 0) ? 'checked' : '';
    return `<label class="chip">
      <input type="radio" name="${name}" value="${it.tag}" ${checked}>
      ${it.label}${showMini ? `<span class="mini"> ${it.tag}</span>` : ""}
    </label>`;
  }).join("");
}

function checkList(el, list, name, { prechecked = [] } = {}) {
  if (!el) return;
  const items = normList(list);
  const checkedSet = new Set(prechecked.map(String));
  el.innerHTML = items.map((it) => {
    const showMini = it.tag && it.label && it.tag !== it.label;
    const checked = checkedSet.has(String(it.tag)) ? 'checked' : '';
    return `<label class="chip">
      <input type="checkbox" name="${name}" value="${it.tag}" ${checked}>
      ${it.label}${showMini ? `<span class="mini"> ${it.tag}</span>` : ""}
    </label>`;
  }).join("");
}

const getOne = (name) => document.querySelector(`input[name="${name}"]:checked`)?.value || "";

function getMany(idOrName){
  const root = document.getElementById(idOrName);
  if (root) {
    const nodes = root.querySelectorAll(
      '.chip.on,' +
      '.wm-item.is-selected,' +
      '[aria-selected="true"],' +
      '[data-selected="true"],' +
      '.selected,.active,.sel,' +
      '.option.selected,.item.selected,' +
      'input[type=checkbox]:checked,' +
      'input[type=radio]:checked'
    );
    return Array.from(nodes).map(el => {
      if (el.tagName === 'INPUT') return el.value;
      return el.dataset?.en || el.value || el.textContent?.trim() || "";
    }).filter(Boolean);
  }
  const els = document.querySelectorAll(`input[name="${idOrName}"]:checked`);
  if (els?.length) return Array.from(els).map(el => el.value);
  return [];
}

/* ===== カラーユーティリティ ===== */
function hslToRgb(h,s,l){
  s/=100; l/=100;
  const c=(1-Math.abs(2*l-1))*s, x=c*(1-Math.abs((h/60)%2-1)), m=l-c/2;
  let r=0,g=0,b=0;
  if(h<60){[r,g,b]=[c,x,0]} else if(h<120){[r,g,b]=[x,c,0]} else if(h<180){[r,g,b]=[0,c,x]}
  else if(h<240){[r,g,b]=[0,x,c]} else if(h<300){[r,g,b]=[x,0,c]} else {[r,g,b]=[c,0,x]}
  return [(r+m)*255,(g+m)*255,(b+m)*255].map(v=>Math.round(v));
}

const SKIN_LAB = [
  [96,  0,  6], [88,  4, 10], [78,  8, 16], [66, 13, 20],
  [56, 15, 22], [46, 14, 20], [34, 12, 18], [20, 10, 16], [14,  8, 12]
];

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

function colorNameFromHSL(h, s, l) {
  if (l < 12) return "black";
  if (l > 92 && s < 20) return "white";
  if (s < 10) {
    if (l < 30) return "dark gray";
    if (l > 70) return "light gray";
    return "gray";
  }
  const table = [
    { h:   0, name: "red" }, { h:  12, name: "crimson" }, { h:  22, name: "vermilion" },
    { h:  32, name: "orange" }, { h:  45, name: "gold" }, { h:  60, name: "yellow" },
    { h:  75, name: "lime" }, { h:  90, name: "green" }, { h: 110, name: "emerald" },
    { h: 150, name: "teal" }, { h: 180, name: "cyan" }, { h: 200, name: "aqua" },
    { h: 210, name: "sky blue" }, { h: 225, name: "azure" }, { h: 240, name: "blue" },
    { h: 255, name: "indigo" }, { h: 270, name: "violet" }, { h: 285, name: "purple" },
    { h: 300, name: "magenta" }, { h: 320, name: "fuchsia" }, { h: 335, name: "rose" },
    { h: 350, name: "pink" }, { h: 360, name: "red" }
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

/* ===== 色ホイール ===== */
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
  const onDown = (e) => { e.preventDefault(); dragging = true; updateFromEvent(e); };
  const onMove = (e) => { if (dragging) updateFromEvent(e); };
  const onUp   = () => { dragging = false; };
  wheelEl.addEventListener("pointerdown", onDown);
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
  return setThumb;
}

function initWheel(wId,tId,sId,lId,swId,tagId,baseTag){
  const wheel=$(wId), thumb=$(tId), sat=$(sId), lit=$(lId), sw=$(swId), tagEl=$(tagId);
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

/* ===== 肌トーン ===== */
function paintSkin(){
  const v   = +($("#skinTone").value||0);
  const tag = toneToTag(v);
  $("#swSkin").style.background = `hsl(${30}, ${20}%, ${85-v*0.7}%)`;
  $("#tagSkin").textContent = tag;
}

/* ===== フォーマッタ & CSV ===== */
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
    csvRow:(i,seed,p,n)=>[`"${i}"`,`"python dream.py -p \\\"${p.replace(/\"/g,'\"\"')}\\\" -n \\\"${n.replace(/\"/g,'\"\"')}\\\" -S ${seed}"`].join(",") },
  nai:{ label:"NovelAI",
    line:(p,n,seed)=>`Prompt: ${p}\nUndesired: ${n}\nSeed: ${seed}`,
    csvHeader:['"no"','"seed"','"prompt"','"undesired"'],
    csvRow:(i,seed,p,n)=>[`"${i}"`,`"${seed}"`,`"${p.replace(/"/g,'""')}"`,`"${n.replace(/"/g,'""')}"`].join(",") }
};

const getFmt = (selId, fallback="a1111") => FORMATTERS[$(selId)?.value || fallback] || FORMATTERS[fallback];

/* ===== 設定 ===== */
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

/* ===== カテゴリ分配 ===== */
function categorizeOutfit(list){
  const L = normList(list || []);
  const C = { top:[], pants:[], skirt:[], dress:[], shoes:[] };

  for (const t of L) {
    const cat = (t.cat || "").toLowerCase();
    if (cat === "top")      { C.top.push(t);   continue; }
    if (cat === "pants")    { C.pants.push(t); continue; }
    if (cat === "skirt")    { C.skirt.push(t); continue; }
    if (cat === "dress")    { C.dress.push(t); continue; }
    if (cat === "shoes")    { C.shoes.push(t); continue; }

    const tag = (t.tag || "").toLowerCase();
    if (/(t-shirt|tank|blouse|shirt|hoodie|sweater|cardigan|jacket|coat)/.test(tag)) { C.top.push(t);   continue; }
    if (/(jeans|pants|trousers|shorts|cargo|bermuda|leggings|overalls|hakama)/.test(tag)) { C.pants.push(t); continue; }
    if (/(skirt)/.test(tag)) { C.skirt.push(t); continue; }
    if (/(dress|gown|yukata|kimono|cheongsam|hanbok|sari|uniform)/.test(tag)) { C.dress.push(t); continue; }
    if (/(boots|sneakers|loafers|mary janes)/.test(tag)) { C.shoes.push(t); continue; }
    C.dress.push(t);
  }
  return C;
}

/* ===== レンダラ ===== */
function renderSFW(){
  radioList($("#hairStyle"),   SFW.hair_style,      "hairStyle");
  radioList($("#eyeShape"),    SFW.eyes,            "eyeShape");
  radioList($("#face"),        SFW.face,            "face");
  radioList($("#skinBody"),    SFW.skin_body,       "skinBody");
  radioList($("#artStyle"),    SFW.art_style,       "artStyle");

  checkList($("#bg"),         SFW.background,   "bg");
  checkList($("#expr"),       SFW.expressions,  "expr");
  checkList($("#lightLearn"), SFW.lighting,     "lightLearn");

  checkList($("#p_bg"),    SFW.background,   "p_bg");
  checkList($("#p_expr"),  SFW.expressions,  "p_expr");
  checkList($("#p_light"), SFW.lighting,     "p_light");

  checkList($("#pose"), SFW.pose, "pose");
  checkList($("#comp"), SFW.composition, "comp");
  checkList($("#view"), SFW.view, "view");
  checkList($("#p_pose"), SFW.pose, "p_pose");
  checkList($("#p_comp"), SFW.composition, "p_comp");
  checkList($("#p_view"), SFW.view, "p_view");

  const C = categorizeOutfit(SFW.outfit);
  radioList($("#outfit_top"),    C.top,   "outfit_top",   {checkFirst:false});
  radioList($("#outfit_pants"),  C.pants, "outfit_pants", {checkFirst:false});
  radioList($("#outfit_skirt"),  C.skirt, "outfit_skirt", {checkFirst:false});
  radioList($("#outfit_dress"),  C.dress, "outfit_dress", {checkFirst:false});
  radioList($("#outfit_shoes"),  C.shoes, "outfit_shoes", {checkFirst:false});
  
  checkList($("#p_outfit_shoes"), C.shoes, "p_outfit_shoes");
  checkList($("#p_outfit_top"),   C.top,   "p_outfit_top");
  checkList($("#p_outfit_pants"), C.pants, "p_outfit_pants");
  checkList($("#p_outfit_skirt"), C.skirt, "p_outfit_skirt");
  checkList($("#p_outfit_dress"), C.dress, "p_outfit_dress");

  radioList($("#bf_age"),      SFW.age,          "bf_age");
  radioList($("#bf_gender"),   SFW.gender,       "bf_gender");
  radioList($("#bf_body"),     SFW.body_type,    "bf_body");
  radioList($("#bf_height"),   SFW.height,       "bf_height");
}

function renderNSFWLearning(){
  const cap = (document.querySelector('input[name="nsfwLevelLearn"]:checked')?.value) || "L1";
  const allow = (lv)=> (lv||"L1") !== "L3";
  const lvl = (x)=>({L1:'R-15', L2:'R-18', L3:'R-18G'})[x||'L1'] || 'R-15';
  const chips = (arr,name)=> normList(arr).filter(o => allow(o.level)).map(o => 
    `<label class="chip">
      <input type="checkbox" name="nsfwL_${name}" value="${o.tag}">
      ${o.label}<span class="mini"> ${lvl(o.level)}</span>
    </label>`).join("");

  const targets = [
    ['nsfwL_expr',      'expression'],
    ['nsfwL_expo',      'exposure'],
    ['nsfwL_situ',      'situation'],
    ['nsfwL_light',     'lighting'],
    ['nsfwL_pose',      'pose'],
    ['nsfwL_acc',       'accessory'],
    ['nsfwL_outfit',    'outfit'],
    ['nsfwL_body',      'body'],
    ['nsfwL_nipple',    'nipples'],
    ['nsfwL_underwear', 'underwear']
  ];

  for (const [elId, nsKey] of targets){
    const el = document.getElementById(elId);
    if (!el) continue;
    el.innerHTML = chips(NSFW[nsKey] || [], nsKey);
  }
}

function renderNSFWProduction(){
  const cap = document.querySelector('input[name="nsfwLevelProd"]:checked')?.value || "L1";
  const order = {L1:1,L2:2,L3:3};
  const allow = (lv)=> (order[(lv||"L1")]||1) <= (order[cap]||1);
  const lvl = (x)=>({L1:"R-15",L2:"R-18",L3:"R-18G"}[(x||"L1")] || "R-15");
  const filt = (arr)=> normList(arr).filter(x=> allow(x.level));
  const chips = (o,name)=> `<label class="chip"><input type="checkbox" name="${name}" value="${o.tag}">${o.label}<span class="mini"> ${lvl(o.level)}</span></label>`;

  $("#nsfwP_expr")  && ($("#nsfwP_expr").innerHTML  = filt(NSFW.expression).map(o=>chips(o,"nsfwP_expr")).join(""));
  $("#nsfwP_expo")  && ($("#nsfwP_expo").innerHTML  = filt(NSFW.exposure).map(o=>chips(o,"nsfwP_expo")).join(""));
  $("#nsfwP_situ")  && ($("#nsfwP_situ").innerHTML  = filt(NSFW.situation).map(o=>chips(o,"nsfwP_situ")).join(""));
  $("#nsfwP_light") && ($("#nsfwP_light").innerHTML = filt(NSFW.lighting).map(o=>chips(o,"nsfwP_light")).join(""));
  $("#nsfwP_pose")     && ($("#nsfwP_pose").innerHTML     = filt(NSFW.pose).map(o=>chips(o,"nsfwP_pose")).join(""));
  $("#nsfwP_acc")      && ($("#nsfwP_acc").innerHTML      = filt(NSFW.accessory).map(o=>chips(o,"nsfwP_acc")).join(""));
  $("#nsfwP_outfit")   && ($("#nsfwP_outfit").innerHTML   = filt(NSFW.outfit).map(o=>chips(o,"nsfwP_outfit")).join(""));
  $("#nsfwP_body")     && ($("#nsfwP_body").innerHTML     = filt(NSFW.body).map(o=>chips(o,"nsfwP_body")).join(""));
  $("#nsfwP_nipple")   && ($("#nsfwP_nipple").innerHTML   = filt(NSFW.nipples).map(o=>chips(o,"nsfwP_nipple")).join(""));
  $("#nsfwP_underwear")&& ($("#nsfwP_underwear").innerHTML= filt(NSFW.underwear).map(o=>chips(o,"nsfwP_underwear")).join(""));
}

/* ===== NSFW切替 ===== */
function bindNSFWToggles(){
  $("#nsfwLearn")?.addEventListener("change", e=>{
    $("#nsfwLearnPanel").style.display = e.target.checked ? "" : "none";
    if(e.target.checked) renderNSFWLearning();
  });
  $('input[name="nsfwLevelLearn"]').forEach(x=> x.addEventListener('change', ()=>{
    if ($("#nsfwLearn")?.checked) renderNSFWLearning();
  }));

  $('input[name="nsfwLevelProd"]').forEach(x=> x.addEventListener('change', renderNSFWProduction));
  $("#nsfwProd")?.addEventListener("change", e=>{
    $("#nsfwProdPanel").style.display = e.target.checked ? "" : "none";
    if (e.target.checked) renderNSFWProduction();
  });
}

/* ===== 辞書I/O ===== */
function isNSFWDict(json){
  const j = json?.NSFW || json || {};
  const cat = j.categories || {};
  const KEYS = ['expression','exposure','situation','lighting','background','pose','accessory','outfit','body','nipples','underwear','表情','露出','シチュ'];
  const hasArr = (o, k) => Array.isArray(o?.[k]) && o[k].length > 0;
  return KEYS.some(k => hasArr(j, k) || hasArr(cat, k));
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
        renderNSFWProduction();
        renderNSFWLearning();
        toast("NSFW辞書を追記しました");
      } else {
        mergeIntoSFW(json);
        renderSFW();
        fillAccessorySlots();
        toast("SFW辞書を追記しました");
      }
    } catch {
      toast("辞書の読み込みに失敗（JSONを確認）");
    } finally {
      e.target.value = "";
    }
  });

  $("#btnExport")?.addEventListener("click", ()=>{
    const save = { sfw:SFW, nsfw:NSFW, settings:Settings };
    dl("lora_prompt_maker_settings.json", JSON.stringify(save,null,2));
  });
}

/* ===== アクセサリー ===== */
function fillAccessorySlots(){
  const accs = normList(SFW.accessories || []);
  const options = `<option value="">（未選択）</option>` + accs.map(a=>`<option value="${a.tag}">${a.label || a.tag}</option>`).join("");
  ["p_accA","p_accB","p_accC","learn_acc"].forEach(id=>{
    const sel = document.getElementById(id); if (sel) sel.innerHTML = options;
  });
}

/* ===== 生成機能 ===== */
function buildOneLearning(extraSeed = 0){
  const textOf = id => (document.getElementById(id)?.textContent || "").trim();
  let p = ["solo"];
  
  const g = getGenderCountTag() || "";
  if (g) p.push(g);

  p.push(...[
    getBFValue('age'), getBFValue('gender'), getBFValue('body'), getBFValue('height'),
    getOne('hairStyle'), getOne('eyeShape'),
    textOf('tagH'), textOf('tagE'), textOf('tagSkin')
  ].filter(Boolean));

  p.push(...[
    getOne('bg'), getOne('pose'), getOne('comp'), getOne('view'), getOne('expr')
  ].filter(Boolean));

  const fixed = (document.getElementById('fixedLearn')?.value || "").trim();
  if (fixed){
    const f = fixed.split(/\s*,\s*/).filter(Boolean);
    p = [...f, ...p];
  }

  const useDefNeg = !!document.getElementById('useDefaultNeg')?.checked;
  const addNeg    = (document.getElementById('negLearn')?.value || "").trim();
  const neg = buildNegative(addNeg, useDefNeg);

  const seed = seedFromName((document.getElementById('charName')?.value || ''), extraSeed);
  const prompt = p.join(", ");
  const text = `${prompt}${neg?` --neg ${neg}`:""} seed:${seed}`;
  return { seed, pos:p, neg, prompt, text };
}

function buildBatchLearning(n){
  const rows = [];
  const wantCount = Math.max(1, Number(n)||1);

  for (let i=0;i<wantCount;i++){
    const one = buildOneLearning(i+1);
    rows.push(one);
  }
  return rows;
}

function buildBatchProduction(n){
  const want = Math.max(1, Number(n) || 1);
  const rows = [];
  
  for(let i=0; i<want; i++){
    let p = ["solo"];
    const g = getGenderCountTag() || "";
    if (g) p.push(g);

    const basics = [
      document.getElementById('tagH')?.textContent,
      document.getElementById('tagE')?.textContent,
      document.getElementById('tagSkin')?.textContent,
      getOne("bf_age"), getOne("bf_gender"), getOne("bf_body"), getOne("bf_height"),
      getOne("hairStyle"), getOne("eyeShape")
    ].filter(Boolean);
    p.push(...basics);

    const bgs = getMany("p_bg");
    const poses = getMany("p_pose");
    const exprs = getMany("p_expr");
    
    if(bgs.length) p.push(bgs[Math.floor(Math.random()*bgs.length)]);
    if(poses.length) p.push(poses[Math.floor(Math.random()*poses.length)]);
    if(exprs.length) p.push(exprs[Math.floor(Math.random()*exprs.length)]);

    const neg = buildNegative((document.getElementById("p_neg")?.value || "").trim(), true);
    const seed = seedFromName((document.getElementById('charName')?.value || ""), i+1);
    const prompt = p.join(", ");
    
    rows.push({ seed, pos:p, prompt, neg, text: `${prompt}${neg?` --neg ${neg}`:""} seed:${seed}` });
  }
  return rows;
}

/* ===== テーブル描画 ===== */
function renderLearnTableTo(tbodySel, rows){
  const tb = document.querySelector(tbodySel);
  if (!tb) return;
  const frag = document.createDocumentFragment();
  rows.forEach((r, i) => {
    const tr = document.createElement("tr");
    const prompt = Array.isArray(r.pos) ? r.pos.join(", ") : (r.prompt || "");
    tr.innerHTML = `
      <td>${i + 1}</td>
      <td>${r.seed}</td>
      <td>${prompt}</td>
      <td>${r.neg || ""}</td>
    `;
    frag.appendChild(tr);
  });
  tb.innerHTML = "";
  tb.appendChild(frag);
}

function renderTextTriplet(baseId, rows, fmtId) {
  if (!rows || !rows.length) return;
  const r = rows[0];
  const prompt = Array.isArray(r.pos) ? r.pos.join(", ") : (r.prompt || "");
  const neg = r.neg || "";
  const seed = r.seed || 0;

  const fmt = getFmt(`#${fmtId||'fmtPlanner'}`);
  const allText = `Prompt: ${prompt}\nNegative prompt: ${neg}\nSeed: ${seed}`;

  const outAll = document.getElementById(`${baseId}All`);
  if (outAll) outAll.textContent = allText;
  const outPrompt = document.getElementById(`${baseId}Prompt`);
  if (outPrompt) outPrompt.textContent = prompt;
  const outNeg = document.getElementById(`${baseId}Neg`);
  if (outNeg) outNeg.textContent = neg;
}

function bindCopyTripletExplicit(pairs){
  if (!Array.isArray(pairs)) return;
  pairs.forEach(pair => {
    if (!Array.isArray(pair) || pair.length < 2) return;
    const [btnId, outId] = pair;
    const btn = document.getElementById(btnId);
    const out = document.getElementById(outId);
    if (!btn || !out) return;

    btn.addEventListener('click', () => {
      const text = (out.textContent || '').trim();
      if (!text) { toast('コピーする内容がありません'); return; }
      navigator.clipboard?.writeText(text)
        .then(()=> toast('コピーしました'))
        .catch(()=> {
          const ta = document.createElement('textarea');
          ta.value = text; document.body.appendChild(ta); ta.select();
          document.execCommand('copy'); ta.remove(); toast('コピーしました');
        });
    });
  });
}

/* ===== CSV出力 ===== */
function csvFromLearn(fmtSelId = "#fmtLearnBatch") {
  const fmt = getFmt(fmtSelId);
  const header = ['"no"','"seed"','"prompt"','"negative"','"merged"','"line"'];
  const rows = Array.from($("#tblLearn tbody")?.querySelectorAll("tr") || []).map((tr, i) => {
    const tds = Array.from(tr.children).map(td => td.textContent || "");
    const no = tds[0] || (i+1);
    const seed = tds[1] || "";
    const p = tds[2] || "";
    const n = tds[3] || "";
    const merged = `${p}\nNegative prompt: ${n}`;
    const line = fmt.line(p, n, seed);
    const esc = (s) => `"${String(s).replace(/"/g, '""')}"`;
    return [esc(no), esc(seed), esc(p), esc(n), esc(merged), esc(line)].join(",");
  });
  return [header.join(","), ...rows].join("\n");
}

function csvFromProd(fmtSelId = "#fmtProd") {
  const fmt = getFmt(fmtSelId);
  const header = ['"no"','"seed"','"prompt"','"negative"','"merged"','"line"'];
  const rows = Array.from($("#tblProd tbody")?.querySelectorAll("tr") || []).map((tr) => {
    const tds = Array.from(tr.children).map(td => td.textContent || "");
    const no = tds[0] || "", seed = tds[1] || "", p = tds[2] || "", n = tds[3] || "";
    const merged = `${p}\nNegative prompt: ${n}`;
    const line = fmt.line(p, n, seed);
    const esc = (s) => `"${String(s).replace(/"/g, '""')}"`;
    return [esc(no), esc(seed), esc(p), esc(n), esc(merged), esc(line)].join(",");
  });
  return [header.join(","), ...rows].join("\n");
}

/* ===== クラウド送信 ===== */
async function postCSVtoGAS(kind, csv, meta = {}) {
  const url = (Settings.gasUrl || '').trim();
  if (!url) { toast("クラウド保存URLを設定してください"); throw new Error("missing GAS url"); }

  const nameChar = ($("#charName")?.value || "").replace(/[^\w\-]/g, "_") || "noname";
  const body = {
    kind, filename: `${kind}_${nameChar}_${nowStamp()}.csv`, csv,
    meta: { charName: $("#charName")?.value || "", ...meta }, ts: Date.now()
  };

  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "text/plain; charset=utf-8" },
    body: JSON.stringify(body)
  });

  const txt = await r.text().catch(()=>"(no text)");
  if (!r.ok) throw new Error("bad status: " + r.status + " " + txt);
  toast("クラウド（GAS）へ保存しました");
}

/* ===== 初期化 ===== */
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

function bindLearnBatch(){
  document.getElementById("btnBatchLearn")?.addEventListener("click", ()=>{
    const cnt = parseInt(document.getElementById("countLearn")?.value, 10) || 24;
    const rows = buildBatchLearning(cnt);
    renderLearnTableTo("#tblLearn tbody", rows);
    renderTextTriplet("outLearn", rows, "fmtLearnBatch");
  });

  bindCopyTripletExplicit([
    ["btnCopyLearnAll", "outLearnAll"],
    ["btnCopyLearnPrompt", "outLearnPrompt"],
    ["btnCopyLearnNeg", "outLearnNeg"]
  ]);

  document.getElementById("btnCsvLearn")?.addEventListener("click", ()=>{
    const csv = csvFromLearn();
    const char = (document.getElementById("charName")?.value || "noname").replace(/[^\w\-]/g,"_");
    dl(`learning_${char}_${nowStamp()}.csv`, csv);
    toast("学習CSVを保存しました");
  });

  document.getElementById("btnCloudLearn")?.addEventListener("click", async ()=>{
    const csv = csvFromLearn();
    await postCSVtoGAS("learning", csv);
  });
}

function bindProduction(){
  document.getElementById("btnGenProd")?.addEventListener("click", ()=>{
    const cnt = parseInt(document.getElementById("countProd").value,10) || 50;
    const rows = buildBatchProduction(cnt);
    renderLearnTableTo("#tblProd tbody", rows);
    renderTextTriplet('outProd', rows, 'fmtProd');
  });

  bindCopyTripletExplicit([
    ['btnCopyProdAll', 'outProdAll'],
    ['btnCopyProdPrompt', 'outProdPrompt'],
    ['btnCopyProdNeg', 'outProdNeg']
  ]);

  document.getElementById("btnCsvProd")?.addEventListener("click", ()=>{
    const csv = csvFromProd();
    const char=(document.getElementById("charName")?.value||"noname").replace(/[^\w\-]/g,"_");
    dl(`production_${char}_${nowStamp()}.csv`, csv);
    toast("量産CSVを保存しました");
  });

  document.getElementById("btnCloudProd")?.addEventListener("click", async ()=>{
    const csv = csvFromProd();
    await postCSVtoGAS("production", csv);
  });
}

function bindGASTools(){
  document.getElementById("btnSaveSettings")?.addEventListener("click", saveSettings);
  document.getElementById("btnResetSettings")?.addEventListener("click", resetSettings);

  $("#btnTestGAS")?.addEventListener("click", async ()=>{
    saveSettings();
    const url = (Settings.gasUrl || '').trim();
    const out = $("#gasTestResult");
    if (!url) { if(out) out.textContent = "URL未設定"; return; }

    if(out) out.textContent = "テスト中…";
    try {
      const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "text/plain; charset=utf-8" },
        body: JSON.stringify({ kind: "ping", ts: Date.now() })
      });
      const txt = await r.text().catch(()=>"(no text)");
      if(out) out.textContent = r.ok ? (txt ? `OK: ${txt}` : "OK") : `NG (${r.status})`;
    } catch (e) {
      if(out) out.textContent = "送信完了（応答確認不可）";
    }
  });
}

function initHairEyeAndAccWheels(){
  window.getHairColorTag = initWheel("#wheelH", "#thumbH", "#satH", "#litH", "#swH", "#tagH", "hair");
  window.getEyeColorTag = initWheel("#wheelE", "#thumbE", "#satE", "#litE", "#swE", "#tagE", "eyes");
  window.getLearnAccColor = initColorWheel("learnAcc", 0, 75, 50);
  window.getAccAColor = initColorWheel("accA", 0, 80, 50);
  window.getAccBColor = initColorWheel("accB", 200, 80, 50);
  window.getAccCColor = initColorWheel("accC", 120, 80, 50);

  window.getTopColor = initColorWheel("top", 35, 80, 55);
  window.getBottomColor = initColorWheel("bottom", 210, 70, 50);
  window.getShoesColor = initColorWheel("shoes", 0, 0, 30);
}

function initSkinTone(){
  const s = document.getElementById('skinTone');
  if (s) {
    s.addEventListener('input', paintSkin);
    paintSkin();
  }
}

function initAll(){
  if (window.__LPM_INITED) return;
  window.__LPM_INITED = true;

  loadSettings();
  bindDictIO();
  bindNSFWToggles();
  bindLearnBatch();
  bindProduction();
  bindGASTools();
  initTagDictionaries();

  loadDefaultDicts().then(()=>{
    renderSFW();
    renderNSFWLearning();
    renderNSFWProduction();
    fillAccessorySlots();
    initHairEyeAndAccWheels();
    initSkinTone();
  });
}

document.addEventListener('DOMContentLoaded', initAll);
