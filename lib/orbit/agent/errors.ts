export class AgentError extends Error {code:string;status:number;constructor(message:string,code='INPUT',status=400){super(message);this.code=code;this.status=status}}
