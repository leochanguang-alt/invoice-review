const COLUMNS = [
    "Invoice Date", "Vender", "Amount", "Currency", "Amount(HKD)",
    "Country", "Category", "Status", "Charge to Company",
    "Charge to Project", "Owner", "Invoice ID"
];

const PAGES = {
    summary: "Dashboard",
    invoice: "Review Invoice",
    reconciliation: "Finance Reconciliation",
    export: "Project Management",
    settings: "Account Setting"
};

const navItems = document.querySelectorAll('.nav-item');
const pageTitle = document.getElementById('page-title');

// Summary page data cache
let allExpenseData = [];
let expenseChart = null;

// Chart color palette - Economist style
const CHART_COLORS = [
    '#E3120B', // Economist Red
    '#1A4480', // Navy Blue
    '#2E8B57', // Sea Green  
    '#DC7633', // Terracotta
    '#7D3C98', // Purple
    '#2874A6', // Steel Blue
    '#1E8449', // Emerald
    '#B7950B', // Gold
    '#5D6D7E', // Slate Gray
    '#943126', // Dark Red
    '#117864', // Teal
    '#AF601A', // Burnt Orange
    '#6C3461', // Plum
    '#1B4F72', // Dark Blue
    '#196F3D', // Forest Green
];

// Normalize company name (merge NEOSS -> Neoss)
function normalizeCompany(company) {
    if (!company) return '';
    const normalized = company.trim();
    if (normalized.toUpperCase() === 'NEOSS') return 'Neoss';
    return normalized;
}

// Auth Elements
const loginPage = document.getElementById('login-page');
const mainApp = document.getElementById('main-app');
const loginForm = document.getElementById('login-form');
const loginEmailInput = document.getElementById('login-email');
const loginPasswordInput = document.getElementById('login-password');
const loginError = document.getElementById('login-error');
const logoutBtn = document.getElementById('logout-btn');
const forgotPasswordBtn = document.getElementById('forgot-password-btn');
const changePasswordBtn = document.getElementById('change-password-btn');

// Current logged-in user
let currentUser = null;

// Initialize
async function init() {
    setupNavigation();
    setupAuth();

    // Check if user is already logged in (from sessionStorage)
    const savedUser = sessionStorage.getItem('currentUser');
    if (savedUser) {
        currentUser = JSON.parse(savedUser);
        showApp();
    } else {
        showLogin();
    }
}

function setupAuth() {
    // Login form submit
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = loginEmailInput.value.trim();
        const password = loginPasswordInput.value;
        
        loginError.textContent = '';
        
        try {
            const res = await fetch('/api/auth', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'login', email, password })
            });
            const data = await res.json();
            
            if (data.success) {
                currentUser = data.user;
                sessionStorage.setItem('currentUser', JSON.stringify(currentUser));
                loginEmailInput.value = '';
                loginPasswordInput.value = '';
                showApp();
            } else {
                loginError.textContent = data.message || 'Login failed';
            }
        } catch (e) {
            console.error('Login error', e);
            loginError.textContent = 'Connection error. Please try again.';
        }
    });

    // Forgot password button
    forgotPasswordBtn.addEventListener('click', () => {
        document.getElementById('forgot-password-modal').style.display = 'flex';
        document.getElementById('forgot-email').value = loginEmailInput.value || '';
        document.getElementById('forgot-error').textContent = '';
        document.getElementById('forgot-success').style.display = 'none';
    });

    // Forgot password form submit
    document.getElementById('forgot-password-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = document.getElementById('forgot-email').value.trim();
        const errorEl = document.getElementById('forgot-error');
        const successEl = document.getElementById('forgot-success');
        
        errorEl.textContent = '';
        successEl.style.display = 'none';
        
        try {
            const res = await fetch('/api/auth', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'reset-password', email })
            });
            const data = await res.json();
            
            if (data.success) {
                successEl.textContent = data.message;
                successEl.style.display = 'block';
                // If in dev mode and password returned, show it
                if (data._debug_password) {
                    successEl.textContent += ` (Dev: ${data._debug_password})`;
                }
            } else {
                errorEl.textContent = data.message || 'Failed to reset password';
            }
        } catch (e) {
            console.error('Reset password error', e);
            errorEl.textContent = 'Connection error. Please try again.';
        }
    });

    // Cancel forgot password
    document.getElementById('cancel-forgot').addEventListener('click', () => {
        document.getElementById('forgot-password-modal').style.display = 'none';
    });

    // Change password button
    changePasswordBtn.addEventListener('click', () => {
        document.getElementById('change-password-modal').style.display = 'flex';
        document.getElementById('current-password').value = '';
        document.getElementById('new-password').value = '';
        document.getElementById('confirm-new-password').value = '';
        document.getElementById('change-password-error').textContent = '';
        document.getElementById('change-password-success').style.display = 'none';
    });

    // Change password form submit
    document.getElementById('change-password-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const currentPassword = document.getElementById('current-password').value;
        const newPassword = document.getElementById('new-password').value;
        const confirmPassword = document.getElementById('confirm-new-password').value;
        const errorEl = document.getElementById('change-password-error');
        const successEl = document.getElementById('change-password-success');
        
        errorEl.textContent = '';
        successEl.style.display = 'none';
        
        if (newPassword !== confirmPassword) {
            errorEl.textContent = 'New passwords do not match';
            return;
        }
        
        if (newPassword.length < 6) {
            errorEl.textContent = 'New password must be at least 6 characters';
            return;
        }
        
        try {
            const res = await fetch('/api/auth', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'change-password',
                    owner_id: currentUser.owner_id,
                    current_password: currentPassword,
                    new_password: newPassword
                })
            });
            const data = await res.json();
            
            if (data.success) {
                successEl.textContent = 'Password changed successfully!';
                successEl.style.display = 'block';
                setTimeout(() => {
                    document.getElementById('change-password-modal').style.display = 'none';
                }, 2000);
            } else {
                errorEl.textContent = data.message || 'Failed to change password';
            }
        } catch (e) {
            console.error('Change password error', e);
            errorEl.textContent = 'Connection error. Please try again.';
        }
    });

    // Cancel change password
    document.getElementById('cancel-change-password').addEventListener('click', () => {
        document.getElementById('change-password-modal').style.display = 'none';
    });

    // Logout button
    logoutBtn.addEventListener('click', () => {
        currentUser = null;
        sessionStorage.removeItem('currentUser');
        showLogin();
    });
}

// Legacy setupAuth for compatibility (keeping old code structure)
function setupAuthLegacy() {
    logoutBtn.addEventListener('click', async () => {
        try {
            await fetch('/api/auth', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'logout' })
            });
            showLogin();
        } catch (e) {
            console.error('Logout error', e);
        }
    });
}

async function checkAuth() {
    try {
        const res = await fetch('/api/auth');
        const data = await res.json();
        return data.authenticated;
    } catch (e) {
        return false;
    }
}

function showApp() {
    loginPage.style.display = 'none';
    mainApp.style.display = 'flex';
    
    // Update user name display
    if (currentUser) {
        document.getElementById('current-user-name').textContent = currentUser.owner_name || currentUser.email;
    }
    
    loadSummaryPage(); // Load summary page on app start
}

function showLogin() {
    mainApp.style.display = 'none';
    loginPage.style.display = 'flex';
    loginError.textContent = '';
}

function setupNavigation() {
    navItems.forEach(item => {
        item.addEventListener('click', () => {
            const page = item.getAttribute('data-page');
            const reviewArea = document.getElementById('invoice-review-area');
            const leavingReview = reviewArea && reviewArea.style.display !== 'none' && page !== 'invoice';
            if (leavingReview && reviewedRows.size > 0) {
                const stay = !confirm(
                    `You have ${reviewedRows.size} reviewed invoice(s) that have not been submitted. Leave anyway?`
                );
                if (stay) return;
                reviewedRows.clear();
            }

            // Update active states
            navItems.forEach(i => i.classList.remove('active'));
            item.classList.add('active');

            // Update title
            pageTitle.innerText = PAGES[page];

            // Hide all content areas first
            document.getElementById('content-area').style.display = 'none';
            document.getElementById('settings-area').style.display = 'none';
            document.getElementById('invoice-review-area').style.display = 'none';
            document.getElementById('export-area').style.display = 'none';
            const reconArea = document.getElementById('reconciliation-area');
            if (reconArea) reconArea.style.display = 'none';

            if (page === 'summary') {
                document.getElementById('content-area').style.display = 'block';
                loadSummaryPage();
            } else if (page === 'settings') {
                showSettingsPage();
            } else if (page === 'invoice') {
                showInvoiceReviewPage();
            } else if (page === 'reconciliation') {
                showReconciliationPage();
            } else if (page === 'export') {
                showExportPage();
            }
        });
    });
}

// ============ SUMMARY PAGE FUNCTIONS ============

async function loadSummaryPage() {
    try {
        // Load only submitted expense data
        const res = await fetch('/api/expenses?status=submitted');
        const json = await res.json();
        
        if (json.success && json.data) {
            // Normalize company names (merge NEOSS -> Neoss)
            allExpenseData = json.data.map(item => ({
                ...item,
                'Charge to Company': normalizeCompany(item['Charge to Company'])
            }));
            
            // Populate filters
            populateFilters();
            
            // Setup filter event listeners
            setupFilterListeners();
            
            // Render chart and list
            renderExpenseChart();
            renderExpenseList();
        }
    } catch (e) {
        console.error('Failed to load summary data:', e);
    }
}

function populateFilters() {
    // Get unique companies (normalized)
    const companies = [...new Set(allExpenseData.map(d => d['Charge to Company']).filter(Boolean))].sort();
    
    // Get unique categories
    const categories = [...new Set(allExpenseData.map(d => d['Category']).filter(Boolean))].sort();
    
    // Get unique projects
    const projects = [...new Set(allExpenseData.map(d => d['Charge to Project']).filter(Boolean))].sort();
    
    // Get unique months
    const months = [...new Set(allExpenseData.map(d => {
        const date = d['Invoice Date'];
        if (!date) return null;
        const dateObj = new Date(date);
        if (isNaN(dateObj.getTime())) return null;
        return `${dateObj.getFullYear()}-${String(dateObj.getMonth() + 1).padStart(2, '0')}`;
    }).filter(Boolean))].sort().reverse();
    
    // Populate company filter
    const companyFilter = document.getElementById('filter-company');
    companyFilter.innerHTML = '<option value="">All</option>' + 
        companies.map(c => `<option value="${c}">${c}</option>`).join('');
    
    // Populate project filter
    const projectFilter = document.getElementById('filter-project');
    projectFilter.innerHTML = '<option value="">All</option>' + 
        projects.map(p => `<option value="${p}">${p}</option>`).join('');
    
    // Populate category filter
    const categoryFilter = document.getElementById('filter-category');
    categoryFilter.innerHTML = '<option value="">All</option>' + 
        categories.map(c => `<option value="${c}">${c}</option>`).join('');
    
    // Populate month filter
    const monthFilter = document.getElementById('filter-month');
    monthFilter.innerHTML = '<option value="">All Months</option>' + 
        months.map(m => {
            const [year, month] = m.split('-');
            return `<option value="${m}">${year}/${month}</option>`;
        }).join('');
}

function setupFilterListeners() {
    // Main filters affect both chart and list
    document.getElementById('filter-company').addEventListener('change', () => {
        updateDependentFilters();
        renderExpenseChart();
        renderExpenseList();
    });
    
    document.getElementById('filter-project').addEventListener('change', () => {
        renderExpenseChart();
        renderExpenseList();
    });
    
    document.getElementById('filter-category').addEventListener('change', () => {
        renderExpenseChart();
        renderExpenseList();
    });
    
    // Month filter only affects the list
    document.getElementById('filter-month').addEventListener('change', renderExpenseList);
}

function updateDependentFilters() {
    const selectedCompany = document.getElementById('filter-company').value;
    
    // Filter data based on company selection
    let filteredData = allExpenseData;
    if (selectedCompany) {
        filteredData = allExpenseData.filter(d => d['Charge to Company'] === selectedCompany);
    }
    
    // Update project filter options
    const projects = [...new Set(filteredData.map(d => d['Charge to Project']).filter(Boolean))].sort();
    const projectFilter = document.getElementById('filter-project');
    const currentProject = projectFilter.value;
    projectFilter.innerHTML = '<option value="">All</option>' + 
        projects.map(p => `<option value="${p}" ${p === currentProject ? 'selected' : ''}>${p}</option>`).join('');
    
    // Update category filter options
    const categories = [...new Set(filteredData.map(d => d['Category']).filter(Boolean))].sort();
    const categoryFilter = document.getElementById('filter-category');
    const currentCategory = categoryFilter.value;
    categoryFilter.innerHTML = '<option value="">All</option>' + 
        categories.map(c => `<option value="${c}" ${c === currentCategory ? 'selected' : ''}>${c}</option>`).join('');
}

function getFilteredData() {
    const selectedCompany = document.getElementById('filter-company').value;
    const selectedProject = document.getElementById('filter-project').value;
    const selectedCategory = document.getElementById('filter-category').value;
    
    let filteredData = allExpenseData;
    
    if (selectedCompany) {
        filteredData = filteredData.filter(d => d['Charge to Company'] === selectedCompany);
    }
    if (selectedProject) {
        filteredData = filteredData.filter(d => d['Charge to Project'] === selectedProject);
    }
    if (selectedCategory) {
        filteredData = filteredData.filter(d => d['Category'] === selectedCategory);
    }
    
    return filteredData;
}

