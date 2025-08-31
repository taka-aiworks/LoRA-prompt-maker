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
  age:[], gender:[], body_type:[], height:[], personality:[], colors:[]
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
    "性別":"gender", "体型(基本)":"body_type", "身長":"height", "性格":"personality",
    "色":"colors"
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

// initColorWheel関数内のpaint関数を修正
function initColorWheel(idBase, defaultHue = 0, defaultS = 80, defaultL = 50) {
  const wheel = document.getElementById("wheel_" + idBase);
  const thumb = document.getElementById("thumb_" + idBase);
  const sat = document.getElementById("sat_" + idBase);
  const lit = document.getElementById("lit_" + idBase);
  const sw = document.getElementById("sw_" + idBase);
  const tag = document.getElementById("tag_" + idBase);
  
  if (!wheel || !thumb || !sat || !lit || !sw || !tag) {
    return () => (document.getElementById("tag_" + idBase)?.textContent || "").trim();
  }
  
  let hue = defaultHue;
  
  sat.value = defaultS;
  lit.value = defaultL;
  
  function paint() {
    const s = +sat.value;
    const l = +lit.value;
    const [r, g, b] = hslToRgb(hue, s, l);
    sw.style.background = `rgb(${r},${g},${b})`;
    
    // 対応する使用チェックボックスがあるか確認
    const useCheckbox = document.getElementById("use_" + idBase) || 
                       document.getElementById("p_use_" + idBase) ||
                       document.getElementById("useBottomColor");
    
    if (useCheckbox && !useCheckbox.checked) {
      tag.textContent = "—";
    } else {
      tag.textContent = colorNameFromHSL(hue, s, l);
    }
  }
  
  const onHue = (h) => {
    hue = h;
    onHue.__lastHue = h;
    paint();
  };
  onHue.__lastHue = hue;
  
  addHueDrag(wheel, thumb, onHue);
  
  sat.addEventListener("input", paint);
  lit.addEventListener("input", paint);
  
  // 使用チェックボックスの変更を監視
  const useCheckbox = document.getElementById("use_" + idBase) || 
                     document.getElementById("p_use_" + idBase) ||
                     document.getElementById("useBottomColor");
  if (useCheckbox) {
    useCheckbox.addEventListener("change", paint);
  }
  
  requestAnimationFrame(() => {
    paint();
    const rect = wheel.getBoundingClientRect();
    const radius = rect.width / 2 - 7;
    const radians = (hue - 90) * Math.PI / 180;
    const centerX = rect.width / 2;
    const centerY = rect.height / 2;
    
    thumb.style.left = (centerX + radius * Math.cos(radians) - 7) + "px";
    thumb.style.top = (centerY + radius * Math.sin(radians) - 7) + "px";
  });
  
  return () => tag.textContent.trim();
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
// categorizeOutfit関数を修正（JSON辞書ベース）
function categorizeOutfit(list){
  const L = normList(list || []);
  const C = { top:[], pants:[], skirt:[], dress:[], shoes:[] };

  for (const t of L) {
    // 辞書の cat プロパティを最優先
    const dictCat = (t.cat || "").toLowerCase();
    if (dictCat) {
      if (dictCat === "top")      { C.top.push(t);   continue; }
      if (dictCat === "pants")    { C.pants.push(t); continue; }
      if (dictCat === "skirt")    { C.skirt.push(t); continue; }
      if (dictCat === "dress")    { C.dress.push(t); continue; }
      if (dictCat === "shoes")    { C.shoes.push(t); continue; }
    }

    // 辞書にcat情報がない場合のみ正規表現フォールバック
    const tag = (t.tag || "").toLowerCase();
    if (/(t-shirt|tank|blouse|shirt|hoodie|sweater|cardigan|jacket|coat|top)/.test(tag)) { 
      C.top.push(t); continue; 
    }
    if (/(jeans|pants|trousers|shorts|cargo|bermuda|leggings|overalls|hakama)/.test(tag)) { 
      C.pants.push(t); continue; 
    }
    if (/(skirt)/.test(tag)) { 
      C.skirt.push(t); continue; 
    }
    if (/(dress|gown|yukata|kimono|cheongsam|hanbok|sari|uniform)/.test(tag)) { 
      C.dress.push(t); continue; 
    }
    if (/(boots|sneakers|loafers|mary janes|heel|sandal|shoe)/.test(tag)) { 
      C.shoes.push(t); continue; 
    }
    
    // 分類不明な場合はtopに分類
    C.top.push(t);
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
  
  const nsfwLevelLearnRadios = document.querySelectorAll('input[name="nsfwLevelLearn"]');
  nsfwLevelLearnRadios.forEach(x => x.addEventListener('change', () => {
    if ($("#nsfwLearn")?.checked) renderNSFWLearning();
  }));

  const nsfwLevelProdRadios = document.querySelectorAll('input[name="nsfwLevelProd"]');
  nsfwLevelProdRadios.forEach(x => x.addEventListener('change', renderNSFWProduction));
  
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
  ["p_accA","p_accB","p_accC","learn_acc","pl_accSel"].forEach(id=>{
    const sel = document.getElementById(id); if (sel) sel.innerHTML = options;
  });
}

// bindBasicInfo関数の修正版
function bindBasicInfo() {
  // キャラ設定インポート
  const importChar = document.getElementById("importChar");
  if (importChar) {
    importChar.addEventListener("change", async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      
      try {
        const text = await file.text();
        const data = JSON.parse(text);
        
        // 基本情報を復元
        if (data.charName) {
          const charNameEl = document.getElementById("charName");
          if (charNameEl) charNameEl.value = data.charName;
        }
        
        if (data.loraTag) {
          const loraTagEl = document.getElementById("loraTag");
          if (loraTagEl) loraTagEl.value = data.loraTag;
        }
        
        // 服モード復元
        if (data.outfitMode) {
          const outfitModeRadio = document.querySelector(`input[name="outfitMode"][value="${data.outfitMode}"]`);
          if (outfitModeRadio) outfitModeRadio.checked = true;
        }
        
        // 下カテゴリ復元
        if (data.bottomCat) {
          const bottomCatRadio = document.querySelector(`input[name="bottomCat"][value="${data.bottomCat}"]`);
          if (bottomCatRadio) bottomCatRadio.checked = true;
        }
        
        // ラジオボタンの復元
        ['bf_age', 'bf_gender', 'bf_body', 'bf_height', 'hairStyle', 'eyeShape'].forEach(name => {
          if (data[name]) {
            const radio = document.querySelector(`input[name="${name}"][value="${data[name]}"]`);
            if (radio) radio.checked = true;
          }
        });
        
        // 服の選択を復元
        ['outfit_top', 'outfit_pants', 'outfit_skirt', 'outfit_dress', 'outfit_shoes'].forEach(name => {
          if (data[name]) {
            const radio = document.querySelector(`input[name="${name}"][value="${data[name]}"]`);
            if (radio) radio.checked = true;
          }
        });
        
        // 色の復元（髪・目・肌）
        if (data.hairColor) {
          const satH = document.getElementById("satH");
          const litH = document.getElementById("litH");
          if (satH && data.hairColor.s) satH.value = data.hairColor.s;
          if (litH && data.hairColor.l) litH.value = data.hairColor.l;
          if (data.hairColor.h !== undefined && window.getHairColorTag) {
            setTimeout(() => paintHairColor(data.hairColor.h), 100);
          }
        }
        
        if (data.eyeColor) {
          const satE = document.getElementById("satE");
          const litE = document.getElementById("litE");
          if (satE && data.eyeColor.s) satE.value = data.eyeColor.s;
          if (litE && data.eyeColor.l) litE.value = data.eyeColor.l;
          if (data.eyeColor.h !== undefined && window.getEyeColorTag) {
            setTimeout(() => paintEyeColor(data.eyeColor.h), 100);
          }
        }
        
        if (data.skinTone !== undefined) {
          const skinTone = document.getElementById("skinTone");
          if (skinTone) skinTone.value = data.skinTone;
        }
        
        // 服の色の復元
        ['top', 'bottom', 'shoes'].forEach(type => {
          if (data[`${type}Color`]) {
            const useCheckbox = document.getElementById(`use_${type}`);
            const sat = document.getElementById(`sat_${type}`);
            const lit = document.getElementById(`lit_${type}`);
            
            if (useCheckbox) useCheckbox.checked = data[`${type}Color`].use !== false;
            if (sat && data[`${type}Color`].s !== undefined) sat.value = data[`${type}Color`].s;
            if (lit && data[`${type}Color`].l !== undefined) lit.value = data[`${type}Color`].l;
            
            if (data[`${type}Color`].h !== undefined) {
              const colorFunc = window[`get${type.charAt(0).toUpperCase()}${type.slice(1)}Color`];
              if (colorFunc) {
                setTimeout(() => {
                  const wheel = document.getElementById(`wheel_${type}`);
                  const thumb = document.getElementById(`thumb_${type}`);
                  if (wheel && thumb) {
                    const rect = wheel.getBoundingClientRect();
                    const radius = rect.width / 2 - 7;
                    const radians = (data[`${type}Color`].h - 90) * Math.PI / 180;
                    const centerX = rect.width / 2;
                    const centerY = rect.height / 2;
                    
                    thumb.style.left = (centerX + radius * Math.cos(radians) - 7) + "px";
                    thumb.style.top = (centerY + radius * Math.sin(radians) - 7) + "px";
                    
                    // 色相更新
                    if (colorFunc.onHue) colorFunc.onHue(data[`${type}Color`].h);
                  }
                }, 150);
              }
            }
          }
        });
        
        // UI更新
        setTimeout(() => {
          if (window.applyOutfitMode) window.applyOutfitMode();
          paintSkin();
        }, 200);
        
        toast("キャラ設定を読み込みました");
      } catch (error) {
        console.error("キャラ設定読み込みエラー:", error);
        toast("キャラ設定の読み込みに失敗しました");
      }
      
      e.target.value = "";
    });
  }
  
  // キャラ設定エクスポート
  const exportChar = document.getElementById("btnExportChar");
  if (exportChar) {
    exportChar.addEventListener("click", () => {
      const data = {
        charName: document.getElementById("charName")?.value || "",
        loraTag: document.getElementById("loraTag")?.value || "",
        // 服モード
        outfitMode: getOne('outfitMode'),
        bottomCat: getOne('bottomCat'),
        // 基本情報
        bf_age: getOne('bf_age'),
        bf_gender: getOne('bf_gender'),
        bf_body: getOne('bf_body'),
        bf_height: getOne('bf_height'),
        hairStyle: getOne('hairStyle'),
        eyeShape: getOne('eyeShape'),
        face: getOne('face'),
        skinBody: getOne('skinBody'),
        artStyle: getOne('artStyle'),
        // 服
        outfit_top: getOne('outfit_top'),
        outfit_pants: getOne('outfit_pants'),
        outfit_skirt: getOne('outfit_skirt'),
        outfit_dress: getOne('outfit_dress'),
        outfit_shoes: getOne('outfit_shoes'),
        // 色情報（髪・目・肌）
        hairColor: {
          h: window.getHairColorTag?.onHue?.__lastHue || 35,
          s: document.getElementById("satH")?.value || 70,
          l: document.getElementById("litH")?.value || 45
        },
        eyeColor: {
          h: window.getEyeColorTag?.onHue?.__lastHue || 240,
          s: document.getElementById("satE")?.value || 80,
          l: document.getElementById("litE")?.value || 55
        },
        skinTone: document.getElementById("skinTone")?.value || 30,
        // 服の色情報
        topColor: {
          use: document.getElementById("use_top")?.checked || false,
          h: window.getTopColor?.onHue?.__lastHue || 35,
          s: document.getElementById("sat_top")?.value || 80,
          l: document.getElementById("lit_top")?.value || 55
        },
        bottomColor: {
          use: document.getElementById("useBottomColor")?.checked || false,
          h: window.getBottomColor?.onHue?.__lastHue || 210,
          s: document.getElementById("sat_bottom")?.value || 70,
          l: document.getElementById("lit_bottom")?.value || 50
        },
        shoesColor: {
          use: document.getElementById("use_shoes")?.checked || false,
          h: window.getShoesColor?.onHue?.__lastHue || 0,
          s: document.getElementById("sat_shoes")?.value || 0,
          l: document.getElementById("lit_shoes")?.value || 30
        }
      };
      
      const filename = `character_${data.charName || 'unnamed'}_${nowStamp()}.json`;
      dl(filename, JSON.stringify(data, null, 2));
      toast("キャラ設定をエクスポートしました");
    });
  }
  
  // 1枚テストボタン
  const btnOneLearn = document.getElementById("btnOneLearn");
  if (btnOneLearn) {
    btnOneLearn.addEventListener("click", () => {
      try {
        const result = buildOneLearning(0);
        renderTextTriplet("outLearnTest", [result], "fmtLearn");
        toast("テスト生成完了");
      } catch (error) {
        console.error("テスト生成エラー:", error);
        toast("テスト生成に失敗しました");
      }
    });
  }
  
  // 1枚テストのコピーボタン
  bindCopyTripletExplicit([
    ["btnCopyLearnTestAll", "outLearnTestAll"],
    ["btnCopyLearnTestPrompt", "outLearnTestPrompt"],
    ["btnCopyLearnTestNeg", "outLearnTestNeg"]
  ]);
}

/* ===== 単語モードの初期化 ===== */
function initWordMode() {
  // 単語モードの基本初期化はここで行う
  window.initWordModeItems = function() {
    // SFW項目の初期化
    const sfwCategories = {
      'background': SFW.background || [],
      'pose': SFW.pose || [],
      'composition': SFW.composition || [],
      'view': SFW.view || [],
      'expression-sfw': SFW.expressions || [],
      'lighting-sfw': SFW.lighting || [],
      'accessories': SFW.accessories || []
    };

    // NSFW項目の初期化
    const nsfwCategories = {
      'exposure': NSFW.exposure || [],
      'underwear-nsfw': NSFW.underwear || [],
      'outfit-nsfw': NSFW.outfit || [],
      'expression-nsfw': NSFW.expression || [],
      'situation': NSFW.situation || [],
      'lighting-nsfw': NSFW.lighting || [],
      'pose-nsfw': NSFW.pose || [],
      'accessory-nsfw': NSFW.accessory || [],
      'body-nsfw': NSFW.body || [],
      'nipple-nsfw': NSFW.nipples || []
    };
    
    // 色の初期化
    const colors = SFW.colors || [
      {tag: 'white', label: '白'},
      {tag: 'black', label: '黒'},
      {tag: 'red', label: '赤'},
      {tag: 'blue', label: '青'},
      {tag: 'green', label: '緑'},
      {tag: 'yellow', label: '黄'},
      {tag: 'pink', label: 'ピンク'},
      {tag: 'purple', label: '紫'},
      {tag: 'orange', label: 'オレンジ'},
      {tag: 'brown', label: '茶'}
    ];
    
    // 各カテゴリにアイテムを追加
    Object.entries(sfwCategories).forEach(([cat, items]) => {
      const container = document.getElementById(`wm-items-${cat}`);
      const count = document.getElementById(`wm-count-${cat}`);
      if (container && items.length > 0) {
        container.innerHTML = items.map(item => createWordModeItem(item, cat)).join('');
        if (count) count.textContent = items.length;
      }
    });
    
    Object.entries(nsfwCategories).forEach(([cat, items]) => {
      const container = document.getElementById(`wm-items-${cat}`);
      const count = document.getElementById(`wm-count-${cat}`);
      if (container && items.length > 0) {
        container.innerHTML = items.map(item => createWordModeItem(item, cat)).join('');
        if (count) count.textContent = items.length;
      }
    });
    
    // 色の初期化
    const colorContainer = document.getElementById('wm-items-color');
    const colorCount = document.getElementById('wm-count-color');
    if (colorContainer) {
      colorContainer.innerHTML = colors.map(item => createWordModeColorItem(item)).join('');
      if (colorCount) colorCount.textContent = colors.length;
    }
    
    // イベントハンドラーを追加
    bindWordModeEvents();
  };
}

/* ===== 単語モードのイベントバインド ===== */
function bindWordModeEvents() {
  const root = document.getElementById('panelWordMode');
  if (!root) return;

  // 選択中チップのクリア
  const clearBtn = root.querySelector('#wm-selected-clear');
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      const chipsContainer = root.querySelector('#wm-selected-chips');
      if (chipsContainer) chipsContainer.innerHTML = '';
      updateSelectedCount();
    });
  }

  // クリック委譲（panelWordMode内のみ）
  root.addEventListener('click', (e) => {
    // <summary>（カテゴリ見出し）はここで素通りさせる
    if (e.target.closest('summary')) return;

    // EN/BOTH コピー（カード内アクション）
    if (e.target.classList.contains('wm-copy-en')) {
      e.preventDefault(); e.stopPropagation();
      const item = e.target.closest('.wm-item');
      const en = item?.dataset.en || '';
      if (en) navigator.clipboard?.writeText(en).then(() => toast('英語タグをコピーしました'));
      return;
    }
    if (e.target.classList.contains('wm-copy-both')) {
      e.preventDefault(); e.stopPropagation();
      const item = e.target.closest('.wm-item');
      const jp = item?.dataset.jp || '';
      const en = item?.dataset.en || '';
      const text = jp && en ? `${jp}(${en})` : (en || jp);
      if (text) navigator.clipboard?.writeText(text).then(() => toast('日英タグをコピーしました'));
      return;
    }

    // アイテム選択
    const itemBtn = e.target.closest('.wm-item');
    if (itemBtn) {
      const en = itemBtn.dataset.en || '';
      const jp = itemBtn.dataset.jp || '';
      const cat = itemBtn.dataset.cat || '';
      if (en && jp) {
        addToSelectedChips(en, jp, cat);
        addToOutputTable(en, jp);
        updateSelectedCount();
      }
    }
  });
   
  // テーブルの全コピーボタン
  const copyAllEn   = root.querySelector('#wm-copy-en-all');
  const copyAllBoth = root.querySelector('#wm-copy-both-all');
  const tableClear  = root.querySelector('#wm-table-clear');

  if (copyAllEn) {
    copyAllEn.addEventListener('click', () => {
      const rows = root.querySelectorAll('#wm-table-body tr');
      const tags = Array.from(rows).map(row => row.dataset.en || '').filter(Boolean);
      if (tags.length) navigator.clipboard?.writeText(tags.join(', ')).then(() => toast('全英語タグをコピーしました'));
    });
  }
  if (copyAllBoth) {
    copyAllBoth.addEventListener('click', () => {
      const rows = root.querySelectorAll('#wm-table-body tr');
      const tags = Array.from(rows).map(row => {
        const en = row.dataset.en || '';
        const jp = row.querySelector('.wm-row-jp')?.textContent || '';
        return jp && en ? `${jp}(${en})` : (en || jp);
      }).filter(Boolean);
      if (tags.length) navigator.clipboard?.writeText(tags.join(', ')).then(() => toast('全タグをコピーしました'));
    });
  }
  if (tableClear) {
    tableClear.addEventListener('click', () => {
      const tbody = root.querySelector('#wm-table-body');
      if (tbody) tbody.innerHTML = '';
    });
  }
}


