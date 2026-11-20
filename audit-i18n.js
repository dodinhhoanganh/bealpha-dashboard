const fs=require("fs"),path=require("path"),vm=require("vm"),dir=path.join(__dirname,"lib/i18n/translations");
function load(lang){const fp=path.join(dir,lang+".ts");let s=fs.readFileSync(fp,"utf8");
s=s.replace(/^import\s+.*$/gm,"").replace(/^export\s+default\s+\w+\s*;?\s*$/gm,"")
 .replace(/^export\s+type\s+TranslationKeys\s*=.*$/gm,"")
 .replace(/export\s+type\s+LocaleDictionary\s*=\s*\{[\s\S]*?\n\};\s*$/m,"");
s=s.replace(/const\s+\w+\s*:\s*\w+\s*=\s*\{/,"module.exports = {").replace(/const\s+\w+\s*=\s*\{/,"module.exports = {");
const sandboxModule={exports:{}};
try{vm.runInNewContext(s,{module:sandboxModule,exports:sandboxModule.exports},{filename:fp});return sandboxModule.exports;}catch{return null;}}
function flat(o,p=""){const r={};for(const[k,v]of Object.entries(o)){const key=p?p+"."+k:k;
if(typeof v==="object"&&v!==null&&!Array.isArray(v))Object.assign(r,flat(v,key));else r[key]=String(v);}return r;}
const SAME=new Set(["Audio","Dashboard","Labels","Label","Status","Marketing","Playlists","Tracks","Single","Remixer","Producer","Version","Instrumental","Standard","Original","Zoom","Platform","Bassist","Drummer","Pianist","Instrumentalist","Account","Details","Streams","No","Email","Password","Admin","Actions","Distribution","Compositions","Notifications","Roles","Period","Artist","Explicit","Date","Page","N/A","Video","Codec","ISWC","EP","DPID","Import / Export","Pitching & Marketing","Distribution (DDEX)","Visuals & Canvas","Import","Export","Download","Super Admin","Email *","Password *","Role *","labels","releases","ID","UPC","VEVO","DSP","Spotify","Apple Music","Amazon Music","YouTube Music","Tidal","Deezer","DDEX","ISRC","SMS","Logo","Spotify ID","Apple Music ID","Rapper","Studio","Spotify Canvas","Apple Music Motion","Remaster","UPC *","UPC/EAN","Album","Tidal Focus Artwork","Amazon Hi-Res Artwork","user@example.com","Apple Digital Masters","True Peak ≤ -1 dBTP","engineer@studio.com","Genre","Genre *","Artwork","Distributor","Optional","Title","Description","Name","Format","Name *","Loading","00:00:30","00:01:30","BeAlpha","Audio · DDEX ERN","Video · VEVO","Bio","Action","Type","min 500","Support"]);
const en=load("en"),enF=flat(en);
const langs=["vi"];
let failures=0;
for(const lang of langs){const o=load(lang);if(!o){failures++;console.error("\n❌ "+lang+": dictionary could not be parsed");continue;}const f=flat(o);const u=[];
const missing=Object.keys(enF).filter(k=>!(k in f));
for(const[k,ev]of Object.entries(enF)){const lv=f[k];if(lv===ev&&ev.length>1&&!SAME.has(ev))u.push({k,v:ev});}
if(u.length===0&&missing.length===0)console.log("✅ "+lang+": complete");
else{console.log("\n🟡 "+lang+": "+u.length+" untranslated, "+missing.length+" fallback-to-English keys");missing.forEach(k=>console.log("  FALLBACK "+k));u.forEach(x=>console.log("  "+x.k+': "'+x.v.substring(0,60)+'"'));}}
if(failures)process.exitCode=1;
