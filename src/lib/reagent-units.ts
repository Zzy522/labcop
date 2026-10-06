/**
 * 试剂单位换算工具
 *
 * 解决问题：
 * - Reagent.stockQuantity 以"瓶"为单位（基础库存单位 = reagent.unit）
 * - 用户领用时输入的是体积（mL/L）或质量（g/mg）
 * - 需要把用户输入换算到 reagent.unit 后才能扣减库存
 *
 * 换算依赖三个信息：
 * 1. reagent.unit（库存基础单位，如"瓶"）
 * 2. reagent.capacityPerUnit + reagent.capacityUnit（每瓶容量，如 500 mL）
 * 3. reagent.density（密度 g/mL，体积↔质量换算时需要）
 *
 * 这些字段由入库时 LLM 从 specification（如"500mL/瓶"）解析填充，
 * 或由用户手动录入。LLM 工具调用（阶段二）可暴露 convertReagentUnit 工具
 * 让 Copilot 帮用户换算。
 */

/** 体积单位（小写匹配） */
const VOLUME_UNITS = ['ml', 'l', 'ul'] as const;
/** 质量单位（小写匹配） */
const MASS_UNITS = ['g', 'mg', 'kg', 'ug'] as const;
/** 计数单位（瓶、支、包等，与 reagent.unit 同类） */
const COUNT_UNITS = ['瓶', '支', '包', '盒', '罐', '袋', '件'] as const;

type UnitCategory = 'volume' | 'mass' | 'count' | 'unknown';

/**
 * 判断单位类别
 */
export function classifyUnit(unit: string): UnitCategory {
  const u = unit.trim().toLowerCase();
  if (VOLUME_UNITS.includes(u as never)) return 'volume';
  if (MASS_UNITS.includes(u as never)) return 'mass';
  if (COUNT_UNITS.some((c) => u === c || u.includes(c))) return 'count';
  return 'unknown';
}

/**
 * 解析 specification 字符串，提取每瓶容量
 *
 * 支持格式：
 * - "500mL/瓶" → { capacityPerUnit: 500, capacityUnit: 'mL' }
 * - "500 mL/瓶" → { capacityPerUnit: 500, capacityUnit: 'mL' }
 * - "100g/瓶" → { capacityPerUnit: 100, capacityUnit: 'g' }
 * - "1L/瓶" → { capacityPerUnit: 1000, capacityUnit: 'mL' }（统一为 mL）
 * - "10片/瓶" → { capacityPerUnit: 10, capacityUnit: '片' }
 * - "500ml" → { capacityPerUnit: 500, capacityUnit: 'mL' }（无"/瓶"也支持）
 *
 * 解析失败返回 null（不报错，由调用方决定如何处理）
 */
export function parseSpecification(
  specification: string | null | undefined
): { capacityPerUnit: number; capacityUnit: string } | null {
  if (!specification) return null;
  const s = specification.trim();

  // 匹配第一个真正带容量/质量单位的数值，跳过纯度等无单位数字。
  // 例如 "98%, AR, 10mg" 应提取 10mg，而不是先匹配 98 后返回 null。
  const pattern = /(\d+(?:\.\d+)?)\s*(mL|L|uL|μL|µL|kg|mg|ug|g|片|支|包|个)(?:\s*\/\s*(?:瓶|支|包|盒|罐|袋|件))?/gi;
  let match: RegExpExecArray | null = null;
  for (const candidate of s.matchAll(pattern)) {
    const remainder = s.slice((candidate.index ?? 0) + candidate[0].length);
    // “10mg/mL”是浓度，不是每瓶 10mg；继续查找后面的真正包装规格。
    if (/^\s*\/\s*(?:mL|L|uL|μL|µL|kg|mg|ug|g)\b/i.test(remainder)) continue;
    match = candidate;
    break;
  }
  if (!match) return null;

  const value = parseFloat(match[1]);
  const rawUnit = match[2];
  const unit = rawUnit.toLowerCase();

  // 统一 L → mL
  if (unit === 'l') {
    return { capacityPerUnit: value * 1000, capacityUnit: 'mL' };
  }
  if (unit === 'kg') {
    return { capacityPerUnit: value * 1000, capacityUnit: 'g' };
  }
  if (unit === 'ml') return { capacityPerUnit: value, capacityUnit: 'mL' };
  if (unit === 'ul' || unit === 'μl' || unit === 'µl') return { capacityPerUnit: value, capacityUnit: 'uL' };
  if (unit === 'g' || unit === 'mg' || unit === 'ug') return { capacityPerUnit: value, capacityUnit: unit };
  // 计数单位保留原文。
  return { capacityPerUnit: value, capacityUnit: rawUnit };
}