function createWordModeColorItem(item) {
  const template = document.getElementById('wm-item-tpl-color');
  if (!template) return '';
  
  const clone = template.content.cloneNode(true);
  const button = clone.querySelector('.wm-item');
  const jpSpan = clone.querySelector('.wm-jp');
  const enSpan = clone.querySelector('.wm-en');
  
  if (button && jpSpan && enSpan) {
    button.dataset.en = item.tag || '';
    button.dataset.jp = item.label || item.tag || '';
    button.dataset.cat = 'color';
    
    jpSpan.textContent = item.label || item.tag || '';
    enSpan.textContent = item.tag || '';
  }
  
  return clone.firstElementChild ? clone.firstElementChild.outerHTML : '';
}


function addToSelectedChips(en, jp, cat) {
  const container = document.getElementById('wm-selected-chips');
  if (!container || selectedCount >= 20) return;
  
  // 重複チェック
  if (container.querySelector(`[data-en="${en}"]`)) return;
  
  const chip = document.createElement('span');
  chip.className = 'wm-selected-chip';
  chip.dataset.en = en;
  chip.dataset.jp = jp;
  chip.innerHTML = `${jp}<small>(${en})</small><button type="button" onclick="removeSelectedChip(this)">×</button>`;
  
  container.appendChild(chip);
  selectedCount++;
  updateSelectedCount();
}

