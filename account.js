let accountUser = null;
let remoteProgress = null;
const hostedAccounts = location.protocol==="https:";
let accountReady = !hostedAccounts;
let accountMessage = "";
let syncJob = null;
let accountEpoch = 0;
let accountBusy = false;

function cleanProgress(raw){
  const result = blank();
  const count = value => Number.isSafeInteger(value) && value >= 0 ? Math.min(value, 1000000000) : 0;
  const isDay = value => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value));
  result.total = count(raw?.total);
  result.passed = Math.min(result.total, count(raw?.passed));
  result.streak = count(raw?.streak);
  result.lastDay = isDay(raw?.lastDay) ? raw.lastDay : null;
  for(const lesson of lessons){
    const id = lesson.id;
    if([1,2].includes(raw?.mastery?.[id])) result.mastery[id] = raw.mastery[id];
    if(typeof raw?.items?.[id]?.weak === "boolean") result.items[id] = {weak:raw.items[id].weak};
  }
  if(Number.isInteger(raw?.daily?.id) && lessons[raw.daily.id] && isDay(raw.daily.day)){
    result.daily = {id:raw.daily.id, day:raw.daily.day, complete:raw.daily.complete === true};
  }
  return result;
}

function mergeProgress(remote, before, after, importing=false){
  const merged = cleanProgress(remote);
  const increases = field => Math.max(0, after[field] - before[field]);
  if(importing){
    merged.total = Math.max(merged.total, after.total);
    merged.passed = Math.max(merged.passed, after.passed);
  }else{
    merged.total += increases("total");
    merged.passed += increases("passed");
  }
  for(const {id} of lessons){
    if(after.mastery[id]) merged.mastery[id] = Math.max(merged.mastery[id] || 0, after.mastery[id]);
    const local = after.items[id]?.weak;
    if(local !== undefined && (importing ? !merged.items[id] : local !== before.items[id]?.weak)){
      merged.items[id] = {weak:local};
    }
  }
  if(after.lastDay && (!merged.lastDay || after.lastDay >= merged.lastDay)){
    const previousDay = new Date(after.lastDay + "T12:00:00");
    previousDay.setDate(previousDay.getDate()-1);
    const continuing = merged.lastDay === day(previousDay);
    const sameDay = merged.lastDay === after.lastDay;
    merged.streak = Math.max(after.streak, continuing ? merged.streak + 1 : sameDay ? merged.streak : 0);
    merged.lastDay = after.lastDay;
  }
  if(after.daily && (!merged.daily || after.daily.day > merged.daily.day)){
    merged.daily = {...after.daily};
  }else if(after.daily?.day === merged.daily?.day && after.daily?.id === merged.daily?.id && after.daily?.complete){
    merged.daily.complete = true;
  }
  return cleanProgress(merged);
}

async function accountRequest(path, options){
  const response=await fetch(path,{...options,cache:"no-store",credentials:"same-origin"});
  if(response.status===409)return null;
  if(response.ok)return response.json();
  const body=await response.json().catch(()=>null);
  throw Error(body?.error || "Could not connect to your dashboard. Please try again.");
}
function progressRow(){
  return accountRequest("/api/progress");
}
function updateProgress(user,row,changes,method="PUT"){
  return accountRequest("/api/progress",{
    method,
    headers:{"Content-Type":"application/json","X-Learner":user.id},
    body:JSON.stringify({revision:row.revision,generation:row.generation,...changes})
  });
}
function accountViewChanged(){
  if(page==="account" || page==="progress")render();
}
async function useAccount(user){
  if(user?.id===accountUser?.id && accountReady)return;
  const epoch = ++accountEpoch;
  accountUser = user;
  accountReady = false;
  remoteProgress = null;
  setPracticeData(user ? blank() : guestProgress);
  if(!user){accountReady=true;accountViewChanged();return;}
  try{
    const row = await progressRow();
    if(epoch!==accountEpoch)return;
    remoteProgress = row;
    setPracticeData(cleanProgress(row.progress));
    accountReady = true;
    accountMessage = "";
  }catch{
    if(epoch!==accountEpoch)return;
    accountMessage = "Couldn’t load your progress. Use Retry connection.";
  }
  if(epoch===accountEpoch){
    if(page==="practice")go("progress");
    else if(page==="today" || page==="lessons" || page==="review")render();
    else accountViewChanged();
  }
}