function renderExpenseChart() {
    const filteredData = getFilteredData();

    // Aggregate total HKD amount per category
    const categoryTotals = {};
    filteredData.forEach((item) => {
        const category = (item['Category'] || 'Unknown').toString().trim() || 'Unknown';
        const amount = parseFloat((item['Amount(HKD)'] || '0').toString().replace(/,/g, '')) || 0;
        categoryTotals[category] = (categoryTotals[category] || 0) + amount;
    });

    // Sort categories by amount descending
    const sortedCategories = Object.keys(categoryTotals).sort(
        (a, b) => categoryTotals[b] - categoryTotals[a],
    );
    const amounts = sortedCategories.map((c) => categoryTotals[c]);
    const colors = sortedCategories.map((_, idx) => CHART_COLORS[idx % CHART_COLORS.length]);

    if (expenseChart) {
        expenseChart.destroy();
    }

    const ctx = document.getElementById('expense-chart').getContext('2d');
    expenseChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: sortedCategories,
            datasets: [{
                label: 'Amount (HKD)',
                data: amounts,
                backgroundColor: colors,
                borderColor: colors,
                borderWidth: 0,
                borderRadius: 4,
                borderSkipped: false,
            }],
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: false,
                },
                tooltip: {
                    backgroundColor: '#FFFFFF',
                    titleColor: '#111827',
                    bodyColor: '#374151',
                    borderColor: '#E5E7EB',
                    borderWidth: 1,
                    padding: 10,
                    cornerRadius: 4,
                    titleFont: {
                        family: "'Source Sans 3', sans-serif",
                        size: 12,
                        weight: 600,
                    },
                    bodyFont: {
                        family: 'Verdana, Geneva, sans-serif',
                        size: 11,
                    },
                    callbacks: {
                        label: function (context) {
                            const value = context.raw || 0;
                            return `HKD ${Number(value).toLocaleString('en-US', {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2,
                            })}`;
                        },
                    },
                },
            },
            scales: {
                x: {
                    beginAtZero: true,
                    grid: {
                        color: '#F3F4F6',
                        drawBorder: false,
                    },
                    ticks: {
                        color: '#6B7280',
                        font: {
                            family: 'Verdana, Geneva, sans-serif',
                            size: 10,
                        },
                        callback: function (value) {
                            if (value >= 1000) {
                                return 'HKD ' + (value / 1000).toLocaleString() + 'K';
                            }
                            return 'HKD ' + value.toLocaleString();
                        },
                    },
                },
                y: {
                    grid: {
                        display: false,
                        drawBorder: false,
                    },
                    ticks: {
                        color: '#4B5563',
                        font: {
                            family: "'Source Sans 3', sans-serif",
                            size: 12,
                        },
                    },
                },
            },
            layout: {
                padding: {
                    left: 10,
                    right: 16,
                },
            },
        },
    });
}

function renderExpenseList() {
    const filteredData = getFilteredData();
    const selectedMonth = document.getElementById('filter-month').value;
    
    // Apply month filter for list only
    let listData = filteredData;
    if (selectedMonth) {
        listData = filteredData.filter(item => {
            const date = item['Invoice Date'];
            if (!date) return false;
            const dateObj = new Date(date);
            if (isNaN(dateObj.getTime())) return false;
            const monthKey = `${dateObj.getFullYear()}-${String(dateObj.getMonth() + 1).padStart(2, '0')}`;
            return monthKey === selectedMonth;
        });
    }
    
    const headerEl = document.getElementById('expense-list-header');
    const bodyEl = document.getElementById('expense-list-body');
    const summaryEl = document.getElementById('expense-list-summary');
    
    if (listData.length === 0) {
        headerEl.innerHTML = '<th>No Data</th>';
        bodyEl.innerHTML = '<tr><td class="empty-state"><div class="empty-state-icon">📊</div>No expense records found for the selected filters.</td></tr>';
        summaryEl.innerHTML = '';
        return;
    }
    
    // Group data by "Company-Project-Category" combination
    const groupedData = {};
    let totalAmount = 0;
    
    listData.forEach(item => {
        const company = item['Charge to Company'] || 'Unknown';
        const project = item['Charge to Project'] || 'Unknown';
        const category = item['Category'] || 'Unknown';
        const groupKey = `${company}-${project}-${category}`;
        
        const amount = parseFloat((item['Amount(HKD)'] || '0').toString().replace(/,/g, '')) || 0;
        totalAmount += amount;
        
        if (!groupedData[groupKey]) {
            groupedData[groupKey] = {
                company,
                project,
                category,
                items: [],
                total: 0
            };
        }
        
        groupedData[groupKey].items.push({
            date: item['Invoice Date'],
            vendor: item['Vender'] || item['Vendor'] || '',
            amount: amount,
            currency: item['Currency'] || 'HKD',
            originalAmount: item['Amount'] || ''
        });
        groupedData[groupKey].total += amount;
    });
    
    // Sort groups by total amount descending
    const sortedGroups = Object.entries(groupedData)
        .sort((a, b) => b[1].total - a[1].total);
    
    // Build table header
    headerEl.innerHTML = `
        <th style="width: 100px;">Date</th>
        <th>Vendor</th>
        <th style="width: 100px; text-align: right;">Original</th>
        <th style="width: 120px; text-align: right;">Amount (HKD)</th>
    `;
    
    // Build table body with grouped rows
    let bodyHtml = '';
    
    sortedGroups.forEach(([groupKey, group]) => {
        // Group header row - format: Company-Project-Category
        bodyHtml += `
            <tr class="header-group">
                <td colspan="4">
                    <span class="group-title">${group.company}-${group.project}-${group.category}</span>
                    <span style="float: right; font-family: 'JetBrains Mono', monospace;">
                        HKD ${group.total.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}
                    </span>
                </td>
            </tr>
        `;
        
        // Sort items by date descending
        const sortedItems = group.items.sort((a, b) => new Date(b.date) - new Date(a.date));
        
        // Detail rows
        sortedItems.forEach(item => {
            const dateStr = item.date ? new Date(item.date).toLocaleDateString('en-CA') : '-';
            bodyHtml += `
                <tr>
                    <td class="date-cell">${dateStr}</td>
                    <td>${item.vendor}</td>
                    <td style="text-align: right; color: var(--text-muted);">${item.originalAmount} ${item.currency}</td>
                    <td class="amount-cell">${item.amount.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td>
                </tr>
            `;
        });
    });
    
    bodyEl.innerHTML = bodyHtml;
    
    // Summary
    summaryEl.innerHTML = `
        <div class="summary-item">
            <span class="summary-label">Total Records</span>
            <span class="summary-value">${listData.length}</span>
        </div>
        <div class="summary-item">
            <span class="summary-label">Groups</span>
            <span class="summary-value">${sortedGroups.length}</span>
        </div>
        <div class="summary-item">
            <span class="summary-label">Total Amount</span>
            <span class="summary-value">HKD ${totalAmount.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</span>
        </div>
    `;
}

init();

// ============ SETTINGS PAGE FUNCTIONS ============

const SHEET_TITLES = {
    company: "Company Management",
    projects: "Project Management",
    owner: "Account Management"
};

let currentSheet = null;
let currentHeaders = [];
let currentData = [];
let editingRow = null;
let isSaving = false;

function showSettingsPage() {
    document.getElementById('settings-area').style.display = 'block';
    document.getElementById('manage-view').style.display = 'none';
    document.querySelector('.settings-cards').style.display = 'grid';
    setupSettingsEvents();
}

function setupSettingsEvents() {
    // Settings card clicks
    document.querySelectorAll('.settings-card').forEach(card => {
        card.onclick = () => {
            currentSheet = card.dataset.sheet;
            loadManageView();
        };
    });

    // Back button
    document.getElementById('back-to-settings').onclick = () => {
        document.getElementById('manage-view').style.display = 'none';
        document.querySelector('.settings-cards').style.display = 'grid';
    };

    // Add button
    document.getElementById('add-row-btn').onclick = () => {
        editingRow = null;
        showEditModal("Add Record");
    };

    // Fix folders button (only for projects)
    document.getElementById('fix-folders-btn').onclick = fixMissingFolders;

    // Cancel edit
    document.getElementById('cancel-edit').onclick = () => {
        document.getElementById('edit-modal').style.display = 'none';
    };

    // Form submit
    document.getElementById('edit-form').onsubmit = async (e) => {
        e.preventDefault();
        await saveRow();
    };
}

async function loadManageView() {
    document.querySelector('.settings-cards').style.display = 'none';
    document.getElementById('manage-view').style.display = 'block';
    document.getElementById('manage-title').innerText = SHEET_TITLES[currentSheet];

    // Show/hide fix folders button based on current sheet
    const fixFoldersBtn = document.getElementById('fix-folders-btn');
    if (fixFoldersBtn) {
        fixFoldersBtn.style.display = currentSheet === 'projects' ? 'block' : 'none';
    }

    // Show/hide add button - hide for owner (personal account)
    const addRowBtn = document.getElementById('add-row-btn');
    if (addRowBtn) {
        addRowBtn.style.display = currentSheet === 'owner' ? 'none' : 'block';
    }

    // Load data from API
    try {
        const res = await fetch(`/api/manage?sheet=${currentSheet}`);
        const json = await res.json();
        if (json.success) {
            currentHeaders = json.headers;
            currentData = json.data;
            
            // For owner sheet, filter to show only current user's data
            if (currentSheet === 'owner' && currentUser) {
                currentData = currentData.filter(row => 
                    row['Owner ID'] === currentUser.owner_id || 
                    row['owner_id'] === currentUser.owner_id
                );
            }
            
            renderManageTable();
        } else {
            alert("Load failed: " + json.message);
        }
    } catch (e) {
        console.error(e);
        alert("Load failed");
    }
}

function renderManageTable() {
    const headerRow = document.getElementById('manage-header');
    const body = document.getElementById('manage-body');

    headerRow.innerHTML = currentHeaders.map(h => `<th>${h}</th>`).join('') + '<th>Actions</th>';

    if (currentData.length === 0) {
        body.innerHTML = `<tr><td colspan="${currentHeaders.length + 1}" style="text-align:center">No data</td></tr>`;
        return;
    }

    body.innerHTML = currentData.map(row => {
        let buttons = '';
        
        if (currentSheet === 'owner') {
            // Personal account - only edit button, no delete
            buttons = `<button class="btn-small btn-edit" data-row="${row._rowNumber}">Edit</button>`;
        } else if (currentSheet === 'projects') {
            buttons = `<button class="btn-small btn-edit" data-row="${row._rowNumber}">Edit</button> <button class="btn-small btn-view" data-row="${row._rowNumber}">View</button>`;
        } else {
            buttons = `
                <button class="btn-small btn-edit" data-row="${row._rowNumber}">Edit</button>
                <button class="btn-small btn-delete" data-row="${row._rowNumber}">Delete</button>
            `;
        }

        return `
            <tr>
                ${currentHeaders.map(h => `<td>${row[h] || ''}</td>`).join('')}
                <td>${buttons}</td>
            </tr>
        `;
    }).join('');

    // Attach events - use string comparison for rowNumber (works for both numeric and string IDs)
    body.querySelectorAll('.btn-edit').forEach(btn => {
        btn.onclick = () => {
            const rowNum = btn.dataset.row;
            const rowData = currentData.find(r => String(r._rowNumber) === rowNum);
            editingRow = rowNum;
            showEditModal("Edit Record", rowData);
        };
    });

    body.querySelectorAll('.btn-view').forEach(btn => {
        btn.onclick = () => {
            const rowNum = btn.dataset.row;
            const rowData = currentData.find(r => String(r._rowNumber) === rowNum);
            editingRow = rowNum;
            showEditModal("View Details", rowData, true);
        };
    });

    body.querySelectorAll('.btn-delete').forEach(btn => {
        btn.onclick = async () => {
            if (!confirm("Are you sure you want to delete this record?")) return;
            const rowNum = btn.dataset.row;
            await deleteRow(rowNum);
        };
    });
}

// Helper to generate random uppercase ID
function generateRandomId(length) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    let result = '';
    for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

let companyList = []; // Cache for company list

async function loadCompanyList() {
    if (companyList.length > 0) return companyList;
    try {
        const res = await fetch('/api/manage?sheet=company');
        const json = await res.json();
        if (json.success) {
            companyList = json.data;
        }
    } catch (e) {
        console.error('Failed to load company list', e);
    }
    return companyList;
}