function removeSelectedChip(btn) {
  const chip = btn.closest('.wm-selected-chip');
  if (chip) {
    chip.remove();
    selectedCount--;
    updateSelectedCount();
  }
}

function updateSelectedCount() {
  const countEl = document.getElementById('wm-selected-count');
  if (countEl) countEl.textContent = selectedCount;
}

function addToOutputTable(en, jp) {
  const tbody = document.getElementById('wm-table-body');
  if (!tbody) return;
  
  // 最大20件制限
  if (tbody.children.length >= 20) return;
  
  // 重複チェック
  if (tbody.querySelector(`tr[data-en="${en}"]`)) return;
  
  const template = document.getElementById('wm-row-tpl');
  if (!template) return;
  
  const clone = template.content.cloneNode(true);
  const row = clone.querySelector('tr');
  const jpCell = clone.querySelector('.wm-row-jp');
  const enCell = clone.querySelector('.wm-row-en');
  const copyEnBtn = clone.querySelector('.wm-row-copy-en');
  const copyBothBtn = clone.querySelector('.wm-row-copy-both');
  const removeBtn = clone.querySelector('.wm-row-remove');
  
  if (row && jpCell && enCell) {
    row.dataset.en = en;
    jpCell.textContent = jp;
    enCell.textContent = en;
    
    if (copyEnBtn) {
      copyEnBtn.addEventListener('click', () => {
        navigator.clipboard?.writeText(en).then(() => toast('英語タグをコピーしました'));
      });
    }
    
    if (copyBothBtn) {
      copyBothBtn.addEventListener('click', () => {
        const text = jp && en ? `${jp}(${en})` : (en || jp);
        navigator.clipboard?.writeText(text).then(() => toast('日英タグをコピーしました'));
      });
    }
    
    if (removeBtn) {
      removeBtn.addEventListener('click', () => {
        row.remove();
      });
    }
    
    tbody.appendChild(row);
  }
}
// 単語モード用のヘルパー関数を追加
function createWordModeItem(item, category) {
  const template = document.getElementById('wm-item-tpl');
  if (!template) return '';
  
  const clone = template.content.cloneNode(true);
  const button = clone.querySelector('.wm-item');
  const jpSpan = clone.querySelector('.wm-jp');
  const enSpan = clone.querySelector('.wm-en');
  
  if (button && jpSpan && enSpan) {
    button.dataset.en = item.tag || '';
    button.dataset.jp = item.label || item.tag || '';
    button.dataset.cat = category;
    
    jpSpan.textContent = item.label || item.tag || '';
    enSpan.textContent = item.tag || '';
  }
  
  return clone.firstElementChild ? clone.firstElementChild.outerHTML : '';
}

