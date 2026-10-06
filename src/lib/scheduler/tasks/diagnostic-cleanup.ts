import { prisma } from '@/lib/prisma';
import type { ScheduledTask } from '../types';
export async function cleanupDiagnostics() {
 const rows=await prisma.assistantRun.findMany({where:{purgedAt:null,OR:[{expiresAt:{lte:new Date()}},{message:{session:{deletedAt:{not:null}}}}]},select:{id:true},take:500});
 for(const {id} of rows) await prisma.$transaction(async tx=>{
  await tx.assistantSpan.updateMany({where:{runId:id},data:{input:'{}',output:null,error:null}});
  const badCase=await tx.assistantCase.findUnique({where:{runId:id},select:{id:true}});
  if(badCase){await tx.assistantEvaluation.deleteMany({where:{caseId:badCase.id}});await tx.assistantCase.update({where:{id:badCase.id},data:{note:'',expected:'',assertions:'{}',owner:'',rootCause:''}});}
  await tx.assistantRun.update({where:{id},data:{input:'{}',output:'',error:null,purgedAt:new Date()}});
 });
 return rows.length;
}
const task:ScheduledTask={name:'diagnostic-cleanup',description:'清理过期或已删除会话的诊断内容',schedule:'*/10 * * * *',runOnStartup:true,handler:async()=>{await cleanupDiagnostics();}};
export default task;