async function showEditModal(title, rowData = {}, isViewMode = false) {
    document.getElementById('edit-modal-title').innerText = title;
    const fieldsDiv = document.getElementById('edit-fields');
    const saveBtn = document.querySelector('#edit-form button[type="submit"]');

    if (saveBtn) {
        saveBtn.style.display = isViewMode ? 'none' : 'block';
    }

    // Load company list for dropdowns
    await loadCompanyList();

    // For new Invoice Owner, calculate next Owner ID
    let nextOwnerId = '';
    if (currentSheet === 'owner' && !editingRow) {
        const maxId = currentData.reduce((max, r) => {
            const id = parseInt(r['Owner ID'] || r['owner id'] || '0');
            return id > max ? id : max;
        }, 0);
        nextOwnerId = String(maxId + 1).padStart(4, '0');
    }

    // For new Project, generate unique 6-char uppercase Project ID
    let newProjectId = '';
    if (currentSheet === 'projects' && !editingRow) {
        const existingIds = new Set(currentData.map(r => (r['ProjectID'] || r['Project ID'] || r['projectid'] || r['project_ID'] || '').toUpperCase()));
        do {
            newProjectId = generateRandomId(6);
        } while (existingIds.has(newProjectId));
    }

    // Build field HTML
    let fieldsHtml = '';
    for (const h of currentHeaders) {
        const value = rowData[h] || '';
        const fieldLower = h.toLowerCase();
        const fieldLowerNorm = fieldLower.replace(/[_\s]/g, '');
        const isCompanyField = (fieldLowerNorm.includes('company')) && (currentSheet === 'projects' || currentSheet === 'owner');
        const isDateField = fieldLowerNorm.includes('date');
        const isProjectNameField = (fieldLowerNorm === 'projectname' || fieldLowerNorm === 'name') && currentSheet === 'projects';
        const isProjectCodeField = (fieldLowerNorm === 'projectcode' || fieldLowerNorm === 'code') && currentSheet === 'projects';
        const isProjectIdField = (fieldLowerNorm === 'projectid' || fieldLowerNorm === 'id') && currentSheet === 'projects';
        const isOwnerId = (fieldLowerNorm === 'ownerid') && currentSheet === 'owner';
        const isOwnerName = fieldLowerNorm === 'owner' && currentSheet === 'owner';
        const isMobileField = fieldLowerNorm === 'mobile' && currentSheet === 'owner';
        const isStatusField = (fieldLowerNorm === 'status') && currentSheet === 'projects';

        // Skip Owner ID in display (it's auto-generated)
        if (isOwnerId) {
            const idValue = editingRow ? value : nextOwnerId;
            fieldsHtml += `<input type="hidden" name="${h}" value="${idValue}" />`;
            continue;
        }

        // Project ID - auto-generated, readonly
        if (isProjectIdField) {
            const projectIdValue = editingRow ? value : newProjectId;
            fieldsHtml += `<div class="edit-field-group">
                <label class="edit-field-label">${h}</label>
                <input type="text" name="${h}" id="project-id-field" value="${projectIdValue}" readonly class="edit-input readonly" />
                <small class="edit-field-hint">Auto-generated: 6 uppercase letters (unique)</small>
            </div>`;
            continue;
        }

        fieldsHtml += `<div class="edit-field-group">
            <label class="edit-field-label">${h}</label>`;

        if (isOwnerName) {
            // Owner is auto-generated from First Name + Last Name (readonly)
            fieldsHtml += `<input type="text" name="${h}" value="${value}" readonly class="edit-input readonly" />
            <small class="edit-field-hint">Auto-generated: First Name + Last Name</small>`;
        } else if (isMobileField) {
            // Mobile with country code prefix
            const mobileValue = value || '+86';
            fieldsHtml += `<input type="text" name="${h}" value="${mobileValue}" class="edit-input" placeholder="+86 13800138000" />
            <small class="edit-field-hint">Format: +country code phone number (default +86)</small>`;
        } else if (isProjectCodeField) {
            fieldsHtml += `<input type="text" name="${h}" value="${value}" readonly class="edit-input readonly" />
            <small class="edit-field-hint">Auto-generated: Company Code + Project Name</small>`;
        } else if (isCompanyField) {
            const isReadonly = isViewMode || (editingRow && currentSheet === 'projects');
            fieldsHtml += `<select name="${h}" ${isReadonly ? 'disabled' : ''} class="edit-select ${isReadonly ? 'readonly' : ''}">
                <option value="">-- Please select --</option>
                ${companyList.map(c => {
                const companyID = c['Company_ID'] || c['Company ID'] || c['Company_Code'] || c['Code'] || '';
                const selected = companyID === value ? 'selected' : '';
                return `<option value="${companyID}" ${selected}>${companyID}</option>`;
            }).join('')}
            </select>`;
            if (isReadonly) {
                fieldsHtml += `<input type="hidden" name="${h}" value="${value}" />`;
            }
        } else if (isStatusField) {
            // Status field - dropdown for Active/Achieved
            const isActiveSelected = value === 'Active' || !value ? 'selected' : '';
            const isAchievedSelected = value === 'Achieved' ? 'selected' : '';
            if (isViewMode) {
                fieldsHtml += `<input type="text" name="${h}" value="${value || 'Active'}" readonly class="edit-input readonly" />`;
            } else {
                fieldsHtml += `<select name="${h}" class="edit-select">
                    <option value="Active" ${isActiveSelected}>Active</option>
                    <option value="Achieved" ${isAchievedSelected}>Achieved</option>
                </select>`;
            }
        } else if (isProjectNameField && (editingRow || isViewMode)) {
            // Project Name becomes readonly after creation or in view mode
            fieldsHtml += `<input type="text" name="${h}" value="${value}" readonly class="edit-input readonly" />
            ${isViewMode ? '' : '<small class="edit-field-hint">Project name cannot be modified after creation</small>'}`;
        } else if (isViewMode) {
            // All other fields in view mode
            fieldsHtml += `<input type="text" name="${h}" value="${value}" readonly class="edit-input readonly" />`;
        } else if (isDateField) {
            const isReadonly = isViewMode;
            fieldsHtml += `<input type="date" name="${h}" value="${value}" ${isReadonly ? 'readonly' : ''} class="edit-input ${isReadonly ? 'readonly' : ''}" />`;
        } else {
            const isReadonly = isViewMode;
            fieldsHtml += `<input type="text" name="${h}" value="${value}" ${isReadonly ? 'readonly' : ''} class="edit-input ${isReadonly ? 'readonly' : ''}" />`;
        }

        fieldsHtml += '</div>';
    }

    fieldsDiv.innerHTML = fieldsHtml;

    // Auto-generate Project Code when Company or Project Name changes
    if (currentSheet === 'projects') {
        setupProjectCodeAutoGenerate();
    }

    // Auto-generate Owner name when First/Last Name changes
    if (currentSheet === 'owner') {
        setupOwnerNameAutoGenerate();
    }

    document.getElementById('edit-modal').style.display = 'flex';
}

function setupOwnerNameAutoGenerate() {
    const form = document.getElementById('edit-form');
    const firstNameField = form.querySelector('[name="First Name"]') || form.querySelector('[name="first name"]');
    const lastNameField = form.querySelector('[name="Last Name"]') || form.querySelector('[name="last name"]');
    const ownerField = form.querySelector('[name="Owner"]') || form.querySelector('[name="owner"]');

    if (!ownerField) return;

    const updateOwnerName = () => {
        const firstName = firstNameField?.value?.trim() || '';
        const lastName = lastNameField?.value?.trim() || '';
        ownerField.value = `${firstName} ${lastName}`.trim();
    };

    firstNameField?.addEventListener('input', updateOwnerName);
    lastNameField?.addEventListener('input', updateOwnerName);
}

function setupProjectCodeAutoGenerate() {
    const form = document.getElementById('edit-form');
    console.log('[DEBUG] setupProjectCodeAutoGenerate START');

    // Find fields by looking for keywords in their 'name' attribute
    const allInputs = Array.from(form.querySelectorAll('input, select'));
    const companyField = allInputs.find(el => {
        const n = el.name.toLowerCase().replace(/[_\s]/g, '');
        return n.includes('company');
    });
    const projectNameField = allInputs.find(el => {
        const n = el.name.toLowerCase().replace(/[_\s]/g, '');
        return (n === 'projectname' || n === 'name' || (n.includes('project') && n.includes('name')));
    });
    const projectCodeField = allInputs.find(el => {
        const n = el.name.toLowerCase().replace(/[_\s]/g, '');
        return (n === 'projectcode' || n === 'code' || (n.includes('project') && n.includes('code')));
    });

    console.log('[DEBUG] Identified fields:', {
        company: companyField ? companyField.name : 'MISSING',
        projectName: projectNameField ? projectNameField.name : 'MISSING',
        projectCode: projectCodeField ? projectCodeField.name : 'MISSING'
    });

    if (!projectCodeField) {
        console.error('[DEBUG] projectCodeField NOT FOUND');
        return;
    }

    const updateProjectCode = () => {
        const companyID = companyField?.value || '';
        const projectName = projectNameField?.value || '';
        console.log('[DEBUG] updateProjectCode triggering:', { companyID, projectName });

        if (!companyID || !projectName) {
            projectCodeField.value = '';
            return;
        }

        const newCode = `${companyID}-${projectName}`;
        projectCodeField.value = newCode;
        console.log('[DEBUG] Set projectCodeField to:', newCode);
    };

    if (companyField) companyField.addEventListener('change', updateProjectCode);
    if (projectNameField) projectNameField.addEventListener('input', updateProjectCode);

    // Initial trigger
    updateProjectCode();
}

async function saveRow() {
    if (isSaving) return;

    const form = document.getElementById('edit-form');
    const saveBtn = form.querySelector('button[type="submit"]');
    const originalBtnText = saveBtn ? saveBtn.innerText : '';

    const data = {};
    currentHeaders.forEach(h => {
        data[h] = form.querySelector(`[name="${h}"]`).value;
    });

    try {
        isSaving = true;
        if (saveBtn) {
            saveBtn.disabled = true;
            saveBtn.innerText = 'Saving...';
        }

        const action = editingRow ? "update" : "add";
        const res = await fetch('/api/manage', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action, sheet: currentSheet, rowNumber: editingRow, data })
        });
        const json = await res.json();
        if (json.success) {
            document.getElementById('edit-modal').style.display = 'none';
            await loadManageView();
            if (json.sequenceReset) {
                alert(json.warning || 'Invoice numbering and archive fields were reset. The existing R2 archive object was retained.');
            }
        } else {
            alert("Save failed: " + json.message);
        }
    } catch (e) {
        console.error(e);
        alert("Save failed");
    } finally {
        isSaving = false;
        if (saveBtn) {
            saveBtn.disabled = false;
            saveBtn.innerText = originalBtnText;
        }
    }
}

async function deleteRow(rowNumber) {
    try {
        const res = await fetch('/api/manage', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'delete', sheet: currentSheet, rowNumber })
        });
        const json = await res.json();
        if (json.success) {
            await loadManageView();
        } else {
            alert("Delete failed: " + json.message);
        }
    } catch (e) {
        console.error(e);
        alert("Delete failed");
    }
}

// Fix missing R2 folders for projects
async function fixMissingFolders() {
    const btn = document.getElementById('fix-folders-btn');
    const originalText = btn.innerText;
    
    try {
        btn.disabled = true;
        btn.innerText = 'Checking...';

        // First, check status
        const checkRes = await fetch('/api/manage', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'check-folders' })
        });
        const checkJson = await checkRes.json();

        if (!checkJson.success) {
            alert('Check failed: ' + checkJson.message);
            return;
        }

        if (checkJson.missing_count === 0) {
            alert('All projects already have folder links!');
            return;
        }

        const confirmed = confirm(`Found ${checkJson.missing_count} projects missing folder links.\nFix now?`);
        if (!confirmed) return;

        btn.innerText = 'Fixing...';

        // Fix missing folders
        const fixRes = await fetch('/api/manage', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'fix-folders', force_all: true })
        });
        const fixJson = await fixRes.json();

        if (fixJson.success) {
            alert(`Fix complete!\nSuccess: ${fixJson.fixed}\nFailed: ${fixJson.errors}`);
            await loadManageView(); // Reload to show updated data
        } else {
            alert('Fix failed: ' + fixJson.message);
        }
    } catch (e) {
        console.error('Fix folders error:', e);
        alert('Fix failed: ' + e.message);
    } finally {
        btn.disabled = false;
        btn.innerText = originalText;
    }
}

// ============ INVOICE REVIEW PAGE FUNCTIONS ============

let reviewRecords = [];
let reviewedRows = new Set();
let selectedRecordRow = null;
let projectsList = [];
let ratesList = [];

const REVIEW_DISPLAY_FIELDS = [
    'Invoice Date', 'Vender', 'Amount', 'Currency', 'Amount(HKD)',
    'Country', 'Category', 'Owner',
    'Charge to Company', 'Charge to Project',
    'Remarks'
];

const OPTIONAL_REVIEW_FIELDS = new Set(['Remarks']);

const EDITABLE_FIELDS = ['Charge to Company', 'Charge to Project'];

async function showInvoiceReviewPage() {
    document.getElementById('invoice-review-area').style.display = 'block';
    setupReviewActions();
    await loadRatesList();
    await loadProjectsList();
    await loadReviewRecords();
}

async function loadRatesList() {
    try {
        const res = await fetch('/api/manage?sheet=currency_history');
        const json = await res.json();
        if (json.success) {
            ratesList = json.data || [];
        }
    } catch (e) {
        console.error('Failed to load rates:', e);
    }
}

function setupReviewActions() {
    const submitBtn = document.getElementById('submit-selected-btn');
    if (submitBtn) {
        submitBtn.onclick = submitReviewedRecords;
    }

    const selectAllBtn = document.getElementById('select-all-btn');
    const deselectAllBtn = document.getElementById('deselect-all-btn');
    if (selectAllBtn) selectAllBtn.onclick = () => selectAllRows(true);
    if (deselectAllBtn) deselectAllBtn.onclick = () => selectAllRows(false);
}

function selectAllRows(select) {
    if (select) {
        reviewRecords.forEach(r => reviewedRows.add(r._rowNumber));
    } else {
        reviewedRows.clear();
    }
    renderReviewRecords();
}

async function loadProjectsList() {
    try {
        const res = await fetch('/api/manage?sheet=projects');
        const json = await res.json();
        if (json.success) {
            projectsList = json.data;
        }
    } catch (e) {
        console.error('Failed to load projects', e);
    }
}

async function loadReviewRecords() {
    const bodyEl = document.getElementById('review-table-body');
    bodyEl.innerHTML = '<tr><td colspan="12" style="text-align: center; padding: 2rem; color: #888;">Loading...</td></tr>';

    try {
        const res = await fetch('/api/expenses');
        const json = await res.json();

        if (json.success && json.data) {
            reviewRecords = json.data.filter(r => isReviewableStatus(r['Status'] || r.Status));
            document.getElementById('review-record-count').textContent = `${reviewRecords.length} records`;
            renderReviewRecords();
        } else {
            bodyEl.innerHTML = '<tr><td colspan="12" style="text-align: center; padding: 2rem; color: #888;">No records found</td></tr>';
        }
    } catch (e) {
        console.error(e);
        bodyEl.innerHTML = '<tr><td colspan="12" style="text-align: center; padding: 2rem; color: red;">Failed to load records</td></tr>';
    }
}

