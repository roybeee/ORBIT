'use client';
import type {Note} from '@/lib/orbit/model';
import type {ReactNode} from 'react';
export function WikiDocument({body,notes,onOpen}:{body:string;notes:Note[];onOpen:(id:string)=>void}){
 const inline=(text:string):ReactNode[]=>text.split(/(\[\[[^\]]+\]\]|\*\*[^*]+\*\*)/g).map((part,i)=>{
  if(part.startsWith('[[')){const [name,label]=part.slice(2,-2).split('|');const title=name.split('#')[0];const n=notes.find(n=>n.title.normalize('NFC')===title.normalize('NFC')||n.wiki?.aliases.includes(title));return n?<button key={i} className="wiki-inline-link" onClick={()=>onOpen(n.id)}>{label||title}</button>:<span key={i}>{label||title}</span>}
  if(part.startsWith('**'))return <strong key={i}>{part.slice(2,-2)}</strong>;return part;
 });
 const lines=body.split('\n');const out:ReactNode[]=[];
 for(let i=0;i<lines.length;i++){
  const line=lines[i];if(!line.trim())continue;
  if(line.trim().startsWith('|')){const rows:string[][]=[];while(i<lines.length&&lines[i].trim().startsWith('|')){const cells=lines[i].trim().replace(/^\||\|$/g,'').split(/\|(?![^[]*\]\])/).map(s=>s.trim());if(!cells.every(s=>/^:?-+:?$/.test(s)))rows.push(cells);i++}i--;out.push(<div className="wiki-table-scroll" key={i}><table><tbody>{rows.map((r,j)=><tr key={j}>{r.map((cell,k)=>j===0?<th key={k}>{inline(cell)}</th>:<td key={k}>{inline(cell)}</td>)}</tr>)}</tbody></table></div>);continue}
  const heading=line.match(/^(#{1,6})\s+(.*)/);if(heading){out.push(<h3 key={i}>{inline(heading[2])}</h3>);continue}
  if(/^---+$/.test(line.trim())){out.push(<hr key={i}/>);continue}
  out.push(<p key={i}>{inline(line)}</p>);
 }
 return <div className="wiki-document">{out}</div>;
}
