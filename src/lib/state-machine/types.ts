/**
 * 状态机抽象层 - 类型定义
 *
 * ============================================================
 * 设计目标
 * ============================================================
 *
 * 为项目中分散的状态字段（Requisition.status、DeviceReservation.status、
 * InspectionAssignment.status 等）提供统一的状态机抽象，集中表达：
 *
 * 1. 合法转换路径（防止非法状态跳变）
 * 2. 转换前守卫（权限校验、前置条件校验）
 * 3. 进入新状态的副作用（写审计日志、派生 Todo、发通知）
 * 4. 跨实体协调（如 Requisition.APPROVED → 触发 ReagentLog 写入）
 *
 * ============================================================
 * 设计原则
 * ============================================================
 *
 * - **零依赖**：纯 TypeScript 类型与函数，不引入 XState 等框架
 * - **声明式**：状态机定义为数据，运行时统一解释执行
 * - **类型安全**：状态与事件用字面量联合类型，编译期发现拼写错误
 * - **渐进接入**：现有 route 无需一次性重写，可逐个状态机迁移
 * - **副作用幂等**：onEnter 副作用必须设计为幂等，避免重试导致重复派生
 *
 * ============================================================
 * 不引入 LangGraph 的理由
 * ============================================================
 *
 * 状态机抽象层与 LangGraph 的 StateGraph 表面相似，但定位不同：
 *
 * | 维度       | 状态机抽象层（本模块）   | LangGraph StateGraph          |
 * |-----------|------------------------|-------------------------------|
 * | 触发方式   | 业务 API 主动调用       | LLM Agent 决策驱动            |
 * | 状态存储   | 数据库字段（source of truth） | Checkpointer（影子状态）  |
 * | 副作用     | 同步、确定性            | LLM 调用、非确定性             |
 * | 适用场景   | 业务实体状态转换         | 多步推理 + 人工干预            |
 *
 * 结论：本模块用于 Requisition/Reservation 等业务实体状态管理；
 * LangGraph 仅用于"审批辅助 Agent"、"风险调查 Agent"等需要 LLM 编排
 * 的场景（见之前 LangGraph State Schema 设计）。
 *
 * ============================================================
 */

/**
 * 状态字面量类型约束
 *
 * 使用 `string & {}` 而非直接 `string`，是为了让具体状态机定义时
 * 能获得字面量自动推导（如 type RequisitionStatus = 'PENDING' | 'APPROVED' | ...）
 */
export type State = string & {};
export type Event = string & {};

/**
 * 状态机上下文
 *
 * 携带触发状态转换时所需的运行时数据，包括：
 * - 谁触发了转换（actor）
 * - 当前实体实例（entity）
 * - 转换参数（payload）
 *
 * 不同状态机可扩展此接口添加自己的字段
 */
export interface StateMachineContext<TEntity = unknown, TUser = unknown> {
  /** 当前操作者（来自 requireAuth） */
  actor: TUser;
  /** 当前实体实例（如 Requisition、DeviceReservation） */
  entity: TEntity;
  /** 触发事件时附加的参数（如审批意见、拒绝理由） */
  payload?: Record<string, unknown>;
  /** Prisma 客户端（供副作用使用） */
  prisma?: unknown;
}

/**
 * 守卫函数：返回 true 允许转换，返回 false 或抛出错误拒绝转换
 *
 * 抛错时错误会被上层捕获并返回给调用方，错误信息可携带具体拒绝原因
 */
export type GuardFn<TContext extends StateMachineContext> = (
  ctx: TContext
) => boolean | Promise<boolean>;

/**
 * 副作用函数：在状态转换成功后执行
 *
 * 设计约束：
 * 1. 必须幂等（重试不应导致重复派生 Todo、重复发通知）
 * 2. 必须自行 try/catch（副作用失败不应回滚状态转换）
 * 3. 失败的副作用应通过 lastSideEffectError 暴露，不阻塞主流程
 *
 * 返回值：可选，用于跨副作用通信（暂未使用，预留扩展）
 */