function renderReviewRecords() {
    const headerEl = document.getElementById('review-table-header');
    const bodyEl = document.getElementById('review-table-body');

    const DISPLAY_COLUMNS = [
        { key: 'Invoice Date', label: 'Invoice Date' },
        { key: 'Vender', label: 'Vendor' },
        { key: 'Amount', label: 'Amount' },
        { key: 'Currency', label: 'Currency' },
        { key: 'Amount(HKD)', label: 'Amount(HKD)' },
        { key: 'Country', label: 'Country' },
        { key: 'Category', label: 'Category' },
        { key: 'Status', label: 'Status' },
        { key: 'Owner', label: 'Owner' },
        { key: 'Remarks', label: 'Remarks' }
    ];

    headerEl.innerHTML = '<th></th>' + DISPLAY_COLUMNS.map(col => `<th>${col.label}</th>`).join('');

    if (reviewRecords.length === 0) {
        bodyEl.innerHTML = `<tr><td colspan="${DISPLAY_COLUMNS.length + 1}" style="text-align: center; color: #888; padding: 2rem;">No records found</td></tr>`;
        return;
    }

    // Helper to get field value - try direct match first, then variations
    const getField = (record, key) => {
        // Direct match
        if (record[key] !== undefined && record[key] !== '') {
            return record[key];
        }

        // Try lowercase
        const lowerKey = key.toLowerCase();
        for (const k of Object.keys(record)) {
            if (k.toLowerCase() === lowerKey) {
                return record[k];
            }
        }

        // Try with underscore/space variations
        const variations = [
            key.replace(/ /g, '_'),
            key.replace(/_/g, ' '),
            key.replace(/[()]/g, ''),
        ];
        for (const v of variations) {
            if (record[v] !== undefined && record[v] !== '') {
                return record[v];
            }
        }

        return '';
    };

    // Render rows
    bodyEl.innerHTML = reviewRecords.map((record, idx) => {
        const rowNum = record._rowNumber;
        const isReviewed = reviewedRows.has(rowNum);
        const isSelected = selectedRecordRow !== null && Number(selectedRecordRow) === Number(rowNum);
        const duplicateMatches = Array.isArray(record.duplicate_matches) ? record.duplicate_matches : [];
        const isDuplicate = duplicateMatches.length > 0;
        const duplicateSummary = isDuplicate ? formatDuplicateWarning(duplicateMatches) : '';

        const cells = DISPLAY_COLUMNS.map(col => {
            const value = getField(record, col.key);
            if (col.key === 'Status') {
                const statusClass = value.toLowerCase().includes('confirmed') ? 'status-confirmed' : 'status-waiting';
                return `<td><span class="${statusClass}">${value}</span></td>`;
            }
            if (col.key === 'Vender' && isDuplicate) {
                return `<td>${value} <span class="duplicate-badge" title="Possible duplicate of ${escapeProjectOptionHtml(duplicateSummary)}">Possible duplicate</span></td>`;
            }
            return `<td>${value}</td>`;
        }).join('');

        return `
            <tr class="review-row ${isReviewed ? 'reviewed' : ''} ${isSelected ? 'selected' : ''} ${isDuplicate ? 'duplicate' : ''}"
                data-row="${rowNum}" data-idx="${idx}">
                <td style="white-space: nowrap;">
                    <button class="review-btn" data-row="${rowNum}">Review</button>
                    <button class="delete-btn" data-row="${rowNum}">Delete</button>
                </td>
                ${cells}
            </tr>
        `;
    }).join('');

    // Attach click events
    bodyEl.querySelectorAll('.review-row').forEach(row => {
        row.onclick = (e) => {
            if (e.target.classList.contains('review-btn')) {
                const rowNum = parseInt(e.target.dataset.row);
                toggleReviewed(rowNum);
            } else if (e.target.classList.contains('delete-btn')) {
                const rowNum = parseInt(e.target.dataset.row);
                deleteInvoiceRecord(rowNum);
            } else {
                const idx = parseInt(row.dataset.idx);
                selectRecord(idx);
            }
        };
    });
}

function toggleReviewed(rowNum) {
    let isReviewed;
    if (reviewedRows.has(rowNum)) {
        reviewedRows.delete(rowNum);
        isReviewed = false;
    } else {
        reviewedRows.add(rowNum);
        isReviewed = true;
    }
    const row = document.querySelector(`.review-row[data-row="${rowNum}"]`);
    if (row) row.classList.toggle('reviewed', isReviewed);
}

function clearReviewDetailPanel() {
    selectedRecordRow = null;
    document.getElementById('review-detail-form').innerHTML = '<h3>Invoice Details</h3><p style="color: #888;">Select a record from the left to view details</p>';
    document.getElementById('attachment-container').innerHTML = '<p style="color: #888;">No attachment available</p>';
}

function removeReviewRecordsLocally(rowNumbers, { removeDuplicateReferences = false } = {}) {
    const removedRows = new Set(Array.from(rowNumbers, value => Number(value)));
    if (removedRows.size === 0) return;

    reviewRecords = reviewRecords.filter(
        record => !removedRows.has(Number(record._rowNumber))
    );
    for (const rowNumber of removedRows) reviewedRows.delete(rowNumber);

    if (removeDuplicateReferences) {
        reviewRecords = reviewRecords.map(record => ({
            ...record,
            duplicate_matches: Array.isArray(record.duplicate_matches)
                ? record.duplicate_matches.filter(match => !removedRows.has(Number(match.id)))
                : record.duplicate_matches
        }));
    }

    if (selectedRecordRow !== null && removedRows.has(Number(selectedRecordRow))) {
        clearReviewDetailPanel();
    }

    const countEl = document.getElementById('review-record-count');
    if (countEl) countEl.textContent = `${reviewRecords.length} records`;
    renderReviewRecords();
}

async function deleteInvoiceRecord(rowNum) {
    const record = reviewRecords.find(r => r._rowNumber === rowNum);
    const vendor = record ? record['Vender'] : 'Unknown';
    const amount = record ? record['Amount'] : '0';
    const currency = record ? record['Currency'] : '';

    const confirmed = confirm(`Are you sure you want to delete this record?\n\nVendor: ${vendor}\nAmount: ${amount} ${currency}\n\nThis will permanently delete the record from the database, R2 storage, and Google Drive.`);
    
    if (!confirmed) return;

    try {
        // Show a simple loading state if needed, or just disable the button
        const btn = document.querySelector(`.delete-btn[data-row="${rowNum}"]`);
        if (btn) {
            btn.disabled = true;
            btn.innerText = 'Deleting...';
        }

        const res = await fetch('/api/delete-invoice', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ rowNumber: rowNum })
        });

        const json = await res.json();

        if (json.success) {
            removeReviewRecordsLocally([rowNum], { removeDuplicateReferences: true });
            if (json.partial) {
                const detailLines = formatCleanupErrors(json.details);
                alert(
                    'Record removed from the list, but attachment cleanup is still pending.\n' +
                    'It will be retried automatically.\n\n' +
                    (detailLines || 'No further details.')
                );
            }
        } else {
            const detailLines = formatCleanupErrors(json.details);
            alert(
                'Failed to delete record: ' + (json.message || 'unknown error') +
                (detailLines ? '\n\n' + detailLines : '')
            );
            if (btn) {
                btn.disabled = false;
                btn.innerText = 'Delete';
            }
        }
    } catch (e) {
        console.error('Delete error:', e);
        alert('An error occurred while deleting the record.');
    }
}

// Render a multi-line summary of cleanup details for an alert dialog.
function formatCleanupErrors(details) {
    if (!details) return '';
    const lines = [];
    if (details.cleanup_status) {
        lines.push(`Cleanup status: ${details.cleanup_status}`);
    }
    if (details.attempts != null) {
        lines.push(`Attempts so far: ${details.attempts}`);
    }
    if (details.drive !== undefined) {
        lines.push(`Drive: ${formatCleanupOutcome(details.drive)}`);
    }
    if (details.r2 !== undefined) {
        lines.push(`R2: ${formatCleanupOutcome(details.r2)}`);
    }
    if (Array.isArray(details.errors) && details.errors.length > 0) {
        lines.push('Errors:');
        for (const err of details.errors) {
            lines.push(`  - ${err}`);
        }
    }
    if (Array.isArray(details.ignored) && details.ignored.length > 0) {
        lines.push('Ignored (already gone):');
        for (const note of details.ignored) {
            lines.push(`  - ${note}`);
        }
    }
    return lines.join('\n');
}

function formatCleanupOutcome(value) {
    if (value === true) return 'ok';
    if (value === false) return 'failed';
    return String(value);
}

async function submitReviewedRecords() {
    if (reviewedRows.size === 0) {
        alert('Please review at least one record before submitting');
        return;
    }

    for (const rowNum of reviewedRows) {
        const record = reviewRecords.find(r => r._rowNumber === rowNum);
        if (!record) continue;
        for (const field of REVIEW_DISPLAY_FIELDS) {
            if (OPTIONAL_REVIEW_FIELDS.has(field)) continue;
            if (!record[field] || String(record[field]).trim() === '') {
                alert(`Record row ${rowNum} has empty field: ${field}`);
                return;
            }
        }
    }

    const confirmed = confirm(`Are you sure you want to submit ${reviewedRows.size} reviewed record(s)?`);
    if (!confirmed) return;

    const recordsToSubmit = reviewRecords
        .filter(r => reviewedRows.has(r._rowNumber))
        .map(r => ({
            rowNumber: r._rowNumber,
            companyId: (r['Charge to Company'] || '').trim(),
            projectCode: (r['Charge to Project'] || '').trim(),
            amount: r['Amount'] || '',
            currency: r['Currency'] || '',
            fileId: r['file_id'] || r['Drive_ID'] || ''
        }));

    console.log('[DEBUG] Records to submit:', recordsToSubmit);

    const progressModal = document.getElementById('progress-modal');
    const progressFill = document.getElementById('progress-fill');
    const progressCurrent = document.getElementById('progress-current');
    const progressTotal = document.getElementById('progress-total');
    const progressStatus = document.getElementById('progress-status');
    const progressDetails = document.getElementById('progress-details');
    const progressTitle = document.getElementById('progress-title');

    progressModal.style.display = 'flex';
    progressTitle.textContent = 'Submitting Records...';
    progressFill.style.width = '0%';
    progressCurrent.textContent = '0';
    progressTotal.textContent = recordsToSubmit.length;
    progressStatus.textContent = 'Initializing...';
    progressDetails.innerHTML = '';

    let successCount = 0;
    let errorCount = 0;
    const successfulRows = new Set();

    try {
        for (let i = 0; i < recordsToSubmit.length; i++) {
            const record = recordsToSubmit[i];
            const progress = Math.round(((i) / recordsToSubmit.length) * 100);

            progressFill.style.width = `${progress}%`;
            progressCurrent.textContent = i;
            progressStatus.textContent = `Processing record ${i + 1}/${recordsToSubmit.length}: Row ${record.rowNumber}...`;

            try {
                const res = await fetch('/api/submit', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ records: [record] })
                });
                const json = await res.json();

                if (json.success) {
                    successCount++;
                    reviewedRows.delete(record.rowNumber);
                    successfulRows.add(record.rowNumber);
                    progressDetails.innerHTML += `<div class="item success">✓ Row ${record.rowNumber}: ${record.projectCode} - ${record.amount}${record.currency}</div>`;
                } else {
                    errorCount++;
                    progressDetails.innerHTML += `<div class="item error">✗ Row ${record.rowNumber}: ${json.message}</div>`;
                }
            } catch (e) {
                errorCount++;
                progressDetails.innerHTML += `<div class="item error">✗ Row ${record.rowNumber}: ${e.message}</div>`;
            }

            progressDetails.scrollTop = progressDetails.scrollHeight;
        }

        progressFill.style.width = '100%';
        progressCurrent.textContent = recordsToSubmit.length;

        if (errorCount === 0) {
            progressTitle.textContent = 'Submission Complete!';
            progressStatus.textContent = `Successfully submitted ${successCount} record(s)!`;
        } else {
            progressTitle.textContent = 'Submission Complete (with errors)';
            progressStatus.textContent = `Success: ${successCount}, Failed: ${errorCount}`;
        }

        removeReviewRecordsLocally(successfulRows);
        await new Promise(resolve => setTimeout(resolve, 500));

        progressModal.style.display = 'none';

    } catch (e) {
        console.error('Submit error:', e);
        progressTitle.textContent = 'Submission Failed';
        progressStatus.textContent = `Error: ${e.message}`;

        await new Promise(resolve => setTimeout(resolve, 3000));
        progressModal.style.display = 'none';
    }
}

window.submitReviewedRecords = submitReviewedRecords;

function selectRecord(idx) {
    const record = reviewRecords[idx];
    if (!record) return;
    selectedRecordRow = record._rowNumber;
    document.querySelectorAll('.review-row').forEach(row => {
        row.classList.toggle(
            'selected',
            Number(row.dataset.row) === Number(selectedRecordRow)
        );
    });
    renderDetailForm(record);
    renderAttachmentPreview(record);
}

let ownerList = []; // Cache for owner list

async function loadOwnerList() {
    if (ownerList.length > 0) return ownerList;
    try {
        const res = await fetch('/api/manage?sheet=owner');
        const json = await res.json();
        if (json.success) {
            ownerList = json.data;
        }
    } catch (e) {
        console.error('Failed to load owner list', e);
    }
    return ownerList;
}

