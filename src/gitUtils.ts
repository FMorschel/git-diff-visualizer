import * as cp from 'child_process';

export function runGitCommand(cwd: string, command: string): Promise<string> {
	return new Promise((resolve, reject) => {
		cp.exec(`git ${command}`, { cwd, maxBuffer: 1024 * 1024 * 10 }, (err, stdout, stderr) => {
			if (err) {
				reject(new Error(stderr || err.message));
			} else {
				resolve(stdout);
			}
		});
	});
}
