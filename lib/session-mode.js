import { a as sessionIdFromTokens, c as createRateLimiter, l as errText, n as getBindingRegistry, o as sessionToken, s as createLogger, t as displayLabel } from "./binding-registry-CamHbZhK.js";
import Schema from "@deepseek-ai/schemastery";
//#region src/host/session-mode.ts
const Config = Schema.object({
	paneId: Schema.string(),
	source: Schema.string().default("dsh:herdr-session"),
	label: Schema.string().default(""),
	cwd: Schema.string()
});
const name = "dsh-plugin-herdr-session-mode";
const inject = ["herdr"];
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
function apply(ctx, config) {
	const source = config.source;
	const agentName = "dsh";
	const registry = getBindingRegistry();
	const logger = createLogger(ctx, "session-mode");
	const rateLimited = createRateLimiter(1e4);
	const bindings = /* @__PURE__ */ new Map();
	const pending = /* @__PURE__ */ new Set();
	const disposedAgents = /* @__PURE__ */ new Set();
	const turnStopped = /* @__PURE__ */ new Set();
	const pendingCleanups = /* @__PURE__ */ new Set();
	const report = (agentId, state, message) => {
		const binding = bindings.get(agentId);
		if (!binding) return;
		ctx.herdr.reportAgent({
			pane_id: binding.paneId,
			source,
			agent: agentName,
			state,
			message
		}).catch((err) => {
			rateLimited("report-agent", () => logger.warn("report-agent failed for %s: %s", binding.paneId, errText(err)));
		});
	};
	/**
	* 会话专属 pane/workspace 清理：created=true 时关闭整个专属 workspace
	* （本会话产出的 pane 都归于此，随会话一并回收，避免残留空 workspace）；
	* 固定绑定：仅释放 authority。
	*/
	const cleanupPane = (binding) => {
		const action = binding.created ? binding.workspaceId ? ctx.herdr.workspaceClose(binding.workspaceId).catch(() => ctx.herdr.paneClose(binding.paneId).catch(() => {})) : ctx.herdr.paneClose(binding.paneId).catch(() => {}) : ctx.herdr.clearAgentAuthority({
			pane_id: binding.paneId,
			source,
			agent: agentName
		}).catch(() => {});
		const tracked = Promise.resolve(action);
		pendingCleanups.add(tracked);
		tracked.finally(() => pendingCleanups.delete(tracked));
		return tracked;
	};
	/**
	* 会话标题：折叠 session.events 中最新一条 session/title 事件（last-wins）。
	* 无标题/事件缺失返回 undefined。标题来自会话首个用户消息的自动生成
	* （session-title），异步出现——bind 时可能尚无，随后由 session/event 监听补正。
	*/
	const sessionTitleOf = (session) => {
		const events = session?.events;
		if (!Array.isArray(events)) return void 0;
		for (let i = events.length - 1; i >= 0; i--) {
			const e = events[i];
			if (e?.type !== "session/title") continue;
			const title = e.data?.title;
			return typeof title === "string" && title.trim() !== "" ? title.trim() : void 0;
		}
	};
	/** 显示名：config.label 覆盖 > 会话标题 > dsh:<项目名>-<会话短id> 兜底。 */
	const resolveLabel = (sessionCwd, agentId, session) => (config.label ?? "").trim() || sessionTitleOf(session) || displayLabel(sessionCwd, agentId);
	/** 按显示名重命名绑定 workspace + pane（尽力而为，失败静默）。 */
	const renameBound = (binding, label) => {
		if (binding.workspaceId) ctx.herdr.workspaceRename(binding.workspaceId, label).catch(() => {});
		ctx.herdr.paneRename(binding.paneId, label).catch(() => {});
	};
	/**
	* 为 agent 绑定 pane（幂等；CA-013：bind 完成前 agent 已 dispose 则不注册并清理已建 pane）。
	* - 专属 workspace：会话启动时在项目目录（agent.session.header.cwd）创建专属
	*   workspace，绑定 pane 为其 root pane——本会话产出的 pane（split/复用）都
	*   归于此 workspace，与其他会话/用户 workspace（如 ~）隔离；
	* - session：会话对象（agent.session），用于读取 cwd 与标题（session/title）；
	* - 显示名与内部标记分离（MG-55）：workspace/pane label 优先取会话标题
	*   （用户可见的会话名），无标题时回退 "dsh:<项目名>-<会话短id>"；
	*   内部标记 = 绑定 pane 的 tokens.dsh_session（report_metadata 写入，ttl=null 永久）——
	*   复用与 /herdr-session-pane 兜底查询都走 tokens，不再用 label 承载 session id；
	* - 复用：herdr 中已存在带本会话 tokens 标记的 pane 时直接复用（进程重启/插件重载
	*   后 registry 内存清空、并发重复 created 的场景），避免同一个会话累积多个 pane；
	*   复用时若会话标题已可用则补正 workspace/pane 显示名。
	*/
	const bind = async (agentId, session) => {
		if (bindings.has(agentId)) return bindings.get(agentId);
		if (pending.has(agentId)) return null;
		const fixed = (config.paneId ?? "").trim();
		if (fixed) {
			const b = {
				paneId: fixed,
				created: false
			};
			bindings.set(agentId, b);
			registry.set(agentId, {
				pane_id: fixed,
				created: false
			});
			return b;
		}
		pending.add(agentId);
		let created = null;
		try {
			const snap = await ctx.herdr.snapshot();
			const sessionCwd = session?.header?.cwd;
			const label = resolveLabel(sessionCwd, agentId, session);
			const existing = (snap.panes ?? []).find((p) => sessionIdFromTokens(p.tokens) === agentId);
			if (existing) {
				created = {
					paneId: existing.pane_id,
					created: true,
					workspaceId: existing.workspace_id
				};
				if (sessionTitleOf(session)) renameBound(created, label);
				logger.info("agent %s reused marked pane %s", agentId, existing.pane_id);
			} else {
				const ws = await ctx.herdr.workspaceCreate({
					label,
					cwd: sessionCwd ?? config.cwd
				});
				if (ws.pane_id) {
					created = {
						paneId: ws.pane_id,
						created: true,
						workspaceId: ws.workspace_id
					};
					await ctx.herdr.paneRename(ws.pane_id, label).catch(() => {});
					await ctx.herdr.reportMetadata({
						pane_id: ws.pane_id,
						source,
						agent: agentName,
						tokens: sessionToken(agentId),
						ttl_ms: null
					}).catch(() => {});
					logger.info("agent %s bound to new pane %s (workspace %s, cwd=%s, label=%s)", agentId, ws.pane_id, ws.workspace_id, sessionCwd ?? config.cwd ?? "default", label);
				} else logger.warn("no pane for agent %s (workspace.create returned no root pane)", agentId);
			}
			if (!created) return null;
			if (disposedAgents.has(agentId)) {
				logger.warn("agent %s disposed during bind; closing pane %s", agentId, created.paneId);
				disposedAgents.delete(agentId);
				cleanupPane(created);
				return null;
			}
			bindings.set(agentId, created);
			registry.set(agentId, {
				pane_id: created.paneId,
				created: created.created,
				...created.workspaceId ? { workspace_id: created.workspaceId } : {}
			});
			return created;
		} catch (err) {
			logger.warn("pane bind failed for agent %s: %s", agentId, errText(err));
			return null;
		} finally {
			pending.delete(agentId);
			if (disposedAgents.has(agentId)) disposedAgents.delete(agentId);
		}
	};
	const sessionOf = (agent) => agent?.session;
	const offCreated = ctx.on("agent/created", (payload) => {
		const agentId = payload.agent.id;
		bind(agentId, sessionOf(payload.agent)).then((binding) => {
			if (binding) report(agentId, "idle", "herdr session ready");
		});
	});
	const offRequest = ctx.on("agent/request", async (payload, next) => {
		const agentId = payload.agent.id;
		turnStopped.delete(agentId);
		if (!bindings.has(agentId) && !pending.has(agentId) && !disposedAgents.has(agentId)) bind(agentId, sessionOf(payload.agent)).then((binding) => {
			if (binding && !turnStopped.has(agentId)) report(agentId, "working", "model request in progress");
		});
		report(agentId, "working", "model request in progress");
		return next();
	});
	const offStopping = ctx.on("agent/turn-stopping", (payload) => {
		const agentId = payload.agent.id;
		turnStopped.add(agentId);
		report(agentId, "idle", "turn finished");
	});
	const offDisposed = ctx.on("agent/disposed", (payload) => {
		const agentId = payload.agent.id;
		disposedAgents.add(agentId);
		turnStopped.delete(agentId);
		if (pending.has(agentId)) return;
		const binding = bindings.get(agentId);
		disposedAgents.delete(agentId);
		if (!binding) return;
		bindings.delete(agentId);
		registry.delete(agentId);
		cleanupPane(binding);
	});
	const offSessionEvent = ctx.on("session/event", (session, event) => {
		if (event?.type !== "session/title") return;
		const agentId = session?.id;
		if (typeof agentId !== "string") return;
		const title = event.data?.title;
		if (typeof title !== "string" || title.trim() === "") return;
		const binding = bindings.get(agentId);
		if (!binding) return;
		const label = (config.label ?? "").trim() || title.trim();
		renameBound(binding, label);
	});
	logger.info("session-mode active (herdr preset standing scope)");
	ctx.effect(() => {
		return () => {
			offCreated();
			offRequest();
			offStopping();
			offDisposed();
			offSessionEvent();
			const ownedIds = [...bindings.keys()];
			for (const binding of bindings.values()) cleanupPane(binding);
			bindings.clear();
			for (const id of ownedIds) registry.delete(id);
			pending.clear();
			disposedAgents.clear();
			turnStopped.clear();
		};
	});
}
//#endregion
export { Config, apply, inject, name };