async function renderDetailForm(record) {
    const formEl = document.getElementById('review-detail-form');
    await loadCompanyList();
    await loadOwnerList();

    // Helper to get field value
    const getField = (key) => {
        if (record[key] !== undefined && record[key] !== '') return record[key];
        // Try lowercase
        for (const k of Object.keys(record)) {
            if (k.toLowerCase() === key.toLowerCase()) return record[k];
        }
        return '';
    };

    let html = '<h3>Invoice Details</h3>';
    const duplicateWarning = formatDuplicateWarning(record.duplicate_matches);
    if (duplicateWarning) {
        html += `<div class="duplicate-warning">Possible duplicate of ${escapeProjectOptionHtml(duplicateWarning)}. Review both records and delete the extra copy if needed.</div>`;
    }

    for (const field of REVIEW_DISPLAY_FIELDS) {
        const rawValue = getField(field);
        const value = (rawValue || '').toString().trim();
        const fieldId = 'detail-' + field.replace(/[^a-zA-Z]/g, '').toLowerCase();

        html += `<div class="detail-field">
            <label>${field}</label>`;

        if (field === 'Charge to Company') {
            html += `<select id="detail-company" onchange="filterProjectsByCompany()">
                <option value="">-- Select --</option>
                ${companyList.map(c => {
                const companyId = (c['Company_ID'] || c['Company ID'] || '').trim();
                const companyName = (c['Company Name'] || '').trim();
                // Match by Company_ID or if the value contains/starts with Company_ID (only if value is not empty)
                const isSelected = value && (
                    companyId.toLowerCase() === value.toLowerCase() ||
                    value.toLowerCase().startsWith(companyId.toLowerCase()) ||
                    value.toLowerCase().includes(companyId.toLowerCase())
                );
                const selected = isSelected ? 'selected' : '';
                return `<option value="${companyId}" ${selected}>${companyId}</option>`;
            }).join('')}
            </select>`;
        } else if (field === 'Charge to Project') {
            html += `<select id="detail-project">
                <option value="">-- Select Company First --</option>
            </select>`;
        } else if (field === 'Owner') {
            html += `<select id="detail-owner">
                <option value="">-- Select --</option>
                ${ownerList.map(o => {
                const ownerName = (o['Owner'] || '').trim();
                const isSelected = value && ownerName.toLowerCase() === value.toLowerCase();
                const selected = isSelected ? 'selected' : '';
                return `<option value="${ownerName}" ${selected}>${ownerName}</option>`;
            }).join('')}
            </select>`;
        } else if (field === 'Category') {
            // Category dropdown with common options
            const categories = ['Meal', 'Entertainment', 'Transportation', 'Accommodation', 'Office Supplies',
                'Cloud Services', 'IT expense', 'Flight', 'Hotel', 'Taxi', 'office expense', 'F&B', 'Other'];
            // Add current value if not in list (case-insensitive check)
            const valueInList = categories.some(cat => cat.toLowerCase() === value.toLowerCase());
            const allCategories = valueInList ? categories : (value ? [value, ...categories] : categories);
            html += `<select id="${fieldId}">
                <option value="">-- Select --</option>
                ${allCategories.map(cat => {
                const isSelected = value && cat.toLowerCase() === value.toLowerCase();
                const selected = isSelected ? 'selected' : '';
                return `<option value="${cat}" ${selected}>${cat}</option>`;
            }).join('')}
            </select>`;
        } else if (field === 'Remarks') {
            const safeValue = value.replace(/"/g, '&quot;');
            html += `<input type="text" id="${fieldId}" value="${safeValue}" data-field="Remarks" maxlength="30" placeholder="Up to 30 characters (optional)" />`;
        } else {
            // Editable text fields
            html += `<input type="text" id="${fieldId}" value="${value}" data-field="${field}" />`;
        }

        html += '</div>';
    }

    // Add hidden input to store the row number
    html += `<input type="hidden" id="detail-row-number" value="${selectedRecordRow}" />`;
    html += `<button class="btn-primary" style="width: 100%; margin-top: 1rem;" onclick="saveRecordChanges()">Save Changes</button>`;

    formEl.innerHTML = html;

    // Initialize project dropdown based on current company and existing value
    const existingProjectValue = getField('Charge to Project');
    filterProjectsByCompany(existingProjectValue);
}

function filterProjectsByCompany(selectedValue) {
    const companySelect = document.getElementById('detail-company');
    const projectSelect = document.getElementById('detail-project');
    if (!companySelect || !projectSelect) return;

    const selectedCompanyId = companySelect.value;
    const projectOptions = buildProjectOptions(
        projectsList,
        selectedCompanyId,
        selectedValue,
    );

    if (!selectedCompanyId && projectOptions.length === 0) {
        projectSelect.innerHTML = '<option value="">-- Select Company First --</option>';
        return;
    }

    if (projectOptions.length === 0) {
        projectSelect.innerHTML = '<option value="">-- No Projects Found --</option>';
        return;
    }

    projectSelect.innerHTML = '<option value="">-- Select --</option>' +
        projectOptions.map(option => {
            const selected = option.selected ? 'selected' : '';
            const rawLabel = option.inactiveCurrent
                ? `${option.value} (Archived/Inactive)`
                : option.value;
            const escapedValue = escapeProjectOptionHtml(option.value);
            const escapedLabel = escapeProjectOptionHtml(rawLabel);
            return `<option value="${escapedValue}" ${selected}>${escapedLabel}</option>`;
        }).join('');
}

let previewState = { scale: 1, x: 0, y: 0, isDragging: false, startX: 0, startY: 0 };

function renderAttachmentPreview(record) {
    const container = document.getElementById('attachment-container');
    // Clear previous
    container.innerHTML = '';

    // Priority 1: Check for R2 Link (New field > Old field)
    let fileLink = record.file_link_r2 || record.file_link || '';

    // Check if it's an R2 link (supports multiple formats)
    const isR2Link = fileLink && (
        fileLink.includes('r2.cloudflarestorage.com') || 
        fileLink.includes('.r2.dev') ||  // R2.dev subdomain format
        fileLink.includes('buiservice-assets')
    );

    if (isR2Link) {
        // Use API proxy to access R2 files (handles authentication and CORS)
        const r2Url = `/api/file?link=${encodeURIComponent(fileLink)}`;

        const isPdf = fileLink.toLowerCase().includes('.pdf');

        if (isPdf) {
            // Use iframe for PDF
            container.innerHTML = `<iframe src="${r2Url}" frameborder="0"></iframe>`;
        } else {
            // Try as image first, fallback to iframe
            const img = document.createElement('img');
            img.src = r2Url;
            img.id = 'preview-img';
            img.alt = 'Attachment';
            img.onerror = () => {
                // If image fails, try as iframe
                container.innerHTML = `<iframe src="${r2Url}" frameborder="0"></iframe>`;
            };
            container.appendChild(img);

            // Add zoom/pan for images
            previewState = { scale: 1, x: 0, y: 0, isDragging: false, startX: 0, startY: 0 };
            const updateTransform = () => {
                img.style.transform = `translate(${previewState.x}px, ${previewState.y}px) scale(${previewState.scale})`;
            };
            container.onwheel = (e) => {
                e.preventDefault();
                const delta = e.deltaY > 0 ? -0.1 : 0.1;
                previewState.scale = Math.max(0.5, Math.min(5, previewState.scale + delta));
                updateTransform();
            };
        }
        return;
    }

    // Priority 2: Fallback to Google Drive preview (for backwards compatibility)
    const driveId = record['Drive_ID'] || '';
    if (driveId) {
        const embedUrl = `https://drive.google.com/file/d/${driveId}/preview`;
        container.innerHTML = `<iframe src="${embedUrl}" frameborder="0"></iframe>`;
        return;
    }

    // Priority 3: No file available
    if (!fileLink) {
        container.innerHTML = '<p style="color: #888;">No attachment available</p>';
        return;
    }

    // Reset preview state for new record
    previewState = { scale: 1, x: 0, y: 0, isDragging: false, startX: 0, startY: 0 };

    if (fileLink.match(/\.(jpg|jpeg|png|gif|webp)$/i)) {
        const img = document.createElement('img');
        img.src = fileLink;
        img.id = 'preview-img';
        img.alt = 'Attachment';
        container.appendChild(img);

        const updateTransform = () => {
            img.style.transform = `translate(${previewState.x}px, ${previewState.y}px) scale(${previewState.scale})`;
        };

        // Zoom with wheel
        container.onwheel = (e) => {
            e.preventDefault();
            const delta = e.deltaY > 0 ? -0.1 : 0.1;
            const newScale = Math.max(0.5, Math.min(5, previewState.scale + delta));
            previewState.scale = newScale;
            updateTransform();
        };

        // Pan with mouse
        const onMouseMove = (e) => {
            if (!previewState.isDragging) return;
            previewState.x = e.clientX - previewState.startX;
            previewState.y = e.clientY - previewState.startY;
            updateTransform();
        };

        const onMouseUp = () => {
            previewState.isDragging = false;
            container.style.cursor = 'grab';
            window.removeEventListener('mousemove', onMouseMove);
            window.removeEventListener('mouseup', onMouseUp);
        };

        container.onmousedown = (e) => {
            previewState.isDragging = true;
            previewState.startX = e.clientX - previewState.x;
            previewState.startY = e.clientY - previewState.y;
            container.style.cursor = 'grabbing';
            window.addEventListener('mousemove', onMouseMove);
            window.addEventListener('mouseup', onMouseUp);
        };

    } else if (fileLink.includes('drive.google.com')) {
        let embedUrl = fileLink;
        if (fileLink.includes('/view')) {
            embedUrl = fileLink.replace('/view', '/preview');
        } else if (fileLink.includes('id=')) {
            const fileId = fileLink.split('id=')[1].split('&')[0];
            embedUrl = `https://docs.google.com/viewer?srcid=${fileId}&pid=explorer&efp=viewer_low_latency&embedded=true`;
        }
        container.innerHTML = `<iframe src="${embedUrl}" frameborder="0"></iframe>`;
    } else if (fileLink.match(/\.pdf$/i)) {
        container.innerHTML = `<iframe src="${fileLink}" frameborder="0"></iframe>`;
    } else {
        container.innerHTML = `<a href="${fileLink}" target="_blank" class="btn-primary">View Attachment in New Tab</a>`;
    }
}

async function saveRecordChanges() {
    if (isSaving) return;

    // Get row number from hidden input or variable
    let rowNumber = selectedRecordRow || document.getElementById('detail-row-number')?.value;

    if (!rowNumber) {
        alert('Please select a record first');
        return;
    }

    rowNumber = parseInt(rowNumber);

    // UI Feedback
    const saveBtn = document.querySelector('.review-detail-form .btn-primary') ||
        Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Save'));
    const originalBtnText = saveBtn ? saveBtn.innerText : '';

    // Auto-calculate Amount(HKD)
    // ... logic same ...
    const amountStr = document.querySelector('#review-detail-form input[data-field="Amount"]')?.value || '0';
    const currency = document.querySelector('#review-detail-form input[data-field="Currency"]')?.value || '';
    const dateStr = document.querySelector('#review-detail-form input[data-field="Invoice Date"]')?.value || '';
    const amount = parseFloat(amountStr.replace(/,/g, ''));

    let rate = null;
    if (amount && currency && dateStr) {
        const date = new Date(dateStr);
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');

        let targetDateStr = '';
        let altTargetDateStr = '';
        if (year === 2025) {
            targetDateStr = '2025-01-01';
            altTargetDateStr = '2025-1-1';
        } else if (year > 2025) {
            const monthPadded = String(date.getMonth() + 1).padStart(2, '0');
            const monthNoPad = String(date.getMonth() + 1);
            targetDateStr = `${year}-${monthPadded}-01`;
            altTargetDateStr = `${year}-${monthNoPad}-1`;
        }

        if (targetDateStr) {
            let foundRateRecord = ratesList.find(r =>
                (r['Currency Code'] === currency) &&
                (r['Date'] === targetDateStr || r['Date'] === altTargetDateStr)
            );
            if (foundRateRecord) {
                const rateVal = foundRateRecord['Rate to HKD'] || foundRateRecord['rate'] || '0';
                rate = parseFloat(rateVal.toString().replace(/,/g, ''));
            }
        }
    }

    const hkdInput = document.querySelector('#review-detail-form input[data-field="Amount(HKD)"]');
    let calculatedHKD = '';
    if (rate !== null && !isNaN(amount)) {
        calculatedHKD = (amount * rate).toFixed(2);
    } else {
        calculatedHKD = 'n/a';
    }

    if (hkdInput) {
        hkdInput.value = calculatedHKD;
    }

    // Collect values
    const rawData = {};
    const companyValue = document.getElementById('detail-company')?.value;
    const projectValue = document.getElementById('detail-project')?.value;
    const ownerValue = document.getElementById('detail-owner')?.value;
    const categoryValue = document.getElementById('detail-category')?.value;

    if (companyValue !== undefined) rawData['Charge to Company'] = companyValue;
    if (projectValue !== undefined) rawData['Charge to Project'] = projectValue;
    if (ownerValue !== undefined) rawData['Owner'] = ownerValue;
    if (categoryValue !== undefined) rawData['Category'] = categoryValue;

    document.querySelectorAll('#review-detail-form input[data-field]').forEach(input => {
        const field = input.dataset.field;
        rawData[field] = input.value;
    });

    const fieldMap = {
        'Invoice Date': 'Invoice_data',
        'Vender': 'Vendor',
        'Amount': 'amount',
        'Currency': 'currency',
        'Amount(HKD)': 'Amount (HKD)',
        'Country': 'Country',
        'Category': 'Category',
        'Owner': 'Owner',
        'Charge to Company': 'Charge to Company',
        'Charge to Project': 'Charge to Project',
        'Remarks': 'Remarks'
    };

    const data = {};
    for (const [uiLabel, value] of Object.entries(rawData)) {
        const header = fieldMap[uiLabel] || uiLabel;
        data[header] = value;
    }

    try {
        isSaving = true;
        if (saveBtn) {
            saveBtn.disabled = true;
            saveBtn.innerText = 'Saving...';
        }

        const postUpdate = async (allowOutOfRange = false) => {
            const response = await fetch('/api/manage', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'update',
                    sheet: 'main',
                    rowNumber: rowNumber,
                    data: data,
                    allow_out_of_range: allowOutOfRange
                })
            });

            return { response, json: await response.json() };
        };

        let result = await postUpdate();

        if (
            result.response.status === 409 &&
            result.json.code === 'INVOICE_DATE_OUTSIDE_PROJECT_RANGE'
        ) {
            const warning = result.json.warning;
            const proceed = confirm(
                `Invoice date ${warning.invoiceDate} is outside project ` +
                `${warning.projectCode} (${warning.projectStartDate} to ${warning.projectEndDate}).\n\n` +
                'Save anyway?'
            );

            if (!proceed) return;
            result = await postUpdate(true);
        }

        if (result.json.success) {
            if (result.json.sequenceReset) {
                // Server reset invoice numbering/archive fields — full reload to reflect changes
                await loadReviewRecords();
                alert(result.json.warning || 'Invoice numbering and archive fields were reset. The existing R2 archive object was retained.');
            } else {
                // Update the local record in place and re-render the table without a full refetch,
                // so the UI doesn't flash "Loading..." on every save.
                const idx = reviewRecords.findIndex(r => Number(r._rowNumber) === Number(rowNumber));
                if (idx !== -1) {
                    const updated = { ...reviewRecords[idx] };
                    for (const [label, value] of Object.entries(rawData)) {
                        updated[label] = value;
                    }
                    reviewRecords[idx] = updated;
                    renderReviewRecords();
                    renderDetailForm(updated);
                } else {
                    await loadReviewRecords();
                }
            }
        } else {
            alert('Failed to save: ' + result.json.message);
        }
    } catch (e) {
        console.error(e);
        alert('Failed to save');
    } finally {
        isSaving = false;
        if (saveBtn) {
            saveBtn.disabled = false;
            saveBtn.innerText = originalBtnText;
        }
    }
}

