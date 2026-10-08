import {createHistory} from '/rewards/wallet-history-v3.js?v=wallet-final1';
import {signupReferralOptions,settleReferral} from '/rewards/referral-client.js?v=referral50';
import {createClient} from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
const $=id=>document.getElementById(id);
const levels=[{name:'مبتدئ',start:0},{name:'برونزي',start:100},{name:'فضي',start:500},{name:'ذهبي',start:1500},{name:'نخبة',start:5000}];
let client,history,session=null,profile=null,requestVersion=0,currentReferral='',privateBalance=false,authBusy=false;
try{privateBalance=localStorage.getItem('vooxor.wallet.hideBalance')==='1';}catch{}
function status(text){$('status').textContent=text;}
function openDialog(id){const d=$(id);if(d&&!d.open)d.showModal();}
function closeDialogs(){document.querySelectorAll('dialog[open]').forEach(d=>d.close());}
function account(){openDialog(session?.user?'settingsDialog':'authDialog');}
document.querySelectorAll('[data-dialog]').forEach(b=>b.addEventListener('click',()=>openDialog(b.dataset.dialog)));
document.querySelectorAll('[data-account]').forEach(b=>b.addEventListener('click',account));
document.querySelectorAll('[data-close]').forEach(b=>b.addEventListener('click',()=>b.closest('dialog').close()));
document.querySelectorAll('dialog').forEach(d=>d.addEventListener('click',e=>{if(e.target===d){const r=d.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)d.close();}}));
document.querySelectorAll('.bottomNav a').forEach(a=>a.addEventListener('click',()=>{document.querySelectorAll('.bottomNav a').forEach(b=>{b.classList.toggle('selected',a===b);if(a===b)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');});}));
function renderBalances(){
 const value=profile?.vx_balance,earned=profile?.lifetime_vx,mask=privateBalance?'•••':null;
 $('familyBalance').textContent=mask??(value==null?'—':String(value));
 $('assetBalance').textContent=mask??(value==null?'—':String(value));
 $('familyLifetime').textContent=(mask??(earned==null?'—':String(earned)))+' VX';
 $('familyBalance').parentElement.classList.toggle('compact',String(value??'').length>4);
 $('balancePrivacy').setAttribute('aria-pressed',String(privateBalance));$('balancePrivacy').setAttribute('aria-label',privateBalance?'إظهار الرصيد':'إخفاء الرصيد');$('privacySetting').checked=privateBalance;
}
function privacy(value){privateBalance=value;try{localStorage.setItem('vooxor.wallet.hideBalance',value?'1':'0');}catch{}renderBalances();}
$('balancePrivacy').onclick=()=>privacy(!privateBalance);$('privacySetting').onchange=e=>privacy(e.target.checked);
function renderLevel(total){
 $('accountLevel').hidden=total==null;if(total==null)return;
 total=Math.max(0,Number(total)||0);let i=0;while(i+1<levels.length&&total>=levels[i+1].start)i++;
 const current=levels[i],next=levels[i+1],percent=next?Math.floor((total-current.start)/(next.start-current.start)*100):100;
 $('levelName').textContent='المستوى '+['المبتدئ','البرونزي','الفضي','الذهبي','النخبة'][i];$('levelHint').textContent=next?'باقي '+(next.start-total)+' VX للوصول إلى '+next.name:'وصلت إلى أعلى مستوى — نخبة VOOXOR';
 $('levelFill').style.width=percent+'%';$('levelPercent').textContent=percent+'%';$('levelBar').setAttribute('aria-valuenow',String(percent));$('levelBar').setAttribute('aria-valuetext',$('levelHint').textContent);
 const medal=document.querySelector('[data-tier="'+i+'"] .medal').cloneNode(true);$('mainMedal').replaceChildren(medal);
 document.querySelectorAll('[data-tier]').forEach(el=>{if(Number(el.dataset.tier)===i)el.setAttribute('aria-current','step');else el.removeAttribute('aria-current');});
}
async function showUser(nextSession){
 const version=++requestVersion;session=nextSession;profile=null;currentReferral='';renderBalances();renderLevel(null);history.load(null);
 $('guestNotice').hidden=Boolean(session?.user);$('referralField').hidden=true;$('referralUrl').value='';$('userEmail').textContent=session?.user?.email||'';
 if(!session?.user){status('سجّل الدخول لعرض رصيدك ومكافآتك.');return;}
 status('جاري تحديث محفظتك…');$('refreshWallet').disabled=true;
 try{
  await settleReferral(client);if(version!==requestVersion)return;history.load(session);
  const {data,error}=await client.from('vooxor_profiles').select('vx_balance,lifetime_vx,referral_code').eq('user_id',session.user.id).maybeSingle();
  if(version!==requestVersion)return;if(error)throw error;if(!data)throw new Error('لم نجد بيانات محفظتك بعد. أعد التحديث.');
  profile=data;renderBalances();renderLevel(data.lifetime_vx??0);
  if(data.referral_code){currentReferral='https://vooxor.com/ar/?ref='+encodeURIComponent(data.referral_code);$('referralUrl').value=currentReferral;}
  status('تم تحديث رصيدك.');
 }catch(error){if(version===requestVersion)status('تعذر تحديث المحفظة: '+(error.message||'حاول مرة أخرى.'));}
 finally{if(version===requestVersion)$('refreshWallet').disabled=false;}
}
async function authenticate(signup){
 if(authBusy||!client)return;if(!$('authForm').reportValidity())return;
 authBusy=true;$('login').disabled=true;$('signup').disabled=true;$('authStatus').textContent=signup?'جاري إنشاء الحساب…':'جاري تسجيل الدخول…';
 try{
  const credentials={email:$('email').value.trim(),password:$('password').value};
  if(signup)credentials.options=signupReferralOptions();
  const {data,error}=await client.auth[signup?'signUp':'signInWithPassword'](credentials);if(error)throw error;
  if(data.session){$('password').value='';$('authStatus').textContent='';closeDialogs();await showUser(data.session);}else $('authStatus').textContent='تحقق من بريدك لتأكيد الحساب ثم سجّل الدخول.';
 }catch(error){$('authStatus').textContent=error.message||'تعذر تسجيل الدخول.';}
 finally{authBusy=false;$('login').disabled=false;$('signup').disabled=false;}
}
$('authForm').onsubmit=e=>{e.preventDefault();void authenticate(false);};$('signup').onclick=()=>void authenticate(true);
$('logout').onclick=async()=>{if(!client)return;$('logout').disabled=true;try{const {error}=await client.auth.signOut();if(error)throw error;closeDialogs();await showUser(null);}catch(e){status('تعذر تسجيل الخروج. أعد المحاولة.');}finally{$('logout').disabled=false;}};
$('refreshWallet').onclick=()=>void showUser(session);
async function copyReferral(){
 if(!session?.user){openDialog('authDialog');return;}if(!currentReferral){status('رابط دعوتك غير متاح بعد. حدّث المحفظة.');return;}
 try{await navigator.clipboard.writeText(currentReferral);status('تم نسخ رابط دعوتك.');}catch{$('referralField').hidden=false;$('referralUrl').focus();$('referralUrl').select();status('رابط دعوتك ظاهر؛ يمكنك نسخه يدويًا.');}
}
$('referralCopy').onclick=()=>void copyReferral();
$('referralShare').onclick=async()=>{
 if(!session?.user){openDialog('authDialog');return;}if(!currentReferral){status('رابط دعوتك غير متاح بعد. حدّث المحفظة.');return;}
 try{if(navigator.share)await navigator.share({title:'VOOXOR',text:'جرّب أدوات VOOXOR واجمع مكافآت VX. سجّل عبر دعوتي لتحصل على 25 VX، واحصل أنت على 50 VX عند إحالة أصدقائك وفق شروط المكافآت.',url:currentReferral});else await copyReferral();}
 catch(e){if(e.name!=='AbortError')void copyReferral();}
};
renderBalances();
try{
 client=createClient(
  'https://eiyvhdgcsgawxdphtvqx.supabase.co',
  'sb_publishable__hZCyLkEo_zc4absaCd2Kg_EDEWel_N'
);history=createHistory(client);
 const {data,error}=await client.auth.getSession();if(error)throw error;await showUser(data.session);
 client.auth.onAuthStateChange((_event,next)=>{setTimeout(()=>void showUser(next),0);});
}catch(e){$('guestNotice').hidden=false;status('تعذر الاتصال بالمحفظة. أعد تحميل الصفحة.');$('historyStatus').textContent='تعذر الاتصال بسجل المكافآت.';}
