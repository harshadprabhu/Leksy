import type { Survey } from "./survey.js";

/** Labels for the five faces, sad to happy. */
export const FACE_LABELS = ["Very unhappy", "Unhappy", "Okay", "Happy", "Delighted"];
export const FACE_COLORS = ["#E34948", "#EB6834", "#EDA100", "#7CB342", "#1BAF7A"];

/** A 1–5 face as inline SVG (sad → happy). Same drawing on every phone, unlike emoji. */
export function faceSvg(n: number, size = 44): string {
  const i = Math.min(5, Math.max(1, Math.round(n))) - 1;
  const c = FACE_COLORS[i]!;
  const curve = [-8, -4, 0, 6, 10][i]!; // mouth: negative frowns, positive smiles
  const mouth = i === 4 ? `<path d="M14 29 Q24 ${29 + curve + 2} 34 29 Q24 33 14 29Z" fill="#3a2a1a"/>` : `<path d="M15 ${i < 2 ? 34 : 32} Q24 ${(i < 2 ? 34 : 32) + curve} 33 ${i < 2 ? 34 : 32}" stroke="#3a2a1a" stroke-width="2.6" fill="none" stroke-linecap="round"/>`;
  const brows = i === 0 ? `<path d="M13 15 L20 18 M35 15 L28 18" stroke="#3a2a1a" stroke-width="2.2" stroke-linecap="round"/>` : i === 1 ? `<path d="M14 16 L20 17.5 M34 16 L28 17.5" stroke="#3a2a1a" stroke-width="2" stroke-linecap="round"/>` : "";
  const eyes = i === 4 ? `<path d="M14 21 Q17 17 20 21 M28 21 Q31 17 34 21" stroke="#3a2a1a" stroke-width="2.4" fill="none" stroke-linecap="round"/>` : `<circle cx="17" cy="21" r="2.6" fill="#3a2a1a"/><circle cx="31" cy="21" r="2.6" fill="#3a2a1a"/>`;
  const tear = i === 0 ? `<path d="M33 24 Q35 28 33 30 Q31 28 33 24Z" fill="#6EC1E4"/>` : "";
  const cheeks = i >= 3 ? `<circle cx="12.5" cy="27" r="3" fill="#ff8a8a" opacity=".45"/><circle cx="35.5" cy="27" r="3" fill="#ff8a8a" opacity=".45"/>` : "";
  return `<svg class="lx-face" viewBox="0 0 48 48" width="${size}" height="${size}" aria-hidden="true"><circle cx="24" cy="24" r="21" fill="${c}"/><circle cx="24" cy="24" r="21" fill="url(#lx-shine)" opacity=".35"/>${cheeks}${brows}${eyes}${tear}${mouth}</svg>`;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Server-rendered survey form; the script below adds stars, branching and submit. */
export function surveyHtml(survey: Survey, title: string, alreadyAnswered: boolean): string {
  if (survey.oneTap) return alreadyAnswered ? "" : oneTapHtml(survey, title);
  if (alreadyAnswered) return `<div class="lx-sv lx-done"><p>Thank you — we've received your feedback.</p></div>`;
  const qs = survey.questions
    .map((q) => {
      const show = q.showIf ? ` data-show-q="${esc(q.showIf.question)}" data-show-op="${q.showIf.op}" data-show-v="${esc(String(q.showIf.value))}" hidden` : "";
      let input = "";
      if (q.type === "rating" && q.style === "faces")
        input = `<div class="lx-faces" role="radiogroup" aria-label="${esc(q.label)}"><svg width="0" height="0" style="position:absolute"><defs><radialGradient id="lx-shine" cx=".35" cy=".3" r=".6"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient></defs></svg>${[1, 2, 3, 4, 5]
          .map((n) => `<button type="button" role="radio" aria-checked="false" data-v="${n}" aria-label="${FACE_LABELS[n - 1]}" style="--fc:${FACE_COLORS[n - 1]}">${faceSvg(n)}<span class="lx-burst"></span></button>`)
          .join("")}</div><div class="lx-face-label" aria-live="polite">Tap a face</div>`;
      else if (q.type === "rating")
        input = `<div class="lx-stars" role="radiogroup">${[1, 2, 3, 4, 5].map((n) => `<button type="button" data-v="${n}" aria-label="${n} star${n > 1 ? "s" : ""}">★</button>`).join("")}</div>`;
      else if (q.type === "nps")
        input = `<div class="lx-nps">${Array.from({ length: 11 }, (_, n) => `<button type="button" data-v="${n}">${n}</button>`).join("")}</div>`;
      else if (q.type === "choice" || q.type === "multi")
        input = `<div class="lx-chips" data-multi="${q.type === "multi"}">${(q.options ?? []).map((o) => `<button type="button" data-v="${esc(o)}">${esc(o)}</button>`).join("")}</div>`;
      else input = `<textarea rows="3" maxlength="2000" placeholder="Type here (optional)"></textarea>`;
      return `<div class="lx-q" data-id="${esc(q.id)}" data-type="${q.type}"${show}><label>${esc(q.label)}</label>${input}</div>`;
    })
    .join("");
  return `<form class="lx-sv" id="lx-survey" novalidate><h3>${esc(title)}</h3>${qs}<button type="submit" class="lx-button lx-submit">Submit</button><p class="lx-err" hidden></p></form><div class="lx-sv lx-thanks" hidden><p>${esc(survey.thankYou)}</p><a class="lx-button lx-review" hidden target="_blank" rel="noopener">Share it on Google</a></div>`;
}

const SHINE = `<svg width="0" height="0" style="position:absolute"><defs><radialGradient id="lx-shine" cx=".35" cy=".3" r=".6"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient></defs></svg>`;

/** The one-tap rating: five faces; the tap is the answer and cannot be changed. */
function oneTapHtml(survey: Survey, title: string): string {
  const q = survey.questions.find((x) => x.id === survey.primary);
  const faces = [1, 2, 3, 4, 5].map((n) => `<button type="button" role="radio" aria-checked="false" data-v="${n}" aria-label="${FACE_LABELS[n - 1]}" style="--fc:${FACE_COLORS[n - 1]}">${faceSvg(n)}<span class="lx-burst"></span></button>`).join("");
  return `<div class="lx-sv lx-wow" id="lx-wow" data-q="${esc(survey.primary)}"><h3>${esc(title)}</h3>${q && q.label !== title ? `<p class="lx-wow-sub">${esc(q.label)}</p>` : ""}<div class="lx-faces" role="radiogroup" aria-label="${esc(q?.label ?? title)}">${SHINE}${faces}</div><div class="lx-face-label" aria-live="polite">Tap a face</div><p class="lx-wow-thanks" hidden>${esc(survey.thankYou)}</p><p class="lx-err" hidden></p></div>`;
}

export const SURVEY_CSS = `
[hidden]{display:none!important}
.lx-sv{padding:16px;border-radius:14px;background:rgba(0,0,0,.035)}
.lx-sv h3{margin:0 0 12px}
.lx-q{margin:14px 0}
.lx-q label{display:block;font-weight:600;margin-bottom:8px;font-size:14px}
.lx-stars button{font-size:30px;background:none;border:0;color:#d6d0c4;cursor:pointer;padding:0 3px}
.lx-stars button.on{color:#e0a526}
.lx-nps{display:flex;flex-wrap:wrap;gap:4px}
.lx-nps button,.lx-chips button{border:1px solid rgba(0,0,0,.15);background:#fff;border-radius:999px;padding:6px 11px;font-size:13px;cursor:pointer;color:inherit}
.lx-nps button.on,.lx-chips button.on{background:var(--lx-accent,#2a2118);color:#fff;border-color:var(--lx-accent,#2a2118)}
.lx-faces{display:flex;justify-content:space-between;gap:4px;max-width:340px;margin:4px auto 0;padding:12px 4px 6px}
.lx-faces button{position:relative;background:none;border:0;padding:4px;cursor:pointer;border-radius:50%;line-height:0;transition:transform .18s ease}
.lx-faces .lx-face{filter:saturate(.55) opacity(.85);transition:filter .2s ease,transform .2s ease}
.lx-faces button:hover .lx-face,.lx-faces button:focus-visible .lx-face{filter:none;transform:translateY(-3px)}
.lx-faces button.on .lx-face{filter:none;animation:lx-pop .55s cubic-bezier(.3,1.6,.5,1) both}
.lx-faces.chosen button:not(.on) .lx-face{filter:grayscale(1) opacity(.35);transform:scale(.88)}
.lx-faces button.on::after{content:"";position:absolute;left:50%;bottom:-6px;width:8px;height:8px;margin-left:-4px;border-radius:50%;background:var(--fc)}
.lx-burst{position:absolute;inset:0;border-radius:50%;pointer-events:none}
.lx-faces button.on .lx-burst{animation:lx-ring .6s ease-out both;box-shadow:0 0 0 0 var(--fc)}
.lx-faces button.on[data-v="5"] .lx-burst::before,.lx-faces button.on[data-v="5"] .lx-burst::after{content:"✦";position:absolute;color:var(--fc);font-size:14px;animation:lx-spark .8s ease-out both}
.lx-faces button.on[data-v="5"] .lx-burst::before{left:-4px;top:2px}
.lx-faces button.on[data-v="5"] .lx-burst::after{right:-4px;top:0;animation-delay:.1s}
.lx-faces button.on[data-v="1"] .lx-face{animation:lx-pop .55s cubic-bezier(.3,1.6,.5,1) both,lx-shake .5s .5s ease-in-out}
.lx-face-label{text-align:center;font-size:13px;font-weight:600;margin-top:10px;min-height:18px;color:var(--lx-face,#8a7a66);transition:color .2s}
@keyframes lx-pop{0%{transform:scale(1)}40%{transform:scale(1.42) rotate(-10deg)}70%{transform:scale(1.18) rotate(6deg)}100%{transform:scale(1.25) rotate(0)}}
@keyframes lx-ring{0%{box-shadow:0 0 0 0 var(--fc);opacity:.7}100%{box-shadow:0 0 0 16px var(--fc);opacity:0}}
@keyframes lx-spark{0%{opacity:0;transform:scale(.3) translateY(4px)}50%{opacity:1}100%{opacity:0;transform:scale(1.2) translateY(-12px)}}
@keyframes lx-shake{0%,100%{transform:scale(1.25) translateX(0)}25%{transform:scale(1.25) translateX(-3px)}75%{transform:scale(1.25) translateX(3px)}}
@media (prefers-reduced-motion:reduce){.lx-faces *{animation:none!important;transition:none!important}.lx-faces button.on .lx-face{transform:scale(1.2)}}
.lx-chips{display:flex;flex-wrap:wrap;gap:6px}
.lx-sv textarea{width:100%;border:1px solid rgba(0,0,0,.15);border-radius:10px;padding:10px;font:inherit}
.lx-submit{border:0;cursor:pointer;width:100%;margin-top:8px}
.lx-err{color:#b3261e;font-size:13px}
.lx-wow{text-align:center;overflow:hidden;transition:max-height .5s ease,opacity .45s ease,margin .5s ease,padding .5s ease}
.lx-wow h3{margin:0 0 2px}
.lx-wow-sub{margin:0;font-size:13px;opacity:.75}
.lx-wow.sent .lx-faces{pointer-events:none}
.lx-wow-thanks{margin:8px 0 0;font-weight:600;font-size:14px;animation:lx-fade .4s ease both}
.lx-wow.gone{max-height:0!important;opacity:0;margin-top:0!important;margin-bottom:0!important;padding-top:0;padding-bottom:0}
@keyframes lx-fade{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}
`;

/** Vanilla JS, no framework: keeps the page fast on 4G. */
export const SURVEY_JS = `
// window.LX_SUBMIT lets a host page (the demo) take the answers instead of the API.
function lxSubmit(a){return (window.LX_SUBMIT||function(a){return fetch(location.pathname.replace(/\\/$/,'')+'/feedback',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({answers:a})})
 .then(function(r){return r.json().then(function(j){return {ok:r.ok,status:r.status,j:j};});});})(a);}
(function(){
// One tap: the chosen face is saved at once, locked, thanked, then the box folds away.
var w=document.getElementById('lx-wow'); if(!w) return;
var lb=w.querySelector('.lx-face-label'),err=w.querySelector('.lx-err');
function vanish(){w.style.maxHeight=w.scrollHeight+'px';void w.offsetHeight;w.classList.add('gone');
 setTimeout(function(){var b=w.closest('.lx-block')||w;b.parentNode&&b.parentNode.removeChild(b);},600);}
w.querySelectorAll('.lx-faces button').forEach(function(b){b.addEventListener('click',function(){
 if(w.classList.contains('sent'))return;w.classList.add('sent');err.hidden=true;
 var fs=w.querySelector('.lx-faces');fs.classList.add('chosen');
 fs.querySelectorAll('button').forEach(function(x){x.setAttribute('aria-checked',x===b?'true':'false');x.disabled=true;});
 void b.offsetWidth;b.classList.add('on');lb.textContent=b.getAttribute('aria-label');lb.style.setProperty('--lx-face',getComputedStyle(b).getPropertyValue('--fc'));
 if(navigator.vibrate)try{navigator.vibrate(12);}catch(_){}
 var a={};a[w.dataset.q]=Number(b.dataset.v);
 lxSubmit(a).then(function(r){
  // Saved, or already saved from an earlier visit: either way the question is done.
  if(r.ok||r.status===409||/already/.test((r.j&&r.j.error)||'')){setTimeout(function(){lb.hidden=true;w.querySelector('.lx-wow-thanks').hidden=false;setTimeout(vanish,1800);},700);return;}
  throw new Error((r.j&&r.j.error)||'Something went wrong');})
 .catch(function(e){err.textContent=(e&&e.message&&e.message!=='Failed to fetch'?e.message:'Network error')+' — please tap again';err.hidden=false;
  w.classList.remove('sent');fs.classList.remove('chosen');b.classList.remove('on');lb.textContent='Tap a face';
  fs.querySelectorAll('button').forEach(function(x){x.disabled=false;x.setAttribute('aria-checked','false');});});
});});
})();
(function(){
var f=document.getElementById('lx-survey'); if(!f) return;
var ans={};
function vis(){f.querySelectorAll('.lx-q[data-show-q]').forEach(function(q){var a=ans[q.dataset.showQ],v=q.dataset.showV,op=q.dataset.showOp,ok=false;
 if(a!==undefined){ok=op==='lte'?Number(a)<=Number(v):op==='gte'?Number(a)>=Number(v):op==='eq'?String(a)===v:Array.isArray(a)&&a.indexOf(v)>=0;}
 q.hidden=!ok; if(!ok) delete ans[q.dataset.id];});}
f.querySelectorAll('.lx-q').forEach(function(q){var id=q.dataset.id,t=q.dataset.type;
 q.querySelectorAll('button[data-v]').forEach(function(b){b.addEventListener('click',function(){var v=b.dataset.v;
  if(t==='rating'&&q.querySelector('.lx-faces')){ans[id]=Number(v);var fs=q.querySelector('.lx-faces');fs.classList.add('chosen');
   q.querySelectorAll('.lx-faces button').forEach(function(x){var on=x===b;x.classList.remove('on');x.setAttribute('aria-checked',on?'true':'false');});
   void b.offsetWidth;b.classList.add('on');var lb=q.querySelector('.lx-face-label');lb.textContent=b.getAttribute('aria-label');lb.style.setProperty('--lx-face',getComputedStyle(b).getPropertyValue('--fc'));
   if(navigator.vibrate)try{navigator.vibrate(12);}catch(_){}}
  else if(t==='rating'){ans[id]=Number(v);q.querySelectorAll('button').forEach(function(x){x.classList.toggle('on',Number(x.dataset.v)<=Number(v));});}
  else if(t==='nps'){ans[id]=Number(v);q.querySelectorAll('button').forEach(function(x){x.classList.toggle('on',x===b);});}
  else{var multi=q.querySelector('.lx-chips').dataset.multi==='true';
   if(multi){var arr=ans[id]||[];var i=arr.indexOf(v);if(i>=0)arr.splice(i,1);else arr.push(v);ans[id]=arr;b.classList.toggle('on');}
   else{ans[id]=v;q.querySelectorAll('button').forEach(function(x){x.classList.toggle('on',x===b);});}}
  vis();});});
 var ta=q.querySelector('textarea'); if(ta) ta.addEventListener('input',function(){ans[id]=ta.value;});});
f.addEventListener('submit',function(e){e.preventDefault();var err=f.querySelector('.lx-err');err.hidden=true;
 var btn=f.querySelector('.lx-submit');btn.disabled=true;
 lxSubmit(ans).then(function(r){if(!r.ok){err.textContent=r.j.error||'Something went wrong';err.hidden=false;btn.disabled=false;return;}
  f.hidden=true;var t=document.querySelector('.lx-thanks');t.hidden=false;
  if(r.j.reviewUrl){var a=t.querySelector('.lx-review');a.href=r.j.reviewUrl;a.hidden=false;}})
 .catch(function(){err.textContent='Network error, please try again';err.hidden=false;btn.disabled=false;});});
})();`;
