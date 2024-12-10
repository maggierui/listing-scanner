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

// Form submission handling
async function handleFormSubmit(e) {
  e.preventDefault();
  
  const formdata={
    categoryIds: Array.from(document.getElementById('categorySelect').selectedOptions)
      .map(option => option.value),
    feedbackThreshold: document.getElementById('feedbackThreshold').value,
     searchPhrases: document.getElementById('searchPhrases').value
  }
  console.log('Client sending data:', formdata);  // Add this debug log

  // Show loading state
  document.getElementById('loading').style.display = 'block';
  document.getElementById('error').style.display = 'none';
  document.getElementById('results').style.display = 'none';

  try {
      const response = await fetch('/api/scan', {
          method: 'POST',
          headers: {
              'Content-Type': 'application/json',
          },
          body: JSON.stringify(formdata)
      });

      if (!response.ok) {
          throw new Error('Scan failed');
      }

      const results = await response.json();
      displayResults(results);
  } catch (error) {
      document.getElementById('error').textContent = 'Scan failed: ' + error.message;
      document.getElementById('error').style.display = 'block';
  } finally {
      document.getElementById('loading').style.display = 'none';
  }
}

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