/**
 * 体积单位互转（→ mL）
 */
function toMilliliters(value: number, unit: string): number | null {
  const u = unit.trim().toLowerCase();
  if (u === 'ml') return value;
  if (u === 'l') return value * 1000;
  if (u === 'ul') return value / 1000;
  return null;
}

/**
 * 质量单位互转（→ g）
 */
function toGrams(value: number, unit: string): number | null {
  const u = unit.trim().toLowerCase();
  if (u === 'g') return value;
  if (u === 'kg') return value * 1000;
  if (u === 'mg') return value / 1000;
  if (u === 'ug') return value / 1_000_000;
  return null;
}

/**
 * 体积↔质量换算（需要密度）
 *
 * 质量(g) = 体积(mL) × 密度(g/mL)
 * 体积(mL) = 质量(g) ÷ 密度(g/mL)
 */
function convertVolumeMass(
  value: number,
  fromUnit: string,
  toUnit: string,
  density?: number | null
): number | null {
  const fromCat = classifyUnit(fromUnit);
  const toCat = classifyUnit(toUnit);

  if (fromCat === toCat) {
    // 同类别：直接互转
    if (fromCat === 'volume') {
      const ml = toMilliliters(value, fromUnit);
      if (ml === null) return null;
      return fromMilliliters(ml, toUnit);
    }
    if (fromCat === 'mass') {
      const g = toGrams(value, fromUnit);
      if (g === null) return null;
      return fromGrams(g, toUnit);
    }
    return null;
  }

  // 跨类别：体积↔质量，需要密度
  if (!density) return null;

  if (fromCat === 'volume' && toCat === 'mass') {
    const ml = toMilliliters(value, fromUnit);
    if (ml === null) return null;
    const g = ml * density;
    return fromGrams(g, toUnit);
  }
  if (fromCat === 'mass' && toCat === 'volume') {
    const g = toGrams(value, fromUnit);
    if (g === null) return null;
    const ml = g / density;
    return fromMilliliters(ml, toUnit);
  }
  return null;
}

function fromMilliliters(ml: number, toUnit: string): number | null {
  const u = toUnit.trim().toLowerCase();
  if (u === 'ml') return ml;
  if (u === 'l') return ml / 1000;
  if (u === 'ul') return ml * 1000;
  return null;
}

function fromGrams(g: number, toUnit: string): number | null {
  const u = toUnit.trim().toLowerCase();
  if (u === 'g') return g;
  if (u === 'kg') return g / 1000;
  if (u === 'mg') return g * 1000;
  if (u === 'ug') return g * 1_000_000;
  return null;
}

/** 换算结果 */
export interface ConversionResult {
  /** 换算到 reagent.unit 后的数值（用于扣减 stockQuantity） */
  stockDelta: number;
  /** 用户友好的领用量描述（如 "1 g"、"50 mL"），不含换算公式 */
  note: string;
}

/**
 * 主换算函数：把用户输入的领用量换算到 reagent 的库存单位
 *
 * @param requestedQuantity 用户输入数值（如 50）
 * @param requestedUnit 用户输入单位（如 "mL"）
 * @param reagent 试剂对象，需含 unit、capacityPerUnit、capacityUnit、density
 * @returns 换算结果，或抛出 Error（含具体原因）
 */
