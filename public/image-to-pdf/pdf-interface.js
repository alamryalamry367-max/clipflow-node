/* UI only; balances and PDF rewards remain controlled by Supabase. */
(() => {
 const notice=document.getElementById('rewardNotice'),referral=document.getElementById('vxPdfReferralLink');
 async function action(share){
  if(!referral.dataset.url){const box=document.getElementById('vxPdfAuthBox');box.style.display='block';box.scrollIntoView({behavior:'smooth',block:'center'});document.getElementById('vxPdfEmail').focus();return;}
  try{if(share&&navigator.share)await navigator.share({title:'VOOXOR Rewards',text:'انضم إلى VOOXOR Rewards من رابط دعوتي',url:referral.dataset.url});else if(navigator.clipboard){await navigator.clipboard.writeText(referral.dataset.url);notice.textContent='تم نسخ رابط الإحالة';}else notice.textContent=referral.dataset.url;}
  catch(e){if(e.name!=='AbortError')notice.textContent='تعذر النسخ أو المشاركة. يمكنك نسخ الرابط من الحقل.';}
 }
 document.getElementById('vxPdfReferralCopy').addEventListener('click',()=>action(false));
 document.getElementById('vxPdfReferralShare').addEventListener('click',()=>action(true));
 // Destination reconstructed from the supplied placement's generateUrl/getPath.
 // Do not reuse the global popunder layer: it intercepts unrelated tool clicks.
 document.getElementById('vxWatchAdRewardCard').addEventListener('click',async()=>{
  if(typeof window.claimWatchAdVXReward!=='function'){notice.textContent='جاري تحميل نظام المكافآت. حاول مجددًا بعد لحظة.';return;}
  const adUrl=new URL('https://spendsdetachment.com/qpad1xzw4');
  const params={scrWidth:String(screen.width),scrHeight:String(screen.height),tz:String(-new Date().getTimezoneOffset()/60),ship:'1',v:'2026.10.6_9153',refer:location.href,kw:JSON.stringify([]),key:'e6542ff4b88b27acc240eedbf8d07660',sub3:'invoke_layer',ifid:crypto.randomUUID?crypto.randomUUID():String(Date.now()),ibid:'01a117da-7d9e-7482-87cf-7600af955012'};
  for(const [key,value] of Object.entries(params))adUrl.searchParams.set(key,value);
  // Open synchronously, before any RPC/await, to retain Android user activation.
  const adWindow=window.open(adUrl.href,'_blank');
  if(adWindow){try{adWindow.opener=null;}catch{}}
  notice.textContent='جاري إضافة مكافأة الضغطة…';
  try{
    const result=await window.claimWatchAdVXReward();
    if(!adWindow){
      const link=document.createElement('a');link.href=adUrl.href;link.target='_blank';link.rel='noopener noreferrer';link.textContent='فتح الإعلان';link.style.marginInlineStart='8px';
      notice.append(document.createTextNode(' — إذا لم يفتح الإعلان، اضغط: '),link);
    }
  }catch(error){notice.textContent='تعذر إضافة المكافأة: '+(error.message||'خطأ اتصال');}
 });
 const drop=document.getElementById('dropZone');
 ['dragenter','dragover'].forEach(t=>drop.addEventListener(t,()=>drop.classList.add('dragOver')));
 ['dragleave','drop'].forEach(t=>drop.addEventListener(t,()=>drop.classList.remove('dragOver')));
 const grid=document.getElementById('files');let count=0;
 new MutationObserver(()=>{const next=grid.children.length;if(!count&&next)document.getElementById('workspace').scrollIntoView({behavior:'smooth',block:'start'});count=next;}).observe(grid,{childList:true});
})();
