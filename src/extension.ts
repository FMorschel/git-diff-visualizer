import * as vscode from 'vscode';
import * as path from 'path';
import { GitService } from './GitService';
import { DiffSidebarProvider } from './DiffSidebarProvider';

export function activate(context: vscode.ExtensionContext) {
	console.log('Congratulations, your extension "git-diff-visualizer" is now active!');

	const provider = new GitContentProvider();
	const registration = vscode.workspace.registerTextDocumentContentProvider('git-diff-visualizer', provider);
	context.subscriptions.push(registration);

	const sidebarProvider = new DiffSidebarProvider(context);
	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(DiffSidebarProvider.viewType, sidebarProvider)
	);

	let disposable = vscode.commands.registerCommand('git-diff-visualizer.showDiff', async () => {
		const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
		if (!workspaceFolder) {
			vscode.window.showErrorMessage('No workspace folder open');
			return;
		}

		const cwd = workspaceFolder.uri.fsPath;

		try {
			// Get branches (local and remote)
			const { current: currentBranch, all: branchList } = await GitService.getBranches(cwd);

			const savedDefault = context.workspaceState.get<string>('defaultBranch');
			let defaultBranch = savedDefault;

			if (!defaultBranch || !branchList.includes(defaultBranch)) {
				defaultBranch = branchList.find(b => b === 'main' || b === 'master') || branchList[0];
			}

			// Move default branch to top or pre-select it? QuickPick doesn't support pre-select easily without items.
			// We can sort.
			branchList.sort((a, b) => {
				if (a === defaultBranch) { return -1; }
				if (b === defaultBranch) { return 1; }
				return a.localeCompare(b);
			});

			const targetBranch = await vscode.window.showQuickPick(branchList, {
				placeHolder: `Select branch to compare against (current: ${currentBranch})`,
				canPickMany: false,
			});

			if (!targetBranch) {
				return;
			}

			// Get changed files (triple dot for merge base comparison)
			// --name-status to see added/modified/deleted
			const repoRoot = await GitService.getRepoRoot(cwd);
			const cleanTarget = targetBranch.trim();

			// Find merge base to compare against "what I'm working on" vs "what others did"
			let diffRef = cleanTarget;
			try {
				const mergeBase = await GitService.getMergeBase(repoRoot, cleanTarget, 'HEAD');
				if (mergeBase) {
					diffRef = mergeBase;
				}
			} catch (e) {
				vscode.window.showErrorMessage(`Could not determine common ancestor with "${cleanTarget}".`);
				return;
			}

			const files = await GitService.getChangedFiles(repoRoot, diffRef);

			if (files.length === 0) {
				vscode.window.showInformationMessage('No changes found.');
				return;
			}

			const items = files.map(f => ({
				label: f.filePath,
				description: f.status,
				file: f
			}));

			const selected = await vscode.window.showQuickPick(items, {
				placeHolder: 'Select a file to view diff'
			});

			if (selected) {
				const relativePath = selected.file.filePath;
				const originalPath = selected.file.originalPath || relativePath;
				const absolutePath = selected.file.absolutePath;

				// Left side: version from target branch (or merge base)
				// We use our custom scheme
				// We encode the repoRoot to pass it to the provider
				const query = `ref=${encodeURIComponent(diffRef)}&cwd=${encodeURIComponent(repoRoot)}`;
				const leftUri = vscode.Uri.from({
					scheme: 'git-diff-visualizer',
					path: '/' + originalPath,
					query: query
				});

				// Right side: current file on disk
				const rightUri = vscode.Uri.file(absolutePath);

				const title = `${path.basename(relativePath)} (${targetBranch} ↔ Local)`;

				await vscode.commands.executeCommand('vscode.diff', leftUri, rightUri, title);
			}

		} catch (err: any) {
			vscode.window.showErrorMessage(`Error: ${err.message}`);
		}
	});

	context.subscriptions.push(disposable);
}

class GitContentProvider implements vscode.TextDocumentContentProvider {
	provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
		const query = new URLSearchParams(uri.query);
		const ref = query.get('ref');
		const cwd = query.get('cwd');

		if (!ref || !cwd) {
			return Promise.resolve("");
		}

		// uri.path is /path/to/file. We need relative path for git show usually.
		// The uri.path coming from `vscode.Uri.parse` will start with /.
		const relativePath = uri.path.startsWith('/') ? uri.path.substring(1) : uri.path;

		return GitService.getFileContent(cwd, ref, relativePath);
	}
}

export function deactivate() {}

