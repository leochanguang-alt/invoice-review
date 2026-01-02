const COLUMNS = [
    "Invoice Date", "Vender", "Amount", "Currency", "Amount(HKD)",
    "Country", "Category", "Status", "Charge to Company",
    "Charge to Project", "Owner", "Invoice ID"
];

const PAGES = {
    summary: "Expense Summary",
    invoice: "Review Invoice",
    reconciliation: "Finance Reconciliation",
    settings: "Account Setting"
};

const navItems = document.querySelectorAll('.nav-item');
const pageTitle = document.getElementById('page-title');
const tableHeader = document.getElementById('table-header');
const tableBody = document.getElementById('table-body');

// Initialize
function init() {
    renderHeaders();
    setupNavigation();
    loadMockData(); // Initially load mock data
}

function renderHeaders() {
    tableHeader.innerHTML = COLUMNS.map(col => `<th>${col}</th>`).join('');
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

            if (page === 'summary') {
                document.getElementById('content-area').style.display = 'block';
                loadMockData();
            } else {
                document.getElementById('content-area').style.display = 'none';
            }
        });
    });
}

async function loadMockData() {
    tableBody.innerHTML = '<tr><td colspan="' + COLUMNS.length + '" style="text-align:center">Loading data...</td></tr>';

    // Attempt real API call
    try {
        const res = await fetch('/api/expenses');
        const json = await res.json();
        if (json.success && json.data) {
            renderRows(json.data);
        } else {
            showMockData();
        }
    } catch (e) {
        console.error("Fetch error, using mock data", e);
        showMockData();
    }
}

function renderRows(data) {
    if (data.length === 0) {
        tableBody.innerHTML = '<tr><td colspan="' + COLUMNS.length + '" style="text-align:center">No records found.</td></tr>';
        return;
    }
    tableBody.innerHTML = data.map(row => `
        <tr>
            ${COLUMNS.map(col => {
        const val = row[col] || '';
        if (col === 'Status') {
            const cls = val.toLowerCase().includes('waiting') ? 'status-waiting' : val.toLowerCase().includes('confirmed') ? 'status-confirmed' : '';
            return `<td><span class="status-badge ${cls}">${val}</span></td>`;
        }
        return `<td>${val}</td>`;
    }).join('')}
        </tr>
    `).join('');
}

function showMockData() {
    const mockData = [
        {
            "Invoice Date": "2023-12-01",
            "Vender": "AWS",
            "Amount": "100.00",
            "Currency": "USD",
            "Amount(HKD)": "780.00",
            "Country": "USA",
            "Category": "Cloud Services",
            "Status": "Confirmed",
            "Charge to Company": "BUI HK",
            "Charge to Project": "Internal",
            "Owner": "John Doe",
            "Invoice ID": "INV-001"
        },
        {
            "Invoice Date": "2023-12-05",
            "Vender": "Starbucks",
            "Amount": "50.00",
            "Currency": "HKD",
            "Amount(HKD)": "50.00",
            "Country": "HK",
            "Category": "F&B",
            "Status": "Waiting for Confirm",
            "Charge to Company": "BUI HK",
            "Charge to Project": "Client-X",
            "Owner": "Jane Smith",
            "Invoice ID": "INV-002"
        }
    ];
    renderRows(mockData);
}

init();
