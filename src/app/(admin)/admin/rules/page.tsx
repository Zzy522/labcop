'use client';

import { Settings2, ShieldCheck, AlertTriangle, FlaskConical, Info } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';

// MVP: 只读展示当前规则配置
const ruleCategories = [
  {
    title: '领用审查规则',
    icon: ShieldCheck,
    color: 'bg-blue-100 text-blue-600',
    rules: [
      { name: '危化品领用审批', description: '危险化学品领用需经过管理员审批确认', enabled: true },
      { name: '领用数量限制', description: '单次领用数量不超过库存的30%', enabled: true },
      { name: '非授权试剂拦截', description: '非授权人员领用高风险试剂将被自动阻断', enabled: true },
    ],
  },
  {
    title: '兼容性检查规则',
    icon: AlertTriangle,
    color: 'bg-orange-100 text-orange-600',
    rules: [
      { name: '试剂不兼容检测', description: '检测同实验室中存放的不兼容试剂组合', enabled: true },
      { name: '存储条件冲突', description: '检测存储条件不满足试剂要求的试剂', enabled: false },
    ],
  },
  {
    title: '库存预警规则',
    icon: FlaskConical,
    color: 'bg-cyan-100 text-cyan-600',
    rules: [
      { name: '低库存预警', description: '库存低于最低库存线时自动触发预警', enabled: true },
      { name: '临期预警', description: '试剂在过期前30天触发临期预警', enabled: true },
      { name: '过期预警', description: '试剂过期后立即触发预警', enabled: true },
    ],
  },
];

export default function RulesPage() {
  return (
    <div className="space-y-5">
      <div className="flex justify-end">
        <Badge variant="outline" className="text-xs">
          <Info className="size-3" />
          规则编辑功能将在后续版本开放
        </Badge>
      </div>

      <div className="space-y-6">
        {ruleCategories.map((category) => {
          const Icon = category.icon;
          return (
            <Card key={category.title}>
              <CardHeader>
                <div className="flex items-center gap-3">
                  <div className={`flex size-10 items-center justify-center rounded-lg ${category.color}`}>
                    <Icon className="size-5" />
                  </div>
                  <div>
                    <CardTitle className="text-base">{category.title}</CardTitle>
                    <CardDescription>共 {category.rules.length} 条规则</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="divide-y">
                  {category.rules.map((rule, idx) => (
                    <div key={idx} className="flex items-center justify-between py-3 first:pt-0 last:pb-0">
                      <div className="flex-1">
                        <p className="text-sm font-medium text-gray-800">{rule.name}</p>
                        <p className="text-xs text-gray-500 mt-0.5">{rule.description}</p>
                      </div>
                      <Badge
                        variant={rule.enabled ? 'default' : 'secondary'}
                        className={rule.enabled ? 'bg-green-100 text-green-700' : ''}
                      >
                        {rule.enabled ? '已启用' : '已禁用'}
                      </Badge>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