function createWordModeColorItem(item) {
  const template = document.getElementById('wm-item-tpl-color');
  if (!template) return '';
  
  const clone = template.content.cloneNode(true);
  const button = clone.querySelector('.wm-item');
  const jpSpan = clone.querySelector('.wm-jp');
  const enSpan = clone.querySelector('.wm-en');
  
  if (button && jpSpan && enSpan) {
    button.dataset.en = item.tag || '';
    button.dataset.jp = item.label || item.tag || '';
    button.dataset.cat = 'color';
    
    jpSpan.textContent = item.label || item.tag || '';
    enSpan.textContent = item.tag || '';
  }
  
  return clone.firstElementChild ? clone.firstElementChild.outerHTML : '';
}

let selectedCount = 0;

function addToSelectedChips(en, jp, cat) {
  const container = document.getElementById('wm-selected-chips');
  if (!container || selectedCount >= 20) return;
  
  // 重複チェック
  if (container.querySelector(`[data-en="${en}"]`)) return;
  
  const chip = document.createElement('span');
  chip.className = 'wm-selected-chip';
  chip.dataset.en = en;
  chip.dataset.jp = jp;
  chip.innerHTML = `${jp}<small>(${en})</small><button type="button" onclick="removeSelectedChip(this)">×</button>`;
  
  container.appendChild(chip);
  selectedCount++;
  updateSelectedCount();
}

function removeSelectedChip(btn) {
  const chip = btn.closest('.wm-selected-chip');
  if (chip) {
    chip.remove();
    selectedCount--;
    updateSelectedCount();
  }
}

function updateSelectedCount() {
  const countEl = document.getElementById('wm-selected-count');
  if (countEl) countEl.textContent = selectedCount;
}

function addToOutputTable(en, jp) {
  const tbody = document.getElementById('wm-table-body');
  if (!tbody) return;
  
  // 最大20件制限
  if (tbody.children.length >= 20) return;
  
  // 重複チェック
  if (tbody.querySelector(`tr[data-en="${en}"]`)) return;
  
  const template = document.getElementById('wm-row-tpl');
  if (!template) return;
  
  const clone = template.content.cloneNode(true);
  const row = clone.querySelector('tr');
  const jpCell = clone.querySelector('.wm-row-jp');
  const enCell = clone.querySelector('.wm-row-en');
  const copyEnBtn = clone.querySelector('.wm-row-copy-en');
  const copyBothBtn = clone.querySelector('.wm-row-copy-both');
  const removeBtn = clone.querySelector('.wm-row-remove');
  
  if (row && jpCell && enCell) {
    row.dataset.en = en;
    jpCell.textContent = jp;
    enCell.textContent = en;
    
    if (copyEnBtn) {
      copyEnBtn.addEventListener('click', () => {
        navigator.clipboard?.writeText(en).then(() => toast('英語タグをコピーしました'));
      });
    }
    
    if (copyBothBtn) {
      copyBothBtn.addEventListener('click', () => {
        const text = jp && en ? `${jp}(${en})` : (en || jp);
        navigator.clipboard?.writeText(text).then(() => toast('日英タグをコピーしました'));
      });
    }
    
    if (removeBtn) {
      removeBtn.addEventListener('click', () => {
        row.remove();
      });
    }
    
    tbody.appendChild(row);
  }
}
   
  // テーブルの全コピーボタン
  const copyAllEn   = root.querySelector('#wm-copy-en-all');
  const copyAllBoth = root.querySelector('#wm-copy-both-all');
  const tableClear  = root.querySelector('#wm-table-clear');

  if (copyAllEn) {
    copyAllEn.addEventListener('click', () => {
      const rows = root.querySelectorAll('#wm-table-body tr');
      const tags = Array.from(rows).map(row => row.dataset.en || '').filter(Boolean);
      if (tags.length) navigator.clipboard?.writeText(tags.join(', ')).then(() => toast('全英語タグをコピーしました'));
    });
  }
  if (copyAllBoth) {
    copyAllBoth.addEventListener('click', () => {
      const rows = root.querySelectorAll('#wm-table-body tr');
      const tags = Array.from(rows).map(row => {
        const en = row.dataset.en || '';
        const jp = row.querySelector('.wm-row-jp')?.textContent || '';
        return jp && en ? `${jp}(${en})` : (en || jp);
      }).filter(Boolean);
      if (tags.length) navigator.clipboard?.writeText(tags.join(', ')).then(() => toast('全タグをコピーしました'));
    });
  }
  if (tableClear) {
    tableClear.addEventListener('click', () => {
      const tbody = root.querySelector('#wm-table-body');
      if (tbody) tbody.innerHTML = '';
    });
  }
}


