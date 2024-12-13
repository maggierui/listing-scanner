// Category handling functions
async function loadCategories() {
  try {
      const response = await fetch('/api/categories');
      const categories = await response.json();
      
      const select = document.getElementById('categorySelect');
      const search = document.getElementById('categorySearch');
      
      function updateCategories(searchTerm = '') {
          select.innerHTML = '';
          const filteredCategories = categories.filter(cat => 
              cat.categoryName.toLowerCase().includes(searchTerm.toLowerCase())
          );
          
          filteredCategories.forEach(category => {
              const option = document.createElement('option');
              option.value = category.categoryId;
              option.textContent = `${category.categoryName} (${category.categoryId})`;
              select.appendChild(option);
          });
      }

      // Initial load of all categories
      updateCategories();

      // Add search functionality
      search.addEventListener('input', (e) => {
          updateCategories(e.target.value);
      });

      // Update selected category ID when selection changes
      select.addEventListener('change', (e) => {
          const selectedOptions = Array.from(e.target.selectedOptions);
          const categoryIds = selectedOptions.map(option => option.value);
          document.getElementById('selectedCategoryId').textContent = 
              categoryIds.length ? categoryIds.join(', ') : 'None';
      });

  } catch (error) {
      console.error('Error loading categories:', error);
      const select = document.getElementById('categorySelect');
      select.innerHTML = '<option value="">Error loading categories</option>';
  }
}

// Form submission handler
async function handleScanSubmit(e) {
  e.preventDefault();
  
  try {
      // Show loading state
      document.getElementById('loading').style.display = 'block';
      document.getElementById('error').style.display = 'none';
      document.getElementById('results').style.display = 'none';

      const response = await fetch('/api/scan', {  // This is a POST request
          method: 'POST',
          headers: {
              'Content-Type': 'application/json',
          },
          body: JSON.stringify({
              categoryIds: Array.from(document.getElementById('categorySelect').selectedOptions)
                  .map(option => option.value),
              feedbackThreshold: document.getElementById('feedbackThreshold').value,
              searchPhrases: document.getElementById('searchPhrases').value
          })
      });

      if (!response.ok) {
          throw new Error('Failed to initiate scan');
      }

      // Start polling for results
      pollResults();

  } catch (error) {
      document.getElementById('loading').style.display = 'none';
      document.getElementById('error').textContent = 'Scan failed: ' + error.message;
      document.getElementById('error').style.display = 'block';
  }
}

// Results polling function
async function pollResults() {
  try {
      const response = await fetch('/api/results', {
          method: 'GET'  // Explicitly specify GET method
      });
      const data = await response.json();

      // Update log area if available
      if (data.logMessages && data.logMessages.length > 0) {
          const logArea = document.getElementById('logArea');
          logArea.innerHTML = data.logMessages.join('<br>');
      }

      if (data.status === 'complete') {
          displayResults(data.listings);
          document.getElementById('loading').style.display = 'none';
          document.getElementById('results').style.display = 'block';
      } else if (data.status === 'error') {
          document.getElementById('loading').style.display = 'none';
          document.getElementById('error').textContent = 'Scan failed: ' + data.error;
          document.getElementById('error').style.display = 'block';
      } else {
          // Continue polling if still processing
          setTimeout(pollResults, 5000);
      }

  } catch (error) {
      document.getElementById('loading').style.display = 'none';
      document.getElementById('error').textContent = 'Error checking results: ' + error.message;
      document.getElementById('error').style.display = 'block';
  }
}

// Make sure form is connected to handler
document.getElementById('scanForm').addEventListener('submit', handleScanSubmit);

// Results display function
function displayResults(results) {
  const resultsDiv = document.getElementById('results');
  const tbody = document.getElementById('resultTable');
  const totalSpan = document.getElementById('totalListings');
  
  tbody.innerHTML = '';
  totalSpan.textContent = results.length;
  
  results.forEach(item => {
      const row = tbody.insertRow();
      row.innerHTML = `
          <td>${item.title}</td>
          <td>${item.price}</td>
          <td>${item.currency}</td>
          <td>${item.seller}</td>
          <td>${item.feedbackScore}</td>
          <td>${item.category}</td>
          <td><a href="${item.link}" target="_blank">View</a></td>
      `;
  });
  
  resultsDiv.style.display = 'block';
  document.getElementById('lastUpdated').textContent = new Date().toLocaleString();
}

// Initialize event listeners when the page loads
document.addEventListener('DOMContentLoaded', () => {
  loadCategories();
  document.getElementById('scanForm').addEventListener('submit', handleFormSubmit);
});

// Download logs function
async function downloadLogs() {
  try {
      const response = await fetch('/api/logs');
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.style.display = 'none';
      a.href = url;
      a.download = 'scan-logs.txt';
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
  } catch (error) {
      console.error('Error downloading logs:', error);
      alert('Failed to download logs');
  }
}