export type SideEffectFn<TContext extends StateMachineContext> = (
  ctx: TContext,
  /** 转换前的旧状态 */
  from: State,
  /** 转换后的新状态 */
  to: State
) => Promise<void | { ok: true } | { ok: false; error: string }>;

/**
 * 状态转换定义
 *
 * 描述从 `from` 状态在收到 `event` 时如何转换到 `to` 状态
 */
export interface Transition<
  TState extends State,
  TEvent extends Event,
  TContext extends StateMachineContext = StateMachineContext
> {
  /** 源状态 */
  from: TState | TState[] | '*';
  /** 触发事件 */
  event: TEvent;
  /** 目标状态 */
  to: TState;
  /** 守卫（可选，返回 false 时拒绝转换） */
  guard?: GuardFn<TContext>;
  /** 守卫失败时的错误信息（用于 API 响应） */
  guardErrorMessage?: string;
}

/**
 * 状态节点定义
 *
 * 描述某个状态的元信息与进入/离开时的副作用
 */
export interface StateNode<
  TState extends State,
  TContext extends StateMachineContext = StateMachineContext
> {
  /** 状态名 */
  state: TState;
  /** 进入状态的副作用（转换成功后执行） */
  onEnter?: SideEffectFn<TContext> | SideEffectFn<TContext>[];
  /** 离开状态的副作用（转换成功前执行，慎用，失败会阻塞转换） */
  onExit?: SideEffectFn<TContext> | SideEffectFn<TContext>[];
  /** 是否终态（终态不允许再转换） */
  isFinal?: boolean;
  /** 状态描述（用于文档与调试） */
  description?: string;
}

/**
 * 状态机定义
 *
 * 完整的状态机声明，包含所有状态、转换、副作用
 */
export interface StateMachineDefinition<
  TState extends State,
  TEvent extends Event,
  TContext extends StateMachineContext = StateMachineContext
> {
  /** 状态机名（如 'RequisitionMachine'，用于日志与审计） */
  name: string;
  /** 实体类型名（如 'Requisition'，用于审计日志 targetType） */
  entityType: string;
  /** 初始状态 */
  initial: TState;
  /** 状态节点定义 */
  states: StateNode<TState, TContext>[];
  /** 转换规则 */
  transitions: Transition<TState, TEvent, TContext>[];
  /** 状态字段名（默认 'status'） */
  stateField?: string;
}

/**
 * 状态转换结果
 */
export interface TransitionResult<TState extends State> {
  /** 是否转换成功 */
  success: boolean;
  /** 转换后的新状态（成功时） */
  newStatus?: TState;
  /** 失败原因（失败时） */
  error?: string;
  /** 副作用执行情况（成功时） */
  sideEffects?: {
    total: number;
    succeeded: number;
    failed: number;
    errors: Array<{ effectName?: string; error: string }>;
  };
  /** 守卫拒绝原因（守卫失败时） */
  guardError?: string;
}

/**
 * 状态机实例接口
 *
 * 由 `defineStateMachine()` 工厂函数创建，提供运行时调用 API
 */
export interface StateMachine<
  TState extends State,
  TEvent extends Event,
  TContext extends StateMachineContext = StateMachineContext
> {
  /** 状态机定义（只读） */
  readonly definition: StateMachineDefinition<TState, TEvent, TContext>;

  /**
   * 触发状态转换
   *
   * @param currentState 当前状态
   * @param event 触发事件
   * @param ctx 上下文（actor、entity、payload、prisma）
   * @returns 转换结果
   *
   * 失败场景：
   * - 当前状态是终态 → success=false, error='状态已是终态'
   * - 当前状态+事件无匹配 transition → success=false, error='非法状态转换'
   * - 守卫失败 → success=false, guardError=守卫错误信息
   * - onExit 副作用失败 → success=false, error=副作用错误
   * - onEnter 副作用失败 → 仍 success=true，但 sideEffects.failed > 0
   */
  transition: (
    currentState: TState,
    event: TEvent,
    ctx: TContext
  ) => Promise<TransitionResult<TState>>;

  /**
   * 查询从当前状态可达的下一状态列表
   * 用于前端展示"可执行操作"按钮
   */
  nextStates: (currentState: TState) => TState[];

  /**
   * 查询从当前状态可用的事件列表
   * 用于前端展示操作按钮
   */
  availableEvents: (currentState: TState) => TEvent[];

  /**
   * 判断状态是否终态
   */
  isFinalState: (state: TState) => boolean;

  /**
   * 校验状态转换是否合法（不实际执行）
   * 用于前置校验，如"该用户能否审批此申请"
   */
  canTransition: (
    currentState: TState,
    event: TEvent,
    ctx: TContext
  ) => Promise<boolean>;
}

