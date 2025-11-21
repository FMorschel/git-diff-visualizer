import * as vscode from 'vscode';
import * as path from 'path';
import { GitService } from './GitService';

interface FileInfo {
    status: string;
    filePath: string;
    originalPath?: string;
    absolutePath: string;
    fileName: string;
    directory: string;
}

interface WebviewMessage {
    type: string;
    value?: any;
    file?: FileInfo;
    branch?: string;
    diffRef?: string;
}

export class DiffSidebarProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'git-diff-visualizer.sidebar';

    private _view?: vscode.WebviewView;

    constructor(
        private readonly _context: vscode.ExtensionContext,
    ) { }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                this._context.extensionUri
            ]
        };

        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

        webviewView.webview.onDidReceiveMessage(async (data: WebviewMessage) => {
            switch (data.type) {
                case 'onInfo': {
                    if (!data.value) {
                        return;
                    }
                    vscode.window.showInformationMessage(data.value);
                    break;
                }
                case 'onError': {
                    if (!data.value) {
                        return;
                    }
                    vscode.window.showErrorMessage(data.value);
                    break;
                }
                case 'getBranches': {
                    await this.loadBranches();
                    break;
                }
                case 'selectBranch': {
                    if (data.value) {
                        await this.loadFiles(data.value);
                    }
                    break;
                }
                case 'saveDefaultBranch': {
                    if (data.value) {
                        await this._context.workspaceState.update('defaultBranch', data.value);
                        vscode.window.showInformationMessage(`Default branch set to ${data.value}`);
                    }
                    break;
                }
                case 'openFile': {
                    if (data.file && data.branch) {
                        await this.openDiff(data.file, data.branch, data.diffRef);
                    }
                    break;
                }
            }
        });
    }

    private async loadBranches() {
        if (!this._view) { return; }
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            return;
        }
        const cwd = workspaceFolder.uri.fsPath;

        try {
            const branchesOutput = await GitService.run(cwd, ['branch', '-a', '--format=%(refname:short)']);
            const branches = branchesOutput.split('\n')
                .map((b: string) => b.trim())
                .filter((b: string) => b !== '' && !b.includes('HEAD'));

            const currentBranch = await GitService.run(cwd, ['branch', '--show-current']);

            // Check for saved default
            const savedDefault = this._context.workspaceState.get<string>('defaultBranch');

            // Sort: savedDefault -> main/master -> others
            let defaultBranch = savedDefault;
            if (!defaultBranch || !branches.includes(defaultBranch)) {
                 defaultBranch = branches.find((b: string) => b === 'main' || b === 'master') || branches[0];
            }

            branches.sort((a: string, b: string) => {
                if (a === defaultBranch) {
                    return -1;
                }
                if (b === defaultBranch) {
                    return 1;
                }
                return a.localeCompare(b);
            });

            this._view.webview.postMessage({ type: 'setBranches', branches, currentBranch, defaultBranch });

            // Auto-load default branch files
            if (defaultBranch) {
                this.loadFiles(defaultBranch);
            }
        } catch (e: any) {
            this._view.webview.postMessage({ type: 'error', value: e.message });
        }
    }

    private async loadFiles(targetBranch: string) {
        if (!this._view) { return; }
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            return;
        }
        const cwd = workspaceFolder.uri.fsPath;

        try {
            const repoRoot = await GitService.run(cwd, ['rev-parse', '--show-toplevel']);
            const cleanTarget = targetBranch.trim();

            // Find merge base to compare against "what I'm working on" vs "what others did"
            let diffRef = cleanTarget;

            try {
                const mergeBase = await GitService.run(repoRoot, ['merge-base', cleanTarget, 'HEAD']);
                if (mergeBase) {
                    diffRef = mergeBase;
                }
            } catch (e) {
                console.warn('Failed to get merge-base', e);
                this._view.webview.postMessage({ type: 'error', value: `Could not determine common ancestor with "${cleanTarget}". Ensure the branch exists and shares history.` });
                return;
            }

            console.log(`Git Diff Visualizer: Using diffRef '${diffRef}' (target: '${cleanTarget}')`);
            const diffOutput = await GitService.run(repoRoot, ['diff', '--name-status', diffRef]);

            const files = diffOutput.split('\n').filter((l: string) => l.trim()).map((line: string) => {
                const parts = line.split('\t');
                const status = parts[0];
                let filePath = parts[1];
                let originalPath: string | undefined;

                if (status.startsWith('R')) {
                    filePath = parts[2];
                    originalPath = parts[1];
                }

                const absolutePath = path.join(repoRoot, filePath);
                const fileName = path.basename(filePath);
                const directory = path.dirname(filePath);

                return { status, filePath, originalPath, absolutePath, fileName, directory };
            });

            this._view.webview.postMessage({ type: 'setFiles', files, targetBranch, diffRef });
        } catch (e: any) {
            this._view.webview.postMessage({ type: 'error', value: e.message });
        }
    }

    private async openDiff(file: FileInfo, targetBranch: string, diffRef?: string) {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            return;
        }
        const cwd = workspaceFolder.uri.fsPath;

        // filePath is relative to repo root (from git diff)
        const relativePath = file.filePath;
        const originalPath = file.originalPath || relativePath;
        const absolutePath = file.absolutePath;

        // We pass the repo root as cwd to the provider so it can run git show correctly
        const repoRoot = await GitService.run(cwd, ['rev-parse', '--show-toplevel']);

        // Use diffRef (merge-base) if available, otherwise targetBranch
        const ref = diffRef || targetBranch;

        const query = `ref=${encodeURIComponent(ref)}&cwd=${encodeURIComponent(repoRoot)}`;
        const leftUri = vscode.Uri.from({
            scheme: 'git-diff-visualizer',
            path: '/' + originalPath,
            query: query
        });
        const rightUri = vscode.Uri.file(absolutePath);
        const title = `${path.basename(relativePath)} (${targetBranch} ↔ Local)`;

        await vscode.commands.executeCommand('vscode.diff', leftUri, rightUri, title);
    }

    private _getHtmlForWebview(webview: vscode.Webview) {
        const styleResetUri = webview.asWebviewUri(vscode.Uri.joinPath(this._context.extensionUri, 'media', 'reset.css'));
        const styleVSCodeUri = webview.asWebviewUri(vscode.Uri.joinPath(this._context.extensionUri, 'media', 'vscode.css'));
        const styleMainUri = webview.asWebviewUri(vscode.Uri.joinPath(this._context.extensionUri, 'media', 'main.css'));
        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._context.extensionUri, 'media', 'main.js'));

        return `<!DOCTYPE html>
			<html lang="en">
			<head>
				<meta charset="UTF-8">
				<meta name="viewport" content="width=device-width, initial-scale=1.0">
				<link href="${styleResetUri}" rel="stylesheet">
				<link href="${styleVSCodeUri}" rel="stylesheet">
				<link href="${styleMainUri}" rel="stylesheet">
				<title>Git Diff Visualizer</title>
			</head>
			<body>
                <div class="container">
                    <div class="controls">
                        <label for="branch-select">Compare against:</label>
                        <div class="input-group">
                            <div class="input-wrapper">
                                <input type="text" id="branch-input" placeholder="Type branch name..." autocomplete="off" />
                                <button id="clear-btn" class="icon-btn" title="Clear" style="display: none;">
                                    <svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" fill="currentColor"><path d="M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13zM0 8a8 8 0 1 1 16 0A8 8 0 0 1 0 8zm10.74-3.26a.75.75 0 0 0-1.06-1.06L8 6.94 6.32 5.26a.75.75 0 1 0-1.06 1.06L6.94 8 5.26 9.68a.75.75 0 0 0 1.06 1.06L8 9.06l1.68 1.68a.75.75 0 0 0 1.06-1.06L9.06 8l1.68-1.68z"/></svg>
                                </button>
                                <button id="save-default-btn" class="icon-btn" title="Save as default">
                                    <svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" fill="currentColor"><path d="M13.85 4.15l-3-3A.5.5 0 0 0 10.5 1h-9a.5.5 0 0 0-.5.5v13a.5.5 0 0 0 .5.5h13a.5.5 0 0 0 .5-.5v-10a.5.5 0 0 0-.15-.35zM10 2v3h-4V2h4zM14 14H2V2h1v4a.5.5 0 0 0 .5.5h7a.5.5 0 0 0 .5-.5V2h2.5l.5.5v11.5z"/></svg>
                                </button>
                            </div>
                            <div id="branch-dropdown" class="dropdown-content"></div>
                        </div>
                        <div class="button-row">
                            <button id="refresh-btn">Refresh</button>
                            <button id="toggle-filter-btn" class="icon-btn" title="Filter Files">
                                <svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" fill="currentColor"><path d="M6 12v-1h4v1H6zM4 7h8v1H4V7zm10-4v1H2V3h12z"/></svg>
                            </button>
                        </div>
                        <div id="filter-container" class="filter-container" style="display: none;">
                            <input type="text" id="file-filter-input" placeholder="Filter files..." autocomplete="off" />
                        </div>
                    </div>
                    <div id="file-list" class="file-list">
                    </div>
                </div>
				<script src="${scriptUri}"></script>
			</body>
			</html>`;
    }
}
