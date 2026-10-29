import { Context } from "@deepseek-ai/cordis";
import Schema from "@deepseek-ai/schemastery";
//#region src/host/config.d.ts
/**
 * dsh-plugin-herdr 配置（DESIGN.md §6）。
 * 所有非必填项都有默认值；非法枚举/越界在插件加载期报错。
 * 全量迁移后传输固定为 socket（CLI 传输与 transport/cliPath 配置已移除）。
 *
 * ——— Pane 终端 Observer/Controller（design: pane-terminal-session-state-machine §6.2）———
 * `terminalSession` 是新增的流式终端会话配置；嵌套对象全部子项都有默认值，
 * 旧配置缺省该块时自动按默认物化。各数值字段在 Schemastery 中设明确上下界。
 */
interface TerminalSessionConfig {
  /** 是否启用 terminal session（observe/control）能力；禁用时直接用 snapshot fallback。 */
  enabled: boolean;
  /** herdr 二进制路径；缺省按 HERDR_BIN_PATH → PATH 中的 herdr 解析。 */
  binPath?: string;
  /** 每个浏览器页面最多活跃 observer 数（per-page 作用域）。 */
  maxObservers: number;
  /** 全局 controller 护栏（per DSH 会话作用域）；允许不同 pane 并行控制，不写死「每会话 1」。 */
  maxControllers: number;
  /** 全局子进程总数硬上限（per 插件进程作用域）。 */
  maxProcesses: number;
  /** controller 无交互自动释放的超时（ms）。 */
  controllerIdleMs: number;
  /** 浏览器断开后到回收子进程的宽限期（ms）。 */
  disconnectGraceMs: number;
  /** 单帧 Base64 解码后最大字节数（默认 8 MiB；硬上限 32 MiB）。 */
  maxDecodedFrameBytes: number;
  /** stdout 单行（NDJSON）最大字节数（默认 12 MiB；硬上限 48 MiB）。 */
  maxNdjsonLineBytes: number;
  /** 每个 session 的连续帧 replay buffer 上限（字节），用于断线续传窗口。 */
  replayBufferBytes: number;
}
interface Config {
  /** 显式 socket 路径；缺省按 HERDR_SOCKET_PATH → POSIX 默认配置目录解析。 */
  socketPath?: string;
  /** 目标会话名；缺省按 HERDR_SESSION → 默认会话。 */
  session?: string;
  /** 单次同步请求的默认超时（ms）。 */
  timeoutMs: number;
  /** 是否允许工具暴露 run_in_background 参数（后台任务闸门，§4 ADR-4）。 */
  allowBackground: boolean;
  /** 事件订阅转发（Herdr → DSH，§10.1）。 */
  events: {
    enabled: boolean;
    /** 断线重连最大退避（ms）。 */
    maxReconnectMs: number;
  };
  /** 是否启用 DSH → Herdr 状态上报（仅 HERDR_ENV=1 时生效，§4 ADR-6）。 */
  reportState: boolean;
  /** 项目根目录（看板过滤用；缺省 process.cwd()，§7.2）。 */
  projectRoot?: string;
  /** Pane 终端 Observer/Controller 流式会话配置；缺省由 resolveTerminalSessionConfig 物化默认值。 */
  terminalSession?: TerminalSessionConfig;
}
declare const Config: Schema<Config>;
//#endregion
//#region src/host/index.d.ts
declare const name = "dsh-plugin-herdr";
declare const inject: string[];
/**
 * 唯一的 host 入口。
 *
 * cordis 4 要求访问服务的 fiber 显式 inject 该服务，所以 ctx.herdr 的提供者
 * 与消费者仍是两个 fiber，但都作为本入口的子插件装配：先挂 provider（ctx.herdr、
 * preset），再挂 runtime（inject tools/herdr/jobs：工具、面板、事件）。
 * 两者都 await，入口在子插件就绪后才变为 ACTIVE（Loader.await / HMR）。
 * tools/jobs 晚到时 runtime 自动等待，不阻塞入口。
 */
declare function apply(ctx: Context, config: Config): Promise<void>;
//#endregion
export { Config, apply, inject, name };