// Make functions globally accessible
window.filterProjectsByCompany = filterProjectsByCompany;
window.saveRecordChanges = saveRecordChanges;

// ============ EXPORT PAGE FUNCTIONS ============

let exportProjectsData = [];
let exportArchiveFilter = 'active';
let currentExportProject = null;

function getFilteredExportProjects() {
    if (exportArchiveFilter === 'archived') {
        return exportProjectsData.filter(p => p.archived);
    }
    if (exportArchiveFilter === 'all') {
        return exportProjectsData;
    }
    return exportProjectsData.filter(p => !p.archived);
}

async function showExportPage() {
    document.getElementById('export-area').style.display = 'block';
    await loadExportProjectData();
}

// Store all invoices data for export page
let allInvoicesData = [];

async function loadExportProjectData() {
    const tbody = document.getElementById('export-table-body');
    tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;">Loading...</td></tr>';

    try {
        // Load projects
        const projectsRes = await fetch('/api/manage?sheet=projects');
        const projectsJson = await projectsRes.json();

        // Load invoices for date ranges and totals
        const invoicesRes = await fetch('/api/expenses');
        const invoicesJson = await invoicesRes.json();

        // Load owners for name lookup
        const ownersRes = await fetch('/api/manage?sheet=owner');
        const ownersJson = await ownersRes.json();

        if (!projectsJson.success || !invoicesJson.success) {
            throw new Error('Failed to load data');
        }

        const projects = projectsJson.data || [];
        const invoices = invoicesJson.data || [];
        const owners = ownersJson.data || [];

        // Store invoices for review functionality
        allInvoicesData = invoices;

        // Create owner lookup map
        const ownerMap = {};
        owners.forEach(o => {
            const id = o['Owner ID'] || o.owner_id || '';
            const name = o['Owner'] || o.owner_name || '';
            if (id) ownerMap[id] = name;
        });

        // Calculate project stats from invoices
        const projectStats = {};
        invoices.forEach(inv => {
            const projId = inv['Charge to Project'] || inv['charge_to_project'] || inv['Project'] || inv['project_id'];
            if (!projId) return;

            if (!projectStats[projId]) {
                projectStats[projId] = {
                    minDate: null,
                    maxDate: null,
                    totalAmount: 0,
                    invoiceCount: 0
                };
            }

            const invDate = inv['Invoice Date'] || inv['invoice_date'];
            if (invDate) {
                const d = new Date(invDate);
                if (!projectStats[projId].minDate || d < projectStats[projId].minDate) {
                    projectStats[projId].minDate = d;
                }
                if (!projectStats[projId].maxDate || d > projectStats[projId].maxDate) {
                    projectStats[projId].maxDate = d;
                }
            }

            // Sum up original amounts (using Amount or Amount(HKD))
            const amount = parseFloat(inv['Amount(HKD)'] || inv['Amount'] || inv['amount'] || 0);
            if (!isNaN(amount)) {
                projectStats[projId].totalAmount += amount;
            }
            projectStats[projId].invoiceCount++;
        });

        // Build export projects data
        exportProjectsData = projects.map(p => {
            const projId = p.project_id || p['Project_ID'];
            const projCode = p.project_code || p['Project Code'] || '';
            const ownerId = p.project_owner || p['Project Owner'] || '';
            // Stats are keyed by project code (from 'Charge to Project' field in invoices)
            const stats = projectStats[projCode] || projectStats[projId] || { minDate: null, maxDate: null, totalAmount: 0, invoiceCount: 0 };

            return {
                project_id: projId,
                project_code: projCode,
                project_name: p.project_name || p['Project Name'] || '',
                company_id: p.company_id || p['Company_ID'] || '',
                owner_id: ownerId,
                owner_name: ownerMap[ownerId] || ownerId || '-',
                start_date: stats.minDate ? stats.minDate.toISOString().split('T')[0] : '-',
                end_date: stats.maxDate ? stats.maxDate.toISOString().split('T')[0] : '-',
                total_amount: stats.totalAmount,
                invoice_count: stats.invoiceCount,
                archived: p.archived || p.Status === 'Achieved' || false,
                drive_folder_link: p.drive_folder_link || ''
            };
        });

        // Sort by project code
        exportProjectsData.sort((a, b) => (a.project_code || '').localeCompare(b.project_code || ''));

        // Render table
        renderExportTable();

    } catch (err) {
        console.error('Error loading export data:', err);
        tbody.innerHTML = '<tr><td colspan="9" style="text-align:center; color:red;">Failed to load: ' + err.message + '</td></tr>';
    }
}

function renderExportTable() {
    const tbody = document.getElementById('export-table-body');
    const filteredProjects = getFilteredExportProjects();

    if (exportProjectsData.length === 0) {
        tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;">No project data</td></tr>';
        return;
    }

    if (filteredProjects.length === 0) {
        const emptyMessage = exportArchiveFilter === 'archived'
            ? 'No archived projects'
            : exportArchiveFilter === 'active'
                ? 'No active projects'
                : 'No projects match this filter';
        tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;">${emptyMessage}</td></tr>`;
        return;
    }

    tbody.innerHTML = filteredProjects.map(p => `
        <tr data-project-id="${p.project_id}">
            <td>
                <div class="export-btn-group">
                    <button class="btn-export" onclick="showExportConfirmModal('${p.project_id}')">Export</button>
                    <button class="btn-review" onclick="showProjectReviewModal('${p.project_id}')">Review</button>
                    <button class="btn-archive ${p.archived ? 'archived' : ''}" onclick="showArchiveConfirmModal('${p.project_id}')">
                        ${p.archived ? 'Archived' : 'Archive'}
                    </button>
                </div>
            </td>
            <td>${p.project_id}</td>
            <td>${p.project_code}</td>
            <td>${p.company_id || '-'}</td>
            <td>${p.owner_name}</td>
            <td>${p.start_date}</td>
            <td>${p.end_date}</td>
            <td class="amount-cell">${p.total_amount.toFixed(2)}</td>
            <td>
                <span class="status-badge ${p.archived ? 'archived' : 'active'}">
                    ${p.archived ? 'Archived' : 'Active'}
                </span>
            </td>
        </tr>
    `).join('');
}

function showExportConfirmModal(projectId) {
    currentExportProject = exportProjectsData.find(p => p.project_id === projectId);
    if (!currentExportProject) return;

    document.getElementById('export-project-name').textContent =
        `${currentExportProject.project_code}`;
    document.getElementById('export-confirm-modal').style.display = 'flex';
}

function showArchiveConfirmModal(projectId) {
    currentExportProject = exportProjectsData.find(p => p.project_id === projectId);
    if (!currentExportProject) return;

    if (currentExportProject.archived) {
        // Already archived, ask to unarchive
        if (confirm(`Project "${currentExportProject.project_name}" is archived. Do you want to unarchive it?`)) {
            toggleArchiveProject(projectId, false);
        }
        return;
    }

    document.getElementById('archive-project-name').textContent =
        `${currentExportProject.project_code} - ${currentExportProject.project_name}`;
    document.getElementById('archive-confirm-modal').style.display = 'flex';
}

async function executeExport() {
    if (!currentExportProject) return;

    document.getElementById('export-confirm-modal').style.display = 'none';
    document.getElementById('export-progress-modal').style.display = 'flex';

    const progressFill = document.getElementById('export-progress-fill');
    const progressStatus = document.getElementById('export-progress-status');

    try {
        progressStatus.textContent = 'Fetching invoice data...';
        progressFill.style.width = '20%';

        // Fetch invoices for this project
        const invoicesRes = await fetch('/api/expenses');
        const invoicesJson = await invoicesRes.json();

        if (!invoicesJson.success) {
            throw new Error('Failed to fetch invoices');
        }

        const projectCode = currentExportProject.project_code;
        const projectInvoices = (invoicesJson.data || []).filter(inv => {
            const projId = inv['Charge to Project'] || inv['charge_to_project'] || inv['Project'] || inv['project_id'];
            return projId === currentExportProject.project_id || projId === projectCode;
        });

        progressStatus.textContent = 'Generating Excel file...';
        progressFill.style.width = '40%';

        const {
            rows: excelData,
            skippedCount,
        } = buildArchivedExportRows(projectInvoices);
        if (skippedCount > 0) {
            alert(
                `${skippedCount} invoice(s) are still in transit or missing a persisted archive path and were skipped.`
            );
        }

        // Generate Excel using simple CSV format (can be opened in Excel)
        const csvContent = generateCSV(excelData);
        const csvBlob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8' });

        progressStatus.textContent = 'Downloading Excel file...';
        progressFill.style.width = '50%';

        // Download CSV
        const csvUrl = URL.createObjectURL(csvBlob);
        const csvLink = document.createElement('a');
        csvLink.href = csvUrl;
        csvLink.download = `${projectCode}_expenses.csv`;
        csvLink.click();
        URL.revokeObjectURL(csvUrl);

        progressStatus.textContent = 'Downloading ZIP archive...';
        progressFill.style.width = '70%';

        // Download ZIP from server
        try {
            const zipResponse = await fetch(`/api/export-zip?project=${encodeURIComponent(projectCode)}`);
            
            if (zipResponse.ok) {
                const zipBlob = await zipResponse.blob();
                const zipUrl = URL.createObjectURL(zipBlob);
                const zipLink = document.createElement('a');
                zipLink.href = zipUrl;
                zipLink.download = `${projectCode}_files.zip`;
                zipLink.click();
                URL.revokeObjectURL(zipUrl);
                
                progressStatus.textContent = 'Export complete!';
                progressFill.style.width = '100%';
                
                setTimeout(() => {
                    document.getElementById('export-progress-modal').style.display = 'none';
                    progressFill.style.width = '0%';
                    alert('Excel report and ZIP archive have been downloaded successfully!');
                }, 1000);
            } else {
                const errData = await zipResponse.json().catch(() => ({ error: 'Unknown error' }));
                console.warn('ZIP download failed:', errData);
                
                progressStatus.textContent = 'Export complete (CSV only)';
                progressFill.style.width = '100%';
                
                setTimeout(() => {
                    document.getElementById('export-progress-modal').style.display = 'none';
                    progressFill.style.width = '0%';
                    alert(`Excel report downloaded.\n\nZIP archive failed: ${errData.error || errData.message || 'No files found in project folder'}`);
                }, 1000);
            }
        } catch (zipErr) {
            console.warn('ZIP download error:', zipErr);
            
            progressStatus.textContent = 'Export complete (CSV only)';
            progressFill.style.width = '100%';
            
            setTimeout(() => {
                document.getElementById('export-progress-modal').style.display = 'none';
                progressFill.style.width = '0%';
                alert(`Excel report downloaded.\n\nZIP archive failed: ${zipErr.message}`);
            }, 1000);
        }

    } catch (err) {
        console.error('Export error:', err);
        progressStatus.textContent = 'Export failed: ' + err.message;
        progressFill.style.background = '#f44336';
        setTimeout(() => {
            document.getElementById('export-progress-modal').style.display = 'none';
            progressFill.style.width = '0%';
            progressFill.style.background = '';
        }, 2000);
    }
}

