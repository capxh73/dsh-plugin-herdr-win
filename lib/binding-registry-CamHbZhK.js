//#region src/host/log.ts
/** 按 key 限流：intervalMs 内同一 key 最多触发一次。 */
function createRateLimiter(intervalMs) {
	const last = /* @__PURE__ */ new Map();
	return (key, fn) => {
		const now = Date.now();
		if (now - (last.get(key) ?? 0) < intervalMs) return;
		last.set(key, now);
		fn();
	};
}
/** 稳定错误文本（logger 参数用）。 */
function errText(err) {
	return err instanceof Error ? err.message : String(err);
}
/** 子系统命名 logger 工厂（名称带 [dsh-plugin-herdr] 前缀便于 grep）。 */
function createLogger(ctx, subsystem) {
	return ctx.logger(`dsh-plugin-herdr/${subsystem}`);
}
//#endregion
//#region src/host/binding-registry.ts
/**
* 跨 bundle 共享的会话绑定注册表。
*
* session-mode（preset 组合，lib/session-mode.mjs）与消费者插件
* （lib/index.mjs）是两个独立构建入口，直接 import 会得到两份模块实例；
* 通过 globalThis 上的 Symbol.for 共享同一 Map，客户端端点
* /herdr-session-pane 即可查询"agentId → 绑定 pane"。
*/
const KEY = Symbol.for("dsh-plugin-herdr.bindings");
function getBindingRegistry() {
	const g = globalThis;
	return g[KEY] ??= /* @__PURE__ */ new Map();
}
/**
* 只读遍历全部已绑定 pane_id（去重，无绑定返回空数组）。
* 供 status.ts 的 self pane 豁免使用：无需知道"当前会话 agent id"，
* 只要某个 workspace 包含任一已绑定会话的 pane 就无条件保留。
* 纯遍历不改动 registry，不影响既有单测。
*/
function getBoundPaneIds() {
	return [...new Set([...getBindingRegistry().values()].map((b) => b.pane_id))];
}
/**
* 只读遍历全部已绑定 workspace_id（去重，无绑定返回空数组）。
* 供 HTTP 路由的 workspace 归属校验使用：目标 pane 的 workspace_id
* 必须在此集合中才允许输入写回（设计 §3.4）。
*/
function getBoundWorkspaceIds() {
	return [...new Set([...getBindingRegistry().values()].map((b) => b.workspace_id).filter((id) => id != null))];
}
/**
* 命名规范（design: herdr-mode-gating MG-55）：
* - 显示名（workspace/pane label）：优先取会话标题（session/title，GUI 会话名）；
*   无标题时回退 "dsh:<项目名>-<会话短id>"（项目名 = 会话 cwd 的 basename；无 cwd
*   时回退 "dsh:<会话短id>"）——同一项目下的多个会话靠会话短 id 区分；
* - 内部标记（绑定 pane 的 tokens.dsh_session = sessionId）：显示名与内部标记
*   分离——复用/兜底查询走 tokens（ttl_ms=null 永久有效），tokens 保留完整
*   session id，显示名只暴露后 8 位短标识。
*/
/** session id 的短标识（去掉 "session-" 前缀后取 8 位；异常时取原串尾部）。 */
function sessionShortId(sessionId) {
	const body = sessionId.replace(/^session-/, "");
	return body.length > 8 ? body.slice(-8) : body;
}
/** 项目名 = 会话 cwd 的 basename（无 cwd/无法解析时 undefined）。 */
function projectName(cwd) {
	if (!cwd) return void 0;
	const parts = cwd.replace(/[\/]+$/, "").split(/[\/]/);
	const base = parts[parts.length - 1];
	return base && base !== "" && base !== "." ? base : void 0;
}
/** 显示名兜底（workspace/pane label 共用；优先取会话标题时由调用方决定）："dsh:<项目名>-<短id>"，无项目名回退 "dsh:<短id>"。 */
function displayLabel(cwd, sessionId) {
	const name = projectName(cwd);
	const short = sessionShortId(sessionId);
	return "dsh:" + (name ? `${name}-${short}` : short);
}
/** 内部标记 key（tokens 键，符合协议 ^[A-Za-z0-9_-]{1,32}$）。 */
const SESSION_TOKEN_KEY = "dsh_session";
/** 绑定 pane 的内部标记 tokens（pane.report_metadata 写入；ttl_ms=null 永久）。 */
function sessionToken(agentId) {
	return { [SESSION_TOKEN_KEY]: agentId };
}
/** 从 pane tokens 提取会话 id（无标记返回 undefined）。 */
function sessionIdFromTokens(tokens) {
	return tokens?.["dsh_session"] ?? void 0;
}
//#endregion
export { sessionIdFromTokens as a, createRateLimiter as c, getBoundWorkspaceIds as i, errText as l, getBindingRegistry as n, sessionToken as o, getBoundPaneIds as r, createLogger as s, displayLabel as t };
