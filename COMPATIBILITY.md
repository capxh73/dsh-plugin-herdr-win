# Compatibility and verification

## Download channels (checked 2026-10-11)

The npm registry reported `latest` and `next` as **0.2.0-rc.2**, and `alpha` as
**0.2.1-alpha.2**. The newest GitHub release is `dsh-v0.2.1-alpha.2`, published
2026-10-09. A GitHub prerelease is not necessarily npm's default download.

DSH Web is launched by the `@deepseek-ai/dsh` CLI (`dsh web`); the package
`@deepseek-ai/dsh-web` is not a replacement CLI installer.

| Plugin | Host release | Intent |
| --- | --- | --- |
| 0.0.3 | 0.2.0-rc.2 | Default npm download at this checkpoint |
| 0.0.3 | 0.2.1-alpha.1 | Existing preview installations |
| 0.0.3 | 0.2.1-alpha.2 | Latest published alpha; development/typecheck baseline |
| 0.0.3 | 0.2.1-rc.3 | The release bundled by the Windows DSH desktop app; verified on Windows |

Only these exact prereleases are admitted by `engines.dsh` and the DSH peer
family. Other versions require a new compatibility run, not an unrestricted
`>=` range. The rc.2 host uses Cordis 4.0.4 and Schemastery 3.18.4; alpha hosts
use Cordis 4.0.5-alpha.1 and Schemastery 3.18.5-alpha.1; the rc.3 desktop host
uses Cordis 4.0.5 and Schemastery 3.18.5. All three vendor pairs are admitted
explicitly, while the build uses the alpha pair. React stays supplied by the Web
shell, not bundled.

## Runtime requirements

Node 24+, Linux, macOS or native Windows (x64/arm64), and a local running Herdr
server. Native Windows is verified against Herdr 0.9.3 and DSH 0.2.1-rc.3; see
"Native Windows transport" below for what differs. Herdr control-plane fixtures
use **0.9.0 / protocol 22**. Arbitrary Herdr protocol upgrades are not claimed.
For WSL, both the server and plugin must run inside the same Linux environment; a
WSL host is detected and reported as such.

## Native Windows transport

Herdr's Windows build exposes its control socket as a **named pipe**, not a
filesystem socket. The plugin therefore keeps the configured endpoint as a plain
path (`%APPDATA%\herdr\herdr.sock`, or `sessions/<name>/herdr.sock`) for display
and configuration, and translates it to `\\.\pipe\<path>` only at the
`net.createConnection` boundary (`toConnectTarget`). The translation is
idempotent, so an endpoint that already starts with `\\` is passed through
unchanged. `socketPing`, the request channel and the subscription stream all use
the same boundary.

Process probing on Windows uses `tasklist /FI "IMAGENAME eq herdr.exe" /FO CSV`
instead of `pgrep`/`ps`. CPU percentage and process start time are not exposed by
that command and are reported as `null` rather than guessed. The child
environment allowlist gains the Windows system variables (`SYSTEMROOT`,
`COMSPEC`, `PATHEXT`, `USERPROFILE`, `APPDATA`, `LOCALAPPDATA`, `TEMP`, …) and is
matched case-insensitively, because Windows environment variable names are
case-insensitive. Every spawned process sets `windowsHide: true`.

Command submission differs by platform. `herdr_pane_run` sends the command with
`pane.send_input(text, keys: ["enter"])` rather than `pane.send_text(text + "\n")`.
A bare LF is accepted as a line terminator by POSIX shells, so the `send_text`
form worked on Linux and macOS, but PowerShell's PSReadLine treats a lone LF as a
line continuation: the command text lands in the pane and the prompt stops at a
`>> ` continuation marker without ever executing. Sending an explicit Enter key
event is what the `herdr pane run` CLI does, and it submits correctly on both
PowerShell and POSIX shells.

Model-facing text is platform-aware too. The embedded `herdr` skill ships the
environment check and caller-context dump for POSIX shells, PowerShell and
cmd.exe, plus a "Shell syntax on Windows" section that warns the remaining
POSIX-shaped examples must be translated (`$env:NAME` vs `%NAME%` vs `$NAME`).
The `herdr_pane_run` parameter description says the command is typed into the
pane's own shell rather than claiming `sh -c`.

`herdr terminal attach` is unsupported on Windows, but
`herdr terminal session observe|control` is available. Terminal-session capability
is decided by probing `herdr terminal session --help` for `observe`/`control`,
not by platform, so a trimmed or backported Windows build is reported honestly.

The Windows installer places the binary under
`%USERPROFILE%\.herdr\packages\standalone\releases\<version>-x86_64-pc-windows-msvc\`
and exposes a stable alias at `%LOCALAPPDATA%\Programs\Herdr\bin`. Executable
discovery searches `PATH` first, then both of those locations.

## Gates

The `ci` workflow runs a frozen dependency install, build, strict typecheck,
generated-type check and complete unit suite. Packaging tests extract the actual
`pnpm pack` tarball and verify exports, types, locale files and Web factory
externals. The DSH smoke matrix installs that tarball with each published CLI in
a disposable `DSH_HOME`, opens the real Web shell in Chromium, visits the Herdr
dashboard, checks unhandled browser errors, then uninstalls the plugin.

Real Herdr integration uses the pinned **0.9.0 and 0.9.3** Linux binaries, each
with its published SHA-256 checked, a unique test session, and mandatory preflight.
0.9.3 was the current stable release checked on 2026-10-12 and also declares
protocol 22. This additional integration matrix does not replace the 0.9.0
schema fixture or certify every browser/terminal interaction on 0.9.3.
Missing prerequisites fail CI; local integration may still explicitly skip.

A passing check certifies only the scenarios it executes. It does not certify
LLM-driven agent work, credentials, remote multi-user isolation, every terminal
reconnect race or every supported operating system. The larger review-hardening
work remains separate in draft PR #13 and is not included in this release.

For release acceptance, inspect checks on the exact PR head/merge commit and
its `dsh-smoke-*` evidence artifacts. Do not treat an old green run or a skipped
integration job as evidence for a new commit.

## Environment management acceptance

The installation panel uses Host platform/architecture, never browser user-agent detection.
Open it through **Herdr → Installation & settings** or
**Settings → Built-in plugins → Herdr environment**; the latter owns `settings.plugins.tab`.
The DSH matrix exercises both entry points, copy/recheck, and the additional alpha.2
missing-install case: missing binary → copy the already verified Herdr binary to the
configured test path → recheck → explicitly start a uniquely named server.
No network installer is executed by the Web service or browser test. Active connection
configuration is inspected, not edited live; applying changed paths requires a host restart.
Official install guidance: https://herdr.dev/docs/install/ (checked 2026-10-12). No official
npm-based Herdr installer is claimed. Native Windows is officially supported by Herdr
(ConPTY-based, not WSL-only): the Windows installer is
`powershell -ExecutionPolicy Bypass -c "irm https://herdr.dev/install.ps1 | iex"` with a
`curl.exe … install.cmd` fallback, and the installation panel offers both on win32 hosts
instead of a WSL suggestion.

## Sources

- https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.1-alpha.2
- https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-alpha.2/README.md
- https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.0-rc.2/vendor/cordis/package.json
- https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.0-rc.2/vendor/schemastery/package.json
- https://registry.npmjs.org/-/package/@deepseek-ai/dsh/dist-tags
- https://github.com/herdrdev/herdr/releases/tag/v0.9.3
- https://github.com/herdrdev/herdr/blob/v0.9.3/src/protocol/wire.rs

Registry evidence is collected by CI with `npm view @deepseek-ai/dsh dist-tags --json`.
