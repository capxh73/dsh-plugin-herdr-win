import { a as sessionIdFromTokens, c as createRateLimiter, i as getBoundWorkspaceIds, l as errText, n as getBindingRegistry, r as getBoundPaneIds, s as createLogger } from "./binding-registry-CamHbZhK.js";
import { createRequire } from "node:module";
import { createConnection } from "node:net";
import { Service } from "@deepseek-ai/cordis";
import Schema from "@deepseek-ai/schemastery";
import { arch, homedir, hostname, platform, release, type } from "node:os";
import path, { delimiter, isAbsolute, join } from "node:path";
import fs, { accessSync, constants, statSync } from "node:fs";
import { execFile, spawn } from "node:child_process";
import { randomFillSync } from "node:crypto";
import { defineTool } from "@deepseek-ai/dsh-tools";
import { Remote, TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
//#region \0rolldown/runtime.js
var __require = /* #__PURE__ */ (() => createRequire(import.meta.url))();
//#endregion
//#region src/host/herdr/service.ts
/**
* Herdr 控制面服务（DESIGN.md §5.3 / §7.3）。
* 全量迁移后唯一实现为 SocketHerdrClient（socket.ts；CLI 传输已移除）。
*/
var HerdrClient = class extends Service {
	constructor(ctx) {
		super(ctx, "herdr");
	}
};
//#endregion
//#region src/core/errors.ts
/**
* Herdr 调用失败（连接/环境/协议类错误，工具层应抛错；业务性失败由规范值表达）。
*
* 传输无关错误契约（D4：由 HerdrCliError 更名——插件已全量迁移至 socket 传输，
* CLI 传输不复存在，错误类型不再绑定 CLI 语义）。
*/
var HerdrError = class extends Error {
	code;
	/** 服务器 error envelope 的 code（如 agent_not_found / timeout / pane_not_found）；客户端侧错误为 undefined。 */
	serverCode;
	constructor(code, message, serverCode) {
		super(message);
		this.name = "HerdrError";
		this.code = code;
		if (serverCode !== void 0) this.serverCode = serverCode;
	}
};
//#endregion
//#region src/core/output.ts
/**
* 输出上限工具（CA-002 / CA-014）：单条响应的固定累积上限；超过即截断并报告 truncated。
* 与传输无关（CLI 传输已移除，socket 传输沿用同一上限语义）。
*/
const MAX_OUTPUT_BYTES = 1048576;
/**
* CR P2：按 UTF-8 字节预算截断字符串，保证结果不超过 maxBytes。
* 直接 Buffer.subarray+toString 在切点落在多字节字符中间时会产生 U+FFFD 替换符
* （3 字节），可能超出预算——这里解码后回退到有效边界。
*/
function truncateUtf8Bytes(text, maxBytes) {
	let out = Buffer.from(text).subarray(0, maxBytes).toString("utf8");
	while (Buffer.byteLength(out) > maxBytes) out = out.slice(0, -1);
	return out;
}
//#endregion
//#region src/core/ansi.ts
/** 安全尾部截断：保留尾部 maxChars 个可见字符，不在 ESC/CSI/OSC/SGR 扩展色参数中间截断。 */
function truncateAnsiTail(text, maxChars) {
	if (text.length <= maxChars) return text;
	let escapePos = -1;
	for (let i = text.length - 1; i >= 0; i--) if (text[i] === "\x1B") {
		escapePos = i;
		break;
	}
	if (escapePos >= 0) text = text.slice(0, escapePos);
	let end = text.length;
	let visibleCount = 0;
	while (end > 0 && visibleCount < maxChars) {
		end--;
		if (text[end] !== "\r") visibleCount++;
	}
	while (end > 0) {
		const ch = text.charCodeAt(end - 1);
		if (ch <= 127 || ch >= 192) break;
		end--;
	}
	return text.slice(end);
}
//#endregion
//#region src/web/logic.ts
/** pane_id 自然排序（w8:p2 < w8:p10）：workspace 字典序 + pane 数字序。 */
function comparePaneId$1(a, b) {
	const [wa, pa] = a.split(":");
	const [wb, pb] = b.split(":");
	if (wa !== wb) return wa < wb ? -1 : 1;
	return (Number((pa ?? "").replace(/\D/g, "")) || 0) - (Number((pb ?? "").replace(/\D/g, "")) || 0);
}
/** workspace_id 自然排序（w2 < w10）。 */
function compareWorkspaceId(a, b) {
	const na = Number(a.replace(/\D/g, "")) || 0;
	const nb = Number(b.replace(/\D/g, "")) || 0;
	if (na !== nb) return na - nb;
	return a < b ? -1 : 1;
}
/** 按 agent 状态计数（缺失/空字符串归 unknown；空数组返回空对象）。 */
function agentStatusCounts(agents) {
	const counts = {};
	for (const a of agents) {
		const s = a.status || "unknown";
		counts[s] = (counts[s] ?? 0) + 1;
	}
	return counts;
}
/**
* 路径 → basename（脱敏：Dashboard 只展示 basename，不把完整本地路径写入 DTO/日志）。
* ''/'/'/尾斜杠 → null；'a' → 'a'；'/a/b' → 'b'；'a\\b' → 'b'。
*/
function pathBase(p) {
	if (!p) return null;
	const cleaned = p.replace(/[\\/]+$/, "");
	if (!cleaned) return null;
	const idx = Math.max(cleaned.lastIndexOf("/"), cleaned.lastIndexOf("\\"));
	const base = idx >= 0 ? cleaned.slice(idx + 1) : cleaned;
	return base === "" ? null : base;
}
/** stale 派生：从未成功刷新（updatedAt=0）或距最近成功刷新超过阈值。 */
function deriveStale(updatedAt, now, thresholdMs) {
	return updatedAt === 0 || now - updatedAt > thresholdMs;
}
/** 进程探测节流判定：从未探测或距上次探测 ≥ interval → 重新探测（纯函数，可测）。 */
function shouldProbeNow(lastProbeAt, now, probeIntervalMs) {
	return lastProbeAt === 0 || now - lastProbeAt >= probeIntervalMs;
}
/**
* kind 归一化（v4）：kind → agent → unknown 回退链。name 是自定义 target，
* 不得当 kind 用（协议无正式 kind 字段，此为兼容推断）。
*/
function normalizeAgentKind(kind, agent) {
	if (kind && kind.trim() !== "") return kind;
	if (agent && agent.trim() !== "") return agent;
	return "unknown";
}
/**
* workspace 聚合：tabs/panes/agents 计数 + agent 状态汇总 + agent 明细挂载。
* - agent 归属优先 workspace_id；缺失时按 pane_id 反查 topology（协议兼容降级）；
* - 缺失/未知状态归 unknown；workspace_id 缺失的 pane/agent 忽略；
* - 结果按 workspace_id 自然排序（w2 < w10）。
*/
function aggregateDashboardWorkspaces(topology, agents) {
	const tabCount = /* @__PURE__ */ new Map();
	for (const t of topology.tabs) {
		if (!t.workspace_id) continue;
		tabCount.set(t.workspace_id, (tabCount.get(t.workspace_id) ?? 0) + 1);
	}
	const panesByWs = /* @__PURE__ */ new Map();
	const wsByPane = /* @__PURE__ */ new Map();
	for (const p of topology.panes) {
		if (!p.workspace_id) continue;
		const arr = panesByWs.get(p.workspace_id) ?? [];
		arr.push(p);
		panesByWs.set(p.workspace_id, arr);
		if (p.pane_id) wsByPane.set(p.pane_id, p.workspace_id);
	}
	const wsAgents = /* @__PURE__ */ new Map();
	for (const a of agents) {
		if (!a.pane_id) continue;
		const wsId = a.workspace_id ?? wsByPane.get(a.pane_id);
		if (!wsId) continue;
		const arr = wsAgents.get(wsId) ?? [];
		arr.push({
			pane_id: a.pane_id,
			name: a.name ?? void 0,
			kind: normalizeAgentKind(a.kind, a.agent),
			status: a.status || "unknown"
		});
		wsAgents.set(wsId, arr);
	}
	return topology.workspaces.filter((w) => Boolean(w.workspace_id)).map((w) => {
		const id = w.workspace_id;
		const panes = panesByWs.get(id) ?? [];
		const agentsOfWs = wsAgents.get(id) ?? [];
		const counts = agentStatusCounts(agentsOfWs.map((a) => ({ status: a.status })));
		const agentByPaneId = new Map(agentsOfWs.map((a) => [a.pane_id, a]));
		const paneDetails = panes.filter((p) => Boolean(p.pane_id)).map((p) => {
			const agent = agentByPaneId.get(p.pane_id);
			return {
				pane_id: p.pane_id,
				label: p.label ?? null,
				kind: agent?.kind ?? "unknown",
				name: agent?.name,
				status: agent?.status ?? p.agent_status ?? "unknown"
			};
		}).sort((a, b) => comparePaneId$1(a.pane_id, b.pane_id));
		return {
			workspace_id: id,
			label: w.label ?? null,
			checkout_path_base: pathBase(w.checkout_path),
			tab_count: tabCount.get(id) ?? 0,
			pane_count: panes.length,
			agent_count: agentsOfWs.length,
			agents_working: counts["working"] ?? 0,
			agents_blocked: counts["blocked"] ?? 0,
			agents: agentsOfWs,
			panes: paneDetails
		};
	}).sort((a, b) => compareWorkspaceId(a.workspace_id, b.workspace_id));
}
/** 汇总：总数 + agent 状态分布（同一轮归一化快照内计算，避免跨时间点）。 */
function buildDashboardSummary(workspaces, agents) {
	return {
		workspaces: workspaces.length,
		tabs: workspaces.reduce((n, w) => n + w.tab_count, 0),
		panes: workspaces.reduce((n, w) => n + w.pane_count, 0),
		agents: agents.length,
		agents_by_status: agentStatusCounts(agents)
	};
}
//#endregion
//#region src/core/poll.ts
const sleep$1 = (ms) => new Promise((res) => setTimeout(res, ms));
async function pollPaneUntilStable(readPane, paneId, waitMs, signal, opts = {}) {
	const intervalMs = opts.intervalMs ?? 500;
	const quietMs = opts.quietMs ?? 1500;
	const deadline = Date.now() + waitMs;
	let prev = "";
	let stableSince = 0;
	let lastRead = "";
	while (Date.now() < deadline) {
		if (signal.aborted) return {
			output: trimBaseline(lastRead, opts.baseline),
			status: "aborted"
		};
		await sleep$1(intervalMs);
		lastRead = await readPane(paneId);
		if (lastRead === prev) {
			if (stableSince === 0) stableSince = Date.now();
			else if (Date.now() - stableSince >= quietMs) break;
		} else {
			stableSince = 0;
			prev = lastRead;
		}
	}
	const timedOut = Date.now() >= deadline;
	let output = trimBaseline(lastRead, opts.baseline);
	output = output.replace(/\s*[❯$#]\s*$/, "").replace(/\s*~\s*$/, "").replace(/^\n+/, "");
	return {
		output,
		status: timedOut ? "timed_out" : "completed"
	};
}
/**
* 若输出以基线（命令执行前的快照）为前缀，仅保留新增部分；否则原样返回。
*
* 基线尾部是"提示符+光标"（如 `❯\n`）：命令执行后同一位置变为命令回显
* （`❯ sh -c ...`），直接 startsWith 会失败。因此先剥掉基线尾部的提示符
* 再匹配——提示符本身属于本次回显，保留无妨。
*/
function trimBaseline(output, baseline) {
	if (!baseline) return output;
	const base = baseline.replace(/\s*[❯$#]\s*$/, "");
	if (base && output.startsWith(base)) return output.slice(base.length);
	return output;
}
//#endregion
//#region src/host/herdr/socket.ts
/**
* CA-014：pane.read 响应归一化——与传输无关的输出上限：
* 上报服务器 truncated 标志（pane_read 分支真实字段），并做客户端 1 MiB 兜底截断
* （服务器可能不截断）。
*/
function capReadText(read) {
	let text = read?.text ?? "";
	let truncated = read?.truncated === true;
	const revision = read?.revision;
	if (Buffer.byteLength(text) > 1048576) {
		text = truncateUtf8Bytes(text, MAX_OUTPUT_BYTES);
		truncated = true;
	}
	if (text.includes("\x1B")) {
		const cleaned = truncateAnsiTail(text, text.length);
		if (cleaned.length < text.length) {
			text = cleaned;
			truncated = true;
		}
	}
	return {
		text,
		truncated,
		revision
	};
}
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
/**
* Socket 传输适配器（DESIGN.md §7.2；全量迁移后为唯一传输，CLI 传输已移除）。
*
* 实测协议行为（herdr 0.9.0 / protocol 22）：
* - **每次请求一个连接**：服务器回复后立即关闭（长连接不存在）；
* - 仅 events.subscribe 在响应后保持连接并推送订阅事件；
* - JSONL over Unix domain socket；错误在 error envelope（serverCode 透传）。
* Windows named pipe 不支持（见 config.resolveSocketPath）。
*/
var SocketHerdrClient = class extends HerdrClient {
	options;
	/** 订阅长连接（events.subscribe 专用）。 */
	subSock = null;
	subBuffer = "";
	eventHandlers = /* @__PURE__ */ new Set();
	closed = false;
	constructor(ctx, options) {
		super(ctx);
		this.options = options;
	}
	/** 订阅连接是否活跃（事件转发健康检查用）。 */
	get connected() {
		return this.subSock !== null && !this.closed;
	}
	/** 关闭订阅连接（effect 清理与测试用）。 */
	close() {
		this.closed = true;
		if (this.subSock) {
			this.subSock.destroy();
			this.subSock = null;
		}
	}
	/** 服务器可达性与版本探测（socket ping；看板 connected/server 数据源）。 */
	async ping() {
		const { result } = await this.callOnce("ping", {});
		const pong = result;
		if (!pong?.version || typeof pong.protocol !== "number") throw new HerdrError("HERDR_PROTOCOL", "ping response missing version/protocol");
		return {
			version: pong.version,
			protocol: pong.protocol
		};
	}
	async snapshot() {
		const { result } = await this.callOnceRead("session.snapshot", {});
		const raw = result?.snapshot;
		if (!raw) throw new HerdrError("HERDR_PROTOCOL", "session.snapshot response missing snapshot");
		const agents = raw.agents.map((a) => ({
			...a,
			status: a.agent_status ?? a.status ?? "unknown"
		}));
		return {
			...raw,
			agents
		};
	}
	async listAgents(filter) {
		const { result } = await this.callOnceRead("agent.list", {});
		const agents = (result?.agents ?? []).map((a) => ({
			...a,
			status: a.agent_status ?? a.status ?? "unknown"
		}));
		if (!filter) return agents;
		return agents.filter((a) => {
			if (filter.workspace_id && a.workspace_id !== filter.workspace_id) return false;
			if (filter.status && a.status !== filter.status) return false;
			return true;
		});
	}
	async runCommand(req, signal) {
		let paneId = req.pane_id;
		if (!paneId) {
			const { result } = await this.callOnce("pane.split", {
				direction: req.direction ?? "right",
				ratio: req.ratio ?? null,
				cwd: req.cwd ?? null,
				env: req.env ?? void 0,
				target_pane_id: req.pane_id ?? null,
				workspace_id: req.workspace_id ?? null
			});
			const pane = result?.pane;
			if (!pane?.pane_id) throw new HerdrError("HERDR_PROTOCOL", "pane.split response missing pane_id");
			paneId = pane.pane_id;
		}
		let baseline = "";
		try {
			baseline = (await this.readPaneText(paneId)).text;
		} catch {}
		// 提交命令必须走 pane.send_input(text + Enter)，不能用 pane.send_text 附带 "\n"：
		// Windows 的 PowerShell/PSReadLine 把裸 LF 当成续行而不是回车，pane 会停在 ">> " 续行提示符，
		// 命令永远不执行（POSIX shell 恰好容忍 LF，所以 Linux 上从未暴露）。对照结论：
		// send_text+"\n" 不执行，send_text+"\r" 执行，send_input(text, keys:["enter"]) 执行，
		// 与 `herdr pane run`（CLI）行为一致。
		await this.callOnce("pane.send_input", {
			pane_id: paneId,
			text: req.command,
			keys: ["enter"]
		});
		let truncated = false;
		const readPane = async (id) => {
			const r = await this.readPaneText(id);
			if (r.truncated) truncated = true;
			return r.text;
		};
		const { output, status } = await pollPaneUntilStable(readPane, paneId, req.wait_ms ?? this.options.timeoutMs, signal, { baseline });
		if (status === "aborted") throw new HerdrError("HERDR_ABORTED", "runCommand aborted while waiting for pane output");
		return {
			kind: "completed",
			pane_id: paneId,
			exit_code: null,
			output,
			truncated,
			timed_out: status === "timed_out"
		};
	}
	async waitAgent(req, signal) {
		const start = Date.now();
		const timeoutMs = req.timeout_ms ?? this.options.timeoutMs;
		try {
			const { result } = await this.callOnce("agent.wait", {
				target: req.target,
				until: req.until,
				timeout_ms: timeoutMs
			}, {
				timeoutMs: timeoutMs + 1e4,
				signal
			});
			const agent = result?.agent;
			return {
				kind: "completed",
				status: agent?.agent_status ?? req.until?.[0],
				agent: agent?.name ?? agent?.agent ?? void 0,
				pane_id: agent?.pane_id ?? void 0,
				waited_ms: Date.now() - start
			};
		} catch (err) {
			if (err instanceof HerdrError && (err.serverCode === "agent_not_found" || /agent_not_found|not found/i.test(err.message))) return {
				kind: "not_found",
				target: req.target
			};
			if (err instanceof HerdrError && (err.serverCode === "timeout" || /timeout/i.test(err.message))) return {
				kind: "timeout",
				waited_ms: Date.now() - start
			};
			throw err;
		}
	}
	async workspaceCreate(req) {
		const { result } = await this.callOnce("workspace.create", {
			cwd: req.cwd ?? null,
			label: req.label ?? null,
			env: req.env ?? void 0
		});
		const res = result;
		if (!res?.workspace?.workspace_id) throw new HerdrError("HERDR_PROTOCOL", "workspace.create response missing workspace_id");
		return {
			workspace_id: res.workspace.workspace_id,
			...res.root_pane?.pane_id ? { pane_id: res.root_pane.pane_id } : {}
		};
	}
	async paneSplit(req) {
		const { result } = await this.callOnce("pane.split", {
			direction: req.direction,
			ratio: req.ratio ?? null,
			cwd: req.cwd ?? null,
			env: req.env ?? void 0,
			target_pane_id: req.pane_id ?? null,
			workspace_id: req.workspace_id ?? null
		});
		const pane = result?.pane;
		if (!pane?.pane_id) throw new HerdrError("HERDR_PROTOCOL", "pane.split response missing pane_id");
		return { pane_id: pane.pane_id };
	}
	async paneClose(paneId) {
		await this.callOnce("pane.close", { pane_id: paneId });
	}
	async workspaceClose(workspaceId) {
		await this.callOnce("workspace.close", { workspace_id: workspaceId });
	}
	async workspaceRename(workspaceId, label) {
		await this.callOnce("workspace.rename", {
			workspace_id: workspaceId,
			label
		});
	}
	async paneRename(paneId, label) {
		await this.callOnce("pane.rename", {
			pane_id: paneId,
			label
		});
	}
	async paneSendKeys(req) {
		await this.callOnce("pane.send_keys", {
			pane_id: req.pane_id,
			keys: req.keys
		});
	}
	async paneSendInput(req) {
		await this.callOnce("pane.send_input", {
			pane_id: req.pane_id,
			text: req.text,
			keys: req.keys
		});
	}
	async paneRead(req) {
		const { result } = await this.callOnce("pane.read", {
			pane_id: req.pane_id,
			source: req.source ?? "recent",
			lines: req.lines ?? null,
			format: req.format ?? "text"
		});
		return capReadText(result?.read);
	}
	async paneWaitForOutputChange(req, signal) {
		const timeoutMs = req.timeout_ms ?? 25e3;
		try {
			const { result } = await this.callOnce("events.wait", {
				match_event: {
					event: "pane_output_changed",
					pane_id: req.pane_id,
					min_revision: req.min_revision
				},
				timeout_ms: timeoutMs
			}, {
				timeoutMs: timeoutMs + 5e3,
				signal
			});
			const data = (result?.event)?.data;
			if (data?.type !== "pane_output_changed" || data.pane_id !== req.pane_id) throw new HerdrError("HERDR_PROTOCOL", "events.wait response missing pane_output_changed event");
			return {
				changed: true,
				revision: data.revision
			};
		} catch (err) {
			if (err instanceof HerdrError && err.serverCode === "timeout") return {
				changed: false,
				revision: req.min_revision
			};
			throw err;
		}
	}
	async paneLayout(req) {
		const { result } = await this.callOnce("pane.layout", { pane_id: req.pane_id ?? null });
		return result;
	}
	async layoutApply(req) {
		const { result } = await this.callOnce("layout.apply", {
			root: req.root,
			workspace_id: req.workspace_id ?? null,
			tab_id: req.tab_id ?? null,
			tab_label: req.tab_label ?? null,
			focus: req.focus ?? false
		});
		return result;
	}
	async agentPrompt(req, signal) {
		const start = Date.now();
		const { result } = await this.callOnce("agent.prompt", {
			target: req.target,
			text: req.text,
			wait: req.wait ? {
				...req.until ? { until: req.until } : {},
				timeout_ms: req.timeout_ms ?? null
			} : null
		}, { signal });
		const status = result?.agent?.agent_status;
		return {
			submitted: true,
			...status !== void 0 ? { status } : {},
			...req.wait ? { waited_ms: Date.now() - start } : {}
		};
	}
	async agentStart(req) {
		const { result } = await this.callOnce("agent.start", {
			name: req.name,
			kind: req.kind,
			pane_id: req.pane_id,
			args: req.args ?? void 0,
			timeout_ms: req.timeout_ms ?? null
		});
		const res = result;
		if (!res?.agent) throw new HerdrError("HERDR_PROTOCOL", "agent.start response missing agent");
		return res.agent;
	}
	async agentExplain(req) {
		try {
			const { result } = await this.callOnce("agent.explain", { target: req.target ?? null });
			return result;
		} catch (err) {
			if (err instanceof HerdrError && err.code === "HERDR_ERROR") return {};
			throw err;
		}
	}
	async agentSendKeys(req) {
		await this.callOnce("agent.send_keys", {
			target: req.target,
			keys: req.keys
		});
	}
	async showNotification(req) {
		await this.callOnce("notification.show", {
			title: req.title,
			body: req.body ?? null,
			position: req.position ?? null,
			sound: req.sound ?? "none"
		});
	}
	async reportAgent(req) {
		await this.callOnce("pane.report_agent", {
			pane_id: req.pane_id,
			source: req.source,
			agent: req.agent,
			state: req.state,
			message: req.message ?? null
		});
	}
	async reportMetadata(req) {
		await this.callOnce("pane.report_metadata", {
			pane_id: req.pane_id,
			source: req.source,
			agent: req.agent ?? null,
			title: req.title ?? null,
			tokens: req.tokens ?? void 0,
			ttl_ms: req.ttl_ms ?? null
		});
	}
	async clearAgentAuthority(req) {
		await this.callOnce("pane.clear_agent_authority", {
			pane_id: req.pane_id,
			source: req.source ?? null
		});
	}
	/** 注册订阅事件处理器；返回退订函数。 */
	onEvent(handler) {
		this.eventHandlers.add(handler);
		return () => this.eventHandlers.delete(handler);
	}
	/** 订阅 Herdr 事件：建立长连接，响应后保持打开并推送订阅事件。已订阅时重建连接（支持动态增订）。 */
	async subscribe(subscriptions) {
		if (this.closed) throw new HerdrError("HERDR_UNAVAILABLE", "socket client is closed");
		if (this.subSock) {
			this.subSock.destroy();
			this.subSock = null;
			this.subBuffer = "";
		}
		return new Promise((resolve, reject) => {
			const sock = createConnection(toConnectTarget(this.options.socketPath));
			this.subSock = sock;
			sock.setEncoding("utf8");
			let responded = false;
			let settled = false;
			const finish = (fn) => {
				if (settled) return;
				settled = true;
				clearTimeout(timer);
				fn();
			};
			const timer = setTimeout(() => {
				sock.destroy();
				if (this.subSock === sock) this.subSock = null;
				finish(() => reject(new HerdrError("HERDR_TIMEOUT", "events.subscribe handshake timed out")));
			}, this.options.timeoutMs);
			sock.on("connect", () => {
				if (settled) return;
				sock.write(JSON.stringify({
					id: "sub_1",
					method: "events.subscribe",
					params: { subscriptions }
				}) + "\n");
			});
			sock.on("data", (chunk) => {
				this.subBuffer += typeof chunk === "string" ? chunk : chunk.toString("utf8");
				let idx;
				while ((idx = this.subBuffer.indexOf("\n")) >= 0) {
					const line = this.subBuffer.slice(0, idx);
					this.subBuffer = this.subBuffer.slice(idx + 1);
					const trimmed = line.trim();
					if (!trimmed) continue;
					let parsed;
					try {
						parsed = JSON.parse(trimmed);
					} catch {
						continue;
					}
					if (parsed.id && !responded) {
						responded = true;
						if (parsed.error) {
							const err = parsed.error;
							sock.destroy();
							if (this.subSock === sock) this.subSock = null;
							finish(() => reject(new HerdrError("HERDR_ERROR", `${err.code ?? "unknown"}: ${err.message ?? ""}`, err.code)));
						} else finish(() => resolve());
						continue;
					}
					if (!parsed.id) for (const handler of this.eventHandlers) try {
						handler(parsed);
					} catch {}
				}
			});
			sock.on("error", (err) => {
				if (settled) return;
				sock.destroy();
				if (this.subSock === sock) this.subSock = null;
				const message = err.code === "ENOENT" ? `herdr socket not found: '${this.options.socketPath}' (is the herdr server running?)` : `failed to connect to herdr socket: ${err.message}`;
				finish(() => reject(new HerdrError("HERDR_UNAVAILABLE", message)));
			});
			sock.on("close", () => {
				if (this.subSock === sock) this.subSock = null;
				if (!responded && !settled) finish(() => reject(new HerdrError("HERDR_UNAVAILABLE", "socket closed before subscribe response")));
			});
		});
	}
	async readPaneText(paneId) {
		const { result } = await this.callOnceRead("pane.read", {
			pane_id: paneId,
			source: "recent",
			lines: 500
		});
		return capReadText(result?.read);
	}
	/**
	* 幂等读方法：连接类失败（HERDR_UNAVAILABLE）时重试 1 次（对齐 CLI 传输 retryRead 语义，
	* §11.2——"请求发出前"失败可安全重试；可变方法绝不重试）。
	*/
	async callOnceRead(method, params) {
		try {
			return await this.callOnce(method, params);
		} catch (err) {
			if (err instanceof HerdrError && err.code === "HERDR_UNAVAILABLE") {
				await sleep(300);
				return await this.callOnce(method, params);
			}
			throw err;
		}
	}
	/** 一次性请求-响应调用（服务器每个连接只服务一个请求后关闭）。 */
	callOnce(method, params, opts = {}) {
		return new Promise((resolve, reject) => {
			let settled = false;
			const timeoutMs = opts.timeoutMs ?? this.options.timeoutMs;
			const sock = createConnection(toConnectTarget(this.options.socketPath));
			sock.setEncoding("utf8");
			let buf = "";
			const finish = (fn) => {
				if (settled) return;
				settled = true;
				clearTimeout(timer);
				sock.destroy();
				fn();
			};
			const timer = setTimeout(() => {
				finish(() => reject(new HerdrError("HERDR_TIMEOUT", `herdr ${method} timed out after ${timeoutMs}ms`)));
			}, timeoutMs);
			const onAbort = () => {
				finish(() => reject(new HerdrError("HERDR_ABORTED", "call aborted")));
			};
			if (opts.signal) {
				if (opts.signal.aborted) {
					onAbort();
					return;
				}
				opts.signal.addEventListener("abort", onAbort, { once: true });
			}
			sock.on("connect", () => {
				if (settled) return;
				sock.write(JSON.stringify({
					id: "req_1",
					method,
					params
				}) + "\n");
			});
			sock.on("data", (chunk) => {
				if (settled) return;
				buf += typeof chunk === "string" ? chunk : chunk.toString("utf8");
				let idx;
				while ((idx = buf.indexOf("\n")) >= 0) {
					const line = buf.slice(0, idx);
					buf = buf.slice(idx + 1);
					const trimmed = line.trim();
					if (!trimmed) continue;
					let parsed;
					try {
						parsed = JSON.parse(trimmed);
					} catch {
						continue;
					}
					if (!parsed.id || parsed.id !== "req_1") continue;
					finish(() => {
						if (opts.signal) opts.signal.removeEventListener("abort", onAbort);
						if (parsed.error) reject(new HerdrError("HERDR_ERROR", `${parsed.error.code ?? "unknown"}: ${parsed.error.message ?? ""}`, parsed.error.code));
						else resolve({ result: parsed.result });
					});
					return;
				}
			});
			sock.on("error", (err) => {
				finish(() => {
					if (opts.signal) opts.signal.removeEventListener("abort", onAbort);
					reject(new HerdrError("HERDR_UNAVAILABLE", err.code === "ENOENT" ? `herdr socket not found: '${this.options.socketPath}' (is the herdr server running?)` : `failed to connect to herdr socket: ${err.message}`));
				});
			});
			sock.on("close", () => {
				finish(() => {
					if (opts.signal) opts.signal.removeEventListener("abort", onAbort);
					reject(new HerdrError("HERDR_UNAVAILABLE", "socket closed before response"));
				});
			});
		});
	}
};
/**
* 原始 socket ping（不依赖 client 实例）：探测服务器可达性与版本。
* 失败（连接拒绝/ENOENT/超时/协议异常）返回 null——启动引导与看板探测的兜底实现。
*/
function socketPing(socketPath, timeoutMs = 5e3) {
	return new Promise((resolve) => {
		const sock = createConnection(toConnectTarget(socketPath));
		sock.setEncoding("utf8");
		let buf = "";
		let settled = false;
		const finish = (v) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			sock.destroy();
			resolve(v);
		};
		const timer = setTimeout(() => finish(null), timeoutMs);
		sock.on("connect", () => {
			if (settled) return;
			sock.write(JSON.stringify({
				id: "ping_1",
				method: "ping",
				params: {}
			}) + "\n");
		});
		sock.on("data", (chunk) => {
			if (settled) return;
			buf += typeof chunk === "string" ? chunk : chunk.toString("utf8");
			let idx;
			while ((idx = buf.indexOf("\n")) >= 0) {
				const line = buf.slice(0, idx);
				buf = buf.slice(idx + 1);
				const trimmed = line.trim();
				if (!trimmed) continue;
				let parsed;
				try {
					parsed = JSON.parse(trimmed);
				} catch {
					continue;
				}
				if (parsed.id !== "ping_1") continue;
				const r = parsed.result;
				if (parsed.error || !r?.version || typeof r.protocol !== "number") finish(null);
				else finish({
					version: r.version,
					protocol: r.protocol
				});
				return;
			}
		});
		sock.on("error", () => finish(null));
		sock.on("close", () => finish(null));
	});
}
//#endregion
//#region src/host/config.ts
/**
* terminalSession 的默认配置。经 Phase 0 实测校准（docs/pane-terminal-session-probe.md）：
* 裸/彩色满屏帧最坏约 19.6 B/cell，8/12 MiB 默认上限有 10+ 倍余量；硬上限防内存攻击。
* 该常量与下方 Schema 默认值必须保持一致（单点维护在 Schema 默认值，见注释）。
*/
const DEFAULT_TERMINAL_SESSION = {
	enabled: true,
	binPath: void 0,
	maxObservers: 8,
	maxControllers: 4,
	maxProcesses: 32,
	controllerIdleMs: 6e5,
	disconnectGraceMs: 5e3,
	maxDecodedFrameBytes: 8388608,
	maxNdjsonLineBytes: 12582912,
	replayBufferBytes: 8388608
};
/** 合并用户 terminalSession 覆盖与默认值（schema 之外的直连/测试路径也安全）。 */
function resolveTerminalSessionConfig(config) {
	return {
		...DEFAULT_TERMINAL_SESSION,
		...config.terminalSession
	};
}
const Config = Schema.object({
	socketPath: Schema.string(),
	session: Schema.string(),
	timeoutMs: Schema.number().min(1e3).max(6e5).default(3e4),
	allowBackground: Schema.boolean().default(false),
	events: Schema.object({
		enabled: Schema.boolean().default(true),
		maxReconnectMs: Schema.number().min(1e3).max(6e5).default(3e4)
	}),
	reportState: Schema.boolean().default(true),
	projectRoot: Schema.string(),
	terminalSession: Schema.object({
		enabled: Schema.boolean().default(true),
		binPath: Schema.string(),
		maxObservers: Schema.natural().min(0).max(64).default(8),
		maxControllers: Schema.natural().min(0).max(32).default(4),
		maxProcesses: Schema.natural().min(1).max(256).default(32),
		controllerIdleMs: Schema.natural().min(1e3).max(36e5).default(6e5),
		disconnectGraceMs: Schema.natural().min(1e3).max(3e4).default(5e3),
		maxDecodedFrameBytes: Schema.natural().min(1048576).max(33554432).default(8388608),
		maxNdjsonLineBytes: Schema.natural().min(2097152).max(50331648).default(12582912),
		replayBufferBytes: Schema.natural().min(1048576).max(100663296).default(8388608)
	})
});
/**
* 解析顺序：显式配置 > HERDR_SOCKET_PATH > 平台默认路径。
* 返回值始终是 **Herdr 视角的原始端点路径**（CLI 的 HERDR_SOCKET_PATH 与看板展示都用它）：
* - POSIX：~/.config/herdr/herdr.sock；
* - Windows：%APPDATA%\herdr\herdr.sock（Herdr 在 Windows 上把 unix socket 暴露为
*   命名管道，但管道名就是该路径的字面量；CLI 只认原始路径，不认 \\.\pipe\ 前缀）。
*   连接时由 toConnectTarget() 转成 \\.\pipe\<原始路径>。
* 有会话名时指向 sessions/<name>/herdr.sock（两平台一致）。
*/
function resolveSocketPath(config, env = process.env) {
	if (config.socketPath) return config.socketPath;
	if (env.HERDR_SOCKET_PATH) return env.HERDR_SOCKET_PATH;
	const session = resolveSession(config, env);
	const base = herdrEndpointBase(env);
	return session ? join(base, "sessions", session, "herdr.sock") : join(base, "herdr.sock");
}
/**
* Herdr 端点根目录（原始路径形态）。
* Windows：%APPDATA%\herdr —— Herdr 自己的默认目录；POSIX：~/.config/herdr。
* 显式 HERDR_CONFIG_PATH 时按 Herdr 语义推导其所在目录（config 与 socket 同目录）。
*/
function herdrEndpointBase(env = process.env) {
	if (process.platform === "win32") {
		const appData = env.APPDATA || join(homedir(), "AppData", "Roaming");
		return join(appData, "herdr");
	}
	return join(homedir(), ".config", "herdr");
}
/**
* 原始端点路径 → net.createConnection 可用的目标。
* Windows 的命名管道名是 \\.\pipe\ + 完整路径（实测 herdr 0.9.3：管道名即字面路径）；
* 已经是 \\.\pipe\ 前缀时原样返回，POSIX 原样返回（unix domain socket）。
*/
function toConnectTarget(socketPath) {
	if (process.platform !== "win32") return socketPath;
	if (socketPath.startsWith("\\\\")) return socketPath;
	return `\\\\.\\pipe\\${socketPath}`;
}
/** 解析顺序：显式配置 > HERDR_SESSION。 */
function resolveSession(config, env = process.env) {
	return config.session ?? env.HERDR_SESSION ?? void 0;
}
//#endregion
//#region src/host/preset.ts
const HERDR_PRESET_ID = "herdr";
const HERDR_PRESET_NAME_ZH = "Herdr 模式";
const HERDR_PRESET_DESCRIPTION_ZH = "会话绑定 Herdr——本对话视为运行在 Herdr 中的代理，状态实时显示在 Herdr 侧边栏，优先使用 herdr 工具操作工作区、窗格与代理。";
/** Registry presets store one name. English surfaces still replace this text in the DOM. */
const HERDR_PRESET_NAME = HERDR_PRESET_NAME_ZH;
const HERDR_PRESET_DESCRIPTION = HERDR_PRESET_DESCRIPTION_ZH;
const HERDR_PERSONA = `你是运行在 Herdr 模式下的编码 Agent。优先使用 herdr_pane_run、herdr_agent_start、herdr_agent_prompt、herdr_agent_wait、herdr_pane_read 和 herdr_snapshot。不要为每条命令新建 pane，不要创建新的 workspace，也不要使用一次性 agent 执行参数。`;
/** Register the Herdr preset. The registry removes it when this plugin unloads. */
function registerHerdrPreset(ctx, logger) {
	let stop = null;
	ctx.inject(["agentPresets"], (injected) => {
		const registry = injected.agentPresets;
		Promise.resolve(registry.register({
			id: HERDR_PRESET_ID,
			name: HERDR_PRESET_NAME,
			description: HERDR_PRESET_DESCRIPTION,
			plugins: [{
				id: "persona",
				name: "@deepseek-ai/dsh-persona",
				config: { prefix: HERDR_PERSONA }
			}, {
				id: "herdr-session-mode",
				name: "@namewta/dsh-plugin-herdr/session-mode",
				config: {
					paneId: "",
					label: ""
				}
			}]
		})).then((disposer) => {
			stop = disposer;
			logger.info("preset \"%s\" registered", HERDR_PRESET_ID);
		}).catch((error) => {
			logger.warn("preset registration failed: %s", error instanceof Error ? error.message : String(error));
		});
	});
	return () => {
		stop?.();
	};
}
//#endregion
//#region src/host/provider.ts
const name$2 = "dsh-plugin-herdr-provider";
/**
* 提供者插件：注册 ctx.herdr 服务（DESIGN.md §3.2 能力分层）。
*
* cordis 4 的服务解析要求：访问某服务的 fiber 必须显式 inject 该服务
* （fiber.store 只快照 inject 声明的依赖），否则解析链走到根上下文会抛
* "cannot get property X without inject"。因此提供者与消费者必须拆成
* 两个插件：本模块提供服务，index.ts 作为消费者 inject ['tools', 'herdr']。
*
* 全量迁移后传输固定为 socket（CLI 传输已移除）。路径未配置时仍挂载
* ctx.herdr，连接推迟到真正调用（Windows 默认没有 POSIX socket 路径）。
*
* 面板数据由消费者插件的 Typert Remote 暴露；本插件不注册 HTTP 路由。
*/
const UNCONFIGURED_SOCKET_PATH = process.platform === "win32" ? "\\\\.\\pipe\\herdr-unconfigured" : "/tmp/herdr-unconfigured.sock";
async function apply$2(ctx, config) {
	registerHerdrPreset(ctx, createLogger(ctx, "preset"));
	const socketPath = resolveSocketPath(config);
	if (!socketPath) createLogger(ctx, "client").warn("herdr socket path is unset; ctx.herdr is mounted and connects only after config.socketPath or HERDR_SOCKET_PATH is set");
	await ctx.plugin(SocketHerdrClient, {
		socketPath: socketPath ?? UNCONFIGURED_SOCKET_PATH,
		timeoutMs: config.timeoutMs
	});
}
//#endregion
//#region src/host/environment/executable.ts
function isExecutable(path) {
	try {
		accessSync(path, constants.X_OK);
		return statSync(path).isFile();
	} catch {
		return false;
	}
}
/** Do not execute a guessed binary from the current project or relative PATH entries. */
function findOnPath(name, opts = {}) {
	const env = opts.env ?? process.env;
	const executable = opts.executable ?? isExecutable;
	if (isAbsolute(name)) return executable(name) ? name : null;
	if (name.includes("/") || name.includes("\\")) return null;
	const windows = (opts.platform ?? process.platform) === "win32";
	for (const dir of (env.PATH ?? "").split(windows ? ";" : delimiter).filter(isAbsolute)) for (const suffix of windows ? [
		"",
		".exe",
		".cmd"
	] : [""]) {
		const path = join(dir, name + suffix);
		if (executable(path)) return path;
	}
	return null;
}
/** Same resolver for diagnostics, server start and terminal processes. Explicit overrides never fall back. */
function findHerdrExecutable(opts = {}) {
	const env = opts.env ?? process.env;
	const configured = opts.binPath || env.HERDR_BIN_PATH;
	if (configured) return findOnPath(configured, opts);
	const onPath = findOnPath("herdr", opts);
	if (onPath) return onPath;
	const platform = opts.platform ?? process.platform;
	const home = opts.home ?? homedir();
	const executable = opts.executable ?? isExecutable;
	// Herdr 官方安装器（standalone 包）的落点：
	//   Windows  %USERPROFILE%\.herdr\packages\standalone\current\herdr.exe
	//   POSIX    ~/.local/bin/herdr（以及 macOS 的 Homebrew 前缀）
	if (platform === "win32") {
		const candidates = [join(home, ".herdr", "packages", "standalone", "current", "herdr.exe"), join(home, ".local", "bin", "herdr.exe")];
		return candidates.find(executable) ?? null;
	}
	if (platform !== "linux" && platform !== "darwin") return null;
	const candidates = [join(home, ".local", "bin", "herdr")];
	if (platform === "darwin") candidates.push("/opt/homebrew/bin/herdr", "/usr/local/bin/herdr");
	return candidates.find(executable) ?? null;
}
//#endregion
//#region src/core/paths.ts
/** realpath 归一：失败（路径不存在/权限）回退原值，避免符号链接误判。 */
function realpathOrSelf(x) {
	try {
		return fs.realpathSync(x);
	} catch {
		return x;
	}
}
const DEFAULTS = {
	sep: path.sep,
	caseInsensitive: process.platform === "win32",
	realpath: realpathOrSelf
};
/** 前缀边界比较核心：p === root 或 p 以 root + sep 开头（/a/b 不算 /a/bc 的祖先）。 */
function withinCore(root, p, sep) {
	if (root === "") return p === "";
	if (p === root) return true;
	return p.startsWith(root + sep);
}
/** win32 的 path.sep 是反斜杠。夹具和 Herdr 常给 /proj/repo，比较前折成 \\。POSIX 不改写。 */
function foldSep(value, sep) {
	if (sep !== "\\") return value;
	return value.replaceAll("/", "\\");
}
/**
* 判断 p 是否位于 root 项目根内（纯函数，可注入）。
* - p 为 null / undefined / 空串 → false；
* - 相对路径按原值比较（不拼 cwd）→ 与绝对 root 比较近恒为 false（要求绝对路径）；
* - 先 realpath 归一（失败回退原值），再做前缀边界比较，避免符号链接误判。
*/
function isPathWithin(root, p, opts) {
	if (p === null || p === void 0) return false;
	if (p === "") return false;
	const { sep, caseInsensitive, realpath } = {
		...DEFAULTS,
		...opts
	};
	const a = realpath(root);
	const b = realpath(p);
	return withinCore(foldSep(caseInsensitive ? a.toLowerCase() : a, sep), foldSep(caseInsensitive ? b.toLowerCase() : b, sep), sep);
}
/**
* 默认包装：使用 path.sep、win32 大小写不敏感、真实 realpath 归一。
* 供 status.ts 轮询判断 pane cwd / worktree checkout_path 是否在本项目目录内。
*/
function isPathWithinProject(projectRoot, p) {
	return isPathWithin(projectRoot, p);
}
//#endregion
//#region src/host/status.ts
const OUTPUT_CAP = 8e3;
const starting = /* @__PURE__ */ new Map();
/** ping 结果 → HerdrServerInfo（socket/session 由调用方解析配置提供）。 */
function serverInfoFromPing(ping, socketPath, session, status, installation = "unknown") {
	return {
		status,
		running: status === "running",
		version: ping?.version ?? null,
		protocol: ping?.protocol ?? null,
		socket: socketPath,
		session,
		checked_at: Date.now(),
		installation
	};
}
/**
* PATH 中 herdr 二进制可用性探测（v4 需求 2：未安装三态；fs.access 不 spawn
* 子进程）。路径为空/无法判定 → unknown；任一 PATH 目录下可执行 → installed。
*/
async function probeHerdrInstallation(binPath = "herdr", envPath = process.env.PATH) {
	return findHerdrExecutable({
		binPath: binPath === "herdr" ? void 0 : binPath,
		env: {
			...process.env,
			PATH: envPath
		}
	}) ? "installed" : !envPath ? "unknown" : "missing";
}
/**
* 启动 herdr headless server（D1：全插件唯一的 CLI spawn 引导例外——协议无
* server.start，socket 无法启动自身）。spawn `herdr server` 后轮询 socket ping
* 直到可达（或超时）。并发调用共享同一启动过程；已运行时直接返回当前状态。
* spawn 失败（ENOENT 等）立即 reject；超时返回未运行状态（running=false）。
*/
function startHerdrServer(socketPath, opts = {}) {
	const key = JSON.stringify([
		socketPath,
		opts.session ?? null,
		opts.binPath ?? "herdr"
	]);
	const pending = starting.get(key);
	if (pending) return pending;
	const binPath = opts.binPath ?? "herdr";
	const spawnFn = opts.spawnFn ?? ((cmd, args, o) => spawn(cmd, args, o));
	const probe = opts.probe ?? (() => socketPing(socketPath));
	const timeoutMs = opts.timeoutMs ?? 15e3;
	const session = opts.session ?? null;
	const pendingStart = (async () => {
		const before = await probe();
		if (before) return serverInfoFromPing(before, socketPath, session, "running");
		let child;
		try {
			child = spawnFn(binPath, ["server"], {
				detached: true,
				stdio: "ignore",
				env: {
					...process.env,
					HERDR_SOCKET_PATH: socketPath,
					HERDR_SESSION: session ?? ""
				}
			});
		} catch (e) {
			throw new Error(`herdr server spawn failed: ${e instanceof Error ? e.message : String(e)}`);
		}
		child.unref();
		const spawnError = new Promise((_resolve, reject) => {
			child.on("error", (err) => reject(/* @__PURE__ */ new Error(`herdr server spawn failed: ${err.message}`)));
		});
		const deadline = Date.now() + timeoutMs;
		for (;;) {
			await Promise.race([spawnError, new Promise((res) => setTimeout(() => res("tick"), 500))]);
			const info = await probe();
			if (info) return serverInfoFromPing(info, socketPath, session, "running");
			if (Date.now() >= deadline) return serverInfoFromPing(null, socketPath, session, "not_running");
		}
	})().finally(() => {
		starting.delete(key);
	});
	starting.set(key, pendingStart);
	return pendingStart;
}
/** pane_id 自然排序（w8:p2 < w8:p10）：workspace 字典序 + pane 数字序。 */
function comparePaneId(a, b) {
	const [wa, pa] = a.split(":");
	const [wb, pb] = b.split(":");
	if (wa !== wb) return wa < wb ? -1 : 1;
	return (Number((pa ?? "").replace(/\D/g, "")) || 0) - (Number((pb ?? "").replace(/\D/g, "")) || 0);
}
const errMsg = (err) => err instanceof Error ? err.message : String(err);
/**
* 项目目录过滤（design-v2 §7.2，纯函数，可单测）。
* workspace 命中条件（任一）：worktree.checkout_path 在项目内 或 任一 pane 的
* cwd/foreground_cwd 在项目内（isPathWithinProject）；self pane 豁免：包含任一
* 已绑定 pane 的 workspace 无条件保留。命中则整组（tabs/panes）保留。
* 返回过滤后拓扑 + filter 元数据；无项目根（空串）时返回全量且不剔除。
*/
function filterTopology(topology, projectRoot, boundPaneIds) {
	const total = topology.workspaces.length;
	const none = {
		project_root: projectRoot,
		matched: total,
		total,
		hidden_workspaces: []
	};
	if (projectRoot === "") return {
		filtered: topology,
		filterInfo: none
	};
	const bound = new Set(boundPaneIds);
	const wsIdToPanes = /* @__PURE__ */ new Map();
	for (const p of topology.panes) {
		const arr = wsIdToPanes.get(p.workspace_id) ?? [];
		arr.push(p);
		wsIdToPanes.set(p.workspace_id, arr);
	}
	const keep = /* @__PURE__ */ new Set();
	const hidden = [];
	for (const w of topology.workspaces) {
		const panes = wsIdToPanes.get(w.workspace_id) ?? [];
		if (panes.some((p) => bound.has(p.pane_id))) {
			keep.add(w.workspace_id);
			continue;
		}
		if (isPathWithinProject(projectRoot, w.checkout_path) || panes.some((p) => isPathWithinProject(projectRoot, p.cwd) || isPathWithinProject(projectRoot, p.foreground_cwd))) keep.add(w.workspace_id);
		else hidden.push(w.workspace_id);
	}
	return {
		filtered: {
			workspaces: topology.workspaces.filter((w) => keep.has(w.workspace_id)),
			tabs: topology.tabs.filter((t) => keep.has(t.workspace_id)),
			panes: topology.panes.filter((p) => keep.has(p.workspace_id))
		},
		filterInfo: {
			project_root: projectRoot,
			matched: keep.size,
			total,
			hidden_workspaces: hidden
		}
	};
}
/**
* Herdr 状态跟踪器：维护所有检测到的 agent 的状态与最近输出。
* - 状态：消费 forward 转发的 herdr/* 事件 + 轮询 agent.list 兜底；
* - 输出：定期轮询各 agent pane 的 pane.read；
* - 安装检查：启动时探测 herdr CLI（未安装时面板显示安装指引）。
*
* CA-012 轮询纪律：首次立即 tick；单飞（上一轮未完成则跳过本轮）；
* 停止时 abort 在途轮询（结果不再落盘）；快照携带 last_error/stale 诊断。
*/
var HerdrStatusTracker = class {
	ctx;
	client;
	agents = /* @__PURE__ */ new Map();
	timer = null;
	pollIntervalMs;
	dirtyPaneIds = /* @__PURE__ */ new Set();
	dirtyTopology = false;
	topologyDebounceTimer = null;
	heartbeatIntervalMs = 1e4;
	lastHeartbeatAt = 0;
	eventDisposers = [];
	serverInfo = {
		status: "unknown",
		running: false,
		version: null,
		protocol: null,
		socket: null,
		session: null,
		checked_at: 0,
		installation: "unknown"
	};
	fullTopology = {
		workspaces: [],
		tabs: [],
		panes: []
	};
	filteredTopology = {
		workspaces: [],
		tabs: [],
		panes: []
	};
	filterInfo = {
		project_root: "",
		matched: 0,
		total: 0,
		hidden_workspaces: []
	};
	cycle = null;
	abort = null;
	lastError = null;
	lastSuccessAt = 0;
	pollLatencyMs = 0;
	staleThresholdMs;
	rateLimited;
	logger;
	staleLogged = false;
	constructor(ctx, client, opts = {}) {
		this.ctx = ctx;
		this.client = client;
		this.pollIntervalMs = opts.pollIntervalMs ?? 2e3;
		this.staleThresholdMs = opts.staleThresholdMs ?? this.pollIntervalMs * 3;
		this.logger = createLogger(ctx, "status");
		this.rateLimited = createRateLimiter(1e4);
		this.binPath = opts.binPath;
		this.socketPath = opts.socketPath ?? null;
		this.session = opts.session ?? null;
		this.pingFn = opts.pingFn ?? (async () => {
			try {
				const p = await client.ping();
				return {
					version: p.version,
					protocol: p.protocol
				};
			} catch (err) {
				if (err instanceof HerdrError && err.code === "HERDR_UNAVAILABLE") return null;
				throw err;
			}
		});
		this.projectRoot = opts.projectRoot ?? process.cwd();
		this.boundPaneIdsFn = opts.getBoundPaneIds ?? getBoundPaneIds;
		this.filterInfo.project_root = this.projectRoot;
	}
	/** socket 路径（看板 server.socket 展示）。 */
	binPath;
	socketPath;
	/** 会话名（看板 server.session 展示）。 */
	session;
	/** 项目根（过滤基准）。 */
	projectRoot;
	/** self pane 豁免的已绑定 pane_id 来源（可注入）。 */
	boundPaneIdsFn;
	/** ping 探测（默认真实 client.ping 包装）。 */
	pingFn;
	/** 消费 herdr/agent-state 事件（forward.ts 发出）。 */
	onAgentState(info) {
		const prev = this.agents.get(info.pane_id);
		this.agents.set(info.pane_id, {
			pane_id: info.pane_id,
			agent: info.agent,
			status: info.status,
			message: info.message,
			output: prev?.output ?? "",
			updated_at: Date.now()
		});
	}
	/** 消费 herdr/resource-changed 事件：pane 关闭时移除对应块。 */
	onResourceChanged(change) {
		if (change.type === "pane" && change.action === "closed") this.agents.delete(change.id);
	}
	markTopologyDirty() {
		this.dirtyTopology = true;
		if (this.topologyDebounceTimer) clearTimeout(this.topologyDebounceTimer);
		this.topologyDebounceTimer = setTimeout(() => {
			this.topologyDebounceTimer = null;
			if (this.abort && !this.abort.signal.aborted) this.pollTopology(this.abort.signal);
		}, 200);
	}
	onHerdrEvent(event) {
		const data = event.data ?? {};
		const type = typeof data.type === "string" ? data.type : event.event ?? "";
		if (type === "pane_output_changed") {
			const paneId = String(data.pane_id ?? "");
			if (paneId) this.dirtyPaneIds.add(paneId);
			return;
		}
		if (type === "pane_agent_status_changed" || type === "pane_agent_detected") {
			const paneId = String(data.pane_id ?? "");
			const agent = String(data.agent ?? "unknown");
			const status = String(data.agent_status ?? data.status ?? "unknown");
			const message = data.message != null ? String(data.message) : void 0;
			if (paneId) {
				this.onAgentState({
					pane_id: paneId,
					agent,
					status,
					message
				});
				this.lastSuccessAt = Date.now();
			}
			return;
		}
		if ((/* @__PURE__ */ new Set([
			"workspace_created",
			"workspace_updated",
			"workspace_metadata_updated",
			"workspace_renamed",
			"workspace_moved",
			"workspace_reordered",
			"workspace_closed",
			"workspace_focused",
			"tab_created",
			"tab_closed",
			"tab_renamed",
			"tab_moved",
			"tab_focused",
			"pane_created",
			"pane_closed",
			"pane_updated",
			"pane_focused",
			"pane_moved",
			"pane_exited",
			"layout_updated"
		])).has(type)) this.markTopologyDirty();
	}
	/** 后台轮询：server 状态 + 拓扑 + agent 列表（兜底）+ 各 pane 输出。 */
	start() {
		if (this.timer) return;
		this.abort = new AbortController();
		const signal = this.abort.signal;
		const tick = () => this.runCycle(signal);
		try {
			const offA = this.ctx.on("herdr/agent-state", (info) => {
				this.onAgentState(info);
				this.lastSuccessAt = Date.now();
			});
			const offR = this.ctx.on("herdr/resource-changed", (change) => {
				this.onResourceChanged(change);
				if (change.type === "workspace" || change.type === "tab" || change.type === "pane") this.markTopologyDirty();
			});
			let offRaw = null;
			try {
				const c = this.ctx.herdr;
				if (typeof c.onEvent === "function") offRaw = c.onEvent((raw) => {
					const ev = raw;
					if (ev && typeof ev.data?.type === "string") this.onHerdrEvent(ev);
				});
			} catch {}
			this.eventDisposers.push(offA, offR);
			if (offRaw) this.eventDisposers.push(offRaw);
		} catch {}
		tick();
		this.timer = setInterval(tick, this.pollIntervalMs);
	}
	/** CA-012：停止轮询并取消在途请求（结果不再落盘）。幂等。 */
	stop() {
		if (this.timer) {
			clearInterval(this.timer);
			this.timer = null;
		}
		if (this.topologyDebounceTimer) {
			clearTimeout(this.topologyDebounceTimer);
			this.topologyDebounceTimer = null;
		}
		for (const d of this.eventDisposers) try {
			d();
		} catch {}
		this.eventDisposers.length = 0;
		this.abort?.abort();
		this.abort = null;
	}
	/**
	* CA-012：单飞轮询周期——上一轮未完成则跳过本轮（慢请求不再跨 tick 重叠）；
	* 四类轮询在同一周期内并行（并发上限 = 4），周期级串行。Phase1增量：仅拉脏 pane/拓扑，10s 心跳全量 reconciling。
	*/
	runCycle(signal) {
		if (this.cycle) return;
		const t0 = Date.now();
		this.cycle = (async () => {
			const errorBefore = this.lastError;
			const now = Date.now();
			const isHeartbeat = now - this.lastHeartbeatAt > this.heartbeatIntervalMs || now - this.lastSuccessAt > this.heartbeatIntervalMs;
			if (isHeartbeat) this.lastHeartbeatAt = now;
			const needTopology = this.dirtyTopology || isHeartbeat;
			const needAgents = isHeartbeat;
			const dirtyIds = isHeartbeat ? void 0 : this.dirtyPaneIds.size > 0 ? new Set(this.dirtyPaneIds) : void 0;
			const needOutputs = isHeartbeat || dirtyIds !== void 0 && dirtyIds.size > 0;
			try {
				await Promise.all([
					this.pollServer(signal),
					needTopology ? this.pollTopology(signal) : Promise.resolve(),
					needAgents ? this.pollAgents(signal) : Promise.resolve(),
					needOutputs ? this.pollOutputs(signal, dirtyIds) : Promise.resolve()
				]);
				if (!isHeartbeat && dirtyIds) this.dirtyPaneIds.clear();
				else if (isHeartbeat) this.dirtyPaneIds.clear();
				if (needTopology) this.dirtyTopology = false;
				if (!signal.aborted && this.lastError === errorBefore) {
					this.lastError = null;
					this.lastSuccessAt = Date.now();
					this.staleLogged = false;
				} else if (!signal.aborted) {
					if (!this.staleLogged && this.lastSuccessAt > 0 && Date.now() - this.lastSuccessAt > this.staleThresholdMs) {
						this.staleLogged = true;
						this.logger.warn("status snapshot stale (last clean refresh %dms ago): %s", Date.now() - this.lastSuccessAt, this.lastError ?? "");
					}
				}
			} finally {
				this.pollLatencyMs = Date.now() - t0;
				this.cycle = null;
			}
		})();
	}
	getDiagnostics() {
		return {
			pollLatencyMs: this.pollLatencyMs,
			dirtyPaneIdsSize: this.dirtyPaneIds.size,
			dirtyTopology: this.dirtyTopology,
			lastHeartbeatAt: this.lastHeartbeatAt
		};
	}
	/**
	* 看板数据快照。
	* @param scope 'project'（默认）返回按项目目录过滤后的 topology；'all' 返回全量。
	*              两种 scope 都附带 filter 元数据（matched/total 以全量为口径）。
	*/
	snapshot(scope = "project") {
		const agents = [...this.agents.values()].sort((a, b) => comparePaneId(a.pane_id, b.pane_id));
		const stale = this.lastSuccessAt === 0 || Date.now() - this.lastSuccessAt > this.staleThresholdMs;
		return {
			agents,
			updated_at: Date.now(),
			connected: this.serverInfo.running,
			server: this.serverInfo,
			topology: scope === "all" ? this.fullTopology : this.filteredTopology,
			last_error: this.lastError,
			stale,
			filter: this.filterInfo,
			poll_latency_ms: this.pollLatencyMs
		};
	}
	/** 轮询 herdr headless server 状态（看板数据源；socket ping 派生）。 */
	async pollServer(signal) {
		try {
			const ping = await this.pingFn();
			if (signal.aborted) return;
			const installation = await probeHerdrInstallation(this.binPath);
			this.serverInfo = serverInfoFromPing(ping, this.socketPath, this.session, ping ? "running" : "not_running", installation);
		} catch (err) {
			if (!signal.aborted) {
				this.serverInfo = {
					status: "unknown",
					running: false,
					version: null,
					protocol: null,
					socket: this.socketPath,
					session: this.session,
					checked_at: Date.now(),
					installation: "unknown"
				};
				this.lastError = `server probe failed: ${errMsg(err)}`;
				this.rateLimited("poll-server", () => this.logger.warn("server probe failed: %s", errMsg(err)));
			}
		}
	}
	/** 轮询 snapshot 提取 workspace/tab/pane 拓扑（失败记录 last_error，下轮重试）。 */
	async pollTopology(signal) {
		try {
			const snap = await this.client.snapshot();
			if (signal.aborted) return;
			const full = {
				workspaces: snap.workspaces.map((w) => {
					const wt = w.worktree;
					return {
						workspace_id: w.workspace_id ?? "",
						label: w.label,
						active_tab_id: w.active_tab_id,
						checkout_path: wt?.checkout_path
					};
				}),
				tabs: snap.tabs.map((t) => ({
					tab_id: t.tab_id ?? "",
					workspace_id: t.workspace_id ?? "",
					label: t.label,
					active_pane_id: t.active_pane_id,
					pane_count: t.pane_count
				})),
				panes: snap.panes.map((p) => {
					const src = p;
					return {
						pane_id: src.pane_id ?? "",
						workspace_id: src.workspace_id ?? "",
						tab_id: src.tab_id,
						title: src.title ?? src.terminal_title,
						terminal_title_stripped: src.terminal_title_stripped,
						display_agent: src.display_agent,
						label: src.label,
						cwd: src.cwd,
						foreground_cwd: src.foreground_cwd,
						focused: src.focused === true,
						agent_status: src.agent_status
					};
				})
			};
			const { filtered, filterInfo } = filterTopology(full, this.projectRoot, this.boundPaneIdsFn());
			this.fullTopology = full;
			this.filteredTopology = filtered;
			this.filterInfo = filterInfo;
		} catch (err) {
			if (!signal.aborted) {
				this.lastError = `topology poll failed: ${errMsg(err)}`;
				this.rateLimited("poll-topology", () => this.logger.warn("topology poll failed: %s", errMsg(err)));
			}
		}
	}
	/** 轮询 agent.list 更新状态（事件接入是加速路径，轮询是兜底）。 */
	async pollAgents(signal) {
		try {
			const agents = await this.client.listAgents();
			if (signal.aborted) return;
			const seen = /* @__PURE__ */ new Set();
			for (const a of agents) {
				if (!a.pane_id) continue;
				seen.add(a.pane_id);
				const prev = this.agents.get(a.pane_id);
				const status = a.status ?? "unknown";
				const raw = a;
				this.agents.set(a.pane_id, {
					pane_id: a.pane_id,
					workspace_id: a.workspace_id,
					agent: a.agent ?? "unknown",
					name: raw.name ?? void 0,
					kind: raw.kind ?? raw.agent ?? void 0,
					status,
					message: a.message ?? void 0,
					output: prev?.output ?? "",
					updated_at: prev && prev.status === status ? prev.updated_at : Date.now()
				});
			}
			for (const key of [...this.agents.keys()]) if (!seen.has(key)) this.agents.delete(key);
		} catch (err) {
			if (!signal.aborted) {
				this.lastError = `agent poll failed: ${errMsg(err)}`;
				this.rateLimited("poll-agents", () => this.logger.warn("agent poll failed: %s", errMsg(err)));
			}
		}
	}
	async pollOutputs(signal, paneIds) {
		if (paneIds && paneIds.size === 0) return;
		const entries = paneIds ? [...this.agents.entries()].filter(([id]) => paneIds.has(id)) : [...this.agents.entries()];
		entries.sort((a, b) => {
			const pa = a[1].status === "working" ? 0 : 1;
			const pb = b[1].status === "working" ? 0 : 1;
			if (pa !== pb) return pa - pb;
			return comparePaneId(a[0], b[0]);
		});
		const CONCURRENCY = 4;
		let idx = 0;
		const worker = async () => {
			while (idx < entries.length) {
				if (signal.aborted) return;
				const [paneId, agent] = entries[idx++];
				try {
					const { text, truncated } = await this.client.paneRead({
						pane_id: paneId,
						source: "recent_unwrapped",
						lines: 300,
						format: "ansi"
					});
					if (signal.aborted) return;
					if (text !== agent.output) {
						agent.output = truncateAnsiTail(text, OUTPUT_CAP);
						agent.outputTruncated = truncated || text.length > 8e3;
						agent.updated_at = Date.now();
					}
				} catch (err) {
					if (!signal.aborted) {
						this.lastError = `pane read failed (${paneId}): ${errMsg(err)}`;
						this.rateLimited("poll-outputs", () => this.logger.warn("pane read failed (%s): %s", paneId, errMsg(err)));
					}
				}
			}
		};
		await Promise.all(Array.from({ length: Math.min(CONCURRENCY, entries.length) }, () => worker()));
	}
};
//#endregion
//#region src/host/dashboard.ts
/** host 元数据采集（测试可注入）。 */
function collectHostInfo() {
	return {
		hostname: hostname(),
		platform: platform(),
		arch: arch(),
		os_type: type(),
		os_release: release(),
		node_version: process.version
	};
}
/** pgrep 输出（每行一个 pid）→ PID 数组（空/无匹配 → []；非数字行忽略）。 */
function parsePgrepOutput(stdout) {
	return stdout.trim().split(/\s+/).map(Number).filter((n) => Number.isInteger(n) && n > 0);
}
function parsePsOutput(stdout) {
	const m = stdout.trim().match(/^(\d+)\s+([\d.]+)\s+(\d+)\s+(.+)$/);
	if (!m) return null;
	const [, pidRaw, cpuRaw, rssRaw, lstart] = m;
	const psPid = Number(pidRaw);
	const cpuPercent = Number.parseFloat(cpuRaw);
	const rss = Number.parseInt(rssRaw, 10);
	if (!Number.isInteger(psPid) || Number.isNaN(cpuPercent) || Number.isNaN(rss)) return null;
	return {
		ps_pid: psPid,
		cpu_percent: cpuPercent,
		rss,
		lstart
	};
}
/** 进程不可用样本（available=false；error 说明原因，不伪造数值）。 */
function unavailableProcess(sampledAt, error, extra = {}) {
	return {
		available: false,
		pid: null,
		started_at: null,
		cpu_percent: null,
		rss_bytes: null,
		source: process.platform === "win32" ? "win32-tasklist" : "posix-pgrep-ps",
		sampled_at: sampledAt,
		error,
		...extra
	};
}
/**
* tasklist /FO CSV 输出 → [{ image, pid, rss_bytes }]。
* 行形如 `"herdr.exe","4242","Console","1","23,340 K"`；末列单位可能是 K（KB）或裸数字（旧系统 KB）。
* 解析不了的行直接跳过，不猜。
*/
function parseTasklistOutput(stdout) {
	const rows = [];
	for (const line of String(stdout).split(/\r?\n/)) {
		const m = line.match(/^\s*"([^"]+)"\s*,\s*"(\d+)"\s*,\s*"[^"]*"\s*,\s*"[^"]*"\s*,\s*"([\d.,\s]+)\s*([KM]?)"/i);
		if (!m) continue;
		const [, image, pidRaw, memRaw, unit] = m;
		const pid = Number(pidRaw);
		if (!Number.isInteger(pid) || pid <= 0) continue;
		const value = Number.parseFloat(memRaw.replace(/[,\s]/g, ""));
		if (Number.isNaN(value)) continue;
		const upper = unit.toUpperCase();
		rows.push({
			image,
			pid,
			rss_bytes: Math.round(upper === "M" ? value * 1024 * 1024 : upper === "K" ? value * 1024 : value * 1024)
		});
	}
	return rows;
}
/**
* Windows best-effort 进程探测：tasklist 按映像名定位 herdr.exe（含 herdr server 同进程），
* 取第一个实例的 PID 与 RSS。
* - CPU% 与启动时间在 tasklist 里不可得 → 诚实置 null（不伪造 0）；
* - 多实例取第一个（best-effort，与 POSIX 分支同一策略）；
* - 无匹配 → unavailable（未运行）；
* - 超时（1.5s）或中止 → unavailable。
*/
async function probeHerdrProcessWin32(sampledAt, signal) {
	const out = await execFileText("tasklist", [
		"/FI",
		"IMAGENAME eq herdr.exe",
		"/FO",
		"CSV",
		"/NH"
	], 1500, signal);
	if (out === null) return unavailableProcess(sampledAt, "process probe failed (tasklist unavailable or timed out)");
	const rows = parseTasklistOutput(out);
	if (rows.length === 0) return unavailableProcess(sampledAt, "herdr server process not found (is the server running?)");
	const first = rows[0];
	return {
		available: true,
		pid: first.pid,
		started_at: null,
		cpu_percent: null,
		rss_bytes: first.rss_bytes,
		source: "win32-tasklist",
		sampled_at: sampledAt,
		error: null
	};
}
/**
* execFile 文本封装：成功 → stdout；失败 → null。
* pgrep 退出码 1 = 无匹配（正常结果，返回 ''）；killed（超时/中止）与其它错误 → null。
*/
function execFileText(cmd, args, timeoutMs, signal) {
	return new Promise((resolve) => {
		execFile(cmd, [...args], {
			timeout: timeoutMs,
			windowsHide: true,
			signal
		}, (err, stdout) => {
			if (!err) {
				resolve(String(stdout));
				return;
			}
			const e = err;
			if (typeof e.code === "number" && e.code === 1) {
				resolve("");
				return;
			}
			resolve(null);
		});
	});
}
/**
* POSIX best-effort 进程探测：pgrep 定位 herdr server PID（优先 argv 精确 'herdr server'，
* 回退进程名 'herdr'；多实例取第一个，best-effort），ps 采样 CPU/RSS/启动时间。
* - 平台非 darwin/linux → unavailable（不支持，不猜测）；
* - pgrep 无匹配 → unavailable（未运行或进程名不匹配）；
* - RSS 单位：darwin/linux 的 ps -o rss= 均为 KB（实测：macOS bash ≈2016KB、herdr ≈5792KB），
*   统一 ×1024 归一为字节；
* - 任一项解析失败 → 该项 null（UI 显示 Unavailable），不伪造 0/猜测值；
* - 超时（1.5s）或中止 → unavailable，且调用方在 abort 时丢弃结果。
*/
async function probeHerdrProcess(signal) {
	const sampledAt = Date.now();
	if (process.platform === "win32") return probeHerdrProcessWin32(sampledAt, signal);
	if (process.platform !== "darwin" && process.platform !== "linux") return unavailableProcess(sampledAt, `process probing unsupported on platform ${process.platform}`);
	let pid = null;
	for (const args of [["-f", "herdr server"], ["-x", "herdr"]]) {
		const out = await execFileText("pgrep", [...args], 1500, signal);
		if (out === null) return unavailableProcess(sampledAt, "process probe failed (pgrep unavailable or timed out)");
		const pids = parsePgrepOutput(out);
		if (pids.length > 0) {
			pid = pids[0];
			break;
		}
	}
	if (pid === null) return unavailableProcess(sampledAt, "herdr server process not found (is the server running?)");
	const out = await execFileText("ps", [
		"-p",
		String(pid),
		"-o",
		"pid=,%cpu=,rss=,lstart="
	], 1500, signal);
	if (out === null) return unavailableProcess(sampledAt, "process probe failed (ps timed out or unavailable)", { pid });
	const parsed = parsePsOutput(out);
	if (!parsed) return unavailableProcess(sampledAt, `ps output unparseable for pid ${pid}`, { pid });
	if (parsed.ps_pid !== pid) return unavailableProcess(sampledAt, "ps returned a different pid than pgrep", { pid });
	const startedAt = Date.parse(parsed.lstart);
	return {
		available: true,
		pid,
		started_at: Number.isNaN(startedAt) ? null : startedAt,
		cpu_percent: parsed.cpu_percent,
		rss_bytes: Number.isNaN(parsed.rss) ? null : parsed.rss * 1024,
		source: "posix-pgrep-ps",
		sampled_at: sampledAt,
		error: null
	};
}
/** 未完成任何周期时的空 DTO（host 恒可用；其余 unavailable/空，结构完整）。 */
function emptyDashboardSnapshot(host) {
	return {
		updated_at: 0,
		stale: true,
		last_error: null,
		server: {
			status: "unknown",
			running: false,
			version: null,
			protocol: null,
			socket: null,
			session: null,
			checked_at: 0,
			installation: "unknown"
		},
		connection: {
			connected: false,
			last_success_at: 0,
			collectors: {
				server: false,
				topology: false,
				agents: false,
				host: true,
				process: false
			}
		},
		host,
		process: unavailableProcess(0, "no process sample yet"),
		summary: {
			workspaces: 0,
			tabs: 0,
			panes: 0,
			agents: 0,
			agents_by_status: {}
		},
		workspaces: []
	};
}
/**
* Dashboard 采集器：复用 status tracker 的单飞快照 + 自身 host/进程采集，装配 DTO。
* CA-012 纪律与 status tracker 一致：首次立即 tick；单飞（上一轮未完成跳过）；
* 停止时 abort 在途探测（结果不落盘）；失败不覆盖最后一份有效 DTO 拓扑。
*/
var HerdrDashboardTracker = class {
	ctx;
	opts;
	timer = null;
	cycle = null;
	abort = null;
	lastDto = null;
	/** 观察到的最近一次干净刷新（status 源 stale=false）；0 = 从未。 */
	lastSuccessAt = 0;
	/** 最近一次进程探测错误（成功周期清空）。 */
	probeError = null;
	/** 进程探测节流状态（≥probeIntervalMs 才重新 spawn ps/pgrep；期间复用上次样本）。 */
	lastProbeAt = 0;
	lastProbeSample = null;
	host;
	pollIntervalMs;
	staleThresholdMs;
	probeIntervalMs;
	probeFn;
	rateLimited;
	logger;
	constructor(ctx, opts) {
		this.ctx = ctx;
		this.opts = opts;
		this.pollIntervalMs = opts.pollIntervalMs ?? 2e3;
		this.staleThresholdMs = opts.staleThresholdMs ?? this.pollIntervalMs * 3;
		this.probeIntervalMs = opts.probeIntervalMs ?? 15e3;
		this.host = (opts.collectHost ?? collectHostInfo)();
		this.probeFn = opts.probeProcess ?? probeHerdrProcess;
		this.logger = createLogger(ctx, "dashboard");
		this.rateLimited = createRateLimiter(1e4);
	}
	/** 当前 DTO（未完成任何周期时返回结构完整的空 DTO）。 */
	snapshot() {
		return this.lastDto ?? emptyDashboardSnapshot(this.host);
	}
	/** 启动轮询：首次立即 tick（不等第一个 interval）。 */
	start() {
		if (this.timer) return;
		this.abort = new AbortController();
		const signal = this.abort.signal;
		const tick = () => void this.runCycle(signal);
		tick();
		this.timer = setInterval(tick, this.pollIntervalMs);
	}
	/** 停止轮询并中止在途探测（结果不落盘）。幂等。 */
	stop() {
		if (this.timer) {
			clearInterval(this.timer);
			this.timer = null;
		}
		this.abort?.abort();
		this.abort = null;
	}
	/** 单飞周期：进程探测（节流）与状态读取并行（探测有独立超时，不阻塞拓扑刷新）。 */
	runCycle(signal) {
		if (this.cycle) return;
		this.cycle = (async () => {
			try {
				const probePromise = this.probeThrottled(signal);
				const status = this.opts.readStatus();
				const sample = await probePromise;
				if (signal.aborted) return;
				this.probeError = sample.error;
				if (!status.stale) this.lastSuccessAt = Date.now();
				this.lastDto = this.assemble(status, sample);
			} catch (err) {
				if (!signal.aborted) {
					this.probeError = `dashboard cycle failed: ${errText(err)}`;
					this.rateLimited("dash-cycle", () => this.logger.warn("dashboard cycle failed: %s", errText(err)));
				}
			} finally {
				this.cycle = null;
			}
		})();
	}
	/**
	* P1-3：进程探测节流——距上次探测 < probeIntervalMs（默认 15s）时复用上次样本，
	* 不 spawn ps/pgrep（避免 4s 客户端轮询每次触发子进程）；abort 时不写缓存。
	*/
	async probeThrottled(signal) {
		if (this.lastProbeSample !== null && !shouldProbeNow(this.lastProbeAt, Date.now(), this.probeIntervalMs)) return this.lastProbeSample;
		const sample = await this.probeFn(signal);
		if (!signal.aborted) {
			this.lastProbeAt = Date.now();
			this.lastProbeSample = sample;
		}
		return sample;
	}
	/** DTO 装配：聚合纯函数 + 脱敏（socket/checkout_path 只留 basename）+ self 判定。 */
	assemble(status, process) {
		const workspaces = aggregateDashboardWorkspaces(status.topology, status.agents);
		const summary = buildDashboardSummary(workspaces, status.agents);
		return {
			updated_at: this.lastSuccessAt,
			stale: deriveStale(this.lastSuccessAt, Date.now(), this.staleThresholdMs),
			last_error: status.last_error ?? this.probeError,
			server: {
				status: status.server.status,
				running: status.server.running,
				version: status.server.version,
				protocol: status.server.protocol,
				socket: pathBase(status.server.socket),
				session: status.server.session,
				checked_at: status.server.checked_at,
				installation: status.server.installation
			},
			connection: {
				connected: status.connected,
				last_success_at: this.lastSuccessAt,
				collectors: {
					server: status.server.status !== "unknown",
					topology: this.lastSuccessAt > 0,
					agents: this.lastSuccessAt > 0,
					host: true,
					process: process.available
				}
			},
			host: this.host,
			process,
			summary,
			workspaces
		};
	}
};
//#endregion
//#region src/host/herdr-skill.ts
const HERDR_SKILL_MD = "---\nname: herdr\ndescription: \"Control Herdr, a terminal multiplexer for coding agents. Use only when the user explicitly mentions Herdr or asks to use Herdr to inspect or control panes, tabs, workspaces, commands, or another agent. Do not use merely because a task could benefit from a background terminal, delegation, or parallel work. Requires HERDR_ENV=1.\"\n---\n\n# Herdr\n\nHerdr organizes terminals into workspaces, tabs, and panes, recognizes coding agents running inside panes, and exposes the current session through the `herdr` CLI.\n\nBefore issuing any control command, verify that this agent is running inside a Herdr-managed pane.\n\nPOSIX shell (Linux, macOS, WSL):\n\n```bash\ntest \"${HERDR_ENV:-}\" = 1\n```\n\nPowerShell (native Windows):\n\n```powershell\n$env:HERDR_ENV -eq \"1\"\n```\n\nIf the check fails, say that you are not running inside Herdr and stop. Do not inspect or control the focused Herdr session from outside Herdr.\n\nWhen the check passes, the `herdr` binary in `PATH` talks to the current session. Use it to inspect neighboring work, create terminal layout, start agents and commands, read output, and wait for state changes.\n\n## Learn the current CLI\n\nThe installed binary is the authority for command syntax. Start with:\n\n```bash\nherdr --help\n```\n\nThen print the relevant command group by running the group without a subcommand:\n\n```bash\nherdr agent\nherdr pane\nherdr workspace\nherdr tab\nherdr worktree\nherdr terminal\nherdr notification\nherdr integration\nherdr session\nherdr machine\n```\n\nDo not run bare `herdr` for discovery; it launches or attaches the TUI. Do not probe a mutating nested command by omitting arguments. Commands such as `herdr workspace create` are valid with defaults and will execute.\n\nMost control commands return JSON. Read identifiers and state from those responses instead of predicting them.\n\n## Shell syntax on Windows\n\nExamples below are written for a POSIX shell. Panes on native Windows run cmd.exe or PowerShell instead, so translate before pasting:\n\n- Environment variables are `$env:HERDR_PANE_ID` in PowerShell and `%HERDR_PANE_ID%` in cmd.exe, not `$HERDR_PANE_ID`.\n- `$PWD` and `$HOME` also resolve in PowerShell, but not in cmd.exe; use `%CD%` and `%USERPROFILE%` there.\n- `test`, `export`, `printf`, and backslash line continuations do not exist. Use `Test-Path`/comparison operators, `$env:NAME = \"value\"`, and `Write-Output`.\n- `herdr` itself behaves the same; only the surrounding shell differs. `herdr pane run` and `herdr agent prompt` submit the Enter key themselves, so they work unchanged on every platform.\n\n## Understand layout, panes, and agents\n\nChoose the primitive that matches the job:\n\n- Workspace, tab, and pane topology organize terminal locations.\n- Pane commands control raw terminals, shells, tests, servers, input, and output.\n- Agent commands control the recognized coding agent currently occupying a pane.\n\nA pane exists whether or not it contains an agent. `agent start` requires an existing available shell pane and never creates, splits, or moves layout. Use pane commands for ordinary processes. Use agent commands when Herdr must validate agent identity or interpret `idle`, `working`, `blocked`, `done`, and `unknown` lifecycle states.\n\nAgent commands accept either a unique live agent name or the pane ID currently hosting that agent. They do not accept terminal IDs or bare agent-kind labels. Names must match `[a-z][a-z0-9_-]{0,31}` and be unique among live agents. A name follows the current pane occupant and is cleared when that agent exits, is released, or is replaced.\n\n`idle` and `done` both mean the agent is ready for input. The CLI/API uses the server's seen state to distinguish them; explicit focus commands mark the target seen, while reads do not. Each TUI client tracks viewed completions independently, so its Done badge can differ from the CLI or another client's badge. `blocked` means Herdr recognized an approval or question UI. `unknown` means an agent is present but Herdr cannot classify it confidently; it does not prove completion.\n\n## Use IDs and caller context\n\nPublic IDs are opaque stable handles:\n\n- workspace: `w1`\n- tab: `w1:t1`\n- pane: `w1:p1`\n\nClosed tab and pane IDs are not reused. A pane moved into another workspace receives a new workspace-qualified pane ID. After `pane move`, continue with `.result.move_result.pane.pane_id` or the live agent name. The old value is reported as `.result.move_result.previous_pane_id`; only the moved process's inherited caller context keeps resolving that old ID, so do not use it as a general agent target.\n\nHerdr injects the caller's context into each managed pane.\n\nPOSIX shell:\n\n```bash\nprintf '%s\\n' \"$HERDR_WORKSPACE_ID\" \"$HERDR_TAB_ID\" \"$HERDR_PANE_ID\"\n```\n\nPowerShell:\n\n```powershell\n\"$env:HERDR_WORKSPACE_ID`n$env:HERDR_TAB_ID`n$env:HERDR_PANE_ID\"\n```\n\ncmd.exe:\n\n```bat\necho %HERDR_WORKSPACE_ID%\necho %HERDR_TAB_ID%\necho %HERDR_PANE_ID%\n```\n\nPrefer `--current` when a pane command should target the calling pane. Omitting a target may use the UI-focused pane, which can belong to the user or another client.\n\nDiscover live state with:\n\n```bash\nherdr workspace list\nherdr tab list --workspace \"$HERDR_WORKSPACE_ID\"\nherdr pane current --current\nherdr pane list --workspace \"$HERDR_WORKSPACE_ID\"\nherdr agent list\n```\n\nCreation responses expose the IDs to use next. `workspace create` returns `.result.workspace`, `.result.tab`, and `.result.root_pane`. `tab create` returns `.result.tab` and `.result.root_pane`. `pane split` returns the new pane as `.result.pane`.\n\nIDs and live agent names are scoped to one server. Two saved SSH machines can both have `w1:p1` or an agent named `reviewer`. Selecting a machine in the TUI does not retarget commands running in your pane: they still use the inherited session and socket context. Run remote control commands on the intended host with its explicit session, and rediscover IDs there.\n\n`herdr machine list` lists saved connection profiles, not a cross-machine pane inventory; add `--json` for scripts. Only add, remove, enable, or disable profiles when the user asks. Removing a profile disconnects the client but does not stop remote sessions. Adding a machine uses the remote default session unless `--remote-session` is explicitly supplied. Setup asks before stopping an incompatible server and defaults to No; do not approve replacement without the user's consent. Experimental handoff is not part of `machine add`.\n\n## Start and coordinate an agent\n\nDefault to a sibling pane in the current tab and the current working directory. Do not create a workspace, tab, worktree, or different cwd unless the user explicitly requests that topology or location.\n\nHonor a direction requested by the user. Otherwise inspect the caller pane:\n\n```bash\nherdr pane layout --pane \"$HERDR_PANE_ID\"\n```\n\nSplit a wide pane to the right and a narrow or tall pane down. Avoid repeated same-direction splits that create unusably narrow columns or short rows. Keep the user's focus in the calling pane and explicitly preserve the caller's working directory:\n\n```bash\nherdr pane split --current --direction right --cwd \"$PWD\" --no-focus\n```\n\nReplace `right` with `down` when appropriate. Read the new pane ID from `.result.pane.pane_id`.\n\nAn available shell pane must be at its interactive prompt, with the shell itself in the foreground and no foreground command, editor, or agent running. Start a supported agent in that pane with a useful unique name:\n\n```bash\nherdr agent start reviewer --kind codex --pane <returned-pane-id>\n```\n\nUse the kind requested by the user. Run `herdr agent` to inspect the installed kind list and options. Pass native agent arguments only after `--`:\n\n```bash\nherdr agent start reviewer --kind codex --pane <returned-pane-id> -- <agent-args...>\n```\n\nA successful `agent start` returns only after Herdr detects the expected agent in the same pane and considers it ready for interactive input. If the agent is blocked during startup, the command returns `agent_not_ready` immediately but keeps the name available for `agent read` and `agent send-keys`. Wait until the agent becomes idle before prompting it. Startup defaults to a 30-second timeout.\n\nSubmit work through the agent surface:\n\n```bash\nherdr agent prompt reviewer \"Review the current diff and report only actionable findings.\" --wait --timeout 120000\n```\n\n`agent prompt` honors the pane's live bracketed-paste mode and sends text followed by encoded Enter as one ordered submission. It reports successful submission only after both have been written; that alone does not prove the agent started a turn. The submit delay grows with prompt size for Codex on Windows. It rejects an agent already waiting at an approval or question dialog with `agent_blocked` before sending any input. Inspect the blocked UI and ask the user before answering it. For normal agent work, `--wait` is enough: it waits for the first settled `idle`, `done`, or `blocked` state. Do not repeat those defaults with `--until`.\n\nWith `--wait`, a prompt sent from a non-working state must produce observed `working` or `blocked` activity. After submission, Herdr waits up to five seconds for that activity; unrelated `idle`, `done`, or session changes do not satisfy this gate. It returns `agent_prompt_stalled` if no activity is observed, or `timeout` if the caller's timeout expires first. The caller timeout includes submission time. Without a timeout, the settled-state wait is indefinite after activity is observed. This wait tracks lifecycle state, not an individual turn; if the agent is already working, completion of the active turn may satisfy it.\n\nUse `--until` only for a state-specific workflow, such as waiting for an already-running agent to request input:\n\n```bash\nherdr agent wait reviewer --until blocked --timeout 120000\n```\n\nWithout `--until`, standalone `agent wait` uses the same settled-state defaults as `agent prompt --wait`.\n\nUse logical keys for interactive agent UI controls:\n\n```bash\nherdr agent send-keys reviewer esc\nherdr agent send-keys reviewer ctrl+c\n```\n\nHerdr validates all keys before writing any bytes. Read the result through the resolved agent:\n\n```bash\nherdr agent get reviewer\nherdr agent read reviewer --source recent-unwrapped --lines 120\n```\n\nIf a wait fails or returns `blocked`, inspect `agent get` and `agent read` before deciding what input to send. A timeout or stalled response does not prove the prompt was never delivered; do not blindly submit it again. Use the pane surface only when raw terminal control is intentional.\n\n## Run an ordinary command in another pane\n\nCreate a sibling pane with the same geometry rule, preserve the caller's working directory, and keep user focus unchanged:\n\n```bash\nherdr pane split --current --direction right --cwd \"$PWD\" --no-focus\n```\n\nRead the new pane ID from `.result.pane.pane_id`, then run and inspect the command:\n\n```bash\nherdr pane run <returned-pane-id> \"just test\"\nherdr pane wait-output <returned-pane-id> --match \"test result\" --timeout 120000\nherdr pane read <returned-pane-id> --source recent-unwrapped --lines 120\n```\n\n`pane run` atomically sends command text and Enter. `pane wait-output` searches the selected snapshot immediately, so output that already exists can match. Use `--match <text>` for a literal substring or `--regex <pattern>` for a Rust regular expression. Omitting `--timeout` allows an indefinite wait.\n\nUse the read source that matches the task:\n\n- `visible`: the currently rendered viewport.\n- `recent`: recent rendered output, including soft wraps.\n- `recent-unwrapped`: recent output with soft wraps joined; prefer it for logs and transcripts.\n- `detection`: the plain-text bottom-buffer snapshot used for agent detection.\n\nUse `--format ansi` when colors and terminal styling are evidence. Otherwise use text.\n\n`--lines` asks Herdr for more rows from the pane's available screen and host scrollback. If increasing it does not reveal more of a completed response, the pane is probably running the agent on the terminal's alternate screen. Rows that leave the alternate screen do not enter Herdr's host scrollback, so a larger line count cannot recover them.\n\nAfter that failed read, ask the agent to write its complete response as Markdown in a temporary directory and reply only with the file path, then read the file directly. Use this only as a fallback; do not request file output in the initial prompt.\n\n## Safety and coordination rules\n\n- Use `--no-focus` for background work unless the user asked to switch context.\n- Use `--current`, an explicit pane ID, or a unique agent name. Do not rely on another client's focused pane.\n- Parse IDs from JSON responses. Do not derive them from sidebar order or examples.\n- Do not close workspaces, tabs, panes, or sessions you did not create unless the user explicitly asked. `workspace close --group` closes the primary workspace and its linked worktree workspaces; never add it merely to bypass `workspace_group_close_required`.\n- Use `--trust-repository` only after the user has verified the repository. It grants per-request Git trust; it is not a routine retry for a failed worktree command.\n- Client and server versions can differ after an update. Check `herdr status` before relying on new server features. A missing method is not permission to stop or upgrade a server.\n- Never run `herdr server stop` from an active session unless the user explicitly intends to stop the server and its pane processes.\n- Never kill the main Herdr process. Use named test sessions for experiments that need an isolated server.\n- CLI server errors are JSON on stderr with exit status 1. CLI syntax errors exit with status 2.\n";
//#endregion
//#region src/host/skill.ts
/** 从 SKILL.md frontmatter 提取描述（runtime skill 注册需要）。 */
function skillDescription(md) {
	const m = md.match(/^---\n([\s\S]*?)\n---/);
	if (!m) return "Control Herdr, a terminal multiplexer for coding agents.";
	return (m[1].match(/^description:\s*["']?([^"\n']+)["']?/m)?.[1] ?? "Control Herdr, a terminal multiplexer for coding agents.").trim();
}
/**
* 注册 Herdr skill 到会话 skill 目录（DESIGN.md §19）。
* 启用插件即给当前及后续会话加载官方 SKILL.md（v0.8.0 内嵌快照）。
* 通过 ctx.inject(['skills']) 等待 registry；headless 无 skills 服务时跳过。
* register() 会补 provider，但 skills.get() 仍要求 source 为字符串，故保留 source: 'runtime'。
*/
function registerHerdrSkill(ctx) {
	let off = null;
	ctx.inject(["skills"], (injected) => {
		off = injected.skills.register({
			name: "herdr",
			description: skillDescription(HERDR_SKILL_MD),
			content: HERDR_SKILL_MD,
			source: "runtime"
		});
		createLogger(ctx, "skill").info("skill \"herdr\" registered (v0.8.0 SKILL.md embedded)");
	});
	return () => {
		off?.();
	};
}
//#endregion
//#region src/host/events/forward.ts
/**
* CA-008：重连指数退避（有 cap + jitter），纯函数便于测试。
* 首次 ~cap/8，之后每次翻倍，封顶 cap；0.5x–1x jitter 防惊群。
*/
function computeBackoffDelayMs(attempt, capMs, rand = Math.random) {
	const base = Math.max(200, Math.floor(capMs / 8));
	const exp = Math.min(capMs, base * 2 ** Math.max(0, attempt));
	return Math.floor(exp * (.5 + rand() * .5));
}
/** 全局订阅事件（只需 type；pane.agent_status_changed 需要 pane_id，动态构建）。 */
const GLOBAL_SUBSCRIPTIONS = [
	"workspace.created",
	"workspace.updated",
	"workspace.renamed",
	"workspace.closed",
	"tab.created",
	"tab.focused",
	"tab.renamed",
	"tab.closed",
	"pane.created",
	"pane.updated",
	"pane.closed",
	"pane.moved",
	"pane.agent_detected",
	"layout.updated"
];
/** 动态订阅列表：全局事件 + 当前所有 pane 的 agent 状态订阅（agent_status_changed 需 pane_id）。 */
async function buildSubscriptions(client) {
	const subs = GLOBAL_SUBSCRIPTIONS.map((type) => ({ type }));
	try {
		const snap = await client.snapshot();
		for (const p of snap.panes) if (p.pane_id) subs.push({
			type: "pane.agent_status_changed",
			pane_id: p.pane_id
		});
	} catch {}
	return subs;
}
const RESOURCE_EVENTS_BY_TYPE = {
	"workspace_created": {
		type: "workspace",
		action: "created"
	},
	"workspace_updated": {
		type: "workspace",
		action: "updated"
	},
	"workspace_metadata_updated": {
		type: "workspace",
		action: "updated"
	},
	"workspace_renamed": {
		type: "workspace",
		action: "updated"
	},
	"workspace_closed": {
		type: "workspace",
		action: "closed"
	},
	"workspace_focused": {
		type: "workspace",
		action: "updated"
	},
	"tab_created": {
		type: "tab",
		action: "created"
	},
	"tab_closed": {
		type: "tab",
		action: "closed"
	},
	"tab_renamed": {
		type: "tab",
		action: "updated"
	},
	"tab_moved": {
		type: "tab",
		action: "updated"
	},
	"tab_focused": {
		type: "tab",
		action: "updated"
	},
	"pane_created": {
		type: "pane",
		action: "created"
	},
	"pane_closed": {
		type: "pane",
		action: "closed"
	},
	"pane_updated": {
		type: "pane",
		action: "updated"
	},
	"pane_focused": {
		type: "pane",
		action: "updated"
	},
	"pane_moved": {
		type: "pane",
		action: "updated"
	},
	"pane_exited": {
		type: "pane",
		action: "updated"
	},
	"pane_output_changed": {
		type: "pane",
		action: "updated"
	},
	"layout_updated": {
		type: "pane",
		action: "updated"
	}
};
/** 从订阅事件 data 提取资源 id（pane_id / tab_id / workspace_id，含嵌套对象兜底）。 */
function eventResourceId(data) {
	const d = data;
	const s = (v) => typeof v === "string" ? v : "";
	return s(d.pane_id) || s(d.pane?.pane_id) || s(d.tab_id) || s(d.tab?.tab_id) || s(d.workspace_id) || s(d.workspace?.workspace_id) || "";
}
/**
* Herdr → DSH 事件转发（DESIGN.md §10.1）。
* 全量迁移后唯一路径：socket 长连接订阅（CLI 轮询兜底已随 CLI 传输移除）。
* 返回清理函数（插件卸载或测试结束调用；插件内同时注册为 effect）。
*/
function setupEventForwarding(ctx, opts) {
	if (!opts.enabled) {
		createLogger(ctx, "forward").debug("event forwarding disabled by config (tracker dirty path remains active)");
		return () => {};
	}
	return setupSocketForwarding(ctx, ctx.herdr, opts);
}
function setupSocketForwarding(ctx, client, opts) {
	const logger = createLogger(ctx, "forward");
	const rateLimited = createRateLimiter(5e3);
	let subscribed = false;
	let timer;
	let attempt = 0;
	let disposed = false;
	let subscribedPaneIds = /* @__PURE__ */ new Set();
	let resubscribedPanes = /* @__PURE__ */ new Set();
	const dispatch = (raw) => {
		const env = raw;
		const data = env.data ?? {};
		const type = typeof data.type === "string" ? data.type : env.event;
		if (type === "pane.agent_status_changed" || type === "pane.agent_detected") {
			const info = {
				pane_id: String(data.pane_id ?? ""),
				agent: String(data.agent ?? ""),
				status: String(data.agent_status ?? data.final_status ?? "unknown")
			};
			if (data.message != null) info.message = String(data.message);
			ctx.emit("herdr/agent-state", info);
			return;
		}
		const mapped = RESOURCE_EVENTS_BY_TYPE[type];
		if (mapped) {
			ctx.emit("herdr/resource-changed", {
				...mapped,
				id: eventResourceId(data)
			});
			if (type === "pane_created") {
				const id = eventResourceId(data);
				if (id && !subscribedPaneIds.has(id) && !resubscribedPanes.has(id)) {
					resubscribedPanes.add(id);
					scheduleResubscribe();
				}
			}
		}
	};
	let resubTimer;
	const scheduleResubscribe = () => {
		if (resubTimer) clearTimeout(resubTimer);
		resubTimer = setTimeout(() => {
			resubTimer = void 0;
			if (subscribed && !disposed) {
				subscribed = false;
				trySubscribe();
			}
		}, 300);
	};
	const trySubscribe = async () => {
		if (subscribed || disposed) return;
		ctx.emit("herdr/channel", "reconnecting");
		try {
			const subscriptions = await buildSubscriptions(client);
			await client.subscribe(subscriptions);
			subscribed = true;
			subscribedPaneIds = new Set(subscriptions.filter((s) => s.type === "pane.agent_status_changed").map((s) => s.pane_id ?? ""));
			attempt = 0;
			ctx.emit("herdr/channel", "connected");
			logger.debug("event subscription connected (pane subscriptions: %d)", subscribedPaneIds.size);
		} catch (err) {
			if (disposed) return;
			ctx.emit("herdr/channel", "disconnected");
			rateLimited("subscribe", () => logger.warn("event subscription failed (attempt %d): %s", attempt, errText(err)));
			scheduleRetry();
		}
	};
	const scheduleRetry = () => {
		if (timer) clearTimeout(timer);
		const delay = computeBackoffDelayMs(attempt, opts.maxReconnectMs);
		attempt++;
		timer = setTimeout(() => {
			timer = void 0;
			trySubscribe();
		}, delay);
	};
	const disposers = [];
	disposers.push(client.onEvent(dispatch));
	disposers.push(ctx.effect(() => {
		trySubscribe();
		return () => {
			if (timer) clearTimeout(timer);
			subscribed = false;
		};
	}));
	disposers.push(ctx.effect(() => {
		const check = setInterval(() => {
			if (subscribed && !client.connected) {
				subscribed = false;
				scheduleRetry();
			}
		}, Math.max(1e3, opts.maxReconnectMs / 2));
		return () => clearInterval(check);
	}));
	return () => {
		if (disposed) return;
		disposed = true;
		if (resubTimer) clearTimeout(resubTimer);
		if (timer) clearTimeout(timer);
		for (const d of disposers) d();
		subscribedPaneIds = /* @__PURE__ */ new Set();
		resubscribedPanes = /* @__PURE__ */ new Set();
		client.close();
	};
}
//#endregion
//#region src/host/events/state-report.ts
/** 元数据刷新周期 = ttl / 2（保证 ttl 过期前至少重报一次）。 */
const refreshInterval = (ttlMs) => Math.max(50, Math.floor(ttlMs / 2));
function setupStateReporting(ctx, opts) {
	if (!opts.reportState) return () => {};
	const env = process.env;
	const herdrEnv = env.HERDR_ENV === "1";
	const paneId = env.HERDR_PANE_ID;
	if (!herdrEnv || !paneId) {
		createLogger(ctx, "report").info("state reporting disabled: HERDR_ENV=%s HERDR_PANE_ID=%s (start dsh inside a Herdr pane to enable)", env.HERDR_ENV ?? "(unset)", paneId ?? "(unset)");
		return () => {};
	}
	const ttlMs = opts.metadataTtlMs ?? 3e4;
	const agent = "dsh";
	const logger = createLogger(ctx, "report");
	const rateLimited = createRateLimiter(1e4);
	const report = (state, message) => {
		ctx.herdr.reportAgent({
			pane_id: paneId,
			source: opts.source,
			agent,
			state,
			message
		}).catch((err) => {
			rateLimited("report-agent", () => logger.warn("report_agent failed: %s", errText(err)));
		});
	};
	let lastModel;
	const buildMetadata = () => ({
		pane_id: paneId,
		source: opts.source,
		agent,
		title: "dsh agent",
		...lastModel ? { tokens: { model: lastModel } } : {},
		ttl_ms: ttlMs
	});
	const reportMetadata = () => {
		ctx.herdr.reportMetadata(buildMetadata()).catch((err) => {
			rateLimited("report-metadata", () => logger.warn("report_metadata failed: %s", errText(err)));
		});
	};
	const disposers = [];
	disposers.push(ctx.on("agent/request", async (payload, next) => {
		const model = payload.agent.options?.model;
		if (model) lastModel = model;
		report("working", "model request in progress");
		reportMetadata();
		return next();
	}));
	disposers.push(ctx.on("tools/pre-execute", async (_exec, next) => {
		const decision = await next();
		if (decision?.kind === "ask") report("blocked", `awaiting approval: ${decision.reason ?? "tool call"}`);
		else if (decision?.kind === "allow") report("working", "tool approved");
		return decision;
	}));
	disposers.push(ctx.on("agent/turn-stopping", () => report("idle", "turn finished")));
	report("idle", "dsh agent ready");
	reportMetadata();
	const refreshTimer = setInterval(() => reportMetadata(), refreshInterval(ttlMs));
	let cleaned = false;
	const cleanup = () => {
		if (cleaned) return;
		cleaned = true;
		clearInterval(refreshTimer);
		for (const d of disposers) d();
		ctx.herdr.clearAgentAuthority({
			pane_id: paneId,
			source: opts.source,
			agent
		}).catch(() => {});
	};
	return cleanup;
}
//#endregion
//#region src/host/events/index.ts
/**
* Host 侧事件装配：tracker 订阅 herdr/* 事件与原始 socket 事件（脏集路径恒活跃，
* 不受 events.enabled 影响），并按配置开启事件转发与 agent 状态上报。
* 返回统一的释放函数。
*/
function setupHerdrEvents(ctx, config, tracker) {
	const offAgentState = ctx.on("herdr/agent-state", (info) => tracker.onAgentState(info));
	const offResourceChanged = ctx.on("herdr/resource-changed", (change) => tracker.onResourceChanged(change));
	const herdrRawSub = ctx.herdr?.onEvent;
	let offRaw = null;
	if (typeof herdrRawSub === "function") try {
		offRaw = herdrRawSub((e) => {
			try {
				tracker.onHerdrEvent(e);
			} catch {}
		});
	} catch {}
	const stopForwarding = setupEventForwarding(ctx, {
		enabled: config.events.enabled,
		maxReconnectMs: config.events.maxReconnectMs
	});
	const stopReporting = setupStateReporting(ctx, {
		reportState: config.reportState,
		source: "dsh:herdr-plugin"
	});
	return () => {
		offRaw?.();
		offAgentState();
		offResourceChanged();
		stopForwarding();
		stopReporting();
	};
}
//#endregion
//#region src/host/terminal-session/process.ts
/**
* TerminalSession CLI 子进程封装（design: pane-terminal-session-state-machine §6.2）。
*
* - binPath 解析顺序：config.terminalSession.binPath → 可信 HERDR_BIN_PATH → PATH 的 herdr；
* - socket 连接走 resolveSocketPath() 最终结果，写入子进程 HERDR_SOCKET_PATH；
*   HERDR_SESSION 仅作辅助上下文；paneId 作为 argv 传递，禁止拼 shell；
* - 子进程 env 使用 allowlist，避免无关敏感环境变量泄漏。
*/
/**
* allowlist 环境：仅注入运行/连接所需的最小集合。
* POSIX 集合之外，Windows 子进程缺少 SYSTEMROOT / COMSPEC / PATHEXT / USERPROFILE /
* APPDATA / TEMP / windir 会直接起不来（CRT 与 .exe 解析都依赖它们），因此按平台追加。
*/
const ENV_ALLOWLIST = [
	"PATH",
	"HOME",
	"TMPDIR",
	"LANG",
	"LC_ALL",
	"TERM"
];
/** Windows 专有必需项（大小写不敏感；实际取进程 env 里的大小写）。 */
const ENV_ALLOWLIST_WIN32 = [
	"SYSTEMROOT",
	"SYSTEMDRIVE",
	"windir",
	"COMSPEC",
	"PATHEXT",
	"USERPROFILE",
	"APPDATA",
	"LOCALAPPDATA",
	"ProgramData",
	"TEMP",
	"TMP",
	"USERNAME",
	"USERDOMAIN",
	"HOMEDRIVE",
	"HOMEPATH",
	"PROCESSOR_ARCHITECTURE",
	"NUMBER_OF_PROCESSORS"
];
/** 当前平台生效的 allowlist（Windows 合并两组；POSIX 保持原集合不变）。 */
function envAllowlistFor(platform = process.platform) {
	return platform === "win32" ? [
		...ENV_ALLOWLIST,
		...ENV_ALLOWLIST_WIN32
	] : ENV_ALLOWLIST;
}
/** 解析 herdr 二进制（config > HERDR_BIN_PATH > PATH）。 */
function resolveHerdrBin(opts) {
	const env = opts.env ?? process.env;
	if (opts.binPath) return opts.binPath;
	if (env.HERDR_BIN_PATH) return env.HERDR_BIN_PATH;
	return findHerdrExecutable({ env }) ?? "herdr";
}
/** 从插件 Config 解析出终端会话对应的 socket/session，供 spawn 使用。 */
function resolveSessionConnection(config) {
	return {
		socketPath: resolveSocketPath(config),
		session: typeof config.session === "string" ? config.session : resolveSession(config)
	};
}
/** 构造最小安全 env（allowlist 合并 + 明确写入 socket/session）。 */
function buildEnv(env, socketPath, session) {
	const allowed = {};
	const src = env ?? process.env;
	const keys = envAllowlistFor();
	// Windows 的进程环境变量名大小写不敏感，但实际存储的大小写不可预测
	// （常见 SystemRoot / windir / ComSpec），因此按小写建索引回查真实键名。
	const lookup = process.platform === "win32" ? new Map(Object.keys(src).map((k) => [k.toLowerCase(), k])) : null;
	for (const key of keys) {
		const actual = lookup ? lookup.get(key.toLowerCase()) : key;
		const v = actual === void 0 ? void 0 : src[actual];
		if (v !== void 0) allowed[actual] = v;
	}
	allowed.HERDR_SOCKET_PATH = socketPath;
	if (session) allowed.HERDR_SESSION = session;
	return allowed;
}
/** spawn 一个 `herdr terminal session <mode> <paneId> ...` 子进程。 */
function spawnTerminalSession(binPath, req, socketPath, session, env) {
	const args = [
		"terminal",
		"session",
		req.mode,
		req.paneId,
		"--cols",
		String(req.cols),
		"--rows",
		String(req.rows)
	];
	if (req.mode === "control" && req.takeover) args.push("--takeover");
	return spawn(binPath, args, {
		env: buildEnv(env, socketPath, session),
		stdio: [
			"pipe",
			"pipe",
			"pipe"
		],
		windowsHide: true
	});
}
//#endregion
//#region src/host/terminal-session/capability.ts
/**
* terminal session 能力探测（design: pane-terminal-session-state-machine §8.1）。
*
* 只做无副作用探测（`herdr terminal session --help`）并缓存；不得为探测启动真实
* terminal session。最低版本门槛（0.8.0）不能代替探测——发行版裁剪/回移时以帮助
* 输出中是否包含 observe/control 为准。
*/
function runHelp(bin, opts, extra) {
	return new Promise((resolveDone) => {
		const { spawn } = __require("node:child_process");
		let out = "";
		let settled = false;
		const child = spawn(bin, extra, {
			env: opts.env ?? process.env,
			stdio: [
				"ignore",
				"pipe",
				"pipe"
			],
			windowsHide: true
		});
		const finish = (v) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			child.kill();
			resolveDone(v);
		};
		child.stdout.setEncoding("utf8");
		child.stdout.on("data", (c) => {
			out += c.slice(0, 4096);
		});
		child.stderr.resume();
		child.on("error", () => finish(null));
		child.on("exit", (code) => finish(code === 0 ? out : null));
		const timer = setTimeout(() => finish(null), opts.timeoutMs ?? 5e3);
	});
}
/**
* 探测并返回能力。结果应缓存（见 manager 或插件级缓存），生命周期内调用一次。
* Windows 不再早退：herdr 0.9.3 的 `terminal session` 在 win32 上同样提供
* observe/control，能力由 --help 的实际输出判定（与 POSIX 同一套判据）。
*/
async function probeTerminalSession(opts = {}) {
	const bin = resolveHerdrBin(opts);
	if (!bin) return {
		available: false,
		observe: false,
		control: false,
		reason: "cli_missing"
	};
	const help = await runHelp(bin, opts, [
		"terminal",
		"session",
		"--help"
	]);
	if (help === null) return {
		available: false,
		observe: false,
		control: false,
		reason: "probe_failed"
	};
	const observe = /\bobserve\b/.test(help);
	const control = /\bcontrol\b/.test(help);
	if (!observe && !control) return {
		available: false,
		observe,
		control,
		reason: "command_missing"
	};
	return {
		available: true,
		observe,
		control
	};
}
//#endregion
//#region src/host/terminal-session/errors.ts
var TerminalSessionError = class extends Error {
	code;
	retryable;
	constructor(code, message, opts = {}) {
		super(message);
		this.name = "TerminalSessionError";
		this.code = code;
		this.retryable = opts.retryable ?? false;
	}
};
function isTerminalSessionError(e) {
	return e instanceof TerminalSessionError;
}
/** 构造 protocol_error；默认不可重试（属于需重建 stream 的协议级失败）。 */
function protocolError(message) {
	return new TerminalSessionError("terminal_session_protocol_error", message);
}
//#endregion
//#region src/host/terminal-session/protocol.ts
/**
* Herdr terminal session NDJSON 协议（design: pane-terminal-session-state-machine §3.1/§6.3）。
*
* - stdout 逐行 JSON；首帧 `full=true` 为基线，后续 `full=false` 是相对上一帧的 ANSI diff；
* - `seq` 在当前 stream 内单调递增，跨进程/重连不可比较；
* - `bytes` 是 Base64 编码的 ANSI bytes，解码后写入 xterm；
* - `terminal.closed` 表示子进程/会话关闭（release 或异常）。
*
* 本模块为纯逻辑：分片/粘包解析 + frame 校验，均可 Node 单测（§11.1）。
*/
/**
* 增量 NDJSON 行解析器：处理任意 chunk 边界、空行、超长行。
* 以 `\n` 字节切行，行内 Buffer 整体转 UTF-8（避免跨 chunk 切断多字节字符）。
*/
var NDJSONParser = class {
	maxLineBytes;
	buf = Buffer.alloc(0);
	overflow = false;
	constructor(maxLineBytes) {
		this.maxLineBytes = maxLineBytes;
	}
	/** 喂入一段 stdout 字节，返回完整行（不含换行）。超长行被跳过并置 overflow。 */
	push(chunk) {
		this.buf = Buffer.concat([this.buf, chunk]);
		const lines = [];
		let start = 0;
		for (let i = 0; i < this.buf.length; i++) {
			if (this.buf[i] !== 10) continue;
			const line = this.buf.subarray(start, i);
			if (line.length > this.maxLineBytes) this.overflow = true;
			else {
				const s = line.toString("utf8");
				if (s.trim().length > 0) lines.push(s);
			}
			start = i + 1;
		}
		this.buf = this.buf.subarray(start);
		if (this.buf.length > this.maxLineBytes) {
			this.overflow = true;
			this.buf = this.buf.subarray(this.buf.length - this.maxLineBytes);
		}
		return lines;
	}
	/** 是否出现过超长行（overflow；调用方应关闭 stream 重建）。 */
	exceeded() {
		return this.overflow;
	}
};
/** 解析单行 JSON 为 TerminalFrame；形状/类型/Base64/大小任一非法抛 protocol_error。 */
function parseFrame(raw, limits) {
	if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw protocolError("frame 不是对象");
	const f = raw;
	if (f.type !== "terminal.frame") throw protocolError(`意外的事件类型: ${String(f.type)}`);
	const seq = f.seq;
	const width = f.width;
	const height = f.height;
	const full = f.full;
	const bytesB64 = f.bytes;
	if (typeof seq !== "number" || !Number.isSafeInteger(seq) || seq < 0) throw protocolError("frame seq 非法");
	if (typeof width !== "number" || !Number.isFinite(width) || width < 1) throw protocolError("frame width 非法");
	if (typeof height !== "number" || !Number.isFinite(height) || height < 1) throw protocolError("frame height 非法");
	if (typeof full !== "boolean") throw protocolError("frame full 非法");
	if (typeof bytesB64 !== "string" || bytesB64.length === 0) throw protocolError("frame bytes 缺失");
	let bytes;
	try {
		bytes = Buffer.from(bytesB64, "base64");
		if (bytes.toString("base64") !== bytesB64) throw new Error("non-canonical base64");
	} catch {
		throw protocolError("frame bytes 非法 base64");
	}
	if (bytes.length > limits.maxDecodedFrameBytes) throw new TerminalSessionError("terminal_session_protocol_error", `frame 超限: ${bytes.length} > ${limits.maxDecodedFrameBytes}`);
	return {
		seq,
		width,
		height,
		full,
		bytes
	};
}
/** 判断一条 stdout JSON 是否为 terminal.closed（会话/子进程关闭）。 */
function isClosedEvent(raw) {
	return typeof raw === "object" && raw !== null && raw.type === "terminal.closed";
}
//#endregion
//#region src/host/terminal-session/manager.ts
/** 重建前等待旧 child 退出释放 ownership/resize lock 的有界超时（ms）。 */
const REBUILD_WAIT_MS = 1e3;
/** 等待 child 退出（已退出立即返回；超时兜底），不悬挂。 */
function waitChildExit(child, timeoutMs) {
	return new Promise((resolveDone) => {
		if (child.exitCode !== null) {
			resolveDone();
			return;
		}
		let settled = false;
		const done = () => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			child.off("exit", onExit);
			resolveDone();
		};
		const onExit = () => done();
		child.once("exit", onExit);
		const timer = setTimeout(done, timeoutMs);
		timer.unref?.();
	});
}
var TerminalSessionManager = class {
	sessions = /* @__PURE__ */ new Map();
	deps;
	maxDecoded;
	maxLine;
	replayCap;
	controllers = /* @__PURE__ */ new Set();
	globalListeners = /* @__PURE__ */ new Set();
	constructor(deps) {
		this.deps = deps;
		this.maxDecoded = deps.config.maxDecodedFrameBytes;
		this.maxLine = deps.config.maxNdjsonLineBytes;
		this.replayCap = deps.config.replayBufferBytes;
	}
	/** 当前活跃进程数（限额/诊断用）。 */
	get processCount() {
		let n = 0;
		for (const s of this.sessions.values()) if (s.state !== "closed") n++;
		return n;
	}
	/** 当前活跃 observer 数（maxObservers 限额用）。 */
	observerCount() {
		let n = 0;
		for (const s of this.sessions.values()) if (s.mode === "observe" && s.state !== "closed") n++;
		return n;
	}
	/** 诊断/指标数据源。 */
	report() {
		const cfg = this.deps.config;
		const sessions = [];
		for (const s of this.sessions.values()) {
			if (s.state === "closed") continue;
			sessions.push({
				sessionId: s.sessionId,
				paneId: s.paneId,
				mode: s.mode,
				generation: s.generation,
				lastSeq: s.lastSeq,
				replayBytes: s.replayBytes
			});
		}
		return {
			activeProcesses: this.processCount,
			observers: this.observerCount(),
			controllers: this.controllers.size,
			limits: {
				maxObservers: cfg.maxObservers,
				maxControllers: cfg.maxControllers,
				maxProcesses: cfg.maxProcesses
			},
			sessions
		};
	}
	/** 创建并启动一个 terminal session，返回 sessionId + generation。 */
	start(req) {
		const cfg = this.deps.config;
		if (req.mode === "control") {
			if (this.controllers.size >= cfg.maxControllers) throw new TerminalSessionError("terminal_session_unavailable", "达到全局 controller 上限");
			for (const s of this.sessions.values()) if (s.mode === "control" && s.paneId === req.pane_id && s.state !== "closed") throw new TerminalSessionError("terminal_session_forbidden", "该 pane 已有 controller");
			this.controllers.add(req.pane_id);
		} else {
			if (this.observerCount() >= cfg.maxObservers) throw new TerminalSessionError("terminal_session_unavailable", "达到全局 observer 上限");
			if (this.processCount >= cfg.maxProcesses) throw new TerminalSessionError("terminal_session_unavailable", "达到全局进程数上限");
		}
		const sessionId = (this.deps.randomId ?? this.randomId)();
		const session = {
			sessionId,
			paneId: req.pane_id,
			mode: req.mode,
			cols: req.cols,
			rows: req.rows,
			takeover: req.takeover ?? false,
			generation: 1,
			lastSeq: 0,
			fullArmed: false,
			state: "starting",
			parser: new NDJSONParser(this.maxLine),
			subscribers: /* @__PURE__ */ new Set(),
			readyBySub: /* @__PURE__ */ new Map(),
			replay: [],
			replayBytes: 0,
			conflictReported: false
		};
		this.sessions.set(sessionId, session);
		this.spawnChild(session);
		return {
			sessionId,
			generation: session.generation
		};
	}
	/** 释放会话：写 release（controller）、正常回收子进程。 */
	release(sessionId, reason) {
		const s = this.sessions.get(sessionId);
		if (!s || s.state === "closed") return Promise.resolve();
		if (s.state !== "closing") {
			s.state = "closing";
			this.emit(s, {
				type: "closed",
				sessionId,
				reason
			});
		}
		return this.reap(s, { sendRelease: s.mode === "control" });
	}
	/** 释放所有会话并终止子进程（插件 dispose）。 */
	dispose() {
		for (const s of [...this.sessions.values()]) this.reap(s, { sendRelease: s.mode === "control" });
		this.sessions.clear();
		this.controllers.clear();
	}
	/** 注册全局帧监听器（/herdr-events 单流转发），返回退订函数。 */
	addGlobalListener(cb) {
		this.globalListeners.add(cb);
		return () => {
			this.globalListeners.delete(cb);
		};
	}
	/** 全局客户端（/herdr-events 单流）接入：取消所有会话挂起的断开宽限回收。 */
	onGlobalClientConnect() {
		for (const s of this.sessions.values()) if (s.graceTimer) {
			clearTimeout(s.graceTimer);
			s.graceTimer = void 0;
		}
	}
	/** 最后一个全局客户端断开：所有 live 会话进入断开宽限期（web 端不再持有
	*  per-session SSE，浏览器关页不会逐会话通知，必须由单流断开统一兜底回收）。 */
	onGlobalClientDisconnect() {
		for (const s of [...this.sessions.values()]) this.onClientDisconnect(s.sessionId);
	}
	/** 当前 live 会话清单（/herdr-events 新连接回放基线用）。 */
	liveSessions() {
		const out = [];
		for (const s of this.sessions.values()) if (s.state === "live" && s.fullArmed) out.push({
			sessionId: s.sessionId,
			paneId: s.paneId,
			mode: s.mode,
			generation: s.generation
		});
		return out;
	}
	/** 最新 full 帧（generation 内基线），供 /herdr-events 新连接补齐重连缺口。 */
	replayLatestFull(sessionId) {
		const s = this.sessions.get(sessionId);
		if (!s || s.state !== "live" || !s.fullArmed) return null;
		for (let i = s.replay.length - 1; i >= 0; i--) if (s.replay[i].event.full) return s.replay[i].event;
		return null;
	}
	/** 订阅 session 事件流，返回退订函数。v1 以单订阅方为主。 */
	subscribe(sessionId, cursor, cb) {
		const s = this.sessions.get(sessionId);
		if (!s || s.state === "closed") {
			queueMicrotask(() => cb({
				type: "error",
				sessionId,
				code: "terminal_session_not_found",
				message: "session 不存在",
				retryable: false
			}));
			return () => {};
		}
		s.subscribers.add(cb);
		if (s.graceTimer) {
			clearTimeout(s.graceTimer);
			s.graceTimer = void 0;
		}
		this.scheduleIdleReset(s);
		this.handleAttach(s, cb, cursor);
		return () => {
			s.subscribers.delete(cb);
			s.readyBySub.delete(cb);
		};
	}
	/** 订阅方写回 backpressure：阻塞则暂停 child stdout，解除后恢复。 */
	setBlocked(sessionId, blocked) {
		const s = this.sessions.get(sessionId);
		if (!s) return;
		const out = s.child?.stdout;
		if (!out || blocked === out.isPaused()) return;
		if (blocked) out.pause();
		else out.resume();
	}
	/** 写 stdin 命令；resize 允许 observe/control，input/scroll 仅 control。 */
	writeCommand(sessionId, payload) {
		const s = this.sessions.get(sessionId);
		if (!s || s.state === "closed") throw new TerminalSessionError("terminal_session_not_found", "session 不存在");
		const isResize = payload.includes("\"terminal.resize\"");
		if (s.mode !== "control" && !isResize) throw new TerminalSessionError("terminal_session_forbidden", "controller-only 命令");
		const input = s.child?.stdin;
		if (!input || !input.writable || s.child.exitCode !== null) throw new TerminalSessionError("terminal_session_process_exited", "controller 子进程已退出");
		input.write(payload + "\n");
		this.touch(s);
	}
	/** 浏览器连接断开：observer 与 controller 都保留一段宽限期，供浏览器重连在这个窗口内续传。 */
	onClientDisconnect(sessionId) {
		const s = this.sessions.get(sessionId);
		if (!s || s.state !== "live") return;
		const grace = this.deps.config.disconnectGraceMs;
		if (grace > 0) {
			s.graceTimer = setTimeout(() => {
				this.release(sessionId, "disconnect grace");
			}, grace);
			s.graceTimer.unref?.();
		} else this.release(sessionId, "client disconnected");
	}
	randomId() {
		const buf = /* @__PURE__ */ new Uint8Array(16);
		randomFillSync(buf);
		return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
	}
	spawnChild(s) {
		const bin = this.deps.binPath ?? resolveHerdrBin({ env: this.deps.env });
		if (!bin) {
			this.failClosed(s, new TerminalSessionError("terminal_session_unavailable", "无法定位 herdr 二进制"));
			return;
		}
		const child = (this.deps.spawnChild ?? spawnTerminalSession)(bin, {
			mode: s.mode,
			paneId: s.paneId,
			cols: s.cols,
			rows: s.rows,
			takeover: s.takeover
		}, this.deps.socketPath, this.deps.session, this.deps.env);
		s.child = child;
		s.state = "live";
		child.stdout.on("data", (chunk) => this.onStdout(s, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
		let stderrTail = "";
		child.stderr.on("data", (chunk) => {
			const c = chunk.toString("utf8");
			stderrTail = (stderrTail + c).slice(-8192);
			this.maybeDetectConflict(s, stderrTail);
		});
		child.on("exit", (code, signal) => {
			if (s.child !== child) return;
			if (s.state === "live") this.failClosed(s, new TerminalSessionError("terminal_session_process_exited", `子进程退出: ${code ?? signal ?? "?"}`, { retryable: true }));
			else this.sessions.delete(s.sessionId);
		});
	}
	/** 重建：generation++ 并重启 child，等待新的 full 基线。 */
	async rebuild(s, reason) {
		if (!this.sessionAlive(s)) return;
		s.generation += 1;
		s.lastSeq = 0;
		s.fullArmed = false;
		s.replay = [];
		s.replayBytes = 0;
		s.parser = new NDJSONParser(this.maxLine);
		for (const sub of s.subscribers) s.readyBySub.set(sub, false);
		const old = s.child;
		let oldWaited = Promise.resolve();
		if (old) {
			old.removeAllListeners("exit");
			old.stdout?.removeAllListeners("data");
			old.stderr?.removeAllListeners("data");
			old.stdout?.pause();
			oldWaited = waitChildExit(old, REBUILD_WAIT_MS);
			old.kill();
		}
		this.emit(s, {
			type: "error",
			sessionId: s.sessionId,
			code: "terminal_session_frame_gap",
			message: reason,
			retryable: true
		});
		await oldWaited;
		if (!this.sessionAlive(s)) return;
		this.spawnChild(s);
	}
	/** 会话是否仍存活（重建/回收 await 期间 s.state 可能被修改，用方法绕过 TS 收窄）。 */
	sessionAlive(s) {
		return s.state !== "closed" && s.state !== "closing";
	}
	onStdout(s, chunk) {
		if (s.state === "closed" || s.state === "closing") return;
		const lines = s.parser.push(chunk);
		if (s.parser.exceeded()) {
			this.failClosed(s, new TerminalSessionError("terminal_session_protocol_error", "stdout 单行超过上限"));
			return;
		}
		for (const line of lines) {
			let obj;
			try {
				obj = JSON.parse(line.trim());
			} catch {
				this.failClosed(s, protocolError("非法 JSON 行"));
				return;
			}
			if (isClosedEvent(obj)) {
				this.emit(s, {
					type: "closed",
					sessionId: s.sessionId,
					reason: obj.reason
				});
				this.reap(s, { sendRelease: false });
				return;
			}
			let frame;
			try {
				frame = parseFrame(obj, { maxDecodedFrameBytes: this.maxDecoded });
			} catch (err) {
				this.failClosed(s, err instanceof Error ? err : protocolError(String(err)));
				return;
			}
			this.onFrame(s, frame);
		}
	}
	onFrame(s, frame) {
		const firstFull = !s.fullArmed;
		if (firstFull) {
			if (!frame.full) {
				this.failClosed(s, protocolError("当前 generation 首帧不是 full"));
				return;
			}
			s.fullArmed = true;
		}
		if (frame.seq !== s.lastSeq + 1) {
			this.rebuild(s, `seq 缺口: 期望 ${s.lastSeq + 1}，收到 ${frame.seq}`);
			return;
		}
		s.lastSeq = frame.seq;
		const ev = {
			type: "frame",
			generation: s.generation,
			seq: frame.seq,
			full: frame.full,
			width: frame.width,
			height: frame.height,
			bytes: frame.bytes.toString("base64")
		};
		this.enqueueReplay(s, ev);
		if (firstFull) {
			const ready = {
				type: "ready",
				sessionId: s.sessionId,
				mode: s.mode,
				generation: s.generation,
				resumed: false,
				afterSeq: 0
			};
			for (const sub of s.subscribers) if (s.readyBySub.get(sub) === false) {
				this.sendReady(s, sub, false, 0);
				s.readyBySub.set(sub, true);
				sub(ev);
			}
			this.emitGlobal(s, ready);
			this.emitGlobal(s, ev);
		} else this.emit(s, ev);
	}
	enqueueReplay(s, frame) {
		s.replay.push({
			seq: frame.seq,
			event: frame
		});
		s.replayBytes += frame.bytes.length;
		while (s.replay.length > 0 && s.replayBytes > this.replayCap) {
			const dropped = s.replay.shift();
			if (dropped) s.replayBytes -= dropped.event.bytes.length;
		}
	}
	handleAttach(s, cb, cursor) {
		if (cursor.generation === s.generation && s.fullArmed) {
			const idx = s.replay.findIndex((r) => r.seq > cursor.afterSeq);
			if (idx >= 0) {
				this.sendReady(s, cb, true, cursor.afterSeq);
				for (let i = idx; i < s.replay.length; i++) cb(s.replay[i].event);
				s.readyBySub.set(cb, true);
				return;
			}
			this.rebuild(s, "replay buffer 无法覆盖所需 cursor");
			return;
		}
		if (cursor.generation !== s.generation && s.fullArmed) {
			this.rebuild(s, "generation 不匹配，重建");
			return;
		}
		s.readyBySub.set(cb, false);
	}
	sendReady(s, sub, resumed, afterSeq) {
		sub({
			type: "ready",
			sessionId: s.sessionId,
			mode: s.mode,
			generation: s.generation,
			resumed,
			afterSeq
		});
	}
	emit(s, ev) {
		for (const sub of s.subscribers) try {
			sub(ev);
		} catch {}
		this.emitGlobal(s, ev);
	}
	/** 全局转发（/herdr-events 单流）：不依赖 per-session 订阅方存在。 */
	emitGlobal(s, ev) {
		if (this.globalListeners.size === 0) return;
		for (const cb of this.globalListeners) try {
			cb(s.sessionId, s.paneId, ev);
		} catch {}
	}
	maybeDetectConflict(s, stderrTail) {
		if (s.mode !== "control" || s.conflictReported) return;
		if (/\b(already|currently|occupied|conflict)\b/i.test(stderrTail)) {
			s.conflictReported = true;
			this.emit(s, {
				type: "conflict",
				sessionId: s.sessionId,
				message: stderrTail.trim().slice(0, 200)
			});
		}
	}
	scheduleIdleReset(s) {
		if (s.mode !== "control") return;
		if (s.idleTimer) clearTimeout(s.idleTimer);
		s.idleTimer = setTimeout(() => {
			this.release(s.sessionId, "idle timeout");
		}, this.deps.config.controllerIdleMs);
		s.idleTimer.unref?.();
	}
	touch(s) {
		this.scheduleIdleReset(s);
	}
	failClosed(s, err) {
		const code = err instanceof TerminalSessionError ? err.code : "terminal_session_protocol_error";
		const retryable = err instanceof TerminalSessionError ? err.retryable : false;
		this.emit(s, {
			type: "error",
			sessionId: s.sessionId,
			code,
			message: err.message,
			retryable
		});
		this.reap(s, { sendRelease: false });
	}
	reap(s, opts) {
		return new Promise((resolveReap) => {
			if (s.state === "closed") {
				resolveReap();
				return;
			}
			s.state = "closed";
			if (s.graceTimer) clearTimeout(s.graceTimer);
			if (s.idleTimer) clearTimeout(s.idleTimer);
			if (s.mode === "control") this.controllers.delete(s.paneId);
			const child = s.child;
			if (!child) {
				this.sessions.delete(s.sessionId);
				resolveReap();
				return;
			}
			const cleanup = () => {
				if (child.exitCode === null) try {
					child.kill("SIGTERM");
				} catch {}
				this.sessions.delete(s.sessionId);
				resolveReap();
			};
			if (opts.sendRelease && child.stdin?.writable && child.exitCode === null) try {
				const timer = setTimeout(cleanup, 1e3);
				timer.unref?.();
				child.once("exit", () => {
					clearTimeout(timer);
					cleanup();
				});
				child.stdin.write("{\"type\":\"terminal.release\"}\n");
				child.stdin.end();
				return;
			} catch {}
			cleanup();
		});
	}
};
function createTerminalRuntime(config, deps = {}) {
	const cfg = resolveTerminalSessionConfig(config);
	const probe = deps.probe ?? probeTerminalSession;
	const now = deps.now ?? Date.now;
	let capability = null;
	let capabilityAt = 0;
	let probeRevision = 0;
	let inflight = null;
	let manager = null;
	if (cfg.enabled) {
		const conn = resolveSessionConnection(config);
		if (conn.socketPath) {
			const opts = {
				config: cfg,
				...cfg.binPath ? { binPath: cfg.binPath } : {},
				socketPath: conn.socketPath,
				...conn.session ? { session: conn.session } : {}
			};
			manager = deps.createManager ? deps.createManager(opts) : new TerminalSessionManager(opts);
		}
	}
	return {
		manager: () => manager,
		async ensureAvailable() {
			if (capability?.available) return true;
			if (capability && now() - capabilityAt < 3e4) return capability.available;
			if (!inflight) {
				const revision = probeRevision;
				inflight = probe({ binPath: cfg.binPath }).then((cap) => {
					if (revision === probeRevision) {
						capability = cap;
						capabilityAt = now();
						inflight = null;
					}
					return cap;
				}, (err) => {
					if (revision === probeRevision) inflight = null;
					throw err;
				});
			}
			return (await inflight).available;
		},
		invalidateProbe() {
			probeRevision++;
			capability = null;
			capabilityAt = 0;
			inflight = null;
		},
		dispose() {
			manager?.dispose();
			manager = null;
		}
	};
}
//#endregion
//#region src/host/tools/shared.ts
/** 手检：非空字符串（DSL 不表达非空约束）。 */
function requireNonEmpty(value, name) {
	if (typeof value !== "string" || value.trim() === "") throw new Error(`${name} must be a non-empty string`);
}
/** 手检：正数。 */
function requirePositiveNumber(value, name) {
	if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) throw new Error(`${name} must be a positive number`);
}
/** 手检：0.1–0.9 区间的 ratio。 */
function requireRatio(value, name) {
	requirePositiveNumber(value, name);
	if (value < .1 || value > .9) throw new Error(`${name} must be between 0.1 and 0.9`);
}
/** 连接/环境/协议错误 → 抛错（工具进入 isError）；业务错误原样返回。 */
function toToolError(err) {
	if (err instanceof HerdrError) throw new Error(`${err.code}: ${err.message}`);
	throw err instanceof Error ? err : new Error(String(err));
}
/** 等宽表格渲染（render 用；纯函数）。 */
function renderTable(headers, rows) {
	const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length)));
	const pad = (s, w) => s + " ".repeat(Math.max(0, w - s.length));
	const line = (cells) => cells.map((c, i) => pad(c, widths[i])).join("  ");
	const sep = widths.map((w) => "-".repeat(w)).join("  ");
	return [
		line(headers),
		sep,
		...rows.map(line)
	].join("\n");
}
//#endregion
//#region src/host/tools/snapshot.ts
/** 摘要渲染（纯函数；规范值本身是完整 snapshot JSON）。 */
function renderSnapshotSummary(snapshot) {
	const ws = snapshot.workspaces;
	const agents = snapshot.agents;
	const statusCounts = /* @__PURE__ */ new Map();
	for (const a of agents) {
		const s = a.status ?? "unknown";
		statusCounts.set(s, (statusCounts.get(s) ?? 0) + 1);
	}
	const lines = [
		`herdr ${snapshot.version} (protocol ${snapshot.protocol})`,
		`workspaces: ${ws.length}`,
		`agents: ${agents.length}${statusCounts.size ? " (" + [...statusCounts].map(([k, v]) => `${k}=${v}`).join(", ") + ")" : ""}`
	];
	const focus = snapshot.focused_pane_id;
	if (focus) lines.push(`focused pane: ${focus}`);
	for (const w of ws.slice(0, 10)) lines.push(`  - ${w.workspace_id} ${w.label ?? ""} (${w.pane_count ?? 0} panes)`);
	return lines.join("\n");
}
function registerSnapshot(ctx) {
	ctx.tools.register(defineTool({
		name: "herdr_snapshot",
		description: "Get a Herdr session snapshot: workspaces, tabs, panes, agents, focus and protocol version.",
		parameters: {},
		output: {
			schema: { type: "json" },
			render: (_args, value) => [{
				type: "text",
				text: renderSnapshotSummary(value)
			}]
		},
		async execute() {
			try {
				return await ctx.herdr.snapshot();
			} catch (err) {
				toToolError(err);
			}
		}
	}));
}
//#endregion
//#region src/host/tools/agent-list.ts
const STATUSES$2 = [
	"idle",
	"working",
	"blocked",
	"done",
	"unknown"
];
function renderAgentTable(agents) {
	if (agents.length === 0) return "(no agents detected)";
	return renderTable([
		"pane",
		"agent",
		"kind",
		"status",
		"message",
		"workspace"
	], agents.map((a) => [
		String(a.pane_id ?? ""),
		String(a.name ?? a.agent ?? ""),
		String(a.kind ?? ""),
		String(a.status ?? "unknown"),
		String(a.message ?? ""),
		String(a.workspace_id ?? "")
	]));
}
function registerAgentList(ctx) {
	ctx.tools.register(defineTool({
		name: "herdr_agent_list",
		description: "List agents detected by Herdr with their semantic state (idle/working/blocked/done/unknown). Optionally filter by workspace or status.",
		parameters: {
			workspace_id: {
				type: "string",
				description: "Filter by workspace id (e.g. w1)"
			},
			status: {
				type: "string",
				enum: STATUSES$2,
				description: "Filter by agent status"
			}
		},
		output: {
			schema: {
				type: "array",
				items: {
					type: "object",
					additionalProperties: true,
					properties: {
						pane_id: { type: "string" },
						workspace_id: { type: "string" },
						agent: { type: "string" },
						status: {
							type: "string",
							enum: STATUSES$2
						},
						message: { type: "string" }
					}
				}
			},
			render: (_args, value) => [{
				type: "text",
				text: renderAgentTable(value)
			}]
		},
		async execute(args) {
			try {
				return await ctx.herdr.listAgents({
					workspace_id: args.workspace_id,
					status: args.status
				});
			} catch (err) {
				toToolError(err);
			}
		}
	}));
}
//#endregion
//#region src/host/jobs.ts
/** 启动后台任务，返回 registry 签发的 jobId（如 herdr-1）。 */
function startWaitJob(ctx, spec) {
	return ctx.jobs.start({
		kind: "herdr",
		label: spec.label,
		owner: spec.owner,
		run: () => {
			const controller = new AbortController();
			let cancelReason;
			let lastOutput = "";
			return {
				cancel: (reason) => {
					if (!controller.signal.aborted) cancelReason = reason;
					controller.abort(reason);
				},
				done: spec.wait(controller.signal).then((result) => {
					lastOutput = spec.render(result);
					return {
						status: "completed",
						result: lastOutput
					};
				}).catch((err) => {
					const detail = err instanceof Error ? err.message : String(err);
					lastOutput = detail;
					if (controller.signal.aborted) return {
						status: "killed",
						detail: cancelReason ?? "cancelled",
						result: detail
					};
					return {
						status: "failed",
						detail,
						result: detail
					};
				})
			};
		}
	});
}
//#endregion
//#region src/host/tools/pane-run.ts
function renderRunResult(args, value) {
	if (value.kind === "background") return `started background job ${value.jobId}`;
	const status = value.timed_out ? " (timed out)" : "";
	const exit = value.exit_code == null ? "exit: n/a" : `exit: ${value.exit_code}`;
	const out = value.output.trim();
	return [`[${value.pane_id}] ${exit}${status}`, out ? out : "(no output)"].join("\n");
}
function registerPaneRun(ctx, opts) {
	ctx.tools.register(defineTool({
		name: "herdr_pane_run",
		description: "Run a shell command in a Herdr pane (persistent terminal). This session owns a dedicated workspace created in the project directory at session start; every pane this session creates lives in that workspace. Reuses the session's own bound pane by default, or the given pane_id; pass workspace_id/direction to deliberately create a new pane (still inside the session workspace unless workspace_id overrides). Do NOT spawn one pane per command — reuse instead. Waits up to wait_ms for output to settle. Returns the pane output.",
		parameters: {
			command: {
				type: "string",
				required: true,
				description: "Shell command to run. Typed into the pane's own shell, so use that shell's syntax: POSIX shell on Linux/macOS, cmd.exe or PowerShell on native Windows."
			},
			pane_id: {
				type: "string",
				description: "Reuse an existing pane (e.g. w1:p2); default creates a new split"
			},
			workspace_id: {
				type: "string",
				description: "Workspace for the new pane (e.g. w1)"
			},
			direction: {
				type: "string",
				enum: ["right", "down"],
				description: "Split direction for a new pane"
			},
			ratio: {
				type: "number",
				description: "Split ratio for a new pane (0.1–0.9)"
			},
			cwd: {
				type: "string",
				description: "Working directory for a new pane"
			},
			env: {
				type: "object",
				additionalProperties: true,
				description: "Environment for a new pane (string values)"
			},
			wait_ms: {
				type: "number",
				description: "Output wait budget in ms (default: config timeoutMs)"
			},
			...opts.allowBackground ? { run_in_background: {
				type: "boolean",
				description: "Run as a background job and return a jobId immediately (results via job tools)"
			} } : {}
		},
		output: {
			schema: { oneOf: [{
				type: "object",
				additionalProperties: false,
				properties: {
					kind: {
						type: "string",
						const: "completed",
						required: true
					},
					pane_id: {
						type: "string",
						required: true
					},
					exit_code: {
						oneOf: [{ type: "number" }, { type: "null" }],
						required: true
					},
					output: {
						type: "string",
						required: true
					},
					truncated: {
						type: "boolean",
						required: true
					},
					timed_out: { type: "boolean" }
				}
			}, {
				type: "object",
				additionalProperties: false,
				properties: {
					kind: {
						type: "string",
						const: "background",
						required: true
					},
					jobId: {
						type: "string",
						required: true
					}
				}
			}] },
			render: (args, value) => [{
				type: "text",
				text: renderRunResult(args, value)
			}]
		},
		async execute(args, exec) {
			try {
				requireNonEmpty(args.command, "command");
				if (args.ratio != null) requireRatio(args.ratio, "ratio");
				let paneId = args.pane_id;
				const bound = exec.agent ? getBindingRegistry().get(exec.agent.id) : void 0;
				if (!paneId && bound) {
					if (args.direction || args.workspace_id) {
						const { pane_id } = await ctx.herdr.paneSplit({
							pane_id: bound.pane_id,
							direction: args.direction ?? "right",
							ratio: args.ratio,
							cwd: args.cwd,
							env: args.env,
							workspace_id: args.workspace_id
						});
						paneId = pane_id;
					} else paneId = bound.pane_id;
				}
				const request = {
					command: args.command,
					pane_id: paneId,
					workspace_id: args.workspace_id,
					direction: args.direction,
					ratio: args.ratio,
					cwd: args.cwd,
					env: args.env,
					wait_ms: args.wait_ms
				};
				if (args.run_in_background && opts.allowBackground) return {
					kind: "background",
					jobId: startWaitJob(ctx, {
						owner: exec.agent?.id,
						label: `herdr run: ${args.command}`,
						wait: (signal) => ctx.herdr.runCommand(request, signal),
						render: (result) => renderRunResult(args, result)
					})
				};
				return await ctx.herdr.runCommand(request, exec.signal);
			} catch (err) {
				toToolError(err);
			}
		}
	}));
}
//#endregion
//#region src/host/tools/agent-wait.ts
const STATUSES$1 = [
	"idle",
	"working",
	"blocked",
	"done",
	"unknown"
];
function renderWaitResult(value) {
	switch (value.kind) {
		case "completed": return `agent ${value.agent ?? value.pane_id ?? ""} reached ${value.status} (waited ${value.waited_ms}ms)`;
		case "timeout": return `timed out after ${value.waited_ms}ms; target did not reach the requested state`;
		case "not_found": return `target not found: ${value.target}`;
	}
}
function registerAgentWait(ctx, opts) {
	ctx.tools.register(defineTool({
		name: "herdr_agent_wait",
		description: "Wait until an agent in a Herdr pane reaches one of the requested states (e.g. done). Use after herdr_agent_prompt or after starting an agent to block until it finishes. Only tracked Herdr agents (started with herdr_agent_start) qualify — a one-shot command in a pane is not an agent and never matches.",
		parameters: {
			target: {
				type: "string",
				required: true,
				description: "Pane id (e.g. w1:p2) or agent name"
			},
			until: {
				type: "array",
				items: {
					type: "string",
					enum: STATUSES$1
				},
				required: true,
				description: "States to match; any match returns (default semantics: idle/done/blocked when omitted)"
			},
			timeout_ms: {
				type: "number",
				description: "Wait budget in ms (default: config timeoutMs)"
			},
			...opts.allowBackground ? { run_in_background: {
				type: "boolean",
				description: "Run as a background job and return a jobId immediately (results via job tools)"
			} } : {}
		},
		output: {
			schema: { oneOf: [
				{
					type: "object",
					additionalProperties: false,
					properties: {
						kind: {
							type: "string",
							const: "completed",
							required: true
						},
						status: {
							type: "string",
							enum: STATUSES$1,
							required: true
						},
						waited_ms: {
							type: "number",
							required: true
						},
						pane_id: { type: "string" },
						agent: { type: "string" },
						message: { type: "string" }
					}
				},
				{
					type: "object",
					additionalProperties: false,
					properties: {
						kind: {
							type: "string",
							const: "timeout",
							required: true
						},
						waited_ms: {
							type: "number",
							required: true
						},
						pane_id: { type: "string" },
						agent: { type: "string" },
						status: {
							type: "string",
							enum: STATUSES$1
						}
					}
				},
				{
					type: "object",
					additionalProperties: false,
					properties: {
						kind: {
							type: "string",
							const: "not_found",
							required: true
						},
						target: {
							type: "string",
							required: true
						}
					}
				},
				{
					type: "object",
					additionalProperties: false,
					properties: {
						kind: {
							type: "string",
							const: "background",
							required: true
						},
						jobId: {
							type: "string",
							required: true
						}
					}
				}
			] },
			render: (_args, value) => [{
				type: "text",
				text: renderWaitResult(value)
			}]
		},
		async execute(args, exec) {
			try {
				requireNonEmpty(args.target, "target");
				const until = args.until;
				if (until && until.length === 0) throw new Error("until must contain at least one status");
				const request = {
					target: args.target,
					until: until ?? ["done"],
					timeout_ms: args.timeout_ms
				};
				if (args.run_in_background && opts.allowBackground) return {
					kind: "background",
					jobId: startWaitJob(ctx, {
						owner: exec.agent?.id,
						label: `herdr wait ${request.target} until ${request.until.join("/")}`,
						wait: (signal) => ctx.herdr.waitAgent(request, signal),
						render: renderWaitResult
					})
				};
				return await ctx.herdr.waitAgent(request, exec.signal);
			} catch (err) {
				toToolError(err);
			}
		}
	}));
}
//#endregion
//#region src/host/tools/workspace-create.ts
function registerWorkspaceCreate(ctx) {
	ctx.tools.register(defineTool({
		name: "herdr_workspace_create",
		description: "Create a new Herdr workspace. In herdr mode this session already owns a dedicated workspace (created in the project directory at session start) and every pane it creates lives there — creating another workspace is refused so all panes stay in the session workspace. Outside herdr mode (no bound pane) this works normally.",
		parameters: {
			cwd: {
				type: "string",
				description: "Working directory for the workspace (default: current)"
			},
			label: {
				type: "string",
				description: "Workspace label shown in the sidebar"
			}
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					workspace_id: {
						type: "string",
						required: true
					},
					pane_id: {
						type: "string",
						description: "Root pane created with the workspace"
					}
				}
			},
			render: (_args, value) => [{
				type: "text",
				text: "created workspace " + value.workspace_id
			}]
		},
		async execute(args, exec) {
			try {
				const bound = exec.agent ? getBindingRegistry().get(exec.agent.id) : void 0;
				if (bound) throw new Error("this session already owns a dedicated workspace (pane " + bound.pane_id + "); do not create another — split panes or start agents inside the session workspace instead");
				return await ctx.herdr.workspaceCreate({
					cwd: args.cwd,
					label: args.label
				});
			} catch (err) {
				toToolError(err);
			}
		}
	}));
}
//#endregion
//#region src/host/tools/pane-split.ts
function registerPaneSplit(ctx) {
	ctx.tools.register(defineTool({
		name: "herdr_pane_split",
		description: "Split a Herdr pane right or down, returning the new pane id.",
		parameters: {
			pane_id: {
				type: "string",
				description: "Pane to split (e.g. w1:p1); default: focused pane"
			},
			direction: {
				type: "string",
				enum: ["right", "down"],
				required: true,
				description: "Split direction"
			},
			ratio: {
				type: "number",
				description: "Split ratio (0.1–0.9)"
			},
			cwd: {
				type: "string",
				description: "Working directory for the new pane"
			}
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: { pane_id: {
					type: "string",
					required: true
				} }
			},
			render: (_args, value) => [{
				type: "text",
				text: `new pane ${value.pane_id}`
			}]
		},
		async execute(args) {
			try {
				if (args.ratio != null) requireRatio(args.ratio, "ratio");
				return await ctx.herdr.paneSplit({
					pane_id: args.pane_id,
					direction: args.direction,
					ratio: args.ratio,
					cwd: args.cwd
				});
			} catch (err) {
				toToolError(err);
			}
		}
	}));
}
//#endregion
//#region src/host/tools/pane-send-keys.ts
function registerPaneSendKeys(ctx) {
	ctx.tools.register(defineTool({
		name: "herdr_pane_send_keys",
		description: "Send key presses to a Herdr pane. Keys: plain text, special keys (enter, esc, tab), modifier chords (ctrl+c, alt+x, shift+tab), function keys (f1).",
		parameters: {
			pane_id: {
				type: "string",
				required: true,
				description: "Target pane (e.g. w1:p1)"
			},
			keys: {
				type: "array",
				items: { type: "string" },
				required: true,
				description: "Key presses to send, in order"
			}
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: { sent: {
					type: "boolean",
					required: true
				} }
			},
			render: (_args, value) => [{
				type: "text",
				text: value.sent ? "keys sent" : "failed"
			}]
		},
		async execute(args) {
			try {
				requireNonEmpty(args.pane_id, "pane_id");
				if (!Array.isArray(args.keys) || args.keys.length === 0) throw new Error("keys must be a non-empty array");
				await ctx.herdr.paneSendKeys({
					pane_id: args.pane_id,
					keys: args.keys
				});
				return { sent: true };
			} catch (err) {
				toToolError(err);
			}
		}
	}));
}
//#endregion
//#region src/host/tools/pane-read.ts
function registerPaneRead(ctx) {
	ctx.tools.register(defineTool({
		name: "herdr_pane_read",
		description: "Read terminal output of a Herdr pane (visible or recent scrollback).",
		parameters: {
			pane_id: {
				type: "string",
				required: true,
				description: "Target pane (e.g. w1:p1)"
			},
			source: {
				type: "string",
				enum: [
					"visible",
					"recent",
					"recent_unwrapped",
					"detection"
				],
				description: "Terminal snapshot source (CLI default: recent)"
			},
			lines: {
				type: "number",
				description: "Restrict to the last N lines"
			}
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					pane_id: {
						type: "string",
						required: true
					},
					text: {
						type: "string",
						required: true
					}
				}
			},
			render: (_args, value) => {
				const v = value;
				return [{
					type: "text",
					text: [`[${v.pane_id}]`, v.text || "(no output)"].join("\n")
				}];
			}
		},
		async execute(args) {
			try {
				requireNonEmpty(args.pane_id, "pane_id");
				const { text } = await ctx.herdr.paneRead({
					pane_id: args.pane_id,
					source: args.source,
					lines: args.lines
				});
				return {
					pane_id: args.pane_id,
					text
				};
			} catch (err) {
				toToolError(err);
			}
		}
	}));
}
//#endregion
//#region src/host/tools/pane-layout.ts
function registerPaneLayout(ctx) {
	ctx.tools.register(defineTool({
		name: "herdr_pane_layout",
		description: "Show the Herdr tab layout snapshot (pane rects, split ratios, focus).",
		parameters: { pane_id: {
			type: "string",
			description: "Pane whose tab layout to show; default: focused"
		} },
		output: {
			schema: { type: "json" },
			render: (_args, value) => [{
				type: "text",
				text: JSON.stringify(value, null, 2)
			}]
		},
		async execute(args) {
			try {
				return await ctx.herdr.paneLayout({ pane_id: args.pane_id });
			} catch (err) {
				toToolError(err);
			}
		}
	}));
}
//#endregion
//#region src/host/tools/layout-apply.ts
function registerLayoutApply(ctx) {
	ctx.tools.register(defineTool({
		name: "herdr_layout_apply",
		description: "Apply a declarative tab layout in Herdr (restores labels, cwd, env and optional commands).",
		parameters: {
			root: {
				type: "json",
				required: true,
				description: "Layout tree: {type:\"pane\"|\"split\", ...}"
			},
			workspace_id: {
				type: "string",
				description: "Target workspace"
			},
			tab_label: {
				type: "string",
				description: "Label for the new tab"
			}
		},
		output: {
			schema: { type: "json" },
			render: (_args, value) => [{
				type: "text",
				text: "layout applied: " + JSON.stringify(value).slice(0, 200)
			}]
		},
		async execute(args) {
			try {
				return await ctx.herdr.layoutApply({
					root: args.root,
					workspace_id: args.workspace_id,
					tab_label: args.tab_label
				});
			} catch (err) {
				toToolError(err);
			}
		}
	}));
}
//#endregion
//#region src/host/tools/agent-prompt.ts
const STATUSES = [
	"idle",
	"working",
	"blocked",
	"done",
	"unknown"
];
function renderPrompt(value) {
	if (value.status) return `submitted; observed state: ${value.status}${value.waited_ms != null ? ` (waited ${value.waited_ms}ms)` : ""}`;
	return "submitted";
}
function registerAgentPrompt(ctx) {
	ctx.tools.register(defineTool({
		name: "herdr_agent_prompt",
		description: "Submit a prompt to an agent in a Herdr pane. Optionally wait for the first matching state after submission (with a stall guard when the agent is idle). Target an agent started with herdr_agent_start; if no agent is running yet, start one first instead of prompting a bare pane.",
		parameters: {
			target: {
				type: "string",
				required: true,
				description: "Pane id (e.g. w1:p2) or agent name"
			},
			text: {
				type: "string",
				required: true,
				description: "Prompt text to submit"
			},
			wait: {
				type: "boolean",
				description: "Wait for the first observed state after submission"
			},
			until: {
				type: "array",
				items: {
					type: "string",
					enum: STATUSES
				},
				description: "States to match when waiting"
			},
			timeout_ms: {
				type: "number",
				description: "Wait budget in ms"
			}
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					submitted: {
						type: "boolean",
						required: true
					},
					status: { type: "string" },
					message: { type: "string" },
					waited_ms: { type: "number" }
				}
			},
			render: (_args, value) => [{
				type: "text",
				text: renderPrompt(value)
			}]
		},
		async execute(args, exec) {
			try {
				requireNonEmpty(args.target, "target");
				requireNonEmpty(args.text, "text");
				return await ctx.herdr.agentPrompt({
					target: args.target,
					text: args.text,
					wait: args.wait,
					until: args.until,
					timeout_ms: args.timeout_ms
				}, exec.signal);
			} catch (err) {
				toToolError(err);
			}
		}
	}));
}
//#endregion
//#region src/host/tools/agent-start.ts
/**
* 启动一个编码 agent（pi / codex / claude 等）并等待其就绪。
* 缺省 pane_id 时在本会话专属 workspace 中（绑定 pane 旁 split）启动，
* 新 pane 继承项目目录 cwd——开启的 agent 落在本会话 workspace 内。
* 启动后应使用 herdr_agent_prompt 提交任务、herdr_agent_wait 等待完成。
* 拒绝一次性执行模式（pi --print / codex exec 等）——那只是跑命令且立即退出，
* 不是可跟踪的 Herdr agent，面板也无法显示其状态。
*/
/** 一次性执行模式标志（agent 跑完即退出，herdr 无法持续跟踪）。 */
const ONESHOT_ARGS = /* @__PURE__ */ new Set([
	"--print",
	"-p",
	"exec",
	"--execute",
	"--eval",
	"-e"
]);
function registerAgentStart(ctx) {
	ctx.tools.register(defineTool({
		name: "herdr_agent_start",
		description: "Start a coding agent (e.g. pi, codex, claude) in a Herdr pane and wait until Herdr recognizes it and considers it ready, returning the agent identity and status. By default starts in a new pane inside this session dedicated workspace (off the bound pane, project cwd). This is the proper way to open an agent for a task: start it here, then submit work with herdr_agent_prompt and wait with herdr_agent_wait. Do NOT fake an agent with a one-shot command like pi --print — that just runs a command; it is not a Herdr agent and herdr_agent_wait cannot track it.",
		parameters: {
			kind: {
				type: "string",
				required: true,
				description: "Agent kind to start (e.g. pi, codex, claude); check your install"
			},
			name: {
				type: "string",
				description: "Agent name, follow <kind>-<purpose> (e.g. pi-disk-check); default auto-generates <kind>-<n> with a unique suffix"
			},
			pane_id: {
				type: "string",
				description: "Existing pane to start the agent in; default creates a new split pane in this session workspace"
			},
			args: {
				type: "array",
				items: { type: "string" },
				description: "Native arguments passed to the agent after --. CONFIGURATION FLAGS ONLY (e.g. --model); never pass task text or one-shot mode flags (--print, -p, exec, --execute, --eval) — those run a command and exit, which is not a tracked Herdr agent. Submit the task with herdr_agent_prompt instead."
			},
			timeout_ms: {
				type: "number",
				description: "Startup timeout in ms (> 3000 and <= 300000; default 30000)"
			}
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					pane_id: { type: "string" },
					workspace_id: { type: "string" },
					agent: { type: "string" },
					display_agent: { type: "string" },
					status: { type: "string" },
					name: { type: "string" },
					kind: { type: "string" }
				}
			},
			render: (args, value) => {
				const v = value;
				return [{
					type: "text",
					text: ["agent started: " + String(v.agent ?? v.display_agent ?? v.name ?? args.kind), "pane " + String(v.pane_id ?? "") + " status " + String(v.status ?? "unknown")].join("\n")
				}];
			}
		},
		async execute(args, exec) {
			try {
				requireNonEmpty(args.kind, "kind");
				const oneShot = (args.args ?? []).find((a) => ONESHOT_ARGS.has(a));
				if (oneShot) throw new Error("one-shot mode flag " + oneShot + " is not allowed in args: it runs a command and exits — not a tracked Herdr agent. Start the agent interactively (configuration flags only, no task text) and submit the task with herdr_agent_prompt instead.");
				let paneId = args.pane_id;
				if (!paneId) {
					const bound = exec.agent ? getBindingRegistry().get(exec.agent.id) : void 0;
					if (!bound) throw new Error("no pane_id given and this session has no bound herdr pane; pass pane_id explicitly");
					const { pane_id } = await ctx.herdr.paneSplit({
						pane_id: bound.pane_id,
						direction: "right"
					});
					paneId = pane_id;
				}
				if (args.timeout_ms != null && (args.timeout_ms <= 3e3 || args.timeout_ms > 3e5)) throw new Error("timeout_ms must be > 3000 and <= 300000");
				let name = args.name;
				if (!name) {
					const n = ((await ctx.herdr.snapshot()).agents ?? []).map((a) => a.agent).filter((x) => typeof x === "string" && x !== "").filter((a) => a === args.kind || a.startsWith(args.kind + "-")).length;
					name = args.kind + "-" + String(n + 1);
				}
				const req = {
					name,
					kind: args.kind,
					pane_id: paneId,
					args: args.args,
					timeout_ms: args.timeout_ms
				};
				const started = async () => {
					const deadline = Date.now() + (req.timeout_ms ?? 3e4);
					for (;;) try {
						return await ctx.herdr.agentStart(req);
					} catch (err) {
						if (err instanceof HerdrError && err.serverCode === "agent_pane_busy" && Date.now() < deadline) {
							await new Promise((res) => setTimeout(res, 500));
							continue;
						}
						throw err;
					}
				};
				const info = await started();
				if (info.interactive_ready !== true) await ctx.herdr.waitAgent({
					target: req.name,
					until: [
						"idle",
						"working",
						"blocked",
						"done"
					],
					timeout_ms: Math.min(req.timeout_ms ?? 3e4, 3e4)
				}, exec.signal).catch(() => {});
				return {
					kind: args.kind,
					...info.pane_id ? { pane_id: info.pane_id } : {},
					...info.workspace_id ? { workspace_id: info.workspace_id } : {},
					...info.agent != null ? { agent: info.agent } : {},
					...info.display_agent != null ? { display_agent: info.display_agent } : {},
					...info.agent_status ? { status: info.agent_status } : {},
					...info.name != null ? { name: info.name } : {}
				};
			} catch (err) {
				toToolError(err);
			}
		}
	}));
}
//#endregion
//#region src/host/tools/agent-explain.ts
function registerAgentExplain(ctx) {
	ctx.tools.register(defineTool({
		name: "herdr_agent_explain",
		description: "Explain why Herdr classified a pane/agent the way it did (detection diagnostics).",
		parameters: { target: {
			type: "string",
			required: true,
			description: "Pane id or agent name to explain"
		} },
		output: {
			schema: { type: "json" },
			render: (_args, value) => [{
				type: "text",
				text: JSON.stringify(value, null, 2)
			}]
		},
		async execute(args) {
			try {
				return await ctx.herdr.agentExplain({ target: args.target });
			} catch (err) {
				toToolError(err);
			}
		}
	}));
}
//#endregion
//#region src/host/tools/agent-send-keys.ts
function registerAgentSendKeys(ctx) {
	ctx.tools.register(defineTool({
		name: "herdr_agent_send_keys",
		description: "Send key presses to the agent controlling a Herdr pane (e.g. ctrl+c to interrupt).",
		parameters: {
			target: {
				type: "string",
				required: true,
				description: "Pane id (e.g. w1:p2) or agent name"
			},
			keys: {
				type: "array",
				items: { type: "string" },
				required: true,
				description: "Key presses to send, in order"
			}
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: { sent: {
					type: "boolean",
					required: true
				} }
			},
			render: (_args, value) => [{
				type: "text",
				text: value.sent ? "keys sent" : "failed"
			}]
		},
		async execute(args) {
			try {
				requireNonEmpty(args.target, "target");
				if (!Array.isArray(args.keys) || args.keys.length === 0) throw new Error("keys must be a non-empty array");
				await ctx.herdr.agentSendKeys({
					target: args.target,
					keys: args.keys
				});
				return { sent: true };
			} catch (err) {
				toToolError(err);
			}
		}
	}));
}
//#endregion
//#region src/host/tools/notification.ts
function registerNotification(ctx) {
	ctx.tools.register(defineTool({
		name: "herdr_notification",
		description: "Show a desktop-style notification through the Herdr server (visible to the user).",
		parameters: {
			title: {
				type: "string",
				required: true,
				description: "Notification title"
			},
			body: {
				type: "string",
				description: "Notification body text"
			},
			position: {
				type: "string",
				enum: [
					"top-left",
					"top-right",
					"bottom-left",
					"bottom-right"
				],
				description: "Toast position"
			},
			sound: {
				type: "string",
				enum: [
					"none",
					"done",
					"request"
				],
				description: "Notification sound"
			}
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: { shown: {
					type: "boolean",
					required: true
				} }
			},
			render: (_args, value) => [{
				type: "text",
				text: value.shown ? "notification shown" : "failed"
			}]
		},
		async execute(args) {
			try {
				requireNonEmpty(args.title, "title");
				await ctx.herdr.showNotification({
					title: args.title,
					body: args.body,
					position: args.position,
					sound: args.sound
				});
				return { shown: true };
			} catch (err) {
				toToolError(err);
			}
		}
	}));
}
//#endregion
//#region src/host/tools/workspace-close.ts
function registerWorkspaceClose(ctx) {
	ctx.tools.register(defineTool({
		name: "herdr_workspace_close",
		description: "Close a Herdr workspace and all its panes (destructive).",
		parameters: { workspace_id: {
			type: "string",
			required: true,
			description: "Workspace id to close (e.g. w1)"
		} },
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					ok: {
						type: "boolean",
						required: true
					},
					closed_panes: {
						type: "number",
						required: true,
						description: "Panes that were in the workspace before closing"
					}
				}
			},
			render: (_args, value) => [{
				type: "text",
				text: "closed workspace (" + value.closed_panes + " panes)"
			}]
		},
		async execute(args) {
			try {
				let closedPanes = 0;
				try {
					closedPanes = (await ctx.herdr.snapshot()).panes.filter((p) => p.workspace_id === args.workspace_id).length;
				} catch {}
				await ctx.herdr.workspaceClose(args.workspace_id);
				return {
					ok: true,
					closed_panes: closedPanes
				};
			} catch (err) {
				toToolError(err);
			}
		}
	}));
}
//#endregion
//#region src/host/tools/pane-close.ts
function registerPaneClose(ctx) {
	ctx.tools.register(defineTool({
		name: "herdr_pane_close",
		description: "Close a Herdr pane (terminates processes running in it).",
		parameters: { pane_id: {
			type: "string",
			required: true,
			description: "Pane to close (e.g. w1:p1)"
		} },
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: { ok: {
					type: "boolean",
					required: true
				} }
			},
			render: () => [{
				type: "text",
				text: "closed pane"
			}]
		},
		async execute(args) {
			try {
				requireNonEmpty(args.pane_id, "pane_id");
				await ctx.herdr.paneClose(args.pane_id);
				return { ok: true };
			} catch (err) {
				toToolError(err);
			}
		}
	}));
}
//#endregion
//#region src/host/tools/workspace-rename.ts
/** 去空白后校验 label 长度上限（与 pane-rename / HTTP 路由保持一致）。 */
function assertLabelLength(label) {
	if (label.trim().length > 64) throw new Error("label must be at most 64 characters");
}
function registerWorkspaceRename(ctx) {
	ctx.tools.register(defineTool({
		name: "herdr_workspace_rename",
		description: "Rename a Herdr workspace label.",
		parameters: {
			workspace_id: {
				type: "string",
				required: true,
				description: "Workspace id to rename (e.g. w1)"
			},
			label: {
				type: "string",
				required: true,
				description: "New label (non-empty, at most 64 characters)"
			}
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: { ok: {
					type: "boolean",
					required: true
				} }
			},
			render: () => [{
				type: "text",
				text: "workspace renamed"
			}]
		},
		async execute(args) {
			try {
				requireNonEmpty(args.workspace_id, "workspace_id");
				requireNonEmpty(args.label, "label");
				assertLabelLength(args.label);
				await ctx.herdr.workspaceRename(args.workspace_id, args.label);
				return { ok: true };
			} catch (err) {
				toToolError(err);
			}
		}
	}));
}
//#endregion
//#region src/host/tools/pane-rename.ts
function registerPaneRename(ctx) {
	ctx.tools.register(defineTool({
		name: "herdr_pane_rename",
		description: "Rename a Herdr pane label (null or empty clears the name).",
		parameters: {
			pane_id: {
				type: "string",
				required: true,
				description: "Pane to rename (e.g. w1:p1)"
			},
			label: {
				oneOf: [{
					type: "string",
					description: "New label (at most 64 characters)"
				}, { type: "null" }],
				description: "New label; null/empty clears the name"
			}
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: { ok: {
					type: "boolean",
					required: true
				} }
			},
			render: () => [{
				type: "text",
				text: "pane renamed"
			}]
		},
		async execute(args) {
			try {
				requireNonEmpty(args.pane_id, "pane_id");
				const label = args.label == null || args.label.trim() === "" ? null : args.label;
				if (label != null) assertLabelLength(label);
				await ctx.herdr.paneRename(args.pane_id, label);
				return { ok: true };
			} catch (err) {
				toToolError(err);
			}
		}
	}));
}
//#endregion
//#region src/host/tools/registry.ts
/** 全部 herdr_* 工具的唯一清单；contract 测试遍历它。 */
const HERDR_TOOLS = [
	{
		name: "herdr_snapshot",
		register: (ctx) => registerSnapshot(ctx)
	},
	{
		name: "herdr_agent_list",
		register: (ctx) => registerAgentList(ctx)
	},
	{
		name: "herdr_pane_run",
		register: (ctx, opts) => registerPaneRun(ctx, { allowBackground: opts.allowBackground })
	},
	{
		name: "herdr_agent_wait",
		register: (ctx, opts) => registerAgentWait(ctx, { allowBackground: opts.allowBackground })
	},
	{
		name: "herdr_workspace_create",
		register: (ctx) => registerWorkspaceCreate(ctx)
	},
	{
		name: "herdr_pane_split",
		register: (ctx) => registerPaneSplit(ctx)
	},
	{
		name: "herdr_pane_send_keys",
		register: (ctx) => registerPaneSendKeys(ctx)
	},
	{
		name: "herdr_pane_read",
		register: (ctx) => registerPaneRead(ctx)
	},
	{
		name: "herdr_pane_layout",
		register: (ctx) => registerPaneLayout(ctx)
	},
	{
		name: "herdr_layout_apply",
		register: (ctx) => registerLayoutApply(ctx)
	},
	{
		name: "herdr_agent_prompt",
		register: (ctx) => registerAgentPrompt(ctx)
	},
	{
		name: "herdr_agent_start",
		register: (ctx) => registerAgentStart(ctx)
	},
	{
		name: "herdr_agent_explain",
		register: (ctx) => registerAgentExplain(ctx)
	},
	{
		name: "herdr_agent_send_keys",
		register: (ctx) => registerAgentSendKeys(ctx)
	},
	{
		name: "herdr_notification",
		register: (ctx) => registerNotification(ctx)
	},
	{
		name: "herdr_workspace_close",
		register: (ctx) => registerWorkspaceClose(ctx)
	},
	{
		name: "herdr_pane_close",
		register: (ctx) => registerPaneClose(ctx)
	},
	{
		name: "herdr_workspace_rename",
		register: (ctx) => registerWorkspaceRename(ctx)
	},
	{
		name: "herdr_pane_rename",
		register: (ctx) => registerPaneRename(ctx)
	}
];
function registerHerdrTools(ctx, opts) {
	for (const tool of HERDR_TOOLS) tool.register(ctx, opts);
}
//#endregion
//#region src/host/terminal-session/routes.ts
/** 参数校验：合法返回 value，否则返回错误消息。 */
function validateStart(body) {
	const paneId = body.pane_id;
	if (typeof paneId !== "string" || paneId.trim() === "") return { error: "pane_id is required" };
	const mode = body.mode;
	if (mode !== "observe" && mode !== "control") return { error: "mode must be 'observe' or 'control'" };
	const cols = body.cols;
	const rows = body.rows;
	if (typeof cols !== "number" || !Number.isInteger(cols) || cols < 1 || cols > 1e3) return { error: "cols must be a positive integer" };
	if (typeof rows !== "number" || !Number.isInteger(rows) || rows < 1 || rows > 1e3) return { error: "rows must be a positive integer" };
	const takeover = body.takeover;
	if (takeover !== void 0 && typeof takeover !== "boolean") return { error: "takeover must be boolean" };
	return { value: {
		pane_id: paneId,
		mode,
		cols,
		rows,
		takeover: typeof takeover === "boolean" ? takeover : false
	} };
}
function parseCommand(body) {
	const sessionId = body.session_id;
	if (typeof sessionId !== "string" || sessionId.trim() === "") return { error: "session_id is required" };
	const cmd = body.command;
	if (typeof cmd !== "object" || cmd === null) return { error: "command is required" };
	const c = cmd;
	if (c.type === "input") {
		if (typeof c.bytes !== "string") return { error: "input.bytes is required" };
		return { value: {
			sessionId,
			payload: JSON.stringify({
				type: "terminal.input",
				bytes: c.bytes
			})
		} };
	}
	if (c.type === "resize") {
		if (typeof c.cols !== "number" || typeof c.rows !== "number") return { error: "resize.cols/rows are required" };
		return { value: {
			sessionId,
			payload: JSON.stringify({
				type: "terminal.resize",
				cols: c.cols,
				rows: c.rows
			})
		} };
	}
	if (c.type === "scroll") {
		if (c.direction !== "up" && c.direction !== "down") return { error: "scroll.direction must be up|down" };
		if (typeof c.lines !== "number" || !Number.isInteger(c.lines) || c.lines < 1) return { error: "scroll.lines must be a positive integer" };
		return { value: {
			sessionId,
			payload: JSON.stringify({
				type: "terminal.scroll",
				direction: c.direction,
				lines: c.lines
			})
		} };
	}
	if (c.type === "release") return { value: {
		sessionId,
		payload: "",
		release: true
	} };
	return { error: "unknown command type" };
}
//#endregion
//#region src/host/panel/remote.ts
const TOPOLOGY_EVENTS = /* @__PURE__ */ new Set([
	"workspace_created",
	"workspace_updated",
	"workspace_metadata_updated",
	"workspace_renamed",
	"workspace_moved",
	"workspace_reordered",
	"workspace_closed",
	"workspace_focused",
	"tab_created",
	"tab_closed",
	"tab_renamed",
	"tab_moved",
	"tab_focused",
	"pane_created",
	"pane_closed",
	"pane_updated",
	"pane_focused",
	"pane_moved",
	"pane_exited",
	"layout_updated"
]);
function record(value) {
	return value !== null && typeof value === "object" && !Array.isArray(value) ? value : {};
}
function failure(error) {
	const message = error instanceof Error ? error.message : String(error);
	return isTerminalSessionError(error) ? {
		ok: false,
		error: message,
		code: error.code
	} : {
		ok: false,
		error: message
	};
}
const TERMINAL_UNAVAILABLE = {
	ok: false,
	error: "terminal session unavailable",
	code: "terminal_session_unavailable"
};
var HerdrPanelService = class extends TypertRemoteService {
	runtime;
	constructor(ctx, runtime) {
		super(ctx, "herdrPanel", { namespace: "herdr" });
		this.runtime = runtime;
	}
	async status(request) {
		const scope = record(request).scope === "all" ? "all" : "project";
		return this.runtime.tracker.snapshot(scope);
	}
	environment() {
		if (!this.runtime.environment) throw new Error("Herdr environment reader is unavailable");
		return this.runtime.environment();
	}
	async dashboard() {
		return this.runtime.dashboard.snapshot();
	}
	async topology() {
		const snap = this.runtime.tracker.snapshot("project");
		return {
			server: snap.server,
			topology: snap.topology,
			filter: snap.filter,
			stale: snap.stale === true,
			last_error: snap.last_error ?? null,
			updated_at: snap.updated_at,
			poll_latency_ms: snap.poll_latency_ms ?? this.runtime.tracker.getDiagnostics().pollLatencyMs
		};
	}
	async agentOutputs(request) {
		const body = record(request);
		const paneIds = String(body.paneIds ?? "").split(",").map((item) => item.trim()).filter(Boolean);
		if (paneIds.length === 0) return { outputs: [] };
		const requested = Number(body.lines);
		const lines = Math.min(Math.max(Number.isFinite(requested) && requested > 0 ? requested : 40, 1), 5e4);
		const format = body.format === "plain" ? "text" : "ansi";
		const outputs = [];
		for (const paneId of paneIds) try {
			const result = await this.runtime.paneRead({
				pane_id: paneId,
				source: "recent_unwrapped",
				lines,
				format
			});
			const text = truncateAnsiTail(result.text ?? "", OUTPUT_CAP);
			outputs.push({
				pane_id: paneId,
				text,
				truncated: Boolean(result.truncated) || (result.text?.length ?? 0) > 8e3,
				...result.revision != null ? { revision: result.revision } : {}
			});
		} catch (error) {
			outputs.push({
				pane_id: paneId,
				error: error instanceof Error ? error.message : String(error)
			});
		}
		return { outputs };
	}
	async sessionPane(request) {
		const agent = String(record(request).agent ?? "");
		if (!agent) return { pane_id: null };
		const bound = this.runtime ? getBindingRegistry().get(agent)?.pane_id : void 0;
		if (bound) return { pane_id: bound };
		try {
			return { pane_id: (await this.runtime.snapshot()).panes.find((pane) => sessionIdFromTokens(pane.tokens) === agent)?.pane_id ?? null };
		} catch {
			return { pane_id: null };
		}
	}
	async paneSession(request) {
		const paneId = String(record(request).pane ?? "");
		if (!paneId) return { session_id: null };
		for (const [sessionId, binding] of getBindingRegistry()) if (binding.pane_id === paneId) return { session_id: sessionId };
		try {
			const pane = (await this.runtime.snapshot()).panes.find((item) => item.pane_id === paneId);
			return { session_id: pane ? sessionIdFromTokens(pane.tokens) ?? null : null };
		} catch {
			return { session_id: null };
		}
	}
	start() {
		return this.runtime.startServer();
	}
	async close(request) {
		const body = record(request);
		if (body.kind !== "workspace" && body.kind !== "pane") return {
			ok: false,
			error: "kind must be 'workspace' or 'pane'"
		};
		if (!body.id?.trim()) return {
			ok: false,
			error: "id must be a non-empty string"
		};
		const bound = new Set(getBoundPaneIds());
		if (body.kind === "pane" && bound.has(body.id)) return {
			ok: false,
			error: "cannot close the pane hosting this session"
		};
		if (body.kind === "workspace") try {
			if ((await this.runtime.snapshot()).panes.some((pane) => pane.workspace_id === body.id && bound.has(pane.pane_id))) return {
				ok: false,
				error: "cannot close the workspace hosting this session"
			};
		} catch {}
		try {
			if (body.kind === "pane") await this.runtime.paneClose(body.id);
			else await this.runtime.workspaceClose(body.id);
			return { ok: true };
		} catch (error) {
			return failure(error);
		}
	}
	async rename(request) {
		const body = record(request);
		if (body.kind !== "workspace" && body.kind !== "pane") return {
			ok: false,
			error: "kind must be 'workspace' or 'pane'"
		};
		if (!body.id?.trim()) return {
			ok: false,
			error: "id must be a non-empty string"
		};
		if (body.kind === "workspace" && !body.label?.trim()) return {
			ok: false,
			error: "label must be a non-empty string"
		};
		if (typeof body.label === "string" && body.label.trim().length > 64) return {
			ok: false,
			error: "label must be at most 64 characters"
		};
		try {
			if (body.kind === "pane") await this.runtime.paneRename(body.id, body.label ?? null);
			else await this.runtime.workspaceRename(body.id, body.label);
			return { ok: true };
		} catch (error) {
			return failure(error);
		}
	}
	async paneInput(request) {
		const body = record(request);
		if (!body.pane_id?.trim()) return {
			ok: false,
			error: "pane_id must be a non-empty string"
		};
		if (body.kind !== void 0 && body.kind !== "text" && body.kind !== "keys") return {
			ok: false,
			error: "kind must be 'text' or 'keys'"
		};
		const hasText = typeof body.text === "string" && body.text.length > 0;
		const hasKeys = Array.isArray(body.keys) && body.keys.length > 0;
		if (!hasText && !hasKeys) return {
			ok: false,
			error: "text or keys is required"
		};
		if (hasText && Buffer.byteLength(body.text, "utf8") > 65536) return {
			ok: false,
			error: "text exceeds 64KB limit"
		};
		if (hasKeys && body.keys.length > 32) return {
			ok: false,
			error: "keys array exceeds 32 item limit"
		};
		if (!await this.ownsPane(body.pane_id)) return {
			ok: false,
			error: "pane not accessible from this session"
		};
		try {
			await this.runtime.paneInput({
				pane_id: body.pane_id,
				text: body.text,
				keys: body.keys
			});
			return { ok: true };
		} catch (error) {
			return failure(error);
		}
	}
	async terminalBootstrap(request) {
		const body = record(request);
		if (!body.pane_id?.trim()) return {
			ok: false,
			error: "pane_id query parameter is required"
		};
		if (!await this.ownsPane(body.pane_id)) return {
			ok: false,
			error: "pane not accessible from this session"
		};
		const requested = Number(body.lines ?? 500);
		const lines = Math.min(Math.max(Number.isFinite(requested) ? requested : 500, 100), 5e4);
		try {
			const result = await this.runtime.paneRead({
				pane_id: body.pane_id,
				source: body.source === "recent_unwrapped" ? "recent_unwrapped" : "visible",
				lines,
				format: "ansi"
			});
			return {
				ok: true,
				text: result.text,
				revision: result.revision,
				truncated: result.truncated
			};
		} catch (error) {
			return {
				ok: false,
				error: error instanceof Error ? error.message : String(error)
			};
		}
	}
	async terminalStart(request) {
		const parsed = validateStart(record(request));
		if (parsed.error || !parsed.value) return {
			ok: false,
			error: parsed.error ?? "invalid request"
		};
		if (!await this.ownsPane(parsed.value.pane_id)) return {
			ok: false,
			error: "pane not accessible from this session"
		};
		if (!await this.runtime.ensureTerminal()) return { ...TERMINAL_UNAVAILABLE };
		const manager = this.runtime.terminal();
		if (!manager) return { ...TERMINAL_UNAVAILABLE };
		try {
			const started = manager.start(parsed.value);
			return {
				ok: true,
				error: void 0,
				session_id: started.sessionId,
				generation: started.generation
			};
		} catch (error) {
			return failure(error);
		}
	}
	async terminalCommand(request) {
		const body = record(request);
		const parsed = parseCommand({
			session_id: body.session_id,
			command: body.command
		});
		if (parsed.error || !parsed.value) return {
			ok: false,
			error: parsed.error ?? "invalid command"
		};
		const manager = this.runtime.terminal();
		if (!manager) return { ...TERMINAL_UNAVAILABLE };
		try {
			if (parsed.value.release) await manager.release(parsed.value.sessionId);
			else manager.writeCommand(parsed.value.sessionId, parsed.value.payload);
			return { ok: true };
		} catch (error) {
			return isTerminalSessionError(error) ? {
				ok: false,
				error: error.message
			} : failure(error);
		}
	}
	async terminalRelease(request) {
		const sessionId = String(record(request).session_id ?? "");
		if (!sessionId.trim()) return {
			ok: false,
			error: "session_id is required"
		};
		const manager = this.runtime.terminal();
		if (!manager) return { ok: true };
		await manager.release(sessionId);
		return { ok: true };
	}
	terminalStats() {
		return {
			ok: true,
			stats: this.runtime.terminal()?.report() ?? null
		};
	}
	async *events(request, signal) {
		const abortSignal = signal ?? this.ctx.invocation?.signal;
		const after = Number(record(request).after_revision);
		if (Number.isSafeInteger(after) && after >= 0) {
			const snap = this.runtime.tracker.snapshot("project");
			yield {
				type: "topology",
				topology: snap.topology,
				filter: snap.filter
			};
		}
		const queue = [];
		let wake = null;
		const push = (event) => {
			queue.push(event);
			wake?.();
			wake = null;
		};
		const manager = this.runtime.terminal();
		const stops = [this.ctx.on("herdr/agent-state", (info) => {
			push({
				type: "agent_status",
				pane_id: info.pane_id,
				agent: info.agent,
				status: info.status,
				...info.message ? { message: info.message } : {}
			});
			return true;
		}), this.ctx.on("herdr/resource-changed", () => {
			const snap = this.runtime.tracker.snapshot("project");
			push({
				type: "topology",
				topology: snap.topology,
				filter: snap.filter
			});
			return true;
		})];
		const client = this.ctx.herdr;
		let stopClient = null;
		if (typeof client.onEvent === "function") stopClient = client.onEvent((raw) => {
			const data = record(record(raw).data);
			const type = typeof data.type === "string" ? data.type : String(record(raw).event ?? "");
			if (type === "pane_output_changed") {
				const paneId = String(data.pane_id ?? "");
				if (paneId) push({
					type: "output",
					pane_id: paneId,
					revision: typeof data.revision === "number" ? data.revision : 0
				});
			} else if (TOPOLOGY_EVENTS.has(type)) {
				const snap = this.runtime.tracker.snapshot("project");
				push({
					type: "topology",
					topology: snap.topology,
					filter: snap.filter
				});
			}
		});
		let stopTerminal = null;
		if (manager) {
			manager.onGlobalClientConnect();
			stopTerminal = manager.addGlobalListener((sessionId, paneId, event) => push({
				type: "term",
				session_id: sessionId,
				pane_id: paneId,
				event
			}));
			for (const live of manager.liveSessions()) {
				const full = manager.replayLatestFull(live.sessionId);
				if (!full) continue;
				push({
					type: "term",
					session_id: live.sessionId,
					pane_id: live.paneId,
					event: {
						type: "ready",
						sessionId: live.sessionId,
						mode: live.mode,
						generation: live.generation,
						resumed: true,
						afterSeq: full.seq
					}
				});
				push({
					type: "term",
					session_id: live.sessionId,
					pane_id: live.paneId,
					event: full
				});
			}
		}
		const heartbeat = setInterval(() => {
			const snap = this.runtime.tracker.snapshot("project");
			push({
				type: "heartbeat",
				stale: snap.stale === true,
				last_error: snap.last_error ?? null
			});
		}, 1e4);
		const onAbort = () => {
			wake?.();
			wake = null;
		};
		abortSignal?.addEventListener("abort", onAbort, { once: true });
		try {
			while (!abortSignal?.aborted) {
				while (queue.length > 0) yield queue.shift();
				if (abortSignal?.aborted) break;
				await new Promise((resolve) => {
					wake = resolve;
				});
			}
		} finally {
			clearInterval(heartbeat);
			abortSignal?.removeEventListener("abort", onAbort);
			for (const stop of stops) stop();
			stopClient?.();
			stopTerminal?.();
			if (manager) manager.onGlobalClientDisconnect();
		}
	}
	async ownsPane(paneId) {
		const workspaces = new Set(getBoundWorkspaceIds());
		if (workspaces.size === 0) return true;
		try {
			const workspace = (await this.runtime.snapshot()).panes.find((pane) => pane.pane_id === paneId)?.workspace_id;
			return !!workspace && workspaces.has(workspace);
		} catch {
			return false;
		}
	}
};
const PANEL_REMOTE_METHODS = [
	"environment",
	"status",
	"dashboard",
	"topology",
	"agentOutputs",
	"sessionPane",
	"paneSession",
	"start",
	"close",
	"rename",
	"paneInput",
	"terminalBootstrap",
	"terminalStart",
	"terminalCommand",
	"terminalRelease",
	"terminalStats"
];
function installRemote(name, mode) {
	const decorator = mode === void 0 ? Remote : Remote({ mode });
	const proto = HerdrPanelService.prototype;
	const method = proto[name];
	if (typeof method !== "function") throw new Error(`herdr panel method ${name} is missing`);
	decorator(method, {
		kind: "method",
		name,
		static: false,
		private: false,
		addInitializer(fn) {
			fn.call(Object.create(proto));
		}
	});
}
for (const name of PANEL_REMOTE_METHODS) installRemote(name);
installRemote("events", "stream");
//#endregion
//#region src/host/environment/service.ts
/** Only fixed, non-mutating CLI probes. Bounded output/time; never shell commands from Remote payloads. */
function runProbe(bin, args, env = process.env) {
	const childEnv = {};
	for (const key of [
		"PATH",
		"HOME",
		"TMPDIR",
		"LANG",
		"LC_ALL",
		"TERM"
	]) if (env[key] !== void 0) childEnv[key] = env[key];
	return new Promise((resolve) => {
		execFile(bin, args, {
			env: childEnv,
			timeout: 2500,
			killSignal: "SIGKILL",
			maxBuffer: 8192,
			windowsHide: true
		}, (error, stdout) => resolve(error ? null : stdout.trim()));
	});
}
/** Created once per runtime. Concurrent clicks share probes; later clicks always re-detect installation. */
function createEnvironmentReader(config, deps = {}) {
	let pending = null;
	const inspect = async () => {
		const platform = deps.platform ?? process.platform;
		const hostArch = deps.arch ?? arch();
		const env = deps.env ?? process.env;
		const supported = ["linux", "darwin", "win32"].includes(platform) && ["x64", "arm64"].includes(hostArch);
		const cfg = resolveTerminalSessionConfig(config);
		const path = (deps.findHerdr ?? ((binPath) => findHerdrExecutable({
			binPath,
			env,
			platform
		})))(cfg.binPath);
		const diagnosticPath = path ?? (cfg.binPath || env.HERDR_BIN_PATH || null);
		const run = deps.run ?? ((bin, args) => runProbe(bin, args, env));
		const socketPath = supported ? resolveSocketPath(config, env) ?? null : null;
		const ping = deps.ping ?? ((path) => socketPing(path, 2500));
		const [versionText, help, pong] = await Promise.all([
			supported && path ? run(path, ["--version"]) : null,
			supported && path && cfg.enabled ? run(path, [
				"terminal",
				"session",
				"--help"
			]) : null,
			socketPath ? ping(socketPath).catch(() => null) : null
		]);
		const version = versionText?.match(/\b\d+\.\d+\.\d+(?:-[\w.-]+)?\b/)?.[0] ?? null;
		const findTool = deps.findTool ?? ((name) => findOnPath(name, {
			env,
			platform
		}));
		return {
			checkedAt: Date.now(),
			host: {
				platform,
				arch: hostArch,
				hostname: deps.hostname ?? hostname(),
				nodeVersion: process.version,
				wsl: platform === "linux" && (/microsoft|wsl/i.test(deps.release ?? release()) || !!env.WSL_DISTRO_NAME)
			},
			supported,
			cli: {
				path: diagnosticPath,
				version,
				state: !supported ? "unsupported" : !path ? "missing" : !version ? "unusable" : "available"
			},
			packageManagers: {
				npm: !!findTool("npm"),
				pnpm: !!findTool("pnpm")
			},
			connection: {
				socketPath,
				session: resolveSession(config, env) ?? null,
				running: !!pong,
				version: pong?.version ?? null,
				protocol: pong?.protocol ?? null
			},
			terminal: {
				enabled: cfg.enabled,
				available: !!help && /\bobserve\b/.test(help) && /\bcontrol\b/.test(help)
			},
			verified: {
				version: "0.9.0",
				protocol: 22
			}
		};
	};
	return () => {
		if (!pending) pending = inspect().finally(() => {
			pending = null;
		});
		return pending;
	};
}
//#endregion
//#region src/host/runtime.ts
const name$1 = "dsh-plugin-herdr-runtime";
const inject$1 = [
	"tools",
	"herdr",
	"jobs"
];
/**
* 消费者插件：注册 herdr_* 工具与事件转发。
* herdr 服务由 provider.ts 提供（index.ts 先装配它）；
* jobs 由 dsh-base 的 dsh-jobs-local 提供（后台化，§9）。
* cordis 4 要求访问服务的 fiber 显式 inject（见 index.ts 注释）。
*/
function apply$1(ctx, config) {
	registerHerdrTools(ctx, { allowBackground: config.allowBackground });
	const tracker = new HerdrStatusTracker(ctx, ctx.herdr, {
		pollIntervalMs: 2e3,
		projectRoot: config.projectRoot,
		binPath: config.terminalSession?.binPath,
		socketPath: resolveSocketPath(config) ?? null,
		session: resolveSession(config) ?? null
	});
	const dashboardTracker = new HerdrDashboardTracker(ctx, { readStatus: () => tracker.snapshot("all") });
	const terminal = createTerminalRuntime(config);
	const readEnvironment = createEnvironmentReader(config);
	new HerdrPanelService(ctx, {
		tracker,
		environment: async () => {
			const report = await readEnvironment();
			terminal.invalidateProbe();
			return report;
		},
		dashboard: dashboardTracker,
		terminal: () => terminal.manager(),
		ensureTerminal: () => terminal.ensureAvailable(),
		startServer: async () => {
			if (!["linux", "darwin", "win32"].includes(process.platform)) return {
				ok: false,
				error: `native platform unsupported (${process.platform}); run DSH and Herdr together in WSL`
			};
			const socketPath = resolveSocketPath(config);
			if (!socketPath) return {
				ok: false,
				error: "herdr socket path unresolvable (set terminalSession.socketPath or HERDR_SOCKET_PATH)"
			};
			const binPath = findHerdrExecutable({ binPath: config.terminalSession?.binPath });
			if (!binPath) return {
				ok: false,
				error: "herdr executable not found; open installation settings"
			};
			const server = await startHerdrServer(socketPath, {
				binPath,
				session: resolveSession(config) ?? null
			});
			return {
				ok: server.running,
				server
			};
		},
		snapshot: () => ctx.herdr.snapshot(),
		paneRead: (request) => ctx.herdr.paneRead(request),
		paneClose: (id) => ctx.herdr.paneClose(id),
		workspaceClose: (id) => ctx.herdr.workspaceClose(id),
		paneRename: (id, label) => ctx.herdr.paneRename(id, label),
		workspaceRename: (id, label) => ctx.herdr.workspaceRename(id, label),
		paneInput: (request) => ctx.herdr.paneSendInput(request)
	});
	tracker.start();
	dashboardTracker.start();
	const stopSkill = registerHerdrSkill(ctx);
	const stopEvents = setupHerdrEvents(ctx, config, tracker);
	ctx.effect(() => {
		return () => {
			stopEvents();
			tracker.stop();
			dashboardTracker.stop();
			terminal.dispose();
			stopSkill();
		};
	});
	ctx.effect(() => {
		createLogger(ctx, "index").info("plugin loaded! transport=socket timeoutMs=%d allowBackground=%s events=%s", config.timeoutMs, config.allowBackground, config.events.enabled);
		return () => createLogger(ctx, "index").debug("plugin disposed");
	});
}
//#endregion
//#region src/host/index.ts
const name = "dsh-plugin-herdr";
const inject = [];
/**
* 唯一的 host 入口。
*
* cordis 4 要求访问服务的 fiber 显式 inject 该服务，所以 ctx.herdr 的提供者
* 与消费者仍是两个 fiber，但都作为本入口的子插件装配：先挂 provider（ctx.herdr、
* preset），再挂 runtime（inject tools/herdr/jobs：工具、面板、事件）。
* 两者都 await，入口在子插件就绪后才变为 ACTIVE（Loader.await / HMR）。
* tools/jobs 晚到时 runtime 自动等待，不阻塞入口。
*/
async function apply(ctx, config) {
	await ctx.plugin({
		name: name$2,
		inject: [],
		apply: apply$2
	}, config);
	await ctx.plugin({
		name: name$1,
		inject: inject$1,
		apply: apply$1
	}, config);
}
//#endregion
export { Config, apply, inject, name };
