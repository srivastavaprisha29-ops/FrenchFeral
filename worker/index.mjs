const apiHeaders = {"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"};
const blankRow = {revision:0,generation:"",imported_guest:false,progress:null};
const readSql = "SELECT revision,generation,imported_guest,progress FROM learner_progress WHERE user_id = ?";
const json = (body,status=200) => Response.json(body,{status,headers:apiHeaders});

function sanitizeProgress(raw){
  const count = value => Number.isSafeInteger(value) && value >= 0 ? Math.min(value,1000000000) : 0;
  const date = value => typeof value==="string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value));
  const total = count(raw?.total);
  const result = {version:2,total,passed:Math.min(total,count(raw?.passed)),mastery:{},items:{},daily:null,lastDay:date(raw?.lastDay)?raw.lastDay:null,streak:count(raw?.streak)};
  for(let id=0;id<12;id++){
    if([1,2].includes(raw?.mastery?.[id]))result.mastery[id]=raw.mastery[id];
    if(typeof raw?.items?.[id]?.weak==="boolean")result.items[id]={weak:raw.items[id].weak};
  }
  const daily=raw?.daily;
  if(Number.isInteger(daily?.id) && daily.id>=0 && daily.id<12 && date(daily.day)){
    result.daily={id:daily.id,day:daily.day,complete:daily.complete===true};
  }
  return result;
}

async function readProgress(db,userId){
  const row = await db.prepare(readSql).bind(userId).first();
  return row ? {...row,imported_guest:Boolean(row.imported_guest),progress:JSON.parse(row.progress)} : blankRow;
}

async function progress(request,db,userId,url){
  if(!userId)return json({error:"Sign in to sync progress."},401);
  if(request.method==="GET")return json(await readProgress(db,userId));
  if(request.method!=="PUT" && request.method!=="DELETE")return json({error:"Method not allowed."},405);
  if(request.headers.get("Origin")!==url.origin || request.headers.get("X-Learner")!==userId){
    return json({error:"This request does not match the signed-in learner."},403);
  }
  if(!request.headers.get("Content-Type")?.startsWith("application/json"))return json({error:"Expected JSON."},415);
  const input=await request.text();
  if(input.length>8192)return json({error:"Progress payload is too large."},413);
  let body;
  try{body=JSON.parse(input);}catch{return json({error:"Invalid JSON."},400);}
  if(!Number.isSafeInteger(body?.revision) || body.revision<0 || typeof body.generation!=="string")return json({error:"Invalid progress version."},400);
  const current=await readProgress(db,userId);
  if(body.revision!==current.revision || body.generation!==current.generation)return json({error:"Progress changed on another device."},409);
  if(request.method==="DELETE"){
    if(!current.revision)return json(blankRow);
    const deletion=await db.prepare("DELETE FROM learner_progress WHERE user_id=? AND revision=? AND generation=?")
      .bind(userId,current.revision,current.generation).run();
    return deletion.meta.changes===1?json(blankRow):json({error:"Progress changed on another device."},409);
  }
  const generation = !current.revision || body.reset===true ? crypto.randomUUID() : current.generation;
  const imported = current.imported_guest || body.imported_guest===true;
  const data = sanitizeProgress(body.reset===true?null:body.progress);
  const next = {revision:current.revision+1,generation,imported_guest:imported,progress:data};
  const values = [next.revision,generation,Number(imported),JSON.stringify(data)];
  const write = current.revision
    ? db.prepare("UPDATE learner_progress SET revision=?,generation=?,imported_guest=?,progress=? WHERE user_id=? AND revision=? AND generation=?").bind(...values,userId,current.revision,current.generation)
    : db.prepare("INSERT OR IGNORE INTO learner_progress(revision,generation,imported_guest,progress,user_id) VALUES(?,?,?,?,?)").bind(...values,userId);
  const result=await write.run();
  return result.meta.changes===1?json(next):json({error:"Progress changed on another device."},409);
}

export default {
  async fetch(request,env){
    const url=new URL(request.url);
    const identity=request.headers.get("oai-authenticated-user-email") && request.headers.get("oai-authenticated-user-id");
    if(url.pathname==="/api/session")return request.method==="GET"?json({user:identity?{id:identity}:null}):json({error:"Method not allowed."},405);
    if(url.pathname==="/api/progress"){
      try{return await progress(request,env.DB,identity,url);}
      catch{return json({error:"Progress storage is temporarily unavailable."},503);}
    }
    const pathname=url.pathname==="/"?"/index.html":url.pathname;
    const entry=Object.hasOwn(assets,pathname)?assets[pathname]:null;
    if(!entry || !["GET","HEAD"].includes(request.method))return new Response("Not found",{status:404});
    const type=pathname.endsWith(".webp")?"image/webp":pathname.endsWith(".js")?"text/javascript; charset=utf-8":"text/html; charset=utf-8";
    return new Response(request.method==="HEAD"?null:Uint8Array.from(atob(entry),character=>character.charCodeAt(0)),{
      headers:{"Content-Type":type,"X-Content-Type-Options":"nosniff","Cache-Control":"public, max-age=300"}
    });
  }
};
