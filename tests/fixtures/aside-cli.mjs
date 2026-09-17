import {appendFileSync} from 'node:fs';
const args=process.argv.slice(2),file=args[args.indexOf('--log-dump')+1],prompt=args.at(-1);
if(args.includes('--help')){console.log('--account --log-dump');process.exit(0)}
if(args[0]==='account'){console.log('* paid-account test@example.com signed in');process.exit(0)}
appendFileSync(file+'.spawns','spawn\n');
appendFileSync(file,JSON.stringify({type:'message_end',message:{role:'assistant',content:[{type:'text',text:'Planning only'}]}})+'\n');
appendFileSync(file,JSON.stringify({type:'tool_execution_start',toolName:'browser',args:{secret:'should-not-upload'}})+'\n');
if(prompt.includes('wait forever'))setInterval(()=>{},1000);
else setTimeout(()=>{appendFileSync(file,JSON.stringify({type:'message_end',message:{role:'assistant',content:[{type:'text',text:'Final answer with https://example.com/source'}]}})+'\n');process.exit(0)},100);
