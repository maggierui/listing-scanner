class ResultsDashboard {
    constructor() {
        this.filters = {
            searchId: null,
            dateFrom: null,
            dateTo: null,
            priceMin: null,
            priceMax: null,
            page: 1,
            limit: 50
        };
        
        this.initializeEventListeners();
        this.loadSavedSearches();
        this.loadResults();
    }
    
    async loadSavedSearches() {
        try {
            const response = await fetch('/api/saves/searches');
            const searches = await response.json();
            
            const select = document.getElementById('savedSearchFilter');
            searches.forEach(search => {
                const option = new Option(search.name, search.id);
                select.add(option);
            });
        } catch (error) {
            console.error('Error loading saved searches:', error);
        }
    }
    
    async loadResults() {
        try {
            const queryString = new URLSearchParams(this.filters).toString();
            const response = await fetch(`/api/dashboard/results?${queryString}`);
            const data = await response.json();
            
            this.displayResults(data.results);
            this.updatePagination(data.total, data.page, data.totalPages);
        } catch (error) {
            console.error('Error loading results:', error);
        }
    }
    
    displayResults(results) {
        const grid = document.getElementById('resultsGrid');
        grid.innerHTML = results.map(item => `
            <div class="result-card">
                <h3>${item.title}</h3>
                <p>Price: $${item.price}</p>
                <p>Found: ${new Date(item.first_found_at).toLocaleString()}</p>
                <p>Search: ${item.search_name}</p>
                <a href="${item.url}" target="_blank">View on eBay</a>
            </div>
        `).join('');
    }
    
    initializeEventListeners() {
        document.getElementById('applyFilters').addEventListener('click', () => {
            this.filters = {
                ...this.filters,
                searchId: document.getElementById('savedSearchFilter').value,
                dateFrom: document.getElementById('dateFrom').value,
                dateTo: document.getElementById('dateTo').value,
                priceMin: document.getElementById('priceMin').value,
                priceMax: document.getElementById('priceMax').value,
                page: 1
            };
            this.loadResults();
        });
    }
}

new ResultsDashboard(); 