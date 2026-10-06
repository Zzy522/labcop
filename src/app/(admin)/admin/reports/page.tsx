'use client';

import { useState } from 'react';
import { BarChart3, Download, FileText, FlaskConical, Cpu, AlertTriangle, ClipboardList } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { authFetch } from '@/lib/auth-fetch';

const reportTypes = [
  {
    id: 'reagents',
    title: '试剂台账',
    description: '导出所有试剂的完整台账信息',
    icon: FlaskConical,
    color: 'bg-cyan-100 text-cyan-600',
  },
  {
    id: 'devices',
    title: '设备台账',
    description: '导出所有设备的完整台账信息',
    icon: Cpu,
    color: 'bg-indigo-100 text-indigo-600',
  },
  {
    id: 'requisitions',
    title: '领用记录',
    description: '导出所有领用申请的详细记录',
    icon: ClipboardList,
    color: 'bg-emerald-100 text-emerald-600',
  },
  {
    id: 'risk-events',
    title: '风险事件',
    description: '导出所有风险事件的详细记录',
    icon: AlertTriangle,
    color: 'bg-red-100 text-red-600',
  },
];

export default function ReportsPage() {
  const [exporting, setExporting] = useState<string | null>(null);

  const handleExport = async (type: string) => {
    setExporting(type);
    try {
      const res = await authFetch(`/api/reports/export?type=${type}`);
      if (!res.ok) throw new Error('导出失败');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const disposition = res.headers.get('Content-Disposition');
      const match = disposition?.match(/filename\*=UTF-8''(.+)/);
      a.download = match ? decodeURIComponent(match[1]) : `${type}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      alert('导出失败，请重试');
    } finally {
      setExporting(null);
    }
  };

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {reportTypes.map((report) => {
          const Icon = report.icon;
          return (
            <Card key={report.id} className="hover:shadow-md transition-shadow">
              <CardHeader>
                <div className="flex items-center gap-3">
                  <div className={`flex size-10 items-center justify-center rounded-lg ${report.color}`}>
                    <Icon className="size-5" />
                  </div>
                  <div className="flex-1">
                    <CardTitle className="text-sm">{report.title}</CardTitle>
                    <CardDescription className="text-xs">{report.description}</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="flex">
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full"
                  disabled={exporting === report.id}
                  onClick={() => handleExport(report.id)}
                >
                  <Download className="size-4" />
                  {exporting === report.id ? '导出中...' : '导出 CSV'}
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
