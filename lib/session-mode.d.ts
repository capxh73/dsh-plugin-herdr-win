import { Context } from "@deepseek-ai/cordis";
import Schema from "@deepseek-ai/schemastery";
//#region src/host/session-mode.d.ts
interface SessionEventLike {
  type: string;
  data?: {
    title?: unknown;
  };
}
declare module '@deepseek-ai/cordis' {
  interface Events {
    'session/event'(this: unknown, session: {
      id: string;
    }, event: SessionEventLike): void;
  }
}
interface Config {
  /** 固定绑定的 Herdr pane（所有会话共用）；留空则每会话自动创建专属 pane。 */
  paneId?: string;
  /** 上报来源标识（Herdr 侧边栏按 source 区分）。 */
  source: string;
  /**
   * workspace/pane 显示名。
   * 留空（默认）优先取会话标题（session/title，即 GUI 中显示的会话名），
   * 无标题时回退 "dsh:<项目名>-<会话短id>"（cwd basename + 短 id 区分
   * 同项目多会话；无 cwd 回退 "dsh:<短id>"）；标题异步生成，生成后自动补正；
   * 非空时作为完整 label 使用（自定义覆盖）。
   */
  label: string;
  /** 自动创建 pane 时新 pane 的 shell 工作目录（可选）。 */
  cwd?: string;
}
declare const Config: Schema<Config>;
declare const name = "dsh-plugin-herdr-session-mode";
declare const inject: string[];
/**
 * herdr 模式（agent preset）的会话绑定插件。
 *
 * agent preset 是 standing mount：组合内插件在进程内只有一份实例，服务于所有
 * 加入 herdr preset 的 agent（会话）——因此必须按 agent 区分状态：
 * - dsh-agent 的事件（agent/created、agent/request、agent/turn-stopping、
 *   agent/disposed）经 scope 载体投递，payload 恒带 `agent`（id === session id）；
 * - 本插件以 `Map<agentId, 绑定>` 维护每个会话的 pane。
 *
 * 绑定策略（config.paneId 固定绑定优先）：
 * 1. 焦点 pane 存在 → `pane.split`（direction right）创建专属 pane；
 * 2. 无焦点 pane → `workspace.create`（root pane 即专属 pane）；
 * 3. 均失败 → 记录日志，会话仍可运行（无侧边栏展示）。
 *
 * 状态上报：会话创建 → idle；模型请求 → working；回合结束 → idle；
 * agent 销毁 → `pane.release-agent` 释放 authority。
 */
declare function apply(ctx: Context, config: Config): void;
//#endregion
export { Config, apply, inject, name };