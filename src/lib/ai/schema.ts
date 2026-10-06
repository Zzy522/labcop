/** 试剂识别字段定义，用于结构化结果展示和编辑 */
export const REAGENT_FIELDS = [
  { key: 'reagentName', label: '试剂名称', required: true },
  { key: 'casNumber', label: 'CAS号', required: false },
  { key: 'specification', label: '质量/容量规格', required: true },
  { key: 'remarks', label: '备注（浓度/纯度）', required: false },
  { key: 'brand', label: '品牌', required: false },
  { key: 'dangerCategory', label: '危险类别', required: false },
  { key: 'riskLevel', label: '风险等级', required: true },
  { key: 'isHazardous', label: '是否危化品', required: true },
  { key: 'isControlled', label: '是否管制品', required: true },
  { key: 'storageLocation', label: '存储位置', required: true },
  { key: 'quantity', label: '入库数量（瓶/件）', required: true },
  { key: 'batchNumber', label: '批次号', required: false },
] as const;

export type ReagentFieldKey = (typeof REAGENT_FIELDS)[number]['key'];