export function convertToStockUnit(
  requestedQuantity: number,
  requestedUnit: string,
  reagent: {
    unit: string | null | undefined;
    capacityPerUnit: number | null | undefined;
    capacityUnit: string | null | undefined;
    density: number | null | undefined;
  }
): ConversionResult {
  if (!requestedQuantity || requestedQuantity <= 0) {
    throw new Error('领用量必须为正数');
  }
  if (!requestedUnit?.trim()) {
    throw new Error('请填写单位');
  }

  const stockUnit = reagent.unit?.trim() || '瓶';
  const reqUnit = requestedUnit.trim();
  const reqCat = classifyUnit(reqUnit);
  const stockCat = classifyUnit(stockUnit);

  // 情况 1：用户单位与库存单位相同（如都是"瓶"）
  if (reqUnit === stockUnit || reqCat === stockCat && reqCat === 'count') {
    return {
      stockDelta: requestedQuantity,
      note: `${requestedQuantity} ${stockUnit}`,
    };
  }

  // 情况 2：库存是"瓶"，用户输入体积/质量 → 需要容量信息
  if (stockCat === 'count') {
    const capPerUnit = reagent.capacityPerUnit;
    const capUnit = reagent.capacityUnit;

    if (!capPerUnit || !capUnit) {
      throw new Error(
        `试剂缺少容量信息（capacityPerUnit/capacityUnit），无法将 ${reqUnit} 换算为 ${stockUnit}。请联系管理员补充规格信息，或直接以 ${stockUnit} 为单位领用。`
      );
    }

    // 先把用户输入换算到容量单位（如 50 mL → mL，或 50 g → mL 需密度）
    let userInCapacityUnit: number;
    if (classifyUnit(reqUnit) === classifyUnit(capUnit)) {
      // 同类别：体积→体积 或 质量→质量
      const converted = convertVolumeMass(requestedQuantity, reqUnit, capUnit, reagent.density);
      if (converted === null) {
        throw new Error(`无法将 ${reqUnit} 换算为 ${capUnit}（单位不兼容）`);
      }
      userInCapacityUnit = converted;
    } else {
      // 跨类别：体积↔质量，需要密度
      if (!reagent.density) {
        throw new Error(
          `试剂缺少密度信息（density），无法将 ${reqUnit} 换算为 ${capUnit}。请联系管理员补充密度信息。`
        );
      }
      const converted = convertVolumeMass(requestedQuantity, reqUnit, capUnit, reagent.density);
      if (converted === null) {
        throw new Error(`无法将 ${reqUnit} 换算为 ${capUnit}（单位不兼容）`);
      }
      userInCapacityUnit = converted;
    }

    // 换算到瓶：用户输入 / 每瓶容量
    const stockDelta = userInCapacityUnit / capPerUnit;
    const note = `${requestedQuantity} ${reqUnit}`;

    return { stockDelta, note };
  }

  // 情况 3：库存是体积/质量，用户也是体积/质量 → 直接换算
  if (reqCat !== 'unknown' && stockCat !== 'unknown') {
    const converted = convertVolumeMass(requestedQuantity, reqUnit, stockUnit, reagent.density);
    if (converted === null) {
      throw new Error(`无法将 ${reqUnit} 换算为 ${stockUnit}（单位不兼容或缺少密度信息）`);
    }
    return {
      stockDelta: converted,
      note: `${requestedQuantity} ${reqUnit}`,
    };
  }

  // 情况 4：单位未知，无法换算
  throw new Error(
    `无法识别的单位：${reqUnit} → ${stockUnit}。请使用常见单位（mL/L/g/mg/瓶/支/包）。`
  );
}

/**
 * 计算试剂的"总容量"（用于 UI 展示）
 *
 * 如 stockQuantity=100 瓶，capacityPerUnit=500 mL，则总容量 = 50000 mL = 50 L
 */
export function computeTotalCapacity(reagent: {
  stockQuantity: number;
  unit: string | null | undefined;
  capacityPerUnit: number | null | undefined;
  capacityUnit: string | null | undefined;
}): { total: number; unit: string } | null {
  const { stockQuantity, capacityPerUnit, capacityUnit } = reagent;
  if (!capacityPerUnit || !capacityUnit) return null;
  const total = stockQuantity * capacityPerUnit;
  // 单位优化：mL → L（>1000）
  if (capacityUnit.toLowerCase() === 'ml' && total >= 1000) {
    return { total: total / 1000, unit: 'L' };
  }
  if (capacityUnit.toLowerCase() === 'mg' && total >= 1000) {
    return { total: total / 1000, unit: 'g' };
  }
  if (capacityUnit.toLowerCase() === 'g' && total >= 1000) {
    return { total: total / 1000, unit: 'kg' };
  }
  return { total, unit: capacityUnit };
}

