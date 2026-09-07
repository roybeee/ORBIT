export function checkShareManifest(value:unknown){
 if(!value||typeof value!=='object')return false;
 const m=value as {id?:unknown;scope?:unknown;share_target?:{action?:unknown;method?:unknown;enctype?:unknown;params?:{files?:{name?:unknown;accept?:unknown}[]}};icons?:{src?:unknown}[]};
 const target=m.share_target;
 return m.id==='/'&&m.scope==='/'&&target?.action==='/share-target'&&target.method==='POST'&&target.enctype==='multipart/form-data'&&Array.isArray(target.params?.files)&&target.params.files.some(f=>f.name==='files'&&Array.isArray(f.accept)&&f.accept.includes('image/*'))&&Array.isArray(m.icons)&&m.icons.length>=2&&m.icons.every(i=>typeof i.src==='string'&&i.src.startsWith('data:image/png;base64,'));
}