function generateCSV(data) {
    if (data.length === 0) return '';

    const headers = Object.keys(data[0]);
    const rows = data.map(row =>
        headers.map(h => {
            let val = row[h] || '';
            // Escape quotes and wrap in quotes if contains comma
            if (typeof val === 'string' && (val.includes(',') || val.includes('"') || val.includes('\n'))) {
                val = '"' + val.replace(/"/g, '""') + '"';
            }
            return val;
        }).join(',')
    );

    return [headers.join(','), ...rows].join('\n');
}

// ==================== Project Review Modal Functions ====================
let currentReviewProject = null;
let selectedInvoiceIds = new Set();

function showProjectReviewModal(projectId) {
    currentReviewProject = exportProjectsData.find(p => p.project_id === projectId);
    if (!currentReviewProject) return;

    selectedInvoiceIds.clear();
    updateSelectedCount();

    document.getElementById('review-project-title').textContent = currentReviewProject.project_code;
    document.getElementById('project-review-modal').style.display = 'flex';

    loadProjectInvoicesForReview();
}

function loadProjectInvoicesForReview() {
    const tbody = document.getElementById('review-invoices-body');
    tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;">Loading...</td></tr>';

    const projectCode = currentReviewProject.project_code;
    const projectInvoices = allInvoicesData.filter(inv => {
        const projId = inv['Charge to Project'] || inv['charge_to_project'] || inv['Project'] || inv['project_id'];
        return projId === currentReviewProject.project_id || projId === projectCode;
    });

    if (projectInvoices.length === 0) {
        tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;">No invoice records for this project</td></tr>';
        return;
    }

    tbody.innerHTML = projectInvoices.map(inv => {
        const invoiceId = inv['Invoice ID'] || inv['generated_invoice_id'] || '';
        const fileLink = inv['file_link_r2'] || '';
        let r2Display = '';

        if (fileLink) {
            // Extract filename from R2 link
            const fileName = fileLink.split('/').pop().split('?')[0];
            r2Display = `<a href="${fileLink}" target="_blank" class="r2-file-link">${fileName}</a>`;
        }

        return `
            <tr data-invoice-id="${invoiceId}">
                <td>
                    <input type="checkbox" class="invoice-checkbox" data-id="${invoiceId}"
                        onchange="toggleInvoiceSelection('${invoiceId}')">
                </td>
                <td>${invoiceId}</td>
                <td>${inv['Invoice Date'] || inv['invoice_date'] || '-'}</td>
                <td>${inv['Vender'] || inv['Vendor'] || inv['vendor'] || '-'}</td>
                <td>${inv['Amount'] || '-'}</td>
                <td>${inv['Currency'] || '-'}</td>
                <td>${inv['Category'] || inv['category'] || '-'}</td>
                <td>${inv['Owner'] || inv['owner'] || '-'}</td>
                <td>${r2Display || '-'}</td>
            </tr>
        `;
    }).join('');

    // Reset select all checkbox
    document.getElementById('select-all-invoices').checked = false;
}

function toggleInvoiceSelection(invoiceId) {
    if (selectedInvoiceIds.has(invoiceId)) {
        selectedInvoiceIds.delete(invoiceId);
    } else {
        selectedInvoiceIds.add(invoiceId);
    }
    updateSelectedCount();
    updateSelectAllState();
}

function updateSelectedCount() {
    const countEl = document.getElementById('selected-count');
    countEl.textContent = `Selected: ${selectedInvoiceIds.size} items`;

    const rejectBtn = document.getElementById('reject-selected-btn');
    rejectBtn.disabled = selectedInvoiceIds.size === 0;
}

function updateSelectAllState() {
    const allCheckboxes = document.querySelectorAll('.invoice-checkbox');
    const selectAllCheckbox = document.getElementById('select-all-invoices');

    if (allCheckboxes.length === 0) {
        selectAllCheckbox.checked = false;
        return;
    }

    const allChecked = Array.from(allCheckboxes).every(cb => cb.checked);
    selectAllCheckbox.checked = allChecked;
}

function toggleSelectAllInvoices() {
    const selectAllCheckbox = document.getElementById('select-all-invoices');
    const allCheckboxes = document.querySelectorAll('.invoice-checkbox');

    allCheckboxes.forEach(cb => {
        cb.checked = selectAllCheckbox.checked;
        const invoiceId = cb.dataset.id;
        if (selectAllCheckbox.checked) {
            selectedInvoiceIds.add(invoiceId);
        } else {
            selectedInvoiceIds.delete(invoiceId);
        }
    });

    updateSelectedCount();
}

function showRejectConfirmModal() {
    if (selectedInvoiceIds.size === 0) return;

    document.getElementById('reject-count').textContent = selectedInvoiceIds.size;
    document.getElementById('reject-confirm-modal').style.display = 'flex';
}

function closeRejectConfirmModal() {
    document.getElementById('reject-confirm-modal').style.display = 'none';
}

async function executeRejectInvoices() {
    closeRejectConfirmModal();

    const invoiceIdsArray = Array.from(selectedInvoiceIds);

    try {
        // Show loading state
        const rejectBtn = document.getElementById('reject-selected-btn');
        rejectBtn.textContent = 'Processing...';
        rejectBtn.disabled = true;

        // Call API to reject invoices
        const response = await fetch('/api/manage', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                action: 'reject-invoices',
                invoiceIds: invoiceIdsArray,
                projectCode: currentReviewProject.project_code
            })
        });

        const result = await response.json();

        if (result.success) {
            alert(`Successfully rejected ${invoiceIdsArray.length} records`);
            // Reload data
            selectedInvoiceIds.clear();
            await loadExportProjectData();
            loadProjectInvoicesForReview();
        } else {
            throw new Error(result.message || 'Reject failed');
        }

    } catch (err) {
        console.error('Reject error:', err);
        alert('Reject failed: ' + err.message);
    } finally {
        const rejectBtn = document.getElementById('reject-selected-btn');
        rejectBtn.textContent = 'Reject Selected';
        updateSelectedCount();
    }
}

function closeProjectReviewModal() {
    document.getElementById('project-review-modal').style.display = 'none';
    currentReviewProject = null;
    selectedInvoiceIds.clear();
}

// Initialize review modal event listeners
document.addEventListener('DOMContentLoaded', function() {
    // Close review modal button
    const closeReviewBtn = document.getElementById('close-review-modal');
    if (closeReviewBtn) {
        closeReviewBtn.addEventListener('click', closeProjectReviewModal);
    }

    // Select all checkbox
    const selectAllCheckbox = document.getElementById('select-all-invoices');
    if (selectAllCheckbox) {
        selectAllCheckbox.addEventListener('change', toggleSelectAllInvoices);
    }

    // Reject button
    const rejectBtn = document.getElementById('reject-selected-btn');
    if (rejectBtn) {
        rejectBtn.addEventListener('click', showRejectConfirmModal);
    }

    // Reject confirm buttons
    const rejectConfirmYes = document.getElementById('reject-confirm-yes');
    if (rejectConfirmYes) {
        rejectConfirmYes.addEventListener('click', executeRejectInvoices);
    }

    const rejectConfirmNo = document.getElementById('reject-confirm-no');
    if (rejectConfirmNo) {
        rejectConfirmNo.addEventListener('click', closeRejectConfirmModal);
    }

    // Close modal when clicking outside
    document.getElementById('project-review-modal')?.addEventListener('click', function(e) {
        if (e.target === this) closeProjectReviewModal();
    });

    document.getElementById('reject-confirm-modal')?.addEventListener('click', function(e) {
        if (e.target === this) closeRejectConfirmModal();
    });
});
// ==================== End Project Review Modal Functions ====================

async function toggleArchiveProject(projectId, archived) {
    try {
        const res = await fetch('/api/manage', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                action: 'update',
                sheet: 'projects',
                rowNumber: projectId,
                data: { archived: archived }
            })
        });

        const json = await res.json();
        if (json.success) {
            // Update local data
            const proj = exportProjectsData.find(p => p.project_id === projectId);
            if (proj) {
                proj.archived = archived;
            }
            renderExportTable();
            alert(archived ? 'Project archived' : 'Project unarchived');
        } else {
            throw new Error(json.message || 'Update failed');
        }
    } catch (err) {
        console.error('Archive error:', err);
        alert('Operation failed: ' + err.message);
    }
}

async function confirmArchiveProject() {
    if (!currentExportProject) return;

    document.getElementById('archive-confirm-modal').style.display = 'none';
    await toggleArchiveProject(currentExportProject.project_id, true);
}

// Export modal event listeners
document.addEventListener('DOMContentLoaded', () => {
    const exportArchiveFilterEl = document.getElementById('export-archive-filter');
    if (exportArchiveFilterEl) {
        exportArchiveFilterEl.addEventListener('change', () => {
            exportArchiveFilter = exportArchiveFilterEl.value;
            renderExportTable();
        });
    }

    // Export confirm modal
    const exportConfirmYes = document.getElementById('export-confirm-yes');
    const exportConfirmNo = document.getElementById('export-confirm-no');
    if (exportConfirmYes) {
        exportConfirmYes.addEventListener('click', executeExport);
    }
    if (exportConfirmNo) {
        exportConfirmNo.addEventListener('click', () => {
            document.getElementById('export-confirm-modal').style.display = 'none';
        });
    }

    // Archive confirm modal
    const archiveConfirmYes = document.getElementById('archive-confirm-yes');
    const archiveConfirmNo = document.getElementById('archive-confirm-no');
    if (archiveConfirmYes) {
        archiveConfirmYes.addEventListener('click', confirmArchiveProject);
    }
    if (archiveConfirmNo) {
        archiveConfirmNo.addEventListener('click', () => {
            document.getElementById('archive-confirm-modal').style.display = 'none';
        });
    }
});

// Make export functions globally accessible
window.showExportConfirmModal = showExportConfirmModal;
window.showArchiveConfirmModal = showArchiveConfirmModal;


// ============ FINANCE RECONCILIATION ============

let reconStatements = [];
let reconSelectedStatementId = null;
let reconTransactions = [];
let reconPreviews = []; // { id, filename, fileBase64, preview, error, duplicate }

function showReconciliationPage() {
    const area = document.getElementById('reconciliation-area');
    if (!area) return;
    area.style.display = 'block';
    setupReconHandlersOnce();
    loadReconStatements();
}

let reconHandlersReady = false;
function setupReconHandlersOnce() {
    if (reconHandlersReady) return;
    reconHandlersReady = true;

    const uploadBtn = document.getElementById('recon-upload-btn');
    const fileInput = document.getElementById('recon-file-input');
    const refreshBtn = document.getElementById('recon-refresh-btn');
    const filterEl = document.getElementById('recon-tx-filter');

    if (uploadBtn) {
        uploadBtn.addEventListener('click', () => parseReconFiles());
    }
    if (refreshBtn) {
        refreshBtn.addEventListener('click', () => loadReconStatements());
    }
    if (filterEl) {
        filterEl.addEventListener('change', () => {
            if (reconSelectedStatementId) loadReconTransactions(reconSelectedStatementId);
        });
    }

    const closeInvoiceModal = document.getElementById('close-recon-invoice-modal');
    const invoiceModal = document.getElementById('recon-invoice-modal');
    if (closeInvoiceModal) {
        closeInvoiceModal.addEventListener('click', closeReconInvoicePreview);
    }
    if (invoiceModal) {
        invoiceModal.addEventListener('click', (e) => {
            if (e.target === invoiceModal) closeReconInvoicePreview();
        });
    }
}

function fileToBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            const result = String(reader.result || '');
            const base64 = result.includes(',') ? result.split(',')[1] : result;
            resolve(base64);
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

function formatMoney(amount, currency) {
    if (amount == null || amount === '') return '—';
    const n = Number(amount);
    const formatted = Number.isFinite(n) ? n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : amount;
    return currency ? `${currency} ${formatted}` : String(formatted);
}

async function parseReconFiles() {
    const fileInput = document.getElementById('recon-file-input');
    const files = Array.from(fileInput?.files || []);
    if (!files.length) {
        alert('Please select one or more PDF files');
        return;
    }

    for (const file of files) {
        if (file.size > 3 * 1024 * 1024) {
            reconPreviews.push({
                id: `${Date.now()}-${Math.random()}`,
                filename: file.name,
                error: 'File exceeds 3MB limit',
            });
            renderReconPreviews();
            continue;
        }

        try {
            const fileBase64 = await fileToBase64(file);
            const res = await fetch('/api/manage', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'recon_upload',
                    filename: file.name,
                    file_base64: fileBase64,
                }),
            });
            const json = await res.json();
            if (json.duplicate) {
                reconPreviews.push({
                    id: `${Date.now()}-${Math.random()}`,
                    filename: file.name,
                    fileBase64,
                    duplicate: true,
                    error: json.message,
                    existing: json.existing,
                    preview: json.preview || null,
                });
            } else if (!json.success) {
                reconPreviews.push({
                    id: `${Date.now()}-${Math.random()}`,
                    filename: file.name,
                    error: json.message || 'Parse failed',
                });
            } else {
                reconPreviews.push({
                    id: `${Date.now()}-${Math.random()}`,
                    filename: file.name,
                    fileBase64,
                    preview: json.preview,
                });
            }
        } catch (err) {
            reconPreviews.push({
                id: `${Date.now()}-${Math.random()}`,
                filename: file.name,
                error: err.message || 'Upload failed',
            });
        }
        renderReconPreviews();
    }

    if (fileInput) fileInput.value = '';
}

function renderReconPreviews() {
    const list = document.getElementById('recon-preview-list');
    if (!list) return;
    if (!reconPreviews.length) {
        list.innerHTML = '';
        return;
    }

    list.innerHTML = reconPreviews.map((item) => {
        if (item.error || item.duplicate) {
            return `<div class="recon-preview-card error">
                <strong>${escapeHtml(item.filename)}</strong>
                <div>${escapeHtml(item.error || 'Duplicate')}</div>
                <div class="recon-preview-actions">
                    <button type="button" class="btn-secondary" data-dismiss="${item.id}">Dismiss</button>
                </div>
            </div>`;
        }
        const p = item.preview;
        const warnClass = (p.warnings && p.warnings.length) ? ' warn' : '';
        const warnings = (p.warnings || []).map((w) => `<div style="color:#b45309;font-size:0.8rem;">⚠ ${escapeHtml(w)}</div>`).join('');
        return `<div class="recon-preview-card${warnClass}">
            <div class="recon-preview-meta">
                <span><strong>${escapeHtml(p.bank)}</strong> ****${escapeHtml(p.card_last4 || '')}</span>
                <span>${escapeHtml(p.period_start || '')} → ${escapeHtml(p.period_end || '')}</span>
                <span>${p.tx_count} txs</span>
                <span>Debit ${formatMoney(p.total_debit, p.currency)}</span>
                <span>Credit ${formatMoney(p.total_credit, p.currency)}</span>
            </div>
            <div style="font-size:0.8rem;color:#64748b;">${escapeHtml(item.filename)}</div>
            ${warnings}
            <div class="recon-preview-actions" style="margin-top:0.5rem;">
                <button type="button" class="btn-primary" data-confirm="${item.id}">Confirm Import</button>
                <button type="button" class="btn-secondary" data-dismiss="${item.id}">Dismiss</button>
            </div>
        </div>`;
    }).join('');

    list.querySelectorAll('[data-dismiss]').forEach((btn) => {
        btn.addEventListener('click', () => {
            reconPreviews = reconPreviews.filter((p) => p.id !== btn.getAttribute('data-dismiss'));
            renderReconPreviews();
        });
    });
    list.querySelectorAll('[data-confirm]').forEach((btn) => {
        btn.addEventListener('click', () => confirmReconImport(btn.getAttribute('data-confirm')));
    });
}

async function confirmReconImport(previewId) {
    const item = reconPreviews.find((p) => p.id === previewId);
    if (!item || !item.fileBase64 || !item.preview) return;

    const btn = document.querySelector(`[data-confirm="${previewId}"]`);
    if (btn) {
        btn.disabled = true;
        btn.textContent = 'Importing…';
    }

    try {
        const res = await fetch('/api/manage', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                action: 'recon_confirm',
                filename: item.filename,
                file_base64: item.fileBase64,
                preview: item.preview,
            }),
        });
        const json = await res.json();
        if (!json.success) {
            alert(json.message || 'Import failed');
            if (btn) {
                btn.disabled = false;
                btn.textContent = 'Confirm Import';
            }
            return;
        }
        reconPreviews = reconPreviews.filter((p) => p.id !== previewId);
        renderReconPreviews();
        await loadReconStatements();
        if (json.statement?.id) {
            selectReconStatement(json.statement.id);
        }
    } catch (err) {
        alert(err.message || 'Import failed');
        if (btn) {
            btn.disabled = false;
            btn.textContent = 'Confirm Import';
        }
    }
}

