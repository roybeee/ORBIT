export interface ProtectedBlock {id:string;title:string;date:string;start:number;end:number}
export interface WeeklyAllocation {
  id:string; from:string; through:string; approvedAt:string; active:boolean; capacityAtApproval:number;
  allocations:{projectId:string;minutes:number;stance:'focus'|'maintain'|'pause';reason:string}[];
  protectedBlocks:ProtectedBlock[];
}
export interface OperatingMetric {
  id:string;projectId:string;name:string;category:'sales'|'cost'|'evidence'|'people'|'contract';unit:string;
  badDirection:'up'|'down';thresholdPercent:number;thresholdAbsolute:number;maxAgeDays:number;
  assignee:string;updatedAt:string;
}
export interface MetricObservation {
  id:string;metricId:string;from:string;through:string;value:number;source:string;
  noteId?:string;noteRevision?:number;recordedAt:string;
  supersedesId?:string;
}
export interface SignalFollowup {
  id:string;metricId:string;observationId:string;baselineId:string;taskId?:string;delegationId?:string;
  question:string;status:'open'|'resolved'|'dismissed';resolution:string;createdAt:string;updatedAt:string;
}
export interface MeetingRecord {
  id:string;projectId:string;event:{id:string;title:string;date:string;start:number;end:number};
  noteId:string;noteRevision:number;summary:string;changedConditions:string;
  priorDecisions:{id:string;title:string;choice:string;updatedAt:string}[];
  decisionId?:string;taskIds:string[];delegationIds:string[];createdAt:string;
}
