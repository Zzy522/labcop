"use client";
import { useEffect,useState } from 'react';
import { authFetch } from '@/lib/auth-fetch';
export function DiagnosticNotice(){const [days,setDays]=useState<number|null>(null);useEffect(()=>{void authFetch('/api/assistant/diagnostics-policy').then(r=>r.json()).then(d=>setDays(d.captureContent?d.retentionDays:null)).catch(()=>{});},[]);return days?<p className="my-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">测试诊断已开启：本实验室的对话、实际上下文及工具输入/输出将供授权开发者排查，保留 {days} 天。请勿输入与测试无关的敏感资料。</p>:null;}