async function loadReconStatements() {
    try {
        const res = await fetch('/api/manage?action=recon_statements');
        const json = await res.json();
        if (!json.success) {
            console.error(json.message);
            return;
        }
        reconStatements = json.data || [];
        renderReconStatements();
    } catch (err) {
        console.error(err);
    }
}

function renderReconStatements() {
    const body = document.getElementById('recon-statements-body');
    if (!body) return;

    if (!reconStatements.length) {
        body.innerHTML = `<tr><td colspan="5" class="recon-empty">No statements uploaded yet</td></tr>`;
        return;
    }

    body.innerHTML = reconStatements.map((s) => {
        const selected = String(s.id) === String(reconSelectedStatementId) ? ' selected' : '';
        const period = `${s.period_start || ''} → ${s.period_end || ''}`;
        return `<tr class="recon-row${selected}" data-statement-id="${s.id}">
            <td>${escapeHtml(s.bank)}</td>
            <td>****${escapeHtml(s.card_last4 || '')}</td>
            <td>${escapeHtml(period)}</td>
            <td>${s.matched_count || 0}/${s.tx_count || 0}</td>
            <td>
                ${s.r2_key ? `<a href="/api/file?path=${encodeURIComponent(s.r2_key)}" target="_blank" rel="noopener">PDF</a>` : ''}
                <button type="button" class="btn-secondary" data-delete-statement="${s.id}" style="margin-left:4px;padding:0.2rem 0.4rem;font-size:0.7rem;">Del</button>
            </td>
        </tr>`;
    }).join('');

    body.querySelectorAll('[data-statement-id]').forEach((row) => {
        row.addEventListener('click', (e) => {
            if (e.target.closest('a,button')) return;
            selectReconStatement(row.getAttribute('data-statement-id'));
        });
    });
    body.querySelectorAll('[data-delete-statement]').forEach((btn) => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const id = btn.getAttribute('data-delete-statement');
            if (!confirm('Delete this statement? (only if no matches)')) return;
            const res = await fetch('/api/manage', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'recon_delete_statement', statement_id: Number(id) }),
            });
            const json = await res.json();
            if (!json.success) {
                alert(json.message || 'Delete failed');
                return;
            }
            if (String(reconSelectedStatementId) === String(id)) {
                reconSelectedStatementId = null;
                reconTransactions = [];
                renderReconTransactions();
            }
            loadReconStatements();
        });
    });
}

function selectReconStatement(id) {
    reconSelectedStatementId = id;
    renderReconStatements();
    const s = reconStatements.find((x) => String(x.id) === String(id));
    const title = document.getElementById('recon-tx-title');
    if (title) {
        title.textContent = s ? `— ${s.bank} ****${s.card_last4 || ''} ${s.period_start || ''}` : '';
    }
    loadReconTransactions(id);
}

async function loadReconTransactions(statementId) {
    const filter = document.getElementById('recon-tx-filter')?.value || 'all';
    const body = document.getElementById('recon-tx-body');
    if (body) body.innerHTML = `<tr><td colspan="7" class="recon-empty">Loading…</td></tr>`;

    try {
        const res = await fetch(`/api/manage?action=recon_transactions&statement_id=${encodeURIComponent(statementId)}&status=${encodeURIComponent(filter)}`);
        const json = await res.json();
        if (!json.success) {
            if (body) body.innerHTML = `<tr><td colspan="7" class="recon-empty">${escapeHtml(json.message || 'Failed')}</td></tr>`;
            return;
        }
        reconTransactions = json.data || [];
        renderReconTransactions();
    } catch (err) {
        if (body) body.innerHTML = `<tr><td colspan="7" class="recon-empty">${escapeHtml(err.message)}</td></tr>`;
    }
}

function renderReconTransactions() {
    const body = document.getElementById('recon-tx-body');
    if (!body) return;

    if (!reconSelectedStatementId) {
        body.innerHTML = `<tr><td colspan="7" class="recon-empty">Select a statement</td></tr>`;
        return;
    }
    if (!reconTransactions.length) {
        body.innerHTML = `<tr><td colspan="7" class="recon-empty">No transactions</td></tr>`;
        return;
    }

    body.innerHTML = reconTransactions.map((tx) => {
        const matchedClass = tx.matched_invoice_id ? ' matched' : '';
        const dirBadge = tx.is_fee
            ? '<span class="recon-badge fee">fee</span>'
            : `<span class="recon-badge ${tx.direction}">${escapeHtml(tx.direction)}</span>`;

        let matchCell = '';
        let actionCell = '';

        if (tx.matched_invoice_id && tx.matched_invoice) {
            const inv = tx.matched_invoice;
            matchCell = `<div><strong>${escapeHtml(inv.generated_invoice_id || ('#' + inv.id))}</strong><br>${escapeHtml(inv.vendor || '')}<br>${formatMoney(inv.amount, inv.currency)}</div>`;
            actionCell = `<div class="recon-actions">
                <button type="button" class="btn-view-invoice" data-view-matched="${tx.id}">View</button>
                <button type="button" class="btn-unmatch" data-unmatch="${tx.id}">Unmatch</button>
            </div>`;
        } else if (tx.is_fee) {
            matchCell = '<span style="color:#94a3b8;">Fee — no invoice</span>';
            actionCell = `<div class="recon-actions">
                <button type="button" class="btn-unmatch" data-unmatch="${tx.id}" title="Abandon matching">Unmatch</button>
            </div>`;
        } else {
            const suggestions = tx.suggestions || [];
            if (suggestions.length) {
                const opts = suggestions.map((s, idx) => {
                    const inv = s.invoice;
                    const label = `${inv.generated_invoice_id || ('#' + inv.id)} · ${inv.vendor || ''} · ${formatMoney(inv.amount, inv.currency)} (${Math.round(s.score)})`;
                    return `<option value="${inv.id}" ${idx === 0 ? 'selected' : ''}>${escapeHtml(label)}</option>`;
                }).join('');
                matchCell = `<div class="recon-candidate"><select data-candidate-for="${tx.id}">${opts}</select></div>`;
                actionCell = `<div class="recon-actions">
                    <button type="button" class="btn-view-invoice" data-view-candidate="${tx.id}">View</button>
                    <button type="button" class="btn-match" data-match="${tx.id}">Match</button>
                    <button type="button" class="btn-unmatch" data-unmatch="${tx.id}" title="Abandon matching">Unmatch</button>
                </div>`;
            } else {
                matchCell = '<span style="color:#94a3b8;">No candidate</span>';
                actionCell = `<div class="recon-actions">
                    <button type="button" class="btn-unmatch" data-unmatch="${tx.id}" title="Abandon matching">Unmatch</button>
                </div>`;
            }
        }

        const txnAmt = formatMoney(tx.txn_amount, tx.txn_currency);
        const postAmt = formatMoney(tx.posting_amount, tx.posting_currency);
        const same = tx.txn_currency === tx.posting_currency && Number(tx.txn_amount) === Number(tx.posting_amount);

        return `<tr class="recon-row${matchedClass}" data-tx-id="${tx.id}">
            <td>${escapeHtml(tx.txn_date || tx.posting_date || '')}</td>
            <td class="recon-desc">${escapeHtml(tx.description || '')}</td>
            <td class="recon-amount">${escapeHtml(txnAmt)}</td>
            <td class="recon-amount">${same ? '—' : escapeHtml(postAmt)}</td>
            <td>${dirBadge}</td>
            <td>${matchCell}</td>
            <td>${actionCell}</td>
        </tr>`;
    }).join('');

    body.querySelectorAll('[data-match]').forEach((btn) => {
        btn.addEventListener('click', () => matchReconTransaction(btn.getAttribute('data-match')));
    });
    body.querySelectorAll('[data-unmatch]').forEach((btn) => {
        btn.addEventListener('click', () => unmatchReconTransaction(btn.getAttribute('data-unmatch')));
    });
    body.querySelectorAll('[data-view-matched]').forEach((btn) => {
        btn.addEventListener('click', () => {
            const tx = reconTransactions.find((t) => String(t.id) === String(btn.getAttribute('data-view-matched')));
            if (tx?.matched_invoice) openReconInvoicePreview(tx.matched_invoice);
        });
    });
    body.querySelectorAll('[data-view-candidate]').forEach((btn) => {
        btn.addEventListener('click', () => {
            const txId = btn.getAttribute('data-view-candidate');
            const tx = reconTransactions.find((t) => String(t.id) === String(txId));
            const select = document.querySelector(`select[data-candidate-for="${txId}"]`);
            const invoiceId = select ? Number(select.value) : null;
            const suggestion = (tx?.suggestions || []).find((s) => Number(s.invoice_id) === invoiceId)
                || (tx?.suggestions || [])[0];
            if (suggestion?.invoice) openReconInvoicePreview(suggestion.invoice);
            else alert('No invoice attachment available for this candidate');
        });
    });
}

function reconInvoiceFileUrl(invoice) {
    if (!invoice) return null;
    const fileLink = invoice.file_link_r2 || invoice.achieved_file_link || invoice.file_link || '';
    if (!fileLink) return null;

    const isR2Link = fileLink.includes('r2.cloudflarestorage.com')
        || fileLink.includes('.r2.dev')
        || fileLink.includes('buiservice-assets')
        || fileLink.startsWith('bui_invoice/')
        || fileLink.startsWith('/bui_invoice/');

    if (isR2Link || fileLink.startsWith('/')) {
        const normalized = fileLink.startsWith('/') ? fileLink.slice(1) : fileLink;
        if (normalized.startsWith('bui_invoice/')) {
            return `/api/file?path=${encodeURIComponent(normalized)}`;
        }
        return `/api/file?link=${encodeURIComponent(fileLink)}`;
    }
    return fileLink;
}

function openReconInvoicePreview(invoice) {
    const modal = document.getElementById('recon-invoice-modal');
    const title = document.getElementById('recon-invoice-modal-title');
    const meta = document.getElementById('recon-invoice-modal-meta');
    const preview = document.getElementById('recon-invoice-preview');
    if (!modal || !preview) return;

    const label = invoice.generated_invoice_id || `#${invoice.id}`;
    if (title) title.textContent = label;
    if (meta) {
        meta.textContent = [
            invoice.vendor || '',
            formatMoney(invoice.amount, invoice.currency),
            invoice.invoice_date || '',
        ].filter(Boolean).join(' · ');
    }

    const url = reconInvoiceFileUrl(invoice);
    if (!url) {
        preview.innerHTML = '<p style="color:#888;">No attachment available</p>';
    } else {
        const lower = String(invoice.file_link_r2 || invoice.achieved_file_link || invoice.file_link || '').toLowerCase();
        const looksPdf = lower.includes('.pdf') || url.includes('.pdf');
        if (looksPdf || !/\.(jpg|jpeg|png|gif|webp)(\?|$)/i.test(lower)) {
            preview.innerHTML = `<iframe src="${url}" title="Invoice preview"></iframe>`;
        } else {
            preview.innerHTML = `<img src="${url}" alt="Invoice attachment">`;
        }
    }

    modal.style.display = 'flex';
}

function closeReconInvoicePreview() {
    const modal = document.getElementById('recon-invoice-modal');
    const preview = document.getElementById('recon-invoice-preview');
    if (preview) preview.innerHTML = '';
    if (modal) modal.style.display = 'none';
}

async function matchReconTransaction(txId) {
    const select = document.querySelector(`select[data-candidate-for="${txId}"]`);
    const invoiceId = select ? Number(select.value) : null;
    if (!invoiceId) {
        alert('Select a candidate invoice');
        return;
    }

    const btn = document.querySelector(`[data-match="${txId}"]`);
    if (btn) btn.disabled = true;

    try {
        const res = await fetch('/api/manage', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                action: 'recon_match',
                transaction_id: Number(txId),
                invoice_id: invoiceId,
            }),
        });
        const json = await res.json();
        if (!json.success) {
            alert(json.message || 'Match failed');
            if (btn) btn.disabled = false;
            return;
        }

        // Local update — no full reload
        const idx = reconTransactions.findIndex((t) => String(t.id) === String(txId));
        if (idx >= 0) {
            reconTransactions[idx] = {
                ...reconTransactions[idx],
                matched_invoice_id: json.invoice_id,
                matched_at: json.matched_at,
                matched_invoice: json.matched_invoice,
                suggestions: [],
            };
        }
        const stmt = reconStatements.find((s) => String(s.id) === String(reconSelectedStatementId));
        if (stmt) stmt.matched_count = (stmt.matched_count || 0) + 1;
        renderReconStatements();
        renderReconTransactions();
    } catch (err) {
        alert(err.message || 'Match failed');
        if (btn) btn.disabled = false;
    }
}

async function unmatchReconTransaction(txId) {
    const tx = reconTransactions.find((t) => String(t.id) === String(txId));
    const isMatched = Boolean(tx?.matched_invoice_id);
    const confirmMsg = isMatched
        ? 'Unmatch this transaction from its invoice?'
        : 'Abandon matching for this transaction? It will be hidden from the Unmatched list.';
    if (!confirm(confirmMsg)) return;

    try {
        const res = await fetch('/api/manage', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                action: 'recon_unmatch',
                transaction_id: Number(txId),
            }),
        });
        const json = await res.json();
        if (!json.success) {
            alert(json.message || 'Unmatch failed');
            return;
        }

        if (json.mode === 'ignored' || (!isMatched && json.success)) {
            // Remove from local list when abandoning unmatched rows
            reconTransactions = reconTransactions.filter((t) => String(t.id) !== String(txId));
            renderReconTransactions();
            return;
        }

        // Unlinked matched pair — reload to refresh suggestions
        await loadReconTransactions(reconSelectedStatementId);
        const stmt = reconStatements.find((s) => String(s.id) === String(reconSelectedStatementId));
        if (stmt && stmt.matched_count > 0) stmt.matched_count -= 1;
        renderReconStatements();
    } catch (err) {
        alert(err.message || 'Unmatch failed');
    }
}

function escapeHtml(str) {
    return String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
