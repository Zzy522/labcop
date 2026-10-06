"use client";

/**
 * RDKit WASM 加载器与子结构匹配工具
 *
 * 使用 @rdkit/rdkit 的 minimal WASM 构建，
 * 通过 get_qmol + get_substruct_matches 实现真正的化学子结构匹配。
 */

let rdkitInstance: any = null;
let loadingPromise: Promise<any> | null = null;

type ClientRDKitLoader = (
  options?: { locateFile?: (fileName: string) => string }
) => Promise<any>;

const RDKIT_SCRIPT_URL = "/rdkit/RDKit_minimal.js";
const RDKIT_WASM_URL = "/rdkit/RDKit_minimal.wasm";

function getClientRDKitLoader(): ClientRDKitLoader | undefined {
  return (window as unknown as { initRDKitModule?: ClientRDKitLoader }).initRDKitModule;
}

function initializeRDKit(): Promise<any> {
  const loader = getClientRDKitLoader();
  if (!loader) {
    return Promise.reject(new Error("RDKit 初始化函数不可用"));
  }
  return loader({
    locateFile: (fileName) => (fileName.endsWith(".wasm") ? RDKIT_WASM_URL : `/rdkit/${fileName}`),
  });
}

/** 动态加载 RDKit WASM（单例，只加载一次） */
export function loadRDKit(): Promise<any> {
  if (rdkitInstance) return Promise.resolve(rdkitInstance);
  if (loadingPromise) return loadingPromise;

  loadingPromise = new Promise((resolve, reject) => {
    if (typeof window === "undefined") {
      reject(new Error("SSR 环境不支持 RDKit"));
      return;
    }

    // 如果脚本已存在，直接初始化
    if (getClientRDKitLoader()) {
      initializeRDKit()
        .then((rdkit: any) => {
          rdkitInstance = rdkit;
          resolve(rdkit);
        })
        .catch(reject);
      return;
    }

    const script = document.createElement("script");
    script.src = RDKIT_SCRIPT_URL;
    script.async = true;
    script.onload = async () => {
      try {
        if (!getClientRDKitLoader()) {
          reject(new Error("RDKit 脚本加载成功但 initRDKitModule 不可用"));
          return;
        }
        const rdkit = await initializeRDKit();
        rdkitInstance = rdkit;
        resolve(rdkit);
      } catch (e) {
        reject(e);
      }
    };
    script.onerror = () => {
      script.remove();
      reject(new Error("RDKit 计算引擎加载失败，请重试"));
    };
    document.body.appendChild(script);
  });

  // 失败后清空 Promise，允许用户点击按钮重试，而不是永久复用 rejected Promise。
  loadingPromise = loadingPromise.catch((error) => {
    loadingPromise = null;
    throw error;
  });
  return loadingPromise;
}

/**
 * 检查 querySmiles 是否为 targetSmiles 的子结构
 *
 * 实现说明：
 * - target 用 get_mol（普通分子，含芳香性感知）
 * - query 优先用 get_mol（SMILES 输入），失败时 fallback 到 get_qmol（SMARTS）
 * - 匹配用 get_substruct_matches（返回 JSON 字符串），非空表示匹配成功
 * - 不使用 has_substruct_match（minimal 构建不含此方法）
 *
 * @returns true 表示 target 包含 query 子结构
 */
export function isSubstructMatch(
  rdkit: any,
  querySmiles: string,
  targetSmiles: string
): boolean {
  if (!rdkit || !querySmiles || !targetSmiles) return false;

  const targetMol = rdkit.get_mol(targetSmiles);
  if (!targetMol || !targetMol.is_valid()) {
    targetMol?.delete();
    return false;
  }

  // query 优先用 get_mol（用户输入通常是 SMILES 而非 SMARTS）
  // get_mol 会进行芳香性感知，使 Kekulé 苯环能匹配芳香表示
  let queryMol = rdkit.get_mol(querySmiles);
  if (!queryMol || !queryMol.is_valid()) {
    queryMol?.delete();
    // fallback: 尝试用 get_qmol（SMARTS 查询分子）
    queryMol = rdkit.get_qmol(querySmiles);
    if (!queryMol || !queryMol.is_valid()) {
      queryMol?.delete();
      targetMol.delete();
      return false;
    }
  }

  let matchesJson: string;
  try {
    // get_substruct_matches 返回 JSON 字符串：匹配的原子索引数组
    matchesJson = targetMol.get_substruct_matches(queryMol);
  } catch (e) {
    console.warn('[RDKit] get_substruct_matches 调用异常:', e);
    targetMol.delete();
    queryMol.delete();
    return false;
  }
  targetMol.delete();
  queryMol.delete();

  try {
    const matches = JSON.parse(matchesJson);
    return Array.isArray(matches) && matches.length > 0;
  } catch {
    return false;
  }
}

/**
 * 将 SMILES 规范化为 RDKit 的 Canonical SMILES
 *
 * 不同写法的同一分子（如 "CCO" 和 "OCC"）会规范化为相同的 Canonical SMILES。
 * 若 SMILES 无效则返回 null。
 */
export function canonicalizeSmiles(rdkit: any, smiles: string): string | null {
  if (!rdkit || !smiles) return null;
  const mol = rdkit.get_mol(smiles);
  if (!mol || !mol.is_valid()) {
    mol?.delete();
    return null;
  }
  const canonical = mol.get_smiles();
  mol.delete();
  return canonical || null;
}

/**
 * 精准匹配：基于 RDKit 规范化 SMILES 比对（非字符串匹配）
 *
 * 将 query 和 target 都转换为 Canonical SMILES 后比较，
 * 这样 "CCO" / "OCC" / "C(C)O" 等同分异构写法都会匹配为同一分子。
 *
 * @returns true 表示两者为同一分子
 */
export function isExactMatch(
  rdkit: any,
  querySmiles: string,
  targetSmiles: string
): boolean {
  if (!rdkit || !querySmiles || !targetSmiles) return false;
  const q = canonicalizeSmiles(rdkit, querySmiles);
  const t = canonicalizeSmiles(rdkit, targetSmiles);
  if (!q || !t) return false;
  return q === t;
}

/**
 * 批量过滤：返回与 query 为同一分子的 SMILES 列表（精准匹配）
 */
export function filterByExactMatch<T>(
  rdkit: any,
  items: T[],
  querySmiles: string,
  getSmiles: (item: T) => string | null | undefined
): T[] {
  if (!rdkit || !querySmiles) return items;
  const queryCanonical = canonicalizeSmiles(rdkit, querySmiles);
  if (!queryCanonical) return [];
  return items.filter((item) => {
    const smiles = getSmiles(item);
    if (!smiles) return false;
    const targetCanonical = canonicalizeSmiles(rdkit, smiles);
    return targetCanonical === queryCanonical;
  });
}

/**
 * 批量过滤：返回包含 query 子结构的 SMILES 列表
 *
 * @param items 原始数据（需含 smiles 字段）
 * @param querySmiles 查询子结构 SMILES
 * @param getSmiles 从 item 提取 SMILES 的函数
 * @returns 过滤后的 items
 */
export function filterBySubstructure<T>(
  rdkit: any,
  items: T[],
  querySmiles: string,
  getSmiles: (item: T) => string | null | undefined
): T[] {
  if (!rdkit || !querySmiles) return items;
  return items.filter((item) => {
    const smiles = getSmiles(item);
    if (!smiles) return false;
    return isSubstructMatch(rdkit, querySmiles, smiles);
  });
}

/**
 * 从 SMILES 解析分子信息：分子式、分子量、规范化 SMILES
 *
 * 用于新建化合物时：用户绘制或输入 SMILES 后自动回填分子式和分子量。
 *
 * RDKit MinimalLib 没有直接暴露分子式方法，因此从 get_json() 返回的原子序数与
 * 隐式氢计数生成 Hill system 分子式；分子量使用 descriptors.amw。
 *
 * @returns null 表示 SMILES 无效；否则返回 { formula, molecularWeight, canonicalSmiles }
 */
const ATOMIC_SYMBOLS = [
  '', 'H', 'He', 'Li', 'Be', 'B', 'C', 'N', 'O', 'F', 'Ne', 'Na', 'Mg', 'Al', 'Si', 'P', 'S',
  'Cl', 'Ar', 'K', 'Ca', 'Sc', 'Ti', 'V', 'Cr', 'Mn', 'Fe', 'Co', 'Ni', 'Cu', 'Zn', 'Ga', 'Ge',
  'As', 'Se', 'Br', 'Kr', 'Rb', 'Sr', 'Y', 'Zr', 'Nb', 'Mo', 'Tc', 'Ru', 'Rh', 'Pd', 'Ag', 'Cd',
  'In', 'Sn', 'Sb', 'Te', 'I', 'Xe', 'Cs', 'Ba', 'La', 'Ce', 'Pr', 'Nd', 'Pm', 'Sm', 'Eu', 'Gd',
  'Tb', 'Dy', 'Ho', 'Er', 'Tm', 'Yb', 'Lu', 'Hf', 'Ta', 'W', 'Re', 'Os', 'Ir', 'Pt', 'Au', 'Hg',
  'Tl', 'Pb', 'Bi', 'Po', 'At', 'Rn', 'Fr', 'Ra', 'Ac', 'Th', 'Pa', 'U', 'Np', 'Pu', 'Am', 'Cm',
  'Bk', 'Cf', 'Es', 'Fm', 'Md', 'No', 'Lr', 'Rf', 'Db', 'Sg', 'Bh', 'Hs', 'Mt', 'Ds', 'Rg', 'Cn',
  'Nh', 'Fl', 'Mc', 'Lv', 'Ts', 'Og',
];

function formulaFromRDKitJson(mol: any): string | null {
  if (typeof mol.get_json !== 'function') return null;

  const parsed = JSON.parse(mol.get_json());
  const atomDefaults = parsed?.defaults?.atom ?? {};
  const molecules = Array.isArray(parsed?.molecules) ? parsed.molecules : [];
  const counts = new Map<string, number>();

  const add = (symbol: string, count = 1) => {
    if (!symbol || count <= 0) return;
    counts.set(symbol, (counts.get(symbol) ?? 0) + count);
  };

  for (const molecule of molecules) {
    const atoms = Array.isArray(molecule?.atoms) ? molecule.atoms : [];
    for (const atom of atoms) {
      const atomicNumber = Number(atom?.z ?? atomDefaults.z ?? 6);
      const symbol = ATOMIC_SYMBOLS[atomicNumber];
      if (symbol) add(symbol);

      const implicitHydrogens = Number(atom?.impHs ?? atomDefaults.impHs ?? 0);
      if (Number.isFinite(implicitHydrogens) && implicitHydrogens > 0) {
        add('H', implicitHydrogens);
      }
    }
  }

  if (counts.size === 0) return null;
  const symbols = counts.has('C')
    ? ['C', ...(counts.has('H') ? ['H'] : []), ...Array.from(counts.keys()).filter((s) => s !== 'C' && s !== 'H').sort()]
    : Array.from(counts.keys()).sort();

  return symbols.map((symbol) => {
    const count = counts.get(symbol) ?? 0;
    return `${symbol}${count === 1 ? '' : count}`;
  }).join('');
}

export function getMolInfo(
  rdkit: any,
  smiles: string
): { formula: string | null; molecularWeight: number | null; canonicalSmiles: string | null } | null {
  if (!rdkit || !smiles) return null;
  const mol = rdkit.get_mol(smiles);
  if (!mol || !mol.is_valid()) {
    mol?.delete();
    return null;
  }

  let formula: string | null = null;
  let molecularWeight: number | null = null;
  let canonicalSmiles: string | null = null;

  try {
    try {
      formula = formulaFromRDKitJson(mol);
    } catch (e) {
      console.warn('[RDKit] 分子式计算异常:', e);
    }

    // 通过 get_descriptors 获取分子量（amw = average molecular weight）
    if (typeof mol.get_descriptors === 'function') {
      try {
        const descJson = mol.get_descriptors();
        const desc = JSON.parse(descJson);
        if (typeof desc.amw === 'number') molecularWeight = desc.amw;
      } catch (e) {
        console.warn('[RDKit] get_descriptors 调用异常:', e);
      }
    }

    // 获取 Canonical SMILES
    try {
      canonicalSmiles = mol.get_smiles() || null;
    } catch {}

    return { formula, molecularWeight, canonicalSmiles };
  } catch (e) {
    console.warn('[RDKit] getMolInfo 异常:', e);
    return null;
  } finally {
    mol.delete();
  }
}
