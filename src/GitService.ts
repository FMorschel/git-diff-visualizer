import * as cp from 'child_process';
import * as path from 'path';

export interface FileInfo {
    status: string;
    filePath: string;
    originalPath?: string;
    absolutePath: string;
    fileName: string;
    directory: string;
}

export class GitService {

    public static async run(cwd: string, args: string[]): Promise<string> {
        return new Promise((resolve, reject) => {
            const child = cp.spawn('git', args, {
                cwd,
                shell: true, // Required on Windows to find git in PATH
                // eslint-disable-next-line @typescript-eslint/naming-convention
                env: { ...process.env, 'LC_ALL': 'C' } // Ensure English output for parsing
            });

            let stdout = '';
            let stderr = '';

            child.stdout.on('data', (data) => stdout += data.toString());
            child.stderr.on('data', (data) => stderr += data.toString());

            child.on('close', (code) => {
                if (code === 0) {
                    resolve(stdout.trim());
                } else {
                    reject(new Error(`Git command failed: ${stderr || stdout}`));
                }
            });

            child.on('error', (err) => {
                reject(err);
            });
        });
    }

    public static async getRepoRoot(cwd: string): Promise<string> {
        return this.run(cwd, ['rev-parse', '--show-toplevel']);
    }

    public static async getBranches(cwd: string): Promise<{ current: string, all: string[] }> {
        const [branchesOutput, current] = await Promise.all([
            this.run(cwd, ['branch', '-a', '--format=%(refname:short)']),
            this.run(cwd, ['branch', '--show-current'])
        ]);

        const all = branchesOutput.split('\n')
            .map(b => b.trim())
            .filter(b => b !== '' && !b.includes('HEAD'));

        return { current, all };
    }

    public static async getMergeBase(cwd: string, target: string, source: string = 'HEAD'): Promise<string> {
        try {
            return await this.run(cwd, ['merge-base', target, source]);
        } catch (e) {
            throw new Error(`Could not determine common ancestor with "${target}".`);
        }
    }

    public static async getChangedFiles(repoRoot: string, ref: string): Promise<FileInfo[]> {
        // --name-status to see added/modified/deleted
        const output = await this.run(repoRoot, ['diff', '--name-status', ref]);

        if (!output) {
            return [];
        }

        return output.split('\n')
            .filter(l => l.trim())
            .map(line => {
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
    }

    public static async getFileContent(cwd: string, ref: string, relativePath: string): Promise<string> {
        try {
            // Use -- to separate ref from path to avoid ambiguity
            return await this.run(cwd, ['show', `${ref}:${relativePath}`]);
        } catch (e) {
            return ""; // Return empty if file doesn't exist (e.g. new file)
        }
    }
}
