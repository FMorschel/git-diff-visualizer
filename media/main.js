(function () {
    const vscode = acquireVsCodeApi();

    const branchInput = document.getElementById('branch-input');
    const branchDropdown = document.getElementById('branch-dropdown');
    const refreshBtn = document.getElementById('refresh-btn');
    const saveDefaultBtn = document.getElementById('save-default-btn');
    const clearBtn = document.getElementById('clear-btn');
    const fileList = document.getElementById('file-list');
    const toggleFilterBtn = document.getElementById('toggle-filter-btn');
    const filterContainer = document.getElementById('filter-container');
    const fileFilterInput = document.getElementById('file-filter-input');

    // Context Menu
    const contextMenu = document.createElement('div');
    contextMenu.className = 'context-menu';
    document.body.appendChild(contextMenu);

    let currentFiles = [];
    let currentBranch = '';
    let currentDiffRef = '';
    let allBranches = [];
    let activeContextMenuFileItem = null;

    // Close context menu on click anywhere
    document.addEventListener('click', () => {
        contextMenu.style.display = 'none';
        if (activeContextMenuFileItem) {
            activeContextMenuFileItem.classList.remove('context-menu-active');
            activeContextMenuFileItem = null;
        }
    });

    // Prevent default context menu globally
    document.addEventListener('contextmenu', (e) => {
        // Only prevent if we are handling it or if we want to block standard menu
        // For now, let's block standard menu on the file list items
        if (e.target.closest('.file-item')) {
            e.preventDefault();
        }
    });

    // Initial load
    vscode.postMessage({ type: 'getBranches' });

    refreshBtn.addEventListener('click', () => {
        vscode.postMessage({ type: 'getBranches' });
    });

    toggleFilterBtn.addEventListener('click', () => {
        const isHidden = filterContainer.style.display === 'none';
        filterContainer.style.display = isHidden ? 'block' : 'none';
        if (isHidden) {
            fileFilterInput.focus();
        } else {
            fileFilterInput.value = '';
            renderFiles();
        }
    });

    fileFilterInput.addEventListener('input', () => {
        renderFiles();
    });

    saveDefaultBtn.addEventListener('click', () => {
        const branch = branchInput.value;
        if (branch) {
            vscode.postMessage({ type: 'saveDefaultBranch', value: branch });
        }
    });

    clearBtn.addEventListener('click', () => {
        branchInput.value = '';
        updateClearBtn();
        branchInput.focus();
        filterBranches();
    });

    function updateClearBtn() {
        clearBtn.style.display = branchInput.value ? 'flex' : 'none';
    }

    // Input handling
    branchInput.addEventListener('focus', () => {
        filterBranches();
        branchDropdown.classList.add('show');
    });

    branchInput.addEventListener('input', () => {
        updateClearBtn();
        filterBranches();
        branchDropdown.classList.add('show');
    });

    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
        if (!branchInput.contains(e.target) && !branchDropdown.contains(e.target)) {
            branchDropdown.classList.remove('show');
        }
    });

    // Handle Enter key
    branchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            const branch = e.target.value;
            if (branch) {
                vscode.postMessage({ type: 'selectBranch', value: branch });
                branchDropdown.classList.remove('show');
            }
        }
    });

    function filterBranches() {
        const filter = branchInput.value.toLowerCase();
        branchDropdown.innerHTML = '';
        
        const filtered = allBranches.filter(b => b.toLowerCase().includes(filter));
        
        filtered.forEach(branch => {
            const div = document.createElement('div');
            div.textContent = branch;
            div.addEventListener('click', () => {
                branchInput.value = branch;
                updateClearBtn();
                vscode.postMessage({ type: 'selectBranch', value: branch });
                branchDropdown.classList.remove('show');
            });
            branchDropdown.appendChild(div);
        });

        if (filtered.length === 0) {
             const div = document.createElement('div');
             div.textContent = 'No matches';
             div.style.color = 'var(--vscode-descriptionForeground)';
             div.style.cursor = 'default';
             branchDropdown.appendChild(div);
        }
    }

    window.addEventListener('message', event => {
        const message = event.data;
        switch (message.type) {
            case 'setBranches':
                updateBranches(message.branches, message.currentBranch, message.defaultBranch);
                break;
            case 'setFiles':
                updateFiles(message.files, message.targetBranch, message.diffRef);
                break;
            case 'error':
                fileList.innerHTML = `<div style="padding: 10px; color: var(--vscode-errorForeground);">${message.value}</div>`;
                break;
        }
    });

    function updateBranches(branches, current, defaultBranch) {
        allBranches = branches;
        
        // If we already had a selection, keep it if possible
        if (currentBranch && branches.includes(currentBranch)) {
            branchInput.value = currentBranch;
        } else if (defaultBranch && !currentBranch) {
             branchInput.value = defaultBranch;
             // Trigger load for default
             vscode.postMessage({ type: 'selectBranch', value: defaultBranch });
        }
        updateClearBtn();
    }

    function updateFiles(files, targetBranch, diffRef) {
        currentFiles = files;
        currentBranch = targetBranch;
        currentDiffRef = diffRef;
        renderFiles();
    }

    function renderFiles() {
        fileList.innerHTML = '';
        const filter = fileFilterInput.value.toLowerCase();
        
        const filteredFiles = currentFiles.filter(file => {
            return file.fileName.toLowerCase().includes(filter) || 
                   file.filePath.toLowerCase().includes(filter);
        });

        if (filteredFiles.length === 0) {
            if (currentFiles.length === 0) {
                fileList.innerHTML = '<div style="padding: 10px;">No changes found.</div>';
            } else {
                fileList.innerHTML = '<div style="padding: 10px;">No matching files found.</div>';
            }
            return;
        }

        filteredFiles.forEach(file => {
            const div = document.createElement('div');
            div.className = 'file-item';
            div.title = file.filePath;
            
            const statusSpan = document.createElement('span');
            statusSpan.className = `file-status status-${file.status.charAt(0)}`;
            statusSpan.textContent = file.status.charAt(0);
            
            const infoDiv = document.createElement('div');
            infoDiv.className = 'file-info';

            const nameSpan = document.createElement('div');
            nameSpan.className = 'file-name';
            nameSpan.textContent = file.fileName;

            const pathSpan = document.createElement('div');
            pathSpan.className = 'file-path';
            pathSpan.textContent = file.directory;

            infoDiv.appendChild(nameSpan);
            infoDiv.appendChild(pathSpan);

            div.appendChild(statusSpan);
            div.appendChild(infoDiv);

            div.addEventListener('click', () => {
                vscode.postMessage({ type: 'openFile', file: file, branch: currentBranch, diffRef: currentDiffRef });
            });

            div.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                if (activeContextMenuFileItem) {
                    activeContextMenuFileItem.classList.remove('context-menu-active');
                }
                activeContextMenuFileItem = div;
                div.classList.add('context-menu-active');
                showContextMenu(e.clientX, e.clientY, file);
            });

            fileList.appendChild(div);
        });
    }

    function showContextMenu(x, y, file) {
        contextMenu.innerHTML = '';
        
        const actions = [
            { label: 'Open File', action: () => vscode.postMessage({ type: 'openSourceFile', file: file }) },
            { label: 'Copy Path', action: () => copyToClipboard(file.filePath) },
            { label: 'Copy Absolute Path', action: () => copyToClipboard(file.absolutePath) },
            { label: 'Copy File Name', action: () => copyToClipboard(file.fileName) }
        ];

        actions.forEach(item => {
            const div = document.createElement('div');
            div.className = 'context-menu-item';
            div.textContent = item.label;
            div.addEventListener('click', () => {
                item.action();
                contextMenu.style.display = 'none';
            });
            contextMenu.appendChild(div);
        });

        // Adjust position to keep in viewport
        contextMenu.style.display = 'block';
        
        const rect = contextMenu.getBoundingClientRect();
        const winWidth = window.innerWidth;
        const winHeight = window.innerHeight;

        if (x + rect.width > winWidth) {x = winWidth - rect.width;}
        if (y + rect.height > winHeight) {y = winHeight - rect.height;}

        contextMenu.style.left = `${x}px`;
        contextMenu.style.top = `${y}px`;
    }

    function copyToClipboard(text) {
        navigator.clipboard.writeText(text).then(() => {
            // Optional: Show a small tooltip or feedback?
            // For now, we rely on the user knowing it worked.
        });
    }
}());