/**
 * 格式化质量/体积数值，自动换算到合适单位
 *
 * - mL ≥ 1000 → L
 * - mg ≥ 1000 → g
 * - g  ≥ 1000 → kg
 * - 整数不显示小数点，非整数保留 2 位
 *
 * 示例：
 * - formatAmount(10, 'mg')   → "10 mg"
 * - formatAmount(1500, 'mg') → "1.5 g"
 * - formatAmount(0.9, 'mg')  → "0.9 mg"（避免 0.90 mg）
 */
export function formatAmount(amount: number, unit: string): string {
  const u = unit.trim().toLowerCase();
  const abs = Math.abs(amount);

  if (u === 'ml' && abs >= 1000) {
    return `${formatNumber(amount / 1000)} L`;
  }
  if (u === 'l' && abs > 0 && abs < 1) {
    return `${formatNumber(amount * 1000)} mL`;
  }
  if (u === 'mg' && abs >= 1000) {
    return `${formatNumber(amount / 1000)} g`;
  }
  if (u === 'g' && abs >= 1000) {
    return `${formatNumber(amount / 1000)} kg`;
  }
  if (u === 'kg' && abs > 0 && abs < 1) {
    return `${formatNumber(amount * 1000)} g`;
  }
  return `${formatNumber(amount)} ${unit}`;
}

/** 数字格式化：整数直接显示，非整数保留 2 位（去掉尾 0） */
export function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return '0';
  if (Number.isInteger(n)) return n.toString();
  // 保留 2 位小数，去掉尾随 0
  return parseFloat(n.toFixed(2)).toString();
}

/**
 * 计算试剂的"可用总量"展示文本
 *
 * 优先返回质量/体积总量（如 "10 mg"），
 * 无容量信息时回退到瓶数（如 "1 瓶"）。
 *
 * 显示策略（依据用户反馈优化）：
 * - primary: 剩余总量（质量/体积），如 "剩余 18 g" — 随领用递减
 * - secondary: 累计入库瓶数，如 "共 5 瓶" — 不随领用改变（totalStockedBottles）
 *
 * 设计原因：
 * 1. 同一试剂可能存在不同规格批次（如 5g/瓶 和 10g/瓶 混存），不显示单瓶容量
 * 2. 瓶数应反映历史总入库量（如入库 5 瓶），而非当前剩余（如 3.6 瓶），
 *    避免领用后出现小数瓶数的困惑
 *
 * @param reagent 试剂对象
 * @param stockDeltaOpt 可选：扣减量（瓶），用于领用后余量预览
 *                       如 stockDeltaOpt=0.1 表示领用 0.1 瓶后的余量
 */
export function getStockDisplayText(
  reagent: {
    stockQuantity: number;
    unit: string | null | undefined;
    capacityPerUnit: number | null | undefined;
    capacityUnit: string | null | undefined;
    /** 累计入库瓶数（不随领用递减）；缺省时回退到 stockQuantity */
    totalStockedBottles?: number | null | undefined;
  },
  stockDeltaOpt?: number
): { primary: string; secondary: string | null } {
  const stockUnit = reagent.unit?.trim() || '瓶';
  const effectiveStock = stockDeltaOpt !== undefined
    ? Math.max(0, reagent.stockQuantity - stockDeltaOpt)
    : reagent.stockQuantity;

  if (reagent.capacityPerUnit && reagent.capacityUnit) {
    const totalAmount = effectiveStock * reagent.capacityPerUnit;
    const primary = `剩余 ${formatAmount(totalAmount, reagent.capacityUnit)}`;
    // 副显示：累计入库瓶数（不随领用递减），回退到 stockQuantity 兼容旧数据
    const totalBottles = reagent.totalStockedBottles ?? reagent.stockQuantity;
    const secondary = `共 ${formatNumber(totalBottles)} ${stockUnit}`;
    return { primary, secondary };
  }
  return { primary: `${effectiveStock} ${stockUnit}`, secondary: null };
}
