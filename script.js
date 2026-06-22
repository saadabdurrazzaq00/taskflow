(function() {
    const STORAGE_KEY = 'taskflow_advanced_v3';
    const DARK_KEY = 'taskflow_dark_mode';
    let tasks = [];
    let deletedTask = null;
    let undoTimeout = null;
    let activeDateFilter = 'all';
    // Keep track of expanded notes across renders
    let expandedNotes = new Set();

    // DOM cache
    const DOM = {
        taskList: document.getElementById('taskList'),
        searchInput: document.getElementById('searchInput'),
        categoryFilter: document.getElementById('categoryFilter'),
        sortSelect: document.getElementById('sortSelect'),
        statTotal: document.getElementById('statTotal'),
        statPending: document.getElementById('statPending'),
        statDone: document.getElementById('statDone'),
        progressFill: document.getElementById('progressFill'),
        progressText: document.getElementById('progressText'),
        toast: document.getElementById('toast'),
        receiptContainer: document.getElementById('receipt-container'),
        receiptContent: document.getElementById('receiptContent'),
        confirmModal: document.getElementById('confirmModal'),
        shortcutsModal: document.getElementById('shortcutsModal'),
        listHeading: document.getElementById('listHeading'),
        emptyMessage: document.getElementById('emptyMessage'),
        dateFiltersContainer: document.getElementById('dateFilters'),
    };

    // Utility: relative date label
    function getRelativeDateLabel(dateStr) {
        if (!dateStr) return '';
        const today = new Date();
        today.setHours(0,0,0,0);
        const due = new Date(dateStr + 'T00:00:00');
        const diffTime = due - today;
        const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));
        if (diffDays === 0) return 'Due Today';
        if (diffDays === 1) return 'Due Tomorrow';
        if (diffDays === -1) return 'Yesterday';
        if (diffDays < -1) return `${Math.abs(diffDays)}d overdue`;
        if (diffDays <= 7) return `In ${diffDays} days`;
        return '';
    }

    function loadTasks() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            tasks = raw ? JSON.parse(raw) : [];
        } catch { tasks = []; }
        tasks = tasks.map(t => ({
            id: t.id || Date.now(),
            name: t.name || t.text || '',
            description: t.description || '',
            date: t.date || '',
            priority: t.priority || 'medium',
            category: t.category || '',
            completed: !!t.completed,
            note: t.note || '',
            createdAt: t.createdAt || new Date().toISOString(),
        }));
    }

    function saveTasks() {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
    }

    function applyDarkMode() {
        const isDark = localStorage.getItem(DARK_KEY) === 'true';
        document.body.classList.toggle('dark-mode', isDark);
        document.getElementById('darkModeToggle').textContent = isDark ? '☀️' : '🌙';
    }

    window.toggleDarkMode = function() {
        const isDark = !document.body.classList.contains('dark-mode');
        document.body.classList.toggle('dark-mode', isDark);
        localStorage.setItem(DARK_KEY, isDark);
        document.getElementById('darkModeToggle').textContent = isDark ? '☀️' : '🌙';
    };

    // ----- Filter logic for date classification -----
    function isOverdue(task) {
        if (task.completed || !task.date) return false;
        const today = new Date();
        today.setHours(0,0,0,0);
        const due = new Date(task.date + 'T00:00:00');
        return due < today;
    }

    function matchesDateFilter(task) {
        if (activeDateFilter === 'all') return true;
        const today = new Date();
        today.setHours(0,0,0,0);
        const dueDate = task.date ? new Date(task.date + 'T00:00:00') : null;
        switch (activeDateFilter) {
            case 'today':
                return dueDate && dueDate.getTime() === today.getTime();
            case 'tomorrow':
                if (!dueDate) return false;
                const tomorrow = new Date(today);
                tomorrow.setDate(today.getDate() + 1);
                return dueDate.getTime() === tomorrow.getTime();
            case 'yesterday':
                if (!dueDate) return false;
                const yesterday = new Date(today);
                yesterday.setDate(today.getDate() - 1);
                return dueDate.getTime() === yesterday.getTime();
            case 'week':
                if (!dueDate) return false;
                const endOfWeek = new Date(today);
                endOfWeek.setDate(today.getDate() + (7 - today.getDay()));
                return dueDate >= today && dueDate <= endOfWeek;
            case 'overdue':
                return isOverdue(task);
            case 'no-date':
                return !task.date;
            default:
                return true;
        }
    }

    function setDateFilter(filter) {
        activeDateFilter = filter;
        // Update active button
        document.querySelectorAll('.filter-chip').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.filter === filter);
        });
        renderTasks();
    }

    // ----- Date filter button events -----
    document.getElementById('dateFilters').addEventListener('click', (e) => {
        if (e.target.classList.contains('filter-chip')) {
            setDateFilter(e.target.dataset.filter);
        }
    });

    // ----- Task CRUD -----
    window.addTask = function() {
        const name = document.getElementById('taskNameInput').value.trim();
        if (!name) return showToast('Please enter a task name.');
        const task = {
            id: Date.now(),
            name,
            description: document.getElementById('taskDescInput').value.trim(),
            date: document.getElementById('dateInput').value,
            priority: document.getElementById('priorityInput').value,
            category: document.getElementById('categoryInput').value,
            completed: false,
            note: '',
            createdAt: new Date().toISOString(),
        };
        tasks.unshift(task);
        saveTasks();
        clearInputs();
        renderTasks();
        updateStats();
        showToast('Task added ✨');
    };

    function clearInputs() {
        document.getElementById('taskNameInput').value = '';
        document.getElementById('taskDescInput').value = '';
        document.getElementById('dateInput').value = '';
        document.getElementById('priorityInput').value = 'medium';
        document.getElementById('categoryInput').value = '';
    }

    window.toggleTask = function(id) {
        const task = tasks.find(t => t.id === id);
        if (task) {
            task.completed = !task.completed;
            saveTasks();
            renderTasks();
            updateStats();
        }
    };

    window.deleteTask = function(id) {
        const index = tasks.findIndex(t => t.id === id);
        if (index > -1) {
            deletedTask = tasks[index];
            tasks.splice(index, 1);
            saveTasks();
            renderTasks();
            updateStats();
            showUndoToast(`Task deleted`, () => {
                tasks.splice(index, 0, deletedTask);
                deletedTask = null;
                saveTasks();
                renderTasks();
                updateStats();
                showToast('Task restored');
            });
        }
    };

    function showUndoToast(message, undoCallback) {
        const toast = DOM.toast;
        toast.innerHTML = `${message} <button class="undo-btn" id="undoBtn">Undo</button>`;
        toast.classList.add('show');
        document.getElementById('undoBtn').onclick = () => {
            undoCallback();
            toast.classList.remove('show');
            clearTimeout(undoTimeout);
        };
        undoTimeout = setTimeout(() => {
            toast.classList.remove('show');
            deletedTask = null;
        }, 3000);
    }

    window.toggleNote = function(id) {
        // Toggle in expanded set
        if (expandedNotes.has(id)) {
            expandedNotes.delete(id);
        } else {
            expandedNotes.add(id);
        }
        renderTasks(); // re-render to apply visibility (we could just toggle class, but simpler)
    };

    window.updateNote = function(id, textarea) {
        const task = tasks.find(t => t.id === id);
        if (task) {
            task.note = textarea.value;
            saveTasks();
        }
    };

    // Confirm before clearing completed
    window.confirmClearCompleted = function() {
        const completedCount = tasks.filter(t => t.completed).length;
        if (completedCount === 0) return;
        DOM.confirmModal.style.display = 'flex';
    };

    window.closeConfirmModal = function() {
        DOM.confirmModal.style.display = 'none';
    };

    window.clearCompleted = function() {
        tasks = tasks.filter(t => !t.completed);
        saveTasks();
        renderTasks();
        updateStats();
        closeConfirmModal();
        showToast('Completed tasks cleared');
    };

    // ----- Shortcuts -----
    window.showShortcuts = function() {
        DOM.shortcutsModal.style.display = 'flex';
    };
    window.closeShortcuts = function() {
        DOM.shortcutsModal.style.display = 'none';
    };

    // ----- Rendering -----
    function formatDate(dateStr) {
        if (!dateStr) return '';
        const d = new Date(dateStr + 'T00:00:00');
        return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    }

    function escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    function getFilteredAndSortedTasks() {
        const searchTerm = DOM.searchInput.value.toLowerCase();
        const categoryFilter = DOM.categoryFilter.value;
        const sortBy = DOM.sortSelect.value;

        let filtered = tasks.filter(t => {
            const matchesSearch = !searchTerm || t.name.toLowerCase().includes(searchTerm) || t.description.toLowerCase().includes(searchTerm);
            const matchesCategory = !categoryFilter || t.category === categoryFilter;
            const matchesDate = matchesDateFilter(t);
            return matchesSearch && matchesCategory && matchesDate;
        });

        // Smart sort: overdue first, then upcoming, then no date, then completed
        if (sortBy === 'smart') {
            filtered.sort((a, b) => {
                const aComp = a.completed ? 1 : 0;
                const bComp = b.completed ? 1 : 0;
                if (aComp !== bComp) return aComp - bComp;
                if (a.completed) return 0;
                // Both not completed
                const aOver = isOverdue(a) ? 0 : 1;
                const bOver = isOverdue(b) ? 0 : 1;
                if (aOver !== bOver) return aOver - bOver;
                if (a.date && b.date) return a.date.localeCompare(b.date);
                if (a.date && !b.date) return -1;
                if (!a.date && b.date) return 1;
                return 0;
            });
        } else {
            switch(sortBy) {
                case 'newest': filtered.sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt)); break;
                case 'oldest': filtered.sort((a,b) => new Date(a.createdAt) - new Date(b.createdAt)); break;
                case 'date': filtered.sort((a,b) => (a.date || '9999') > (b.date || '9999') ? 1 : -1); break;
                case 'priority': {
                    const prio = {high:3, medium:2, low:1};
                    filtered.sort((a,b) => (prio[b.priority]||0) - (prio[a.priority]||0));
                    break;
                }
                case 'name': filtered.sort((a,b) => a.name.localeCompare(b.name)); break;
            }
        }
        return filtered;
    }

    function renderTasks() {
        const listEl = DOM.taskList;
        const filtered = getFilteredAndSortedTasks();
        const heading = activeDateFilter === 'all' ? 'Your Tasks' : {
            today: "Today's Tasks",
            tomorrow: "Tomorrow's Tasks",
            yesterday: "Yesterday's Tasks",
            week: "This Week's Tasks",
            overdue: "Overdue Tasks",
            'no-date': "Tasks without Due Date"
        }[activeDateFilter] || 'Your Tasks';
        DOM.listHeading.textContent = heading;

        if (filtered.length === 0) {
            let message = 'No tasks found';
            if (activeDateFilter === 'today') message = "Nothing due today – enjoy your day!";
            else if (activeDateFilter === 'tomorrow') message = "Nothing due tomorrow – plan ahead!";
            else if (activeDateFilter === 'overdue') message = "No overdue tasks – great job!";
            listEl.innerHTML = `<li class="empty-state"><div class="empty-icon">✨</div><p>${message}</p></li>`;
            return;
        }

        listEl.innerHTML = filtered.map(task => {
            const completedClass = task.completed ? 'completed' : '';
            const checkedClass = task.completed ? 'checked' : '';
            const overdueClass = isOverdue(task) ? 'overdue' : '';
            const relativeLabel = getRelativeDateLabel(task.date);
            let dateExtraClass = '';
            if (relativeLabel === 'Due Today') dateExtraClass = 'today';
            else if (relativeLabel === 'Due Tomorrow') dateExtraClass = 'tomorrow';
            const dateFormatted = formatDate(task.date);
            const priorityLabel = task.priority.charAt(0).toUpperCase() + task.priority.slice(1);
            const categoryLabel = task.category ? task.category.charAt(0).toUpperCase() + task.category.slice(1) : '';
            const noteVisible = expandedNotes.has(task.id);
            return `
                <li class="task-item ${completedClass} ${overdueClass} ${dateExtraClass}" data-id="${task.id}">
                    <button class="task-checkbox ${checkedClass}" aria-label="Toggle completion" onclick="toggleTask(${task.id})">${task.completed ? '✓' : ''}</button>
                    <div class="task-content">
                        <span class="task-text">${escapeHtml(task.name)}</span>
                        ${task.description ? `<div class="task-description">${escapeHtml(task.description)}</div>` : ''}
                        <div class="task-meta">
                            <span class="task-date">📅 ${dateFormatted || 'No due date'}</span>
                            ${relativeLabel ? `<span class="task-date" style="color:var(--accent);">${relativeLabel}</span>` : ''}
                            <span class="priority-badge ${task.priority}">${priorityLabel}</span>
                            ${categoryLabel ? `<span class="category-badge">${categoryLabel}</span>` : ''}
                        </div>
                        <div class="notes-container ${noteVisible ? 'visible' : ''}" data-note-id="${task.id}">
                            <textarea class="notes-textarea" placeholder="Add a note..." oninput="updateNote(${task.id}, this)">${escapeHtml(task.note || '')}</textarea>
                        </div>
                    </div>
                    <div class="task-actions">
                        <button class="icon-btn" aria-label="Toggle note" onclick="toggleNote(${task.id})">📝</button>
                        <button class="icon-btn delete-btn" aria-label="Delete task" onclick="deleteTask(${task.id})">🗑</button>
                    </div>
                </li>`;
        }).join('');
    }

    function updateStats() {
        const total = tasks.length;
        const done = tasks.filter(t => t.completed).length;
        const pending = total - done;
        const percent = total ? Math.round((done/total)*100) : 0;
        DOM.statTotal.textContent = total;
        DOM.statPending.textContent = pending;
        DOM.statDone.textContent = done;
        DOM.progressFill.style.width = percent+'%';
        DOM.progressText.textContent = percent+'% completed';
    }

    function showToast(msg) {
        const toast = DOM.toast;
        toast.innerHTML = msg;
        toast.classList.add('show');
        setTimeout(() => toast.classList.remove('show'), 2200);
    }

    // ----- Receipt & CSV -----
    function generateReceiptHTML() {
        const now = new Date();
        const dateStr = now.toLocaleDateString('en-US', { month:'long', day:'numeric', year:'numeric' });
        const timeStr = now.toLocaleTimeString('en-US', { hour:'2-digit', minute:'2-digit' });
        const allSorted = [...tasks.filter(t=>!t.completed), ...tasks.filter(t=>t.completed)];
        let itemsHTML = allSorted.length ? allSorted.map(task => {
            const doneClass = task.completed ? 'done' : '';
            const checkMark = task.completed ? '✓' : '';
            return `<div class="receipt-item ${doneClass}">
                <div class="rec-check">${checkMark}</div>
                <div class="rec-info">
                    <div class="rec-name">${escapeHtml(task.name)}</div>
                    ${task.description ? `<div class="rec-desc">📝 ${escapeHtml(task.description)}</div>` : ''}
                    <div style="font-size:0.7rem;">📅 ${task.date ? formatDate(task.date) : 'No due date'}</div>
                    ${task.note ? `<div class="rec-note">📌 ${escapeHtml(task.note)}</div>` : ''}
                    <span class="rec-priority ${task.priority}">${task.priority.toUpperCase()}</span>
                </div>
            </div>`;
        }).join('') : '<div class="receipt-item"><div class="rec-check">—</div><div class="rec-info">No tasks</div></div>';
        return `<div class="receipt-header"><h2>📋 TaskFlow</h2><div>${dateStr} · ${timeStr}</div></div>${itemsHTML}<div class="receipt-footer"><div>Pending: ${tasks.filter(t=>!t.completed).length}</div><div>Completed: ${tasks.filter(t=>t.completed).length}</div><div style="font-weight:700;">TOTAL: ${tasks.length}</div></div>`;
    }

    window.openReceipt = function() {
        DOM.receiptContent.innerHTML = generateReceiptHTML();
        DOM.receiptContainer.classList.add('visible');
        document.body.style.overflow = 'hidden';
    };
    window.closeReceipt = function() {
        DOM.receiptContainer.classList.remove('visible');
        document.body.style.overflow = '';
    };
    window.downloadReceipt = function() {
        if (!DOM.receiptContainer.classList.contains('visible')) openReceipt();
        setTimeout(() => window.print(), 200);
    };

    window.exportCSV = function() {
        const rows = [['Name','Description','Due Date','Priority','Category','Notes','Completed']];
        tasks.forEach(t => rows.push([
            t.name,
            t.description,
            t.date || '',
            t.priority,
            t.category,
            t.note,
            t.completed ? 'Yes' : 'No'
        ]));
        const csvContent = rows.map(r => r.map(c => `"${c.replace(/"/g,'""')}"`).join(',')).join('\n');
        const blob = new Blob([csvContent], {type: 'text/csv'});
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `taskflow_${new Date().toISOString().slice(0,10)}.csv`;
        a.click();
        URL.revokeObjectURL(url);
        showToast('CSV exported!');
    };

    // ----- Global keyboard shortcuts -----
    document.addEventListener('keydown', function(e) {
        // Ctrl+Enter to add task
        if (e.ctrlKey && e.key === 'Enter') {
            e.preventDefault();
            addTask();
        }
        // Escape closes overlays
        if (e.key === 'Escape') {
            if (DOM.receiptContainer.classList.contains('visible')) {
                closeReceipt();
            } else if (DOM.confirmModal.style.display === 'flex') {
                closeConfirmModal();
            } else if (DOM.shortcutsModal.style.display === 'flex') {
                closeShortcuts();
            }
        }
        // ? shows shortcuts
        if (e.key === '?' && !e.ctrlKey && !e.metaKey && document.activeElement === document.body) {
            e.preventDefault();
            showShortcuts();
        }
        // / focuses search
        if (e.key === '/' && document.activeElement !== DOM.searchInput && document.activeElement !== document.getElementById('taskNameInput')) {
            e.preventDefault();
            DOM.searchInput.focus();
        }
    });

    // Initialize
    function init() {
        loadTasks();
        applyDarkMode();
        const today = new Date().toISOString().split('T')[0];
        document.getElementById('dateInput').value = today;
        // Set default active filter button
        setDateFilter('all');
        renderTasks();
        updateStats();
    }

    init();
})();
