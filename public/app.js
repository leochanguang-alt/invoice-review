const COLUMNS = [
    "Invoice Date", "Vender", "Amount", "Currency", "Amount(HKD)",
    "Country", "Category", "Status", "Charge to Company",
    "Charge to Project", "Owner", "Invoice ID"
];

const PAGES = {
    summary: "Dashboard",
    invoice: "Review Invoice",
    reconciliation: "Finance Reconciliation",
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
const loginModal = document.getElementById('login-modal');
const mainApp = document.getElementById('main-app');
const loginForm = document.getElementById('login-form');
const passwordInput = document.getElementById('password-input');
const loginError = document.getElementById('login-error');
const logoutBtn = document.getElementById('logout-btn');

// Initialize
async function init() {
    setupNavigation();
    // setupAuth(); // Auth disabled for now

    // Skip auth check - show app directly
    showApp();

    /* Original auth check (disabled):
    const isAuthenticated = await checkAuth();
    if (isAuthenticated) {
        showApp();
    } else {
        showLogin();
    }
    */
}

function setupAuth() {
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const password = passwordInput.value;
        try {
            const res = await fetch('/api/auth', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'login', password })
            });
            const data = await res.json();
            if (data.success) {
                showApp();
                passwordInput.value = '';
                loginError.style.display = 'none';
            } else {
                loginError.style.display = 'block';
            }
        } catch (e) {
            console.error('Login error', e);
            loginError.innerText = "Connection Error";
            loginError.style.display = 'block';
        }
    });

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
    loginModal.style.display = 'none';
    mainApp.style.display = 'flex';
    loadSummaryPage(); // Load summary page on app start
}

function showLogin() {
    mainApp.style.display = 'none';
    loginModal.style.display = 'flex';
}

