async function loadConditions() {
  const conditionContainer = document.getElementById('conditionCheckboxes');
    const conditions = await fetch('/api/conditions').then(res => res.json());
    
    conditions.forEach(condition => {
        const div = document.createElement('div');
        div.className = 'condition-option';
        
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.id = `condition-${condition.id}`;
        checkbox.name = 'conditions';
        checkbox.value = condition.id;
        
        const label = document.createElement('label');
        label.htmlFor = `condition-${condition.id}`;
        label.textContent = condition.name;
        
        div.appendChild(checkbox);
        div.appendChild(label);
        conditionContainer.appendChild(div);
    });
}

// Form submission handler
async function handleScanSubmit(e) {
  e.preventDefault();
  
  try {
      // Show loading state
      document.getElementById('loading').style.display = 'block';
      document.getElementById('error').style.display = 'none';
      document.getElementById('results').style.display = 'none';
      console.log('Submitting scan request...');

      const response = await fetch('/api/scan', {  // This is a POST request
          method: 'POST',
          headers: {
              'Content-Type': 'application/json',
          },
          body: JSON.stringify({
              searchPhrases: document.getElementById('searchPhrases').value,
              typicalPhrases: document.getElementById('typicalPhrases').value,
              feedbackThreshold: document.getElementById('feedbackThreshold').value,
              selectedConditions: Array.from(document.querySelectorAll('input[name="conditions"]:checked'))
                  .map(checkbox => checkbox.value)
          })
      });

      console.log('Scan response status:', response.status);
      const responseData = await response.json();
      console.log('Scan response data:', responseData);

      if (!response.ok) {
          throw new Error('Failed to initiate scan');
      }

      // Start polling for results
      console.log('Starting results polling...');
      pollResults();

  } catch (error) {
      document.getElementById('loading').style.display = 'none';
      document.getElementById('error').textContent = 'Scan failed: ' + error.message;
      document.getElementById('error').style.display = 'block';
  }
}

// Results polling function
// Results polling function with retry logic
async function pollResults(retryCount = 0, maxRetries = 3) {
  try {
      const response = await fetch('/api/results', {
          method: 'GET',
          headers: {
              'Cache-Control': 'no-cache'
          }
      });
      
      if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const data = await response.json();
      console.log('Poll response:', data);

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
          if (retryCount < maxRetries) {
              console.log(`Retrying poll... Attempt ${retryCount + 1} of ${maxRetries}`);
              await new Promise(resolve => setTimeout(resolve, 2000));
              return pollResults(retryCount + 1, maxRetries);
          }
          document.getElementById('loading').style.display = 'none';
          document.getElementById('error').textContent = 'Scan failed: ' + data.error;
          document.getElementById('error').style.display = 'block';
      } else {
          // Continue polling if still processing
          await new Promise(resolve => setTimeout(resolve, 5000));
          return pollResults(0, maxRetries); // Reset retry count for new polling cycle
      }
  } catch (error) {
      console.error('Polling error:', error);
      
      if (retryCount < maxRetries) {
          console.log(`Retrying poll... Attempt ${retryCount + 1} of ${maxRetries}`);
          await new Promise(resolve => setTimeout(resolve, 2000));
          return pollResults(retryCount + 1, maxRetries);
      }
      
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
          <td><a href="${item.link}" target="_blank">View</a></td>
      `;
  });
  
  resultsDiv.style.display = 'block';
  document.getElementById('lastUpdated').textContent = new Date().toLocaleString();
}

// Initialize event listeners when the page loads
document.addEventListener('DOMContentLoaded', () => {
  loadCategories();
  loadConditions();
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
// Add these functions to client.js
async function downloadSearchResults() {
  try {
      const response = await fetch('/api/download/search-results');
      if (!response.ok) throw new Error('Download failed');
      
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.style.display = 'none';
      a.href = url;
      a.download = `search-results-${new Date().toISOString().split('T')[0]}.csv`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
  } catch (error) {
      console.error('Error downloading search results:', error);
      alert('Failed to download search results');
  }
}

async function downloadPreviousListings() {
  try {
      const response = await fetch('/api/download/previous-listings');
      if (!response.ok) throw new Error('Download failed');
      
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.style.display = 'none';
      a.href = url;
      a.download = `previous-listings-${new Date().toISOString().split('T')[0]}.csv`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
  } catch (error) {
      console.error('Error downloading previous listings:', error);
      alert('Failed to download previous listings');
  }
}