/* ===== 撮影モードの初期化 ===== */
function initPlannerMode() {
  let plannerInitialized = false;
  
  window.pmInitPlannerOnce = function() {
    if (plannerInitialized) return;
    plannerInitialized = true;
    
    // 撮影モードのアクセサリーセレクト初期化
    const plAccSel = document.getElementById("pl_accSel");
    if (plAccSel && SFW.accessories) {
      const options = '<option value="">（未選択）</option>' + 
        SFW.accessories.map(acc => `<option value="${acc.tag}">${acc.label || acc.tag}</option>`).join('');
      plAccSel.innerHTML = options;
    }
    
    // 撮影モードの色ホイール初期化
    window.getPlannerAccColor = initColorWheel("plAcc", 0, 75, 50);
    
    // 撮影モード用のNSFWトグル
    const plNsfw = document.getElementById("pl_nsfw");
    const plNsfwPanel = document.getElementById("pl_nsfwPanel");
    if (plNsfw && plNsfwPanel) {
      plNsfw.addEventListener("change", (e) => {
        plNsfwPanel.style.display = e.target.checked ? "" : "none";
        if (e.target.checked) {
          renderPlannerNSFW();
        }
      });
    }
    
    // NSFWレベル変更
    const plNsfwLevelRadios = document.querySelectorAll('input[name="pl_nsfwLevel"]');
    plNsfwLevelRadios.forEach(radio => {
      radio.addEventListener('change', () => {
        if (document.getElementById("pl_nsfw")?.checked) {
          renderPlannerNSFW();
        }
      });
    });
    
    // 撮影モード出力ボタン
    const btnPlanOne = document.getElementById("btnPlanOne");
    if (btnPlanOne) {
      btnPlanOne.addEventListener("click", () => {
        try {
          const result = buildOnePlanner();
          renderTextTriplet("outPlanner", [result], "fmtPlanner");
          toast("撮影モード生成完了");
        } catch (error) {
          console.error("撮影モード生成エラー:", error);
          toast("撮影モード生成に失敗しました");
        }
      });
    }
    
    // 撮影モードのコピーボタン
    bindCopyTripletExplicit([
      ["btnCopyPlannerAll", "outPlannerAll"],
      ["btnCopyPlannerPrompt", "outPlannerPrompt"],
      ["btnCopyPlannerNeg", "outPlannerNeg"]
    ]);
  };
  
  // 撮影モードのレンダリング修正
window.initPlannerItems = function() {
  // 撮影モード用のラジオボタンリスト初期化
  radioList($("#pl_bg"), SFW.background, "pl_bg", {checkFirst: false});
  radioList($("#pl_pose"), SFW.pose, "pl_pose", {checkFirst: false});
  radioList($("#pl_comp"), SFW.composition, "pl_comp", {checkFirst: false});
  radioList($("#pl_view"), SFW.view, "pl_view", {checkFirst: false});
  radioList($("#pl_expr"), SFW.expressions, "pl_expr", {checkFirst: false});
  radioList($("#pl_light"), SFW.lighting, "pl_light", {checkFirst: false});
  
  // アクセサリーセレクト更新
  const plAccSel = document.getElementById("pl_accSel");
  if (plAccSel && SFW.accessories) {
    const options = '<option value="">（未選択）</option>' + 
      SFW.accessories.map(acc => `<option value="${acc.tag}">${acc.label || acc.tag}</option>`).join('');
    plAccSel.innerHTML = options;
  }
};

// buildOnePlanner関数を修正
function buildOnePlanner() {
  const textOf = id => (document.getElementById(id)?.textContent || "").trim();
  let p = [];
  
  // NSFWチェック
  const isNSFW = document.getElementById("pl_nsfw")?.checked;
  if (isNSFW) {
    p.push("NSFW");
  }
  
  // solo, 1girl/1boy は撮影モードでは追加しない
  
  const g = getGenderCountTag() || "";
  if (g) p.push(g);

  // 基本情報
  p.push(...[
    getBFValue('age'), getBFValue('gender'), getBFValue('body'), getBFValue('height'),
    getOne('hairStyle'), getOne('eyeShape'),
    textOf('tagH'), textOf('tagE'), textOf('tagSkin')
  ].filter(Boolean));

  // 基本情報の服を取得
  let hasNSFWOutfit = false;
  if (isNSFW) {
    const nsfwOutfits = getMany("pl_nsfw_outfit");
    if (nsfwOutfits.length > 0) {
      p.push(...nsfwOutfits);
      hasNSFWOutfit = true;
    }
  }
  
  // 基本情報の服（NSFWで服が選ばれてない場合のみ）
  if (!hasNSFWOutfit) {
    const isOnepiece = getIsOnepiece();
    const outfits = [];
    const colorTags = {
      top: textOf('tag_top'),
      bottom: textOf('tag_bottom'), 
      shoes: textOf('tag_shoes')
    };

    if (isOnepiece) {
      const dress = getOne('outfit_dress');
      if (dress) outfits.push(dress);
    } else {
      const top = getOne('outfit_top');
      const bottomCat = getOne('bottomCat') || 'pants';
      const pants = getOne('outfit_pants');
      const skirt = getOne('outfit_skirt');
      const shoes = getOne('outfit_shoes');
      
      if (top) outfits.push(top);
      if (bottomCat === 'pants' && pants) outfits.push(pants);
      else if (bottomCat === 'skirt' && skirt) outfits.push(skirt);
      if (shoes) outfits.push(shoes);
    }

    const finalOutfits = makeFinalOutfitTags(outfits, colorTags);
    p.push(...finalOutfits);
  }

  // 固定タグ（先頭に追加）
  const fixed = (document.getElementById('fixedPlanner')?.value || "").trim();
  if (fixed) {
    const fixedTags = fixed.split(/\s*,\s*/).filter(Boolean);
    p = [...fixedTags, ...p];
  }

  // 各カテゴリから1つずつ選択（ラジオボタン）
  const categories = ["pl_bg", "pl_pose", "pl_comp", "pl_view", "pl_expr", "pl_light"];
  categories.forEach(cat => {
    const selected = getOne(cat);
    if (selected) p.push(selected);
  });

  // アクセサリー
  const accSel = document.getElementById("pl_accSel");
  const accTag = window.getPlannerAccColor ? window.getPlannerAccColor() : "";
  if (accSel && accSel.value && accTag) {
    p.push(`${accTag} ${accSel.value}`);
  } else if (accSel && accSel.value) {
    p.push(accSel.value);
  }

  // NSFW要素（服以外、各カテゴリ1つまで）
  if (isNSFW) {
    const nsfwCats = ["pl_nsfw_expo", "pl_nsfw_underwear", "pl_nsfw_expr", "pl_nsfw_situ", "pl_nsfw_light", "pl_nsfw_pose", "pl_nsfw_acc", "pl_nsfw_body", "pl_nsfw_nipple"];
    nsfwCats.forEach(cat => {
      const selected = getMany(cat);
      if (selected.length > 0) p.push(selected[0]); // 1つだけ取る
    });
  }

  // ネガティブプロンプト
  const useDefNeg = !!document.getElementById('pl_useDefaultNeg')?.checked;
  const addNeg = (document.getElementById('negPlanner')?.value || "").trim();
  const neg = buildNegative(addNeg, useDefNeg);

  const seed = seedFromName((document.getElementById('charName')?.value || ''), 0);
  const prompt = p.join(", ");
  
  return { seed, pos: p, neg, prompt, text: `${prompt}${neg ? ` --neg ${neg}` : ""} seed:${seed}` };
}

// renderPlannerNSFW関数を修正
function renderPlannerNSFW() {
  const level = document.querySelector('input[name="pl_nsfwLevel"]:checked')?.value || "L1";
  const order = { L1: 1, L2: 2, L3: 3 };
  const allowLevel = (lv) => (order[lv || "L1"] || 1) <= (order[level] || 1);
  const levelLabel = (x) => ({ L1: "R-15", L2: "R-18", L3: "R-18G" }[x || "L1"] || "R-15");
  
  const filterByLevel = (arr) => normList(arr).filter(x => allowLevel(x.level));
  
  const createRadio = (item, name) => 
    `<label class="chip">
      <input type="radio" name="${name}" value="${item.tag}">
      ${item.label}<span class="mini"> ${levelLabel(item.level)}</span>
    </label>`;

  // 各NSFW要素を描画（ラジオボタン）
  const nsfwElements = [
    ['pl_nsfw_expo', 'exposure', NSFW.exposure],
    ['pl_nsfw_underwear', 'underwear', NSFW.underwear],
    ['pl_nsfw_outfit', 'outfit', NSFW.outfit],
    ['pl_nsfw_expr', 'expression', NSFW.expression],
    ['pl_nsfw_situ', 'situation', NSFW.situation],
    ['pl_nsfw_light', 'lighting', NSFW.lighting],
    ['pl_nsfw_pose', 'pose', NSFW.pose],
    ['pl_nsfw_acc', 'accessory', NSFW.accessory],
    ['pl_nsfw_body', 'body', NSFW.body],
    ['pl_nsfw_nipple', 'nipples', NSFW.nipples]
  ];

  nsfwElements.forEach(([elementId, category, items]) => {
    const element = document.getElementById(elementId);
    if (element && items) {
      element.innerHTML = filterByLevel(items).map(item => createRadio(item, elementId)).join('');
    }
  });
}

// buildOneLearning関数を修正
function buildOneLearning(extraSeed = 0){
  const textOf = id => (document.getElementById(id)?.textContent || "").trim();
  let p = [];
  
  // NSFWチェック
  const isNSFW = document.getElementById("nsfwLearn")?.checked;
  if (isNSFW) {
    p.push("NSFW");
  }
  
  p.push("solo");
  
  const g = getGenderCountTag() || "";
  if (g) p.push(g);

  p.push(...[
    getBFValue('age'), getBFValue('gender'), getBFValue('body'), getBFValue('height'),
    getOne('hairStyle'), getOne('eyeShape'),
    textOf('tagH'), textOf('tagE'), textOf('tagSkin')
  ].filter(Boolean));

  // 服の処理（ワンピース対応、NSFW優先）
  const isOnepiece = getIsOnepiece();
  const wearMode = document.querySelector('input[name="learnWearMode"]:checked')?.value || 'basic';
  
  let hasNSFWOutfit = false;
  if (isNSFW) {
    const nsfwOutfits = getMany("nsfwL_outfit");
    if (nsfwOutfits.length > 0) {
      p.push(...nsfwOutfits.slice(0, 1)); // 1つだけ
      hasNSFWOutfit = true;
    }
  }
  
  if (!hasNSFWOutfit && wearMode === 'basic') {
    const outfits = [];
    const colorTags = {
      top: textOf('tag_top'),
      bottom: textOf('tag_bottom'), 
      shoes: textOf('tag_shoes')
    };

    if (isOnepiece) {
      const dress = getOne('outfit_dress');
      if (dress) outfits.push(dress);
    } else {
      const top = getOne('outfit_top');
      const bottomCat = getOne('bottomCat') || 'pants';
      const pants = getOne('outfit_pants');
      const skirt = getOne('outfit_skirt');
      const shoes = getOne('outfit_shoes');
      
      if (top) outfits.push(top);
      if (bottomCat === 'pants' && pants) outfits.push(pants);
      else if (bottomCat === 'skirt' && skirt) outfits.push(skirt);
      if (shoes) outfits.push(shoes);
    }

    // buildOneLearning関数を修正（続き）
    const finalOutfits = makeFinalOutfitTags(outfits, colorTags);
    p.push(...finalOutfits);
  }

  // 固定アクセサリー
  const accSel = document.getElementById("learn_acc");
  const accColor = window.getLearnAccColor ? window.getLearnAccColor() : "";
  if (accSel && accSel.value && accColor) {
    p.push(`${accColor} ${accSel.value}`);
  } else if (accSel && accSel.value) {
    p.push(accSel.value);
  }

  // NSFW要素（学習モード）- 体型のみ
  if (isNSFW) {
    const nsfwBody = getMany("nsfwL_body");
    if (nsfwBody.length > 0) p.push(nsfwBody[0]); // 1つだけ
  }

  // 各カテゴリから1つずつ（SFWとNSFWで競合する場合はNSFW優先）
  const categories = [
    { sfw: 'bg', nsfw: null, key: 'bg' },
    { sfw: 'pose', nsfw: null, key: 'pose' },
    { sfw: 'comp', nsfw: null, key: 'comp' },
    { sfw: 'view', nsfw: null, key: 'view' },
    { sfw: 'expr', nsfw: 'nsfwL_expr', key: 'expr' }
  ];

  categories.forEach(({ sfw, nsfw, key }) => {
    let selected = null;
    
    // NSFW優先
    if (isNSFW && nsfw) {
      const nsfwSelected = getMany(nsfw);
      if (nsfwSelected.length > 0) {
        selected = nsfwSelected[0];
      }
    }
    
    // NSFWで選択されなかった場合はSFW
    if (!selected) {
      const sfwSelected = getOne(sfw);
      if (sfwSelected) selected = sfwSelected;
    }
    
    if (selected) p.push(selected);
  });

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

// buildBatchProduction関数を修正
function buildBatchProduction(n){
  const want = Math.max(1, Number(n) || 1);
  const rows = [];
  
  for(let i=0; i<want; i++){
    let p = [];
    
    // NSFWチェック
    const isNSFW = document.getElementById("nsfwProd")?.checked;
    if (isNSFW) {
      p.push("NSFW");
    }
    
    p.push("solo");
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

    // 量産モードでの服の処理（NSFW優先）
    let hasNSFWOutfit = false;
    if (isNSFW) {
      const nsfwOutfits = getMany("nsfwP_outfit");
      if (nsfwOutfits.length > 0) {
        p.push(pick(nsfwOutfits));
        hasNSFWOutfit = true;
      }
    }
    
    if (!hasNSFWOutfit) {
      const topOutfits = getMany("p_outfit_top");
      const pantsOutfits = getMany("p_outfit_pants");
      const skirtOutfits = getMany("p_outfit_skirt");
      const dressOutfits = getMany("p_outfit_dress");
      const shoesOutfits = getMany("p_outfit_shoes");
      
      const selectedOutfits = [];
      
      if (dressOutfits.length > 0) {
        selectedOutfits.push(pick(dressOutfits));
        if (shoesOutfits.length > 0) {
          selectedOutfits.push(pick(shoesOutfits));
        }
      } else {
        if (topOutfits.length > 0) {
          selectedOutfits.push(pick(topOutfits));
        }
        
        const allowBottomSwap = document.getElementById("allowBottomSwap")?.checked;
        let hasBottom = false;
        
        if (pantsOutfits.length > 0) {
          selectedOutfits.push(pick(pantsOutfits));
          hasBottom = true;
        } else if (allowBottomSwap && skirtOutfits.length > 0) {
          selectedOutfits.push(pick(skirtOutfits));
          hasBottom = true;
        }
        
        if (!hasBottom && skirtOutfits.length > 0) {
          selectedOutfits.push(pick(skirtOutfits));
        } else if (!hasBottom && allowBottomSwap && pantsOutfits.length > 0) {
          selectedOutfits.push(pick(pantsOutfits));
        }
        
        if (shoesOutfits.length > 0) {
          selectedOutfits.push(pick(shoesOutfits));
        }
      }

      // 量産モードの色タグを取得（--を除外）
      const prodColorTags = {
        top: document.getElementById("p_use_top")?.checked ? 
             (document.getElementById("tag_p_top")?.textContent || "").replace(/^—$/, "") : "",
        bottom: document.getElementById("p_use_bottom")?.checked ? 
                (document.getElementById("tag_p_bottom")?.textContent || "").replace(/^—$/, "") : "",
        shoes: document.getElementById("p_use_shoes")?.checked ? 
               (document.getElementById("tag_p_shoes")?.textContent || "").replace(/^—$/, "") : ""
      };

      const finalOutfits = makeFinalOutfitTags(selectedOutfits, prodColorTags);
      p.push(...finalOutfits);
    }

    // アクセサリー（A/B/C）
    ['p_accA', 'p_accB', 'p_accC'].forEach(accId => {
      const accSel = document.getElementById(accId);
      const accColorFunc = window[accId === 'p_accA' ? 'getAccAColor' : 
                                 accId === 'p_accB' ? 'getAccBColor' : 'getAccCColor'];
      const accColor = accColorFunc ? accColorFunc() : "";
      
      if (accSel && accSel.value && accColor && accColor !== "—") {
        p.push(`${accColor} ${accSel.value}`);
      } else if (accSel && accSel.value) {
        p.push(accSel.value);
      }
    });

    // 各カテゴリから1つずつ（SFWとNSFWで競合する場合はNSFW優先）
    const categories = [
      { sfw: 'p_bg', nsfw: 'nsfwP_background', key: 'bg' },
      { sfw: 'p_pose', nsfw: 'nsfwP_pose', key: 'pose' },
      { sfw: 'p_comp', nsfw: null, key: 'comp' },
      { sfw: 'p_expr', nsfw: 'nsfwP_expr', key: 'expr' }
    ];

    categories.forEach(({ sfw, nsfw, key }) => {
      let selected = null;
      
      // NSFW優先
      if (isNSFW && nsfw) {
        const nsfwItems = getMany(nsfw);
        if (nsfwItems.length > 0) {
          selected = pick(nsfwItems);
        }
      }
      
      // NSFWで選択されなかった場合はSFW
      if (!selected) {
        const sfwItems = getMany(sfw);
        if (sfwItems.length > 0) {
          selected = pick(sfwItems);
        }
      }
      
      if (selected) p.push(selected);
    });

    // その他のNSFW要素（各カテゴリ1つまで）
    if (isNSFW) {
      const otherNSFWCats = ["nsfwP_expo", "nsfwP_underwear", "nsfwP_situ", "nsfwP_light", "nsfwP_acc", "nsfwP_body", "nsfwP_nipple"];
      otherNSFWCats.forEach(cat => {
        const items = getMany(cat);
        if (items.length > 0) p.push(pick(items));
      });
    }

    // 固定タグ
    const fixedProd = (document.getElementById('fixedProd')?.value || "").trim();
    if (fixedProd) {
      const fixedTags = fixedProd.split(/\s*,\s*/).filter(Boolean);
      p = [...fixedTags, ...p];
    }

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

// renderTextTriplet関数を修正
function renderTextTriplet(baseId, rows, fmtId) {
  if (!rows || !rows.length) return;
  
  const fmt = getFmt(`#${fmtId||'fmtPlanner'}`);
  
  // 学習・量産モードの場合は全件を出力
  const isLearningMode = baseId.includes('Learn');
  const isProdMode = baseId.includes('Prod');
  
  if ((isLearningMode || isProdMode) && rows.length > 1) {
    // 全件のプロンプト、ネガティブ、全体を作成
    const allPrompts = rows.map(r => Array.isArray(r.pos) ? r.pos.join(", ") : (r.prompt || "")).join("\n");
    const allNegs = rows.map(r => r.neg || "").join("\n");
    const allTexts = rows.map(r => {
      const prompt = Array.isArray(r.pos) ? r.pos.join(", ") : (r.prompt || "");
      return fmt.line(prompt, r.neg || "", r.seed || 0);
    }).join("\n");

    const outAll = document.getElementById(`${baseId}All`);
    if (outAll) outAll.textContent = allTexts;
    
    const outPrompt = document.getElementById(`${baseId}Prompt`);
    if (outPrompt) outPrompt.textContent = allPrompts;
    
    const outNeg = document.getElementById(`${baseId}Neg`);
    if (outNeg) outNeg.textContent = allNegs;
  } else {
    // 1件のみの場合（従来通り）
    const r = rows[0];
    const prompt = Array.isArray(r.pos) ? r.pos.join(", ") : (r.prompt || "");
    const neg = r.neg || "";
    const seed = r.seed || 0;

    const allText = fmt.line(prompt, neg, seed);

    const outAll = document.getElementById(`${baseId}All`);
    if (outAll) outAll.textContent = allText;
    
    const outPrompt = document.getElementById(`${baseId}Prompt`);
    if (outPrompt) outPrompt.textContent = prompt;
    
    const outNeg = document.getElementById(`${baseId}Neg`);
    if (outNeg) outNeg.textContent = neg;
  }
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
    const char = (document.getElementById("charName")?.value || "noname").replace(/[^\w\-]/g,"_");
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
  // 髪・瞳
  window.getHairColorTag = initWheel("#wheelH", "#thumbH", "#satH", "#litH", "#swH", "#tagH", "hair");
  window.getEyeColorTag  = initWheel("#wheelE", "#thumbE", "#satE", "#litE", "#swE", "#tagE", "eyes");

  // アクセ（学習/固定）
  window.getLearnAccColor = initColorWheel("learnAcc", 0,   75, 50);
  window.getAccAColor     = initColorWheel("accA",     0,   80, 50);
  window.getAccBColor     = initColorWheel("accB",     200, 80, 50);
  window.getAccCColor     = initColorWheel("accC",     120, 80, 50);

  // 服カラー（基本情報タブ）
  window.getTopColor    = initColorWheel("top",    35,  80, 55);
  window.getBottomColor = initColorWheel("bottom", 210, 70, 50);
  window.getShoesColor  = initColorWheel("shoes",  0,   0,  30);

  // ★★★ 量産タブ（production）のピッカーを追加初期化 ★★★
  window.getPTopColor    = initColorWheel("p_top",    35,  80, 55);
  window.getPBottomColor = initColorWheel("p_bottom", 210, 70, 50);
  window.getPShoesColor  = initColorWheel("p_shoes",  0,   0,  30);
}

function initSkinTone(){
  const s = document.getElementById('skinTone');
  if (s) {
    s.addEventListener('input', paintSkin);
    paintSkin();
  }
}
/* ===== 色ホイールの修正 ===== */
function paintHairColor(hue) {
  if (typeof hue === 'number') {
    // 髪色ホイールの色相を設定
    const satH = document.getElementById("satH");
    const litH = document.getElementById("litH");
    const swH = document.getElementById("swH");
    const tagH = document.getElementById("tagH");
    
    if (satH && litH && swH && tagH) {
      const s = +satH.value;
      const l = +litH.value;
      const [r, g, b] = hslToRgb(hue, s, l);
      swH.style.background = `rgb(${r},${g},${b})`;
      const cname = colorNameFromHSL(hue, s, l);
      tagH.textContent = `${cname} hair`;
    }
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
  
  // 基本情報の初期化バインド
  bindBasicInfo();
  
  // 単語モードの初期化
  initWordMode();
  
  // 撮影モードの初期化
  initPlannerMode();

  loadDefaultDicts().then(()=>{
    renderSFW();
    renderNSFWLearning();
    renderNSFWProduction();
    fillAccessorySlots();
    initHairEyeAndAccWheels();
    initSkinTone();
    
    // 辞書ロード後に単語モードを再初期化
    if (window.initWordModeItems) window.initWordModeItems();
    if (window.initPlannerItems) window.initPlannerItems();
  });
}

document.addEventListener('DOMContentLoaded', initAll);

/* ===== 服の完成タグをUIで直接生成 ===== */
function makeFinalOutfitTags(selectedOutfits, colorTags) {
  const sel = Array.isArray(selectedOutfits) ? selectedOutfits.filter(Boolean) : [];
  const colors = Object.assign({ top:"", bottom:"", shoes:"" }, (colorTags||{}));

  // 辞書があればカテゴリを引く（なければ推定）
  const catMap = new Map();
  try {
    const dict = (window.SFW && Array.isArray(SFW.outfit)) ? SFW.outfit : [];
    for (const e of dict) if (e && e.tag && e.cat) catMap.set(String(e.tag).toLowerCase(), String(e.cat).toLowerCase());
  } catch {}

  const getCat = (tag) => {
    const k = String(tag||"").toLowerCase();
    if (catMap.has(k)) return catMap.get(k);
    // 簡易推定（辞書が無い/足りない場合の保険）
    if (/(dress|kimono|yukata|cheongsam|hanbok|sari|uniform|gown)$/i.test(k)) return "dress";
    if (/(skirt)$/i.test(k)) return "skirt";
    if (/(jeans|pants|trousers|shorts|overalls|hakama)$/i.test(k)) return "pants";
    if (/(boots|sneakers|loafers|mary janes|socks)$/i.test(k)) return "shoes";
    return "top"; // 迷ったら top とみなす
  };

  const hasDress = sel.some(t => getCat(t) === "dress");

  // すでに色名で始まってたら二重付与しないための軽いチェック
  const colorPool = new Set(
    ((window.SFW && Array.isArray(SFW.colors) ? SFW.colors.map(c=>c.tag) : [])).concat([
      "white","black","red","blue","green","yellow","pink","purple","orange","brown","gray","silver","gold","beige","navy",
      "light blue","sky blue","teal","turquoise","lavender","violet","magenta","crimson","scarlet","emerald","olive",
      "khaki","ivory","peach","mint"
    ]).map(s=>String(s).toLowerCase())
  );
  const startsWithColor = (s)=>{
    const t = String(s||"").toLowerCase();
    return Array.from(colorPool).some(c => t.startsWith(c+" "));
  };

  const out = [];
  if (hasDress) {
    // ワンピは top の色を前置き。下の色は無効（下は出力しない）
    for (const t of sel) {
      const cat = getCat(t);
      if (cat === "dress") {
        const tagged = startsWithColor(t) ? t : (colors.top ? `${colors.top} ${t}` : t);
        out.push(tagged);
      } else if (cat === "shoes") {
        const tagged = startsWithColor(t) ? t : (colors.shoes ? `${colors.shoes} ${t}` : t);
        out.push(tagged);
      }
      // top/pants/skirt は無視
    }
  } else {
    // 通常モード：top / bottom / shoes を色前置
    for (const t of sel) {
      const cat = getCat(t);
      if (cat === "top") {
        out.push(startsWithColor(t) ? t : (colors.top    ? `${colors.top} ${t}`    : t));
      } else if (cat === "pants" || cat === "skirt") {
        out.push(startsWithColor(t) ? t : (colors.bottom ? `${colors.bottom} ${t}` : t));
      } else if (cat === "shoes") {
        out.push(startsWithColor(t) ? t : (colors.shoes  ? `${colors.shoes} ${t}`  : t));
      } else if (cat === "dress") {
        // 念のため（hasDress=falseなので単独ワンピのとき）
        out.push(startsWithColor(t) ? t : (colors.top ? `${colors.top} ${t}` : t));
      } else {
        out.push(t); // 未分類はそのまま
      }
    }
  }
  return out;
}

/* ===== 統合：最終トークンを組み立てる（髪・目は今まで通り） =====
   base = 髪色・目色・体型など（服以外）のトークン配列
   outfits = 服の選択結果（タグ配列）
   colorTags = { top, bottom, shoes } ピッカーの文字タグ
*/
function buildFinalTokens(base, outfits, colorTags) {
  const a = Array.isArray(base) ? base.filter(Boolean) : [];
  const b = makeFinalOutfitTags(outfits, colorTags);
  return a.concat(b);
}