function setupNavigation() {
    navItems.forEach(item => {
        item.addEventListener('click', () => {
            // Update active states
            navItems.forEach(i => i.classList.remove('active'));
            item.classList.add('active');

            // Update title
            const page = item.getAttribute('data-page');
            pageTitle.innerText = PAGES[page];

            // Hide all content areas first
            document.getElementById('content-area').style.display = 'none';
            document.getElementById('settings-area').style.display = 'none';
            document.getElementById('invoice-review-area').style.display = 'none';

            if (page === 'summary') {
                document.getElementById('content-area').style.display = 'block';
                loadSummaryPage();
            } else if (page === 'settings') {
                showSettingsPage();
            } else if (page === 'invoice') {
                showInvoiceReviewPage();
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
    
    // Group by month
    const monthlyData = {};
    const breakdownData = {}; // For stacking by category/project
    
    const selectedCompany = document.getElementById('filter-company').value;
    const selectedProject = document.getElementById('filter-project').value;
    const selectedCategory = document.getElementById('filter-category').value;
    
    // Determine breakdown dimension
    let breakdownKey = 'Category';
    if (selectedCategory && !selectedProject) {
        breakdownKey = 'Charge to Project';
    }
    
    filteredData.forEach(item => {
        const date = item['Invoice Date'];
        if (!date) return;
        
        const amount = parseFloat((item['Amount(HKD)'] || '0').toString().replace(/,/g, '')) || 0;
        const breakdownValue = item[breakdownKey] || 'Other';
        
        const dateObj = new Date(date);
        if (isNaN(dateObj.getTime())) return;
        
        const monthKey = `${dateObj.getFullYear()}-${String(dateObj.getMonth() + 1).padStart(2, '0')}`;
        
        if (!monthlyData[monthKey]) {
            monthlyData[monthKey] = 0;
        }
        monthlyData[monthKey] += amount;
        
        if (!breakdownData[monthKey]) {
            breakdownData[monthKey] = {};
        }
        if (!breakdownData[monthKey][breakdownValue]) {
            breakdownData[monthKey][breakdownValue] = 0;
        }
        breakdownData[monthKey][breakdownValue] += amount;
    });
    
    // Sort months
    const sortedMonths = Object.keys(monthlyData).sort();
    
    // Prepare chart data
    const labels = sortedMonths.map(m => {
        const [year, month] = m.split('-');
        return `${year}/${month}`;
    });
    
    // Get all breakdown values
    const allBreakdownValues = [...new Set(
        Object.values(breakdownData).flatMap(obj => Object.keys(obj))
    )].sort();
    
    let datasets;
    
    if (allBreakdownValues.length <= 1 || (selectedProject && selectedCategory)) {
        // Single dimension - simple bar
        datasets = [{
            label: 'Total Expenses',
            data: sortedMonths.map(m => monthlyData[m] || 0),
            backgroundColor: CHART_COLORS[0],
            borderColor: CHART_COLORS[0],
            borderWidth: 0,
            borderRadius: 6,
            borderSkipped: false
        }];
    } else {
        // Multiple dimensions - stacked bar
        datasets = allBreakdownValues.map((val, idx) => ({
            label: val,
            data: sortedMonths.map(m => (breakdownData[m] && breakdownData[m][val]) || 0),
            backgroundColor: CHART_COLORS[idx % CHART_COLORS.length],
            borderColor: CHART_COLORS[idx % CHART_COLORS.length],
            borderWidth: 0,
            borderRadius: 4,
            borderSkipped: false
        }));
    }
    
    // Destroy existing chart
    if (expenseChart) {
        expenseChart.destroy();
    }
    
    // Create chart
    const ctx = document.getElementById('expense-chart').getContext('2d');
    expenseChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: datasets
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: datasets.length > 1,
                    position: 'bottom',
                    labels: {
                        color: '#4B5563',
                        font: {
                            family: "'Source Sans 3', sans-serif",
                            size: 11
                        },
                        padding: 12,
                        usePointStyle: true,
                        pointStyle: 'rect'
                    }
                },
                tooltip: {
                    backgroundColor: '#FFFFFF',
                    titleColor: '#111827',
                    bodyColor: '#374151',
                    borderColor: '#E5E7EB',
                    borderWidth: 1,
                    padding: 10,
                    cornerRadius: 4,
                    mode: 'index',
                    titleFont: {
                        family: "'Source Sans 3', sans-serif",
                        size: 12,
                        weight: 600
                    },
                    bodyFont: {
                        family: "Verdana, Geneva, sans-serif",
                        size: 11
                    },
                    callbacks: {
                        label: function(context) {
                            return null; // 不显示分组数值
                        },
                        afterBody: function(tooltipItems) {
                            // 计算并显示汇总数值
                            let total = 0;
                            tooltipItems.forEach(item => {
                                total += item.raw || 0;
                            });
                            return `Total: HKD ${total.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
                        }
                    }
                }
            },
            scales: {
                x: {
                    stacked: datasets.length > 1,
                    grid: {
                        color: '#F3F4F6',
                        drawBorder: false
                    },
                    ticks: {
                        color: '#6B7280',
                        font: {
                            family: "'Source Sans 3', sans-serif",
                            size: 11
                        }
                    }
                },
                y: {
                    stacked: datasets.length > 1,
                    beginAtZero: true,
                    grid: {
                        color: '#F3F4F6',
                        drawBorder: false
                    },
                    ticks: {
                        color: '#6B7280',
                        font: {
                            family: "Verdana, Geneva, sans-serif",
                            size: 10
                        },
                        callback: function(value) {
                            if (value >= 1000) {
                                return 'HKD ' + (value / 1000).toLocaleString() + 'K';
                            }
                            return 'HKD ' + value.toLocaleString();
                        }
                    }
                }
            },
            layout: {
                padding: {
                    left: 10
                }
            }
        }
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
    company: "公司信息管理",
    projects: "项目管理",
    owner: "个人账户管理"
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
        showEditModal("添加记录");
    };

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

    // Load data from API
    try {
        const res = await fetch(`/api/manage?sheet=${currentSheet}`);
        const json = await res.json();
        if (json.success) {
            currentHeaders = json.headers;
            currentData = json.data;
            renderManageTable();
        } else {
            alert("加载失败: " + json.message);
        }
    } catch (e) {
        console.error(e);
        alert("加载失败");
    }
}

function renderManageTable() {
    const headerRow = document.getElementById('manage-header');
    const body = document.getElementById('manage-body');

    headerRow.innerHTML = currentHeaders.map(h => `<th>${h}</th>`).join('') + '<th>操作</th>';

    if (currentData.length === 0) {
        body.innerHTML = `<tr><td colspan="${currentHeaders.length + 1}" style="text-align:center">暂无数据</td></tr>`;
        return;
    }

    body.innerHTML = currentData.map(row => {
        let buttons = `
            <button class="btn-small btn-edit" data-row="${row._rowNumber}">修改</button>
            <button class="btn-small btn-delete" data-row="${row._rowNumber}">删除</button>
        `;

        if (currentSheet === 'projects') {
            const driveLink = row['Drive_Folder_Link'] || '';
            buttons = `
                <button class="btn-small btn-view" data-row="${row._rowNumber}">View</button>
                <button class="btn-small btn-achieve" data-row="${row._rowNumber}" disabled>Achieve</button>
            `;
        }

        return `
            <tr>
                ${currentHeaders.map(h => `<td>${row[h] || ''}</td>`).join('')}
                <td>${buttons}</td>
            </tr>
        `;
    }).join('');

    // Attach events
    body.querySelectorAll('.btn-edit').forEach(btn => {
        btn.onclick = () => {
            const rowNum = parseInt(btn.dataset.row);
            const rowData = currentData.find(r => r._rowNumber === rowNum);
            editingRow = rowNum;
            showEditModal("修改记录", rowData);
        };
    });

    body.querySelectorAll('.btn-view').forEach(btn => {
        btn.onclick = () => {
            const rowNum = parseInt(btn.dataset.row);
            const rowData = currentData.find(r => r._rowNumber === rowNum);
            editingRow = rowNum;
            showEditModal("查看详情", rowData, true);
        };
    });

    body.querySelectorAll('.btn-delete').forEach(btn => {
        btn.onclick = async () => {
            if (!confirm("确定删除此记录?")) return;
            const rowNum = parseInt(btn.dataset.row);
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

        // Skip Owner ID in display (it's auto-generated)
        if (isOwnerId) {
            const idValue = editingRow ? value : nextOwnerId;
            fieldsHtml += `<input type="hidden" name="${h}" value="${idValue}" />`;
            continue;
        }

        // Project ID - auto-generated, readonly
        if (isProjectIdField) {
            const projectIdValue = editingRow ? value : newProjectId;
            fieldsHtml += `<div style="margin-bottom: 10px;">
                <label style="display: block; margin-bottom: 5px; color: #ccc;">${h}</label>
                <input type="text" name="${h}" id="project-id-field" value="${projectIdValue}" readonly
                    style="width: 100%; padding: 8px; border: 1px solid #333; background: #1a1a1a; color: #888; border-radius: 4px;" />
                <small style="color: #666;">自动生成: 6位大写字母 (唯一)</small>
            </div>`;
            continue;
        }

        fieldsHtml += `<div style="margin-bottom: 10px;">
            <label style="display: block; margin-bottom: 5px; color: #ccc;">${h}</label>`;

        if (isOwnerName) {
            // Owner is auto-generated from First Name + Last Name (readonly)
            fieldsHtml += `<input type="text" name="${h}" value="${value}" readonly
                style="width: 100%; padding: 8px; border: 1px solid #333; background: #1a1a1a; color: #888; border-radius: 4px;" />
            <small style="color: #666;">自动生成: First Name + Last Name</small>`;
        } else if (isMobileField) {
            // Mobile with country code prefix
            const mobileValue = value || '+86';
            fieldsHtml += `<input type="text" name="${h}" value="${mobileValue}" 
                style="width: 100%; padding: 8px; border: 1px solid #333; background: #2d2d2d; color: #fff; border-radius: 4px;" 
                placeholder="+86 13800138000" />
            <small style="color: #666;">格式: +国家区号 手机号 (默认 +86)</small>`;
        } else if (isProjectCodeField) {
            fieldsHtml += `<input type="text" name="${h}" value="${value}" readonly
                style="width: 100%; padding: 8px; border: 1px solid #333; background: #1a1a1a; color: #888; border-radius: 4px;" />
            <small style="color: #666;">自动生成: Company Code + Project Name</small>`;
        } else if (isCompanyField) {
            const isReadonly = isViewMode || (editingRow && currentSheet === 'projects');
            fieldsHtml += `<select name="${h}" ${isReadonly ? 'disabled' : ''}
                style="width: 100%; padding: 8px; border: 1px solid #333; background: ${isReadonly ? '#1a1a1a' : '#2d2d2d'}; color: ${isReadonly ? '#888' : '#fff'}; border-radius: 4px;">
                <option value="">-- 请选择 --</option>
                ${companyList.map(c => {
                const companyID = c['Company_ID'] || c['Company ID'] || c['Company_Code'] || c['Code'] || '';
                const selected = companyID === value ? 'selected' : '';
                return `<option value="${companyID}" ${selected}>${companyID}</option>`;
            }).join('')}
            </select>`;
            if (isReadonly) {
                fieldsHtml += `<input type="hidden" name="${h}" value="${value}" />`;
            }
        } else if (isProjectNameField && (editingRow || isViewMode)) {
            // Project Name becomes readonly after creation or in view mode
            fieldsHtml += `<input type="text" name="${h}" value="${value}" readonly
                style="width: 100%; padding: 8px; border: 1px solid #333; background: #1a1a1a; color: #888; border-radius: 4px;" />
            ${isViewMode ? '' : '<small style="color: #666;">项目创建后不可修改名称</small>'}`;
        } else if (isViewMode) {
            // All other fields in view mode
            fieldsHtml += `<input type="text" name="${h}" value="${value}" readonly
                style="width: 100%; padding: 8px; border: 1px solid #333; background: #1a1a1a; color: #888; border-radius: 4px;" />`;
        } else if (isDateField) {
            const isReadonly = isViewMode;
            fieldsHtml += `<input type="date" name="${h}" value="${value}" ${isReadonly ? 'readonly' : ''}
                style="width: 100%; padding: 8px; border: 1px solid #333; background: ${isReadonly ? '#1a1a1a' : '#2d2d2d'}; color: ${isReadonly ? '#888' : '#fff'}; border-radius: 4px;" />`;
        } else {
            const isReadonly = isViewMode;
            fieldsHtml += `<input type="text" name="${h}" value="${value}" ${isReadonly ? 'readonly' : ''}
                style="width: 100%; padding: 8px; border: 1px solid #333; background: ${isReadonly ? '#1a1a1a' : '#2d2d2d'}; color: ${isReadonly ? '#888' : '#fff'}; border-radius: 4px;" />`;
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
            saveBtn.innerText = '正在保存...';
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
        } else {
            alert("保存失败: " + json.message);
        }
    } catch (e) {
        console.error(e);
        alert("保存失败");
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
            alert("删除失败: " + json.message);
        }
    } catch (e) {
        console.error(e);
        alert("删除失败");
    }
}

// ============ INVOICE REVIEW PAGE FUNCTIONS ============

let reviewRecords = [];
let reviewedRows = new Set();
let submitSelectedRows = new Set(); // For submit tab checkbox selection
let selectedRecordRow = null;
let currentReviewTab = 'review';
let projectsList = [];
let ratesList = [];

const REVIEW_DISPLAY_FIELDS = [
    'Invoice Date', 'Vender', 'Amount', 'Currency', 'Amount(HKD)',
    'Country', 'Category', 'Owner',
    'Charge to Company', 'Charge to Project'
];

const EDITABLE_FIELDS = ['Charge to Company', 'Charge to Project'];

async function showInvoiceReviewPage() {
    document.getElementById('invoice-review-area').style.display = 'block';
    setupReviewTabs();
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

function setupReviewTabs() {
    document.querySelectorAll('.review-tab').forEach(tab => {
        tab.onclick = () => {
            // Check if leaving review tab with reviewed items
            if (currentReviewTab === 'review' && reviewedRows.size > 0) {
                showConfirmModal();
                return;
            }
            switchReviewTab(tab.dataset.tab);
        };
    });

    // Confirm modal buttons
    document.getElementById('confirm-yes').onclick = confirmReviewedInvoices;
    document.getElementById('confirm-no').onclick = () => {
        document.getElementById('confirm-modal').style.display = 'none';
        reviewedRows.clear();
        renderReviewRecords();
    };

    // Submit button event listener
    const submitBtn = document.getElementById('submit-selected-btn');
    if (submitBtn) {
        submitBtn.onclick = submitSelectedRecords;
    }
}

function switchReviewTab(tabName) {
    currentReviewTab = tabName;
    document.querySelectorAll('.review-tab').forEach(t => {
        t.classList.toggle('active', t.dataset.tab === tabName);
    });

    // Clear selections when switching tabs
    submitSelectedRows.clear();
    reviewedRows.clear();
    selectedRecordRow = null;

    // Show/hide right panel based on tab
    const rightPanel = document.querySelector('.review-right-panel');
    const leftPanel = document.querySelector('.review-left-panel');
    const submitActions = document.getElementById('submit-actions');

    if (tabName === 'submit') {
        // Hide right panel for submit tab
        if (rightPanel) rightPanel.style.display = 'none';
        if (leftPanel) leftPanel.style.flex = '1';
        if (submitActions) submitActions.style.display = 'block';
    } else {
        // Show right panel for other tabs
        if (rightPanel) rightPanel.style.display = 'flex';
        if (leftPanel) leftPanel.style.flex = '';
        if (submitActions) submitActions.style.display = 'none';
    }

    loadReviewRecords();
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
    bodyEl.innerHTML = '<tr><td colspan="10" style="text-align: center; padding: 2rem; color: #888;">Loading...</td></tr>';

    try {
        const res = await fetch('/api/expenses');
        const json = await res.json();

        if (json.success && json.data) {
            // Filter by status based on current tab
            let filteredRecords;
            if (currentReviewTab === 'review') {
                // Review tab: show Waiting for Confirm
                filteredRecords = json.data.filter(r =>
                    (r['Status'] || '').toLowerCase().includes('waiting')
                );
            } else if (currentReviewTab === 'submit') {
                // Submit tab: show only Confirmed (not Submitted, not Waiting)
                filteredRecords = json.data.filter(r => {
                    const status = (r['Status'] || '').toLowerCase().trim();
                    return status === 'confirmed';
                });
            } else {
                // Modify tab: show Confirmed
                filteredRecords = json.data.filter(r => {
                    const status = (r['Status'] || '').toLowerCase().trim();
                    return status === 'confirmed';
                });
            }
            reviewRecords = filteredRecords;
            document.getElementById('review-record-count').textContent = `${reviewRecords.length} records`;
            renderReviewRecords();
        } else {
            bodyEl.innerHTML = '<tr><td colspan="10" style="text-align: center; padding: 2rem; color: #888;">No records found</td></tr>';
        }
    } catch (e) {
        console.error(e);
        bodyEl.innerHTML = '<tr><td colspan="10" style="text-align: center; padding: 2rem; color: red;">Failed to load records</td></tr>';
    }
}

function renderReviewRecords() {
    const headerEl = document.getElementById('review-table-header');
    const bodyEl = document.getElementById('review-table-body');

    // Define columns based on current tab
    let DISPLAY_COLUMNS;
    if (currentReviewTab === 'submit') {
        // Submit tab: no Status, add Project and Company
        DISPLAY_COLUMNS = [
            { key: 'Invoice Date', label: 'Invoice Date' },
            { key: 'Vender', label: 'Vendor' },
            { key: 'Amount', label: 'Amount' },
            { key: 'Currency', label: 'Currency' },
            { key: 'Amount(HKD)', label: 'Amount(HKD)' },
            { key: 'Country', label: 'Country' },
            { key: 'Category', label: 'Category' },
            { key: 'Owner', label: 'Owner' },
            { key: 'Charge to Project', label: 'Project' },
            { key: 'Charge to Company', label: 'Company' }
        ];
    } else {
        // Review/Modify tabs: original columns with Status
        DISPLAY_COLUMNS = [
            { key: 'Invoice Date', label: 'Invoice Date' },
            { key: 'Vender', label: 'Vendor' },
            { key: 'Amount', label: 'Amount' },
            { key: 'Currency', label: 'Currency' },
            { key: 'Amount(HKD)', label: 'Amount(HKD)' },
            { key: 'Country', label: 'Country' },
            { key: 'Category', label: 'Category' },
            { key: 'Status', label: 'Status' },
            { key: 'Owner', label: 'Owner' }
        ];
    }

    // Render header
    if (currentReviewTab === 'submit') {
        // Submit tab: checkbox with select all
        const allSelected = reviewRecords.length > 0 && reviewRecords.every(r => submitSelectedRows.has(r._rowNumber));
        headerEl.innerHTML = `<th><input type="checkbox" id="select-all-checkbox" ${allSelected ? 'checked' : ''} onchange="toggleSubmitSelectAll()" /></th>` +
            DISPLAY_COLUMNS.map(col => `<th>${col.label}</th>`).join('');
    } else {
        // Review/Modify tabs: button column
        headerEl.innerHTML = '<th></th>' + DISPLAY_COLUMNS.map(col => `<th>${col.label}</th>`).join('');
    }

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
        const isSubmitSelected = submitSelectedRows.has(rowNum);

        const cells = DISPLAY_COLUMNS.map(col => {
            const value = getField(record, col.key);
            // Special styling for Status
            if (col.key === 'Status') {
                const statusClass = value.toLowerCase().includes('confirmed') ? 'status-confirmed' : 'status-waiting';
                return `<td><span class="${statusClass}">${value}</span></td>`;
            }
            return `<td>${value}</td>`;
        }).join('');

        if (currentReviewTab === 'submit') {
            // Submit tab: checkbox
            return `
                <tr class="review-row ${isSubmitSelected ? 'submit-selected' : ''}" 
                    data-row="${rowNum}" data-idx="${idx}">
                    <td><input type="checkbox" class="submit-checkbox" data-row="${rowNum}" ${isSubmitSelected ? 'checked' : ''} /></td>
                    ${cells}
                </tr>
            `;
        } else {
            // Review/Modify tabs: review and delete buttons
            return `
                <tr class="review-row ${isReviewed ? 'reviewed' : ''} ${isSelected ? 'selected' : ''}" 
                    data-row="${rowNum}" data-idx="${idx}">
                    <td style="white-space: nowrap;">
                        <button class="review-btn" data-row="${rowNum}">Review</button>
                        <button class="delete-btn" data-row="${rowNum}" style="background: #666; margin-left: 5px;">Delete</button>
                    </td>
                    ${cells}
                </tr>
            `;
        }
    }).join('');

    // Attach click events
    bodyEl.querySelectorAll('.review-row').forEach(row => {
        row.onclick = (e) => {
            if (currentReviewTab === 'submit') {
                // Submit tab: handle checkbox
                if (e.target.classList.contains('submit-checkbox')) {
                    const rowNum = parseInt(e.target.dataset.row);
                    toggleSubmitSelect(rowNum);
                }
            } else {
                // Review/Modify tabs
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
            }
        };
    });
}

function toggleReviewed(rowNum) {
    if (reviewedRows.has(rowNum)) {
        reviewedRows.delete(rowNum);
    } else {
        reviewedRows.add(rowNum);
    }
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
            alert('Record deleted successfully from all sources.');
            // Refresh the list
            await loadReviewRecords();
            // Clear detail panel if the deleted record was selected
            if (selectedRecordRow === rowNum) {
                selectedRecordRow = null;
                document.getElementById('review-detail-form').innerHTML = '<h3>Invoice Details</h3><p style="color: #888;">Select a record from the left to view details</p>';
                document.getElementById('attachment-container').innerHTML = '<p style="color: #888;">No attachment available</p>';
            }
        } else {
            alert('Failed to delete record: ' + json.message);
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

// Submit tab functions
function toggleSubmitSelect(rowNum) {
    if (submitSelectedRows.has(rowNum)) {
        submitSelectedRows.delete(rowNum);
    } else {
        submitSelectedRows.add(rowNum);
    }
    renderReviewRecords();
}

function toggleSubmitSelectAll() {
    const allSelected = reviewRecords.length > 0 && reviewRecords.every(r => submitSelectedRows.has(r._rowNumber));
    if (allSelected) {
        // Deselect all
        submitSelectedRows.clear();
    } else {
        // Select all
        reviewRecords.forEach(r => submitSelectedRows.add(r._rowNumber));
    }
    renderReviewRecords();
}

async function submitSelectedRecords() {
    if (submitSelectedRows.size === 0) {
        alert('Please select at least one record to submit');
        return;
    }

    const confirmed = confirm(`Are you sure you want to submit ${submitSelectedRows.size} record(s)?`);
    if (!confirmed) return;

    // Collect selected records data for Invoice_ID generation
    const recordsToSubmit = reviewRecords
        .filter(r => submitSelectedRows.has(r._rowNumber))
        .map(r => ({
            rowNumber: r._rowNumber,
            companyId: (r['Charge to Company'] || '').trim(),
            projectCode: (r['Charge to Project'] || '').trim(),
            amount: r['Amount'] || '',
            currency: r['Currency'] || '',
            fileId: r['file_id'] || r['Drive_ID'] || ''
        }));

    console.log('[DEBUG] Records to submit:', recordsToSubmit);

    // Show progress modal
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

    try {
        // Submit records one by one to show progress
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
                    progressDetails.innerHTML += `<div class="item success">✓ Row ${record.rowNumber}: ${record.projectCode} - ${record.amount}${record.currency}</div>`;
                } else {
                    errorCount++;
                    progressDetails.innerHTML += `<div class="item error">✗ Row ${record.rowNumber}: ${json.message}</div>`;
                }
            } catch (e) {
                errorCount++;
                progressDetails.innerHTML += `<div class="item error">✗ Row ${record.rowNumber}: ${e.message}</div>`;
            }

            // Scroll to bottom of details
            progressDetails.scrollTop = progressDetails.scrollHeight;
        }

        // Complete
        progressFill.style.width = '100%';
        progressCurrent.textContent = recordsToSubmit.length;

        if (errorCount === 0) {
            progressTitle.textContent = 'Submission Complete!';
            progressStatus.textContent = `Successfully submitted ${successCount} record(s)!`;
        } else {
            progressTitle.textContent = 'Submission Complete (with errors)';
            progressStatus.textContent = `Success: ${successCount}, Failed: ${errorCount}`;
        }

        // Wait a moment then close
        await new Promise(resolve => setTimeout(resolve, 2000));

        progressModal.style.display = 'none';
        submitSelectedRows.clear();
        await loadReviewRecords();

    } catch (e) {
        console.error('Submit error:', e);
        progressTitle.textContent = 'Submission Failed';
        progressStatus.textContent = `Error: ${e.message}`;

        // Wait then close
        await new Promise(resolve => setTimeout(resolve, 3000));
        progressModal.style.display = 'none';
    }
}

// Make submit functions globally accessible
window.toggleSubmitSelectAll = toggleSubmitSelectAll;
window.submitSelectedRecords = submitSelectedRecords;

function selectRecord(idx) {
    const record = reviewRecords[idx];
    selectedRecordRow = record._rowNumber;
    renderReviewRecords();
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

    if (!selectedCompanyId) {
        projectSelect.innerHTML = '<option value="">-- Select Company First --</option>';
        return;
    }

    // Filter projects by Company_ID field (case-insensitive)
    const filteredProjects = projectsList.filter(p => {
        const projectCompanyId = (p['Company_ID'] || p['Company ID'] || '').toLowerCase();
        return projectCompanyId === selectedCompanyId.toLowerCase();
    });

    if (filteredProjects.length === 0) {
        projectSelect.innerHTML = '<option value="">-- No Projects Found --</option>';
        return;
    }

    projectSelect.innerHTML = '<option value="">-- Select --</option>' +
        filteredProjects.map(p => {
            const projectCode = (p['Project Code'] || p['Project_ID'] || '').trim();
            const normalizedValue = (selectedValue || '').toString().trim();
            const isSelected = normalizedValue && projectCode.toLowerCase() === normalizedValue.toLowerCase();
            const selected = isSelected ? 'selected' : '';
            return `<option value="${projectCode}" ${selected}>${projectCode}</option>`;
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
        'Charge to Project': 'Charge to Project'
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

        const res = await fetch('/api/manage', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                action: 'update',
                sheet: 'main',
                rowNumber: rowNumber,
                data: data
            })
        });
        const json = await res.json();
        if (json.success) {
            await loadReviewRecords();
        } else {
            alert('Failed to save: ' + json.message);
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

function showConfirmModal() {
    const modal = document.getElementById('confirm-modal');
    document.getElementById('confirm-modal-message').textContent =
        `You have ${reviewedRows.size} reviewed invoice(s). Confirm to update their status to "Confirmed"?`;
    modal.style.display = 'flex';
}

async function confirmReviewedInvoices() {
    document.getElementById('confirm-modal').style.display = 'none';

    // Validate all reviewed records
    for (const rowNum of reviewedRows) {
        const record = reviewRecords.find(r => r._rowNumber === rowNum);
        if (!record) continue;

        // Check for empty required fields
        for (const field of REVIEW_DISPLAY_FIELDS) {
            if (!record[field] || record[field].trim() === '') {
                alert(`Record row ${rowNum} has empty field: ${field}`);
                return;
            }
        }
    }

    // Update status for all reviewed records
    try {
        for (const rowNum of reviewedRows) {
            await fetch('/api/confirm', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ rowNumber: rowNum })
            });
        }
        alert(`${reviewedRows.size} invoice(s) confirmed!`);
        reviewedRows.clear();
        await loadReviewRecords();
    } catch (e) {
        console.error(e);
        alert('Failed to confirm invoices');
    }
}

// Make functions globally accessible
window.filterProjectsByCompany = filterProjectsByCompany;
window.saveRecordChanges = saveRecordChanges;

