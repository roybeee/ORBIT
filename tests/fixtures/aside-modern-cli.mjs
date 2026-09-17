const args=process.argv.slice(2);
if(args.includes('--help')){console.log('Usage: aside exec [options] [prompt...]\n--account <id> --host <host>');process.exit(0)}
if(args[0]==='account'&&args[1]==='list'){console.log('* paid-account test@example.com signed in');process.exit(0)}
if(args[0]!=='exec'||args[1]!=='--account'||args[2]!=='paid-account'||args.length!==4){console.error('Unsupported arguments');process.exit(2)}
console.log('세션 시작: ses_test');
setTimeout(()=>{console.log('CLI 출력 수신');process.exit(args.at(-1).includes('fail')?1:0)},100);
