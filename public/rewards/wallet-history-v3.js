const $=id=>document.getElementById(id);
const labels={signup_bonus:'هدية إنشاء الحساب',referral_bonus:'مكافأة دعوة صديق',install_app:'مكافأة تثبيت التطبيق',use_pdf_tool:'مكافأة تحويل الصور إلى PDF',watch_ad:'مكافأة إعلان / تجربة منصة',platform_daily:'مكافأة تجربة منصة',daily_bonus:'المكافأة اليومية'};
const svgNS='http://www.w3.org/2000/svg';
function icon(name){const svg=document.createElementNS(svgNS,'svg'),use=document.createElementNS(svgNS,'use');svg.classList.add('icon');svg.setAttribute('aria-hidden','true');use.setAttribute('href','#i-'+name);svg.append(use);return svg;}
export function createHistory(client){
 let account=null,version=0,offset=0,busy=false,hasMore=false,entries=[],filter='all',errorText='';
 const isReferral=tx=>String(tx.transaction_type||'').includes('referral');
 function render(){
  $('historyList').replaceChildren();
  const visible=entries.filter(tx=>filter==='all'||(filter==='referrals'?isReferral(tx):!isReferral(tx)));
  for(const tx of visible){
   const li=document.createElement('li'),avatar=document.createElement('span'),text=document.createElement('div'),title=document.createElement('strong'),time=document.createElement('time'),amount=document.createElement('b'),complete=document.createElement('span');
   avatar.className='txIcon'+(isReferral(tx)?'':' reward');avatar.append(icon(isReferral(tx)?'adduser':'gift'));
   text.className='txText';title.textContent=labels[tx.transaction_type]||(isReferral(tx)?'مكافأة إحالة':'حركة رصيد VX');
   const date=new Date(tx.created_at);if(Number.isFinite(date.getTime())){time.dateTime=date.toISOString();time.textContent=new Intl.DateTimeFormat('ar-SA',{dateStyle:'short',timeStyle:'short',calendar:'gregory',timeZone:'Asia/Riyadh'}).format(date);}else time.textContent='التاريخ غير متاح';
   const value=Number(tx.amount);amount.className='txAmount'+(value<0?' negative':'');amount.dir='ltr';amount.textContent=Number.isFinite(value)?(value>0?'+':'')+value+' VX':'— VX';
   complete.className='txComplete';complete.setAttribute('aria-label','مسجلة في سجل المكافآت');complete.append(icon('check'));text.append(title,time);li.append(avatar,text,amount,complete);$('historyList').append(li);
  }
  $('historyStatus').textContent=!account?'سجّل الدخول لعرض سجل مكافآتك.':errorText?errorText:busy?'جاري تحميل العمليات…':!entries.length?'لم تُسجّل مكافآت بعد.':!visible.length?'لا توجد نتائج لهذا التصنيف ضمن العمليات المحمّلة.':'';
  $('historyMore').hidden=!hasMore;$('historyMore').disabled=busy;$('historyRefresh').disabled=!account||busy;
 }
 async function fetchPage(reset=false){
  if(!account||busy)return;
  if(reset){offset=0;entries=[];hasMore=false;}
  const request=version;busy=true;errorText='';render();
  try{const {data,error}=await client.rpc('vooxor_wallet_history',{p_offset:offset});if(request!==version)return;if(error)throw error;if(!Array.isArray(data))throw new Error('استجابة السجل غير صالحة');entries.push(...data);offset+=data.length;hasMore=data.length===20;}
  catch(error){if(request===version)errorText='تعذر تحميل السجل. اضغط زر التحديث لإعادة المحاولة.';}
  finally{if(request===version){busy=false;render();}}
 }
 function load(session){version++;account=session?.user?.id||null;entries=[];offset=0;busy=false;hasMore=false;errorText='';render();if(account)void fetchPage();}
 $('historyRefresh').onclick=()=>void fetchPage(true);$('historyMore').onclick=()=>void fetchPage();
 document.querySelectorAll('[data-filter]').forEach(button=>button.onclick=()=>{filter=button.dataset.filter;document.querySelectorAll('[data-filter]').forEach(b=>{const active=b===button;b.classList.toggle('selected',active);b.setAttribute('aria-pressed',String(active));});render();});
 return {load};
}
