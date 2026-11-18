import { mkdir, readFile, writeFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const sources = ["index.html","account.js","cafe.webp","campus.webp","library.webp","metro.webp","paper.webp","paris-collage.webp"];
const assets = Object.fromEntries(await Promise.all(sources.map(async name => {
  const file = await readFile(new URL(name,root));
  return ["/"+name,file.toString("base64")];
})));
const dist = new URL("dist/server/",root);
await mkdir(dist,{recursive:true});
const worker = await readFile(new URL("worker/index.mjs",root),"utf8");
await writeFile(new URL("index.js",dist),"const assets = "+JSON.stringify(assets)+";\n"+worker);
