import type { Survey } from "@leksy/core";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Server-rendered survey form; the script below adds stars, branching and submit. */
export function surveyHtml(survey: Survey, title: string, alreadyAnswered: boolean): string {
  if (alreadyAnswered) return `<div class="lx-sv lx-done"><p>Thank you — we've received your feedback.</p></div>`;
  const qs = survey.questions
    .map((q) => {
      const show = q.showIf ? ` data-show-q="${esc(q.showIf.question)}" data-show-op="${q.showIf.op}" data-show-v="${esc(String(q.showIf.value))}" hidden` : "";
      let input = "";
      if (q.type === "rating")
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
.lx-nps button.on,.lx-chips button.on{background:#2a2118;color:#fff;border-color:#2a2118}
.lx-chips{display:flex;flex-wrap:wrap;gap:6px}
.lx-sv textarea{width:100%;border:1px solid rgba(0,0,0,.15);border-radius:10px;padding:10px;font:inherit}
.lx-submit{border:0;cursor:pointer;width:100%;margin-top:8px}
.lx-err{color:#b3261e;font-size:13px}
`;

/** Vanilla JS, no framework: keeps the page fast on 4G. */
export const SURVEY_JS = `
(function(){
var f=document.getElementById('lx-survey'); if(!f) return;
var ans={};
function vis(){f.querySelectorAll('.lx-q[data-show-q]').forEach(function(q){var a=ans[q.dataset.showQ],v=q.dataset.showV,op=q.dataset.showOp,ok=false;
 if(a!==undefined){ok=op==='lte'?Number(a)<=Number(v):op==='gte'?Number(a)>=Number(v):op==='eq'?String(a)===v:Array.isArray(a)&&a.indexOf(v)>=0;}
 q.hidden=!ok; if(!ok) delete ans[q.dataset.id];});}
f.querySelectorAll('.lx-q').forEach(function(q){var id=q.dataset.id,t=q.dataset.type;
 q.querySelectorAll('button[data-v]').forEach(function(b){b.addEventListener('click',function(){var v=b.dataset.v;
  if(t==='rating'){ans[id]=Number(v);q.querySelectorAll('button').forEach(function(x){x.classList.toggle('on',Number(x.dataset.v)<=Number(v));});}
  else if(t==='nps'){ans[id]=Number(v);q.querySelectorAll('button').forEach(function(x){x.classList.toggle('on',x===b);});}
  else{var multi=q.querySelector('.lx-chips').dataset.multi==='true';
   if(multi){var arr=ans[id]||[];var i=arr.indexOf(v);if(i>=0)arr.splice(i,1);else arr.push(v);ans[id]=arr;b.classList.toggle('on');}
   else{ans[id]=v;q.querySelectorAll('button').forEach(function(x){x.classList.toggle('on',x===b);});}}
  vis();});});
 var ta=q.querySelector('textarea'); if(ta) ta.addEventListener('input',function(){ans[id]=ta.value;});});
f.addEventListener('submit',function(e){e.preventDefault();var err=f.querySelector('.lx-err');err.hidden=true;
 var btn=f.querySelector('.lx-submit');btn.disabled=true;
 fetch(location.pathname.replace(/\\/$/,'')+'/feedback',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({answers:ans})})
 .then(function(r){return r.json().then(function(j){return {ok:r.ok,j:j};});})
 .then(function(r){if(!r.ok){err.textContent=r.j.error||'Something went wrong';err.hidden=false;btn.disabled=false;return;}
  f.hidden=true;var t=document.querySelector('.lx-thanks');t.hidden=false;
  if(r.j.reviewUrl){var a=t.querySelector('.lx-review');a.href=r.j.reviewUrl;a.hidden=false;}})
 .catch(function(){err.textContent='Network error, please try again';err.hidden=false;btn.disabled=false;});});
})();`;

export function otpPage(brandName: string, maskedPhone: string, nonce: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(brandName)} bill</title><style>body{font-family:system-ui,sans-serif;background:#fbf8f2;color:#2a2118;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0}.c{max-width:360px;padding:28px;background:#fff;border-radius:16px;box-shadow:0 2px 24px rgba(0,0,0,.06);text-align:center}input{font-size:22px;letter-spacing:8px;text-align:center;width:180px;padding:10px;border:1px solid #ccc;border-radius:10px}button{margin-top:14px;padding:12px 22px;border:0;border-radius:999px;background:#b08d57;color:#fff;font-weight:600;cursor:pointer}p{color:#6b6b6b;font-size:14px}</style></head><body><div class="c"><h2>${esc(brandName)}</h2><p>This bill is protected. We'll send a code to ${esc(maskedPhone)}.</p><div id="s1"><button id="send">Send code</button></div><div id="s2" hidden><input id="code" inputmode="numeric" maxlength="6" autocomplete="one-time-code"><br><button id="verify">Open bill</button></div><p id="m"></p></div><script nonce="${nonce}">
var base=location.pathname.replace(/\\/$/,'');function m(t){document.getElementById('m').textContent=t;}
document.getElementById('send').onclick=function(){fetch(base+'/otp',{method:'POST'}).then(function(r){if(r.ok){document.getElementById('s1').hidden=true;document.getElementById('s2').hidden=false;m('Code sent.');}else m('Please wait a minute and try again.');});};
document.getElementById('verify').onclick=function(){fetch(base+'/otp/verify',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({code:document.getElementById('code').value})}).then(function(r){if(r.ok)location.reload();else m('That code did not match.');});};
</script></body></html>`;
}
