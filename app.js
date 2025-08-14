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
const EMBED_SFW  = { hair_style:[], eyes:[], outfit:[], face:[], skin_body:[], art_style:[], background:[], pose_composition:[], expressions:[], accessories:[], lighting:[] };
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
  "表情":"expressions","アクセサリー":"accessories","ライティング":"lighting"
};
function normNSFW(ns) {
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
// 角度ドラッグ共通（pointer系で連続追従）
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
    const hue = (ang * 180 / Math.PI + 360 + 90) % 360; // 右=0° → 上=90°に合わせる
    setThumb(hue);
    onHueChange(hue);
  };

  const onDown = (e) => {
    dragging = true;
    wheelEl.setPointerCapture?.(e.pointerId);
    updateFromEvent(e);
  };
  const onMove = (e) => { if (dragging) updateFromEvent(e); };
  const onUp   = (e) => { dragging = false; wheelEl.releasePointerCapture?.(e.pointerId); };

  // pointer系で統一
  wheelEl.addEventListener("pointerdown", onDown);
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup",   onUp);

  // リサイズ時の親レイアウト変化で位置がズレないよう再配置
  const ro = new ResizeObserver(()=> {
    // 直近のhueはonHueChange内で保持してもらう
    onHueChange.__lastHue != null && setThumb(onHueChange.__lastHue);
  });
  ro.observe(wheelEl);

  return setThumb; // 必要なら外からも呼べるように
}

/* ======= 色ホイール（髪/瞳） ======= */
function initWheel(wId,tId,sId,lId,swId,tagId,baseTag){
  const wheel=$(wId), thumb=$(tId), sat=$(sId), lit=$(lId), sw=$(swId), tagEl=$(tagId);
  let hue = 35;

  function paint(){
    const s=+sat.value, l=+lit.value;
    const [r,g,b]=hslToRgb(hue,s,l);
    sw.style.background = `#${[r,g,b].map(v=>v.toString(16).padStart(2,"0")).join("")}`;
    const name = `${(l>=78?'light ':l<=32?'dark ':'')}${baseTag}`.trim();
    tagEl.textContent = name;
  }

  // ドラッグで角度更新
  const onHue = (h)=>{ hue = h; onHue.__lastHue = h; paint(); };
  addHueDrag(wheel, thumb, onHue);

  // スライダー反映
  sat.addEventListener("input", paint);
  lit.addEventListener("input", paint);

  // 初期描画（親の実サイズに応じてthumb位置を置く）
  requestAnimationFrame(paint);

  // getterは従来通り
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

  let hue = defaultHue; sat.value = defaultS; lit.value = defaultL;

  function paint(){
    const s=+sat.value, l=+lit.value;
    const [r,g,b]=hslToRgb(hue,s,l);
    sw.style.background = `rgb(${r},${g},${b})`;
    tag.textContent = colorNameFromHSL(hue,s,l);
  }

  const onHue = (h)=>{ hue = h; onHue.__lastHue = h; paint(); };
  addHueDrag(wheel, thumb, onHue);

  sat.addEventListener("input", paint);
  lit.addEventListener("input", paint);

  requestAnimationFrame(paint);

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
  checkList($("#lightLearn"),    SFW.lighting,        "lightLearn");
}
}

/* ========= タブ切替 ========= */
function initTabs(){
  $$(".tab").forEach(t=> t.addEventListener("click", ()=>{
    $$(".tab").forEach(x=>x.classList.remove("active"));
    t.classList.add("active");
    const m=t.dataset.mode;
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
    j["表情"] || j["露出"] || j["シチュ"] || j["ライティング"]
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
    line:(p,n,seed)=>`python dream.py -p "${p}" - n "${n}" -S ${seed}`,
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
  ["hairStyle","eyeShape","face","skinBody","artStyle","outfit"].forEach(n=>{
    const v=document.querySelector(`input[name="${n}"]:checked`)?.value; if(v) arr.push(v);
  });
  const acc = $("#learn_acc")?.value || "";
  if (acc) arr.push(`${getLearnAccColor && getLearnAccColor()} ${acc}`);
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
  const pos = uniq([...fixed, b, p, e, l, ...addon]).filter(Boolean);
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
    if(outfits.length) o.push(pick(outfits));
    if(acc.length)     o.push(...acc);
    if(bgs.length)     o.push(pick(bgs));
    if(poses.length)   o.push(pick(poses));
    if(exprs.length)   o.push(pick(exprs));
    if(light)          o.push(light);
    if(nsfwAdd.length) o.push(...nsfwAdd);

    const prompt = uniq([...fixed, ...o]).filter(Boolean).join(", ");
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

  // まず空で描画（軽い）
  renderSFW(); renderNSFWProduction(); renderNSFWLearning(); fillAccessorySlots();

  // 肌トーン
  $("#skinTone")?.addEventListener("input", paintSkin);
  paintSkin();

  // 色ホイール（アイドル時初期化の取りこぼし防止）
  if (typeof requestIdleCallback === "function") {
    requestIdleCallback(setupColorPickers, { timeout: 300 });
  } else {
    setTimeout(setupColorPickers, 0);
  }

  // デフォルト辞書を追記ロード
  await loadDefaultDicts();

  // ステータス
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
}