function queueProgress(){
  if(!accountReady || !remoteProgress || !accountUser || syncJob)return;
  const epoch=accountEpoch;
  const user=accountUser;
  syncJob=(async()=>{
    let base=cleanProgress(remoteProgress.progress);
    for(let attempt=0;attempt<6;attempt++){
      if(epoch!==accountEpoch)return;
      const snapshot=cleanProgress(data);
      if(JSON.stringify(snapshot)===JSON.stringify(base))return;
      const current=await progressRow();
      if(epoch!==accountEpoch)return;
      if(!current || (remoteProgress.revision && current.generation!==remoteProgress.generation)){
        if(current){remoteProgress=current;setPracticeData(cleanProgress(current.progress));}
        throw Error("Progress was reset elsewhere. Your dashboard has been refreshed.");
      }
      const next=mergeProgress(current.progress,base,snapshot);
      const written=await updateProgress(user,current,{progress:next});
      if(epoch!==accountEpoch)return;
      if(!written)continue;
      setPracticeData(mergeProgress(next,snapshot,cleanProgress(data)));
      remoteProgress=written;
      base=next;
    }
    throw Error("Progress is waiting to sync. Select Retry sync.");
  })().then(()=>{
    if(epoch===accountEpoch)accountMessage="";
  }).catch(error=>{
    if(epoch===accountEpoch)accountMessage=error instanceof Error?error.message:"Progress is waiting to sync. Select Retry sync.";
  }).finally(()=>{
    syncJob=null;
    if(epoch===accountEpoch)accountViewChanged();
  });
}

function accountPanel(){
  const status=accountMessage ? '<p role="status" class="feedback">'+escaped(accountMessage)+'</p>' : "";
  const button=(action,label)=>'<button class="button" type="button" data-account="'+action+'"'+(accountBusy?' disabled':'')+'>'+label+'</button>';
  if(!hostedAccounts)return intro("Account","Guest practice is available here. Visit the hosted FrenchFeral Site to sign in.");
  if(!accountReady)return intro("Account","Checking your connection…")+status+button("retry","Retry connection");
  if(!accountUser)return intro("Account","Keep practicing as a guest, or sign in to sync your dashboard across devices.")+status+
    '<a class="button" href="/signin-with-chatgpt?return_to=%2F%3Fview%3Daccount" target="_top">Continue with ChatGPT</a>';
  return intro("Account","You’re signed in with ChatGPT.")+status+
    '<div class="card"><h3>Progress & privacy</h3><p>FrenchFeral syncs progress totals, streak, and current mastery and review status.</p><div class="actions">'+
    (guestProgress.total && !remoteProgress?.imported_guest ? button("import","Import practice from this browser"):"")+
    button("retry","Retry sync")+button("signout","Sign out")+button("reset","Reset progress")+button("delete","Delete synced data")+'</div></div>';
}

async function accountAction(action){
  if(accountBusy || !hostedAccounts)return;
  if(action==="retry"){
    if(accountReady && accountUser)queueProgress();
    else await initializeAccount();
    return;
  }
  if(!accountUser || !accountReady)return;
  const user=accountUser;
  const epoch=accountEpoch;
  if(action==="reset" && !window.confirm("Reset all synced FrenchFeral progress?"))return;
  if(action==="delete" && !window.confirm("Permanently delete your synced FrenchFeral data? Your ChatGPT account stays active."))return;
  accountBusy=true;
  try{
    await syncJob;
    if(epoch!==accountEpoch)return;
    if(action==="signout"){
      if(JSON.stringify(cleanProgress(data))!==JSON.stringify(cleanProgress(remoteProgress.progress))){
        throw Error("Some progress is waiting to sync. Select Retry sync before signing out.");
      }
      window.top.location.href="/signout-with-chatgpt?return_to=%2F";
      return;
    }
    const row=await progressRow();
    if(epoch!==accountEpoch)return;
    if(action==="import" && row.imported_guest)throw Error("Guest progress has already been imported into this account.");
    const changes=action==="import" ? {
      progress:mergeProgress(row.progress,blank(),cleanProgress(guestProgress),true),imported_guest:true
    } : {reset:true};
    const written=await updateProgress(user,row,changes,action==="delete"?"DELETE":"PUT");
    if(epoch!==accountEpoch)return;
    if(!written)throw Error("Progress changed on another device. Try again.");
    if(action==="import"){
      guestProgress=blank();
      saveGuestProgress();
    }
    remoteProgress=written;
    setPracticeData(cleanProgress(written.progress));
    accountMessage=action==="import"?"Guest progress imported.":action==="delete"?"Synced data deleted.":"Progress reset.";
  }catch(error){accountMessage=error.message || "Account request failed. Please try again.";}
  finally{accountBusy=false;accountViewChanged();}
}

async function initializeAccount(){
  if(!hostedAccounts)return;
  try{
    const session=await accountRequest("/api/session");
    await useAccount(session.user);
  }catch(error){
    accountMessage=error.message;
    accountViewChanged();
  }
}
