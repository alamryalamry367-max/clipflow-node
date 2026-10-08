const node=id=>document.getElementById(id);
let client,userId=null,offset=0,generation=0,busy=false;
const labels={signup_bonus:'هدية إنشاء الحساب',referral_bonus:'مكافأة دعوة صديق',install_app:'مكافأة تثبيت التطبيق',use_pdf_tool:'مكافأة تحويل الصور إلى PDF',watch_ad:'مكافأة إعلان / تجربة منصة',platform_daily:'مكافأة تجربة منصة',daily_bonus:'المكافأة اليومية'};
async function fetchHistory(reset=false){
 if(!userId||busy)return;
 if(reset){offset=0;node('historyList').replaceChildren();}
 const token=generation,account=userId;busy=true;node('historyRefresh').disabled=true;node('historyMore').disabled=true;node('historyStatus').textContent='جاري تحميل السجل…';
 try{
  const {data,error}=await client.rpc('vooxor_wallet_history',{p_offset:offset});
  if(token!==generation||account!==userId)return;
  if(error)throw error;
  if(!Array.isArray(data))throw new Error('استجابة السجل غير صالحة');
  for(const tx of data){
   const row=document.createElement('li'),coin=document.createElement('i'),text=document.createElement('div'),title=document.createElement('strong'),date=document.createElement('time'),amount=document.createElement('b');
   coin.className='vxFamilyCoin historyCoin';coin.textContent='V';coin.setAttribute('aria-hidden','true');text.className='historyText';title.textContent=labels[tx.transaction_type]||'حركة عملات VX';
   const d=new Date(tx.created_at);date.textContent=Number.isNaN(d.getTime())?'التاريخ غير متاح':new Intl.DateTimeFormat('ar-SA',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Riyadh',calendar:'gregory'}).format(d);if(!Number.isNaN(d.getTime()))date.dateTime=d.toISOString();
   const value=Number(tx.amount);amount.className='historyAmount'+(value<0?' negative':'');amount.textContent=(value>0?'+':'')+value+' VX';text.append(title,date);row.append(coin,text,amount);node('historyList').append(row);
  }
  offset+=data.length;node('historyMore').hidden=data.length<20;node('historyStatus').textContent=offset?'':'لا توجد حركات عملات بعد.';
 }catch(error){if(token===generation){node('historyStatus').textContent='تعذر تحميل السجل: '+(error.message||'أعد المحاولة');node('historyMore').hidden=true;}}
 finally{if(token===generation){busy=false;node('historyRefresh').disabled=false;node('historyMore').disabled=false;}}
}
export function loadWalletHistory(api,session){client=api;userId=session?.user?.id||null;generation++;busy=false;offset=0;node('walletHistory').hidden=!userId;node('historyList').replaceChildren();node('historyStatus').textContent='';node('historyMore').hidden=true;if(userId)void fetchHistory(true);}
node('historyRefresh').onclick=()=>void fetchHistory(true);
node('historyMore').onclick=()=>void fetchHistory();
