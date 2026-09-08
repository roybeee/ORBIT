import {z} from 'zod';
import {sceneModes} from './scenes.ts';
const level=z.number().finite().min(0).max(100);
const scene=z.string().refine(id=>Object.hasOwn(sceneModes,id),'알 수 없는 사운드입니다.');
const seconds=z.number().int().min(0).max(10800);
export const soundConfig=z.object({
  mix:z.object({rain:level,ocean:level,wind:level,noise:level,pad:level}),
  beatEnabled:z.boolean(),beatHz:z.number().min(1).max(40),fade:z.number().min(0).max(60),
  silent:z.boolean().optional(),engineVersion:z.string().max(16).optional(),
  purposeRating:z.number().int().min(1).max(5).nullable().optional(),
});
const configJson=z.string().max(2000).refine(value=>{try{return soundConfig.safeParse(JSON.parse(value)).success}catch{return false}});
const result=z.enum(['done','partial','not-started','rested','ended']).nullable();
const helpful=z.number().int().min(0).max(1).nullable();
const session=z.object({
  id:z.string().uuid(),scene_id:scene,mode:z.enum(['focus','rest','sleep']),goal:z.string().max(240),
  duration:seconds.min(60),elapsed:seconds,status:z.enum(['active','completed','abandoned']),
  result,helpful,discomfort:z.number().int().min(0).max(1),started_at:z.number().finite().nonnegative(),
  finished_at:z.number().finite().nonnegative().nullable(),mix_json:configJson,
}).refine(s=>s.mode===sceneModes[s.scene_id as keyof typeof sceneModes]&&s.elapsed<=s.duration,'세션의 목적과 시간을 확인해 주세요.');
const routine=z.object({id:z.string().uuid(),name:z.string().trim().min(1).max(60),scene_id:scene,duration:seconds.min(60),mix_json:configJson});
export const soundState=z.object({
  sessions:z.array(session).max(500),active:session.nullable(),favorites:z.array(scene).max(24),
  routines:z.array(routine).max(50),settings:z.object({volume:level.optional(),fade:z.number().min(0).max(60).optional()}),name:z.string().max(80),
});
export type SoundState=z.infer<typeof soundState>;
export const emptySound=():SoundState=>({sessions:[],active:null,favorites:[],routines:[],settings:{},name:'나의 사운드스테이션'});
export const soundAction=z.discriminatedUnion('action',[
  z.object({action:z.literal('start'),id:z.string().uuid(),sceneId:scene,goal:z.string().max(240),duration:seconds.min(60),config:soundConfig}),
  z.object({action:z.literal('checkpoint'),id:z.string().uuid(),elapsed:seconds,config:soundConfig}),
  z.object({action:z.literal('finish'),id:z.string().uuid(),elapsed:seconds,config:soundConfig,result,helpful,discomfort:z.boolean()}),
  z.object({action:z.literal('feedback'),id:z.string().uuid(),helpful,discomfort:z.boolean()}),
  z.object({action:z.literal('favorite'),sceneId:scene,enabled:z.boolean()}),
  z.object({action:z.literal('routine'),id:z.string().uuid(),name:z.string().trim().min(1).max(60),sceneId:scene,duration:seconds.min(60),config:soundConfig}),
  z.object({action:z.literal('delete-routine'),id:z.string().uuid()}),
  z.object({action:z.literal('settings'),volume:level,fade:z.number().min(0).max(60)}),
  z.object({action:z.literal('clear-history')}),
  z.object({action:z.literal('import'),state:soundState}),
]);
export type SoundAction=z.infer<typeof soundAction>;
export function reduceSound(previous:SoundState,input:SoundAction,now=Date.now()):SoundState{
  const s=structuredClone(previous);
  switch(input.action){
    case 'start':
      if(s.sessions.some(row=>row.id===input.id))throw Error('이미 마친 세션입니다. 사운드 화면에서 새 세션을 시작해 주세요.');
      if(s.active){if(s.active.id===input.id)return s;throw Error('진행 중인 사운드 세션이 있습니다. 다시 연결해 이어 듣거나 마쳐 주세요.');}
      s.active={id:input.id,scene_id:input.sceneId,mode:sceneModes[input.sceneId as keyof typeof sceneModes],goal:input.goal,duration:input.duration,elapsed:0,status:'active',result:null,helpful:null,discomfort:0,started_at:now,finished_at:null,mix_json:JSON.stringify(input.config)};break;
    case 'checkpoint':
      if(s.active?.id===input.id){s.active.elapsed=Math.min(s.active.duration,Math.max(s.active.elapsed,input.elapsed));s.active.mix_json=JSON.stringify(input.config);}break;
    case 'finish':
      if(s.active?.id===input.id){
        s.sessions=[{...s.active,elapsed:Math.min(s.active.duration,Math.max(s.active.elapsed,input.elapsed)),status:'completed' as const,result:input.result,helpful:input.helpful,discomfort:input.discomfort?1:0,finished_at:now,mix_json:JSON.stringify(input.config)},...s.sessions.filter(row=>row.id!==input.id)].slice(0,500);s.active=null;
      }break;
    case 'feedback':{const row=s.sessions.find(row=>row.id===input.id);if(row){row.helpful=input.helpful;row.discomfort=input.discomfort?1:0;}break;}
    case 'favorite':s.favorites=input.enabled?[...new Set([...s.favorites,input.sceneId])]:s.favorites.filter(id=>id!==input.sceneId);break;
    case 'routine':
      if(s.routines.some(row=>row.id===input.id))break;
      if(s.routines.length>=50)throw Error('루틴은 최대 50개까지 저장할 수 있습니다.');
      s.routines.unshift({id:input.id,name:input.name,scene_id:input.sceneId,duration:input.duration,mix_json:JSON.stringify(input.config)});break;
    case 'delete-routine':s.routines=s.routines.filter(row=>row.id!==input.id);break;
    case 'settings':s.settings={volume:input.volume,fade:input.fade};break;
    case 'clear-history':s.sessions=[];break;
    case 'import':{
      if(s.active)throw Error('진행 중인 세션을 마친 뒤 백업을 불러와 주세요.');
      const sessions=new Map(s.sessions.map(row=>[row.id,row]));
      input.state.sessions.filter(row=>row.status==='completed').forEach(row=>sessions.set(row.id,row));
      const routines=new Map(s.routines.map(row=>[row.id,row]));input.state.routines.forEach(row=>routines.set(row.id,row));
      s.sessions=[...sessions.values()].sort((a,b)=>b.started_at-a.started_at).slice(0,500);
      s.routines=[...routines.values()].slice(0,50);s.favorites=[...new Set([...s.favorites,...input.state.favorites])];
      s.settings={...s.settings,...input.state.settings};s.active=input.state.active?.status==='active'?input.state.active:null;break;
    }
  }
  return s;
}