/**
 * 状态机工厂函数签名
 *
 * 实现见 `factory.ts`（待创建）。types.ts 仅声明接口不引入实现，
 * 符合"先定义接口，不接入业务"的工程原则
 */
export type StateMachineFactory = <
  TState extends State,
  TEvent extends Event,
  TContext extends StateMachineContext = StateMachineContext
>(
  definition: StateMachineDefinition<TState, TEvent, TContext>
) => StateMachine<TState, TEvent, TContext>;

/**
 * 状态机协调器接口
 *
 * 用于跨状态机通信，如：
 * - Requisition.APPROVED → 检查是否需要触发额外巡检
 * - DeviceReservation.ACTIVE → 自动派生 Todo(DEVICE_RETURN)
 *
 * 设计原则：
 * - 协调器是"事件总线"，不直接修改实体状态
 * - 协调器只触发副作用（派生 Todo、写日志、发通知）
 * - 协调器必须幂等
 */
export interface StateMachineCoordinator<TContext extends StateMachineContext = StateMachineContext> {
  /**
   * 注册跨状态机事件处理器
   *
   * @param entityName 实体类型名（如 'Requisition'）
   * @param event 状态机事件名（如 'APPROVED'）
   * @param handler 处理函数
   */
  on: (
    entityName: string,
    event: string,
    handler: (ctx: TContext) => Promise<void>
  ) => void;

  /**
   * 触发跨状态机事件
   * 由状态机 onEnter 副作用调用
   */
  emit: (entityName: string, event: string, ctx: TContext) => Promise<void>;
}

/**
 * 状态机错误类型
 *
 * 用于在状态机运行时区分错误类型，便于上层 API 返回合适的 HTTP 状态码
 */
export enum StateMachineErrorCode {
  /** 非法状态转换（当前状态+事件无匹配） */
  ILLEGAL_TRANSITION = 'ILLEGAL_TRANSITION',
  /** 守卫拒绝（权限不足或前置条件不满足） */
  GUARD_REJECTED = 'GUARD_REJECTED',
  /** 状态已是终态 */
  FINAL_STATE = 'FINAL_STATE',
  /** onExit 副作用失败（阻塞转换） */
  EXIT_SIDE_EFFECT_FAILED = 'EXIT_SIDE_EFFECT_FAILED',
  /** onEnter 副作用失败（不阻塞转换，仅记录） */
  ENTER_SIDE_EFFECT_FAILED = 'ENTER_SIDE_EFFECT_FAILED',
  /** 状态机定义错误（如重复状态、循环转换） */
  DEFINITION_ERROR = 'DEFINITION_ERROR',
}

export class StateMachineError extends Error {
  constructor(
    message: string,
    public readonly code: StateMachineErrorCode,
    public readonly statusCode: number = 400
  ) {
    super(message);
    this.name = 'StateMachineError';
  }
}

/**
 * 状态机可视化输出
 *
 * 用于生成 Mermaid 状态图，便于文档化与团队 review
 */
export interface StateMachineVisualization {
  /** Mermaid 状态图代码 */
  mermaid: string;
  /** 状态列表（含终态标记） */
  states: Array<{ state: string; isFinal: boolean; description?: string }>;
  /** 转换列表 */
  transitions: Array<{ from: string; to: string; event: string }>;
}
