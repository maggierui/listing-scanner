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
    // Get form data
    const formData = {
        searchPhrases: document.getElementById('searchPhrases').value.split(',').map(s => s.trim()),
        typicalPhrases: document.getElementById('typicalPhrases').value.split(',').map(s => s.trim()),
        feedbackThreshold: parseInt(document.getElementById('feedbackThreshold').value),
        conditions: Array.from(document.querySelectorAll('input[name="conditions"]:checked')).map(cb => cb.value),
        // Include searchId if we're using a saved search
        searchId: document.getElementById('savedSearches').value || null
    };
      // Show loading state
      document.getElementById('loading').style.display = 'block';
      document.getElementById('error').style.display = 'none';
      document.getElementById('results').style.display = 'none';
      console.log('Submitting scan request...');

      // Use these variables in both the scan request
      const response = await fetch('/api/scan', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(formData)
    });
    // Log the response status
    console.log('Response status:', response.status);

      // Check if user wants to save this search
    const saveSearch = document.getElementById('saveSearchCheckbox').checked;
    let searchName = null;
    
    if (saveSearch) {
        // Check for duplicate searches before saving
        const existingSearches = await fetch('/api/saves/searches').then(r => r.json());
        const isDuplicate = existingSearches.some(search => 
            search.name === searchName &&
            arraysEqual(search.search_phrases, searchPhrases) &&
            arraysEqual(search.typical_phrases, typicalPhrases) &&
            search.feedback_threshold === feedbackThreshold &&
            arraysEqual(search.conditions, conditions)
        );

        if (isDuplicate) {
            const proceed = confirm('A search with identical criteria already exists. Save anyway?');
            if (!proceed) return;
        }
        searchName = document.getElementById('searchName').value.trim();
        if (!searchName) {
            alert('Please enter a name for your search');
            return;
        }
        
        // Save the search to database
        try {
            const searchData = {
                name: searchName,
                searchPhrases: searchPhrases,
                typicalPhrases: typicalPhrases,
                feedbackThreshold: feedbackThreshold,
                conditions: conditions
            };
            
            const response = await fetch('/api/saves/search', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(searchData)
            });
            
            if (!response.ok) {
                throw new Error('Failed to save search');
            }
            
            console.log('Search saved successfully');
        } catch (error) {
            console.error('Error saving search:', error);
            alert('Failed to save search. Please try again.');
            return;
        }
    }

      console.log('Scan response status:', response.status);
        

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Error response:', errorText);
        throw new Error(`Scan failed: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
        console.log('Scan response:', data);

      // Start polling for results
     // console.log('Starting results polling...');
      //pollResults();
      // Display results with status indicators
      displayCurrentSearchResults({
        ...data.results,
        isNew: true // Mark new results
    });

  } catch (error) {
      document.getElementById('loading').style.display = 'none';
      document.getElementById('error').textContent = 'Scan failed: ' + error.message;
      document.getElementById('error').style.display = 'block';
  }
}

// Load saved search results (only when viewing saved searches)
async function loadSavedSearchResults(searchId) {
    try {
        const response = await fetch(`/api/saves/search/${searchId}/results`);
        if (!response.ok) throw new Error('Failed to fetch saved results');
        
        const results = await response.json();
        displayCurrentSearchResults(results.map(r => ({
            ...r,
            isNew: false // Mark as previously found
        })), false); // Don't clear existing results
    } catch (error) {
        console.error('Error loading saved results:', error);
    }
}

// Handle saved search selection
async function handleSavedSearchSelect(event) {
    const searchId = event.target.value;
    if (!searchId) return;
    
    try {
        // Load search criteria
        const response = await fetch(`/api/saves/search/${searchId}`);
        if (!response.ok) throw new Error('Failed to fetch search details');
        
        const search = await response.json();
        
        // Populate form
        document.getElementById('searchPhrases').value = search.search_phrases.join(', ');
        document.getElementById('typicalPhrases').value = search.typical_phrases.join(', ');
        document.getElementById('feedbackThreshold').value = search.feedback_threshold;
        
        document.querySelectorAll('input[name="conditions"]').forEach(checkbox => {
            checkbox.checked = search.conditions.includes(checkbox.value);
        });
        
        // Clear results container
        document.getElementById('resultsContainer').innerHTML = '';
        
        // Optionally load saved results
        if (confirm('Would you like to see previously found items for this search?')) {
            await loadSavedSearchResults(searchId);
        }
    } catch (error) {
        console.error('Error loading search details:', error);
    }
}
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

// Function to display results from current search
async function displayCurrentSearchResults(results, isNewSearch = true) {
    const container = document.getElementById('resultsContainer');
    
    // Clear previous results if this is a new search
    if (isNewSearch) {
        container.innerHTML = '';
    }

    // Add results to container
    const resultsHTML = results.map(item => `
        <div class="result-item ${item.isNew ? 'new-item' : ''}">
            <h3>${item.title}</h3>
            <p>Price: $${item.price}</p>
            <p>Status: ${item.isNew ? 'New' : 'Previously Found'}</p>
            <p>Found: ${new Date(item.first_found_at || Date.now()).toLocaleString()}</p>
            <a href="${item.url}" target="_blank">View on eBay</a>
        </div>
    `).join('');

    container.innerHTML += resultsHTML;
}

// Initialize event listeners when the page loads
document.addEventListener('DOMContentLoaded', async () => {
    try {
        await loadConditions();
        document.getElementById('scanForm').addEventListener('submit', handleScanSubmit);
    } catch (error) {
        showError('Failed to load initial data: ' + error.message);
    }
});

// Add this near your other event listeners
document.getElementById('saveSearchCheckbox').addEventListener('change', function(e) {
    const searchNameInput = document.getElementById('searchNameInput');
    searchNameInput.style.display = e.target.checked ? 'block' : 'none';
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

// Function to load saved searches into dropdown
async function loadSavedSearches() {
    try {
        const response = await fetch('/api/saves/searches');
        if (!response.ok) {
            throw new Error('Failed to fetch saved searches');
        }
        
        const searches = await response.json();
        const dropdown = document.getElementById('savedSearches');
        
        // Clear existing options (except the first one)
        while (dropdown.options.length > 1) {
            dropdown.remove(1);
        }
         // Check if there are any saved searches
         if (!searches || searches.length === 0) {
            // Add a disabled option indicating no searches
            const noSearchesOption = new Option('No saved searches available', '');
            noSearchesOption.disabled = true;
            dropdown.add(noSearchesOption);
            
            // Disable the dropdown
            dropdown.disabled = true;
            return;
        }
        // Enable the dropdown if we have searches
        dropdown.disabled = false;
        // Add saved searches to dropdown
        searches.forEach(search => {
            const option = new Option(search.name, search.id);
            dropdown.add(option);
        });
    } catch (error) {
        console.error('Error loading saved searches:', error);
        // Show error in dropdown
        const dropdown = document.getElementById('savedSearches');
        dropdown.innerHTML = '<option value="" disabled>Error loading saved searches</option>';
        dropdown.disabled = true;
    }
}

// Function to handle selection of a saved search
async function handleSavedSearchSelect(event) {
    const searchId = event.target.value;
    if (!searchId) return; // User selected the default option
    
    try {
        const response = await fetch(`/api/saves/search/${searchId}`);
        if (!response.ok) {
            throw new Error('Failed to fetch search details');
        }
        
        const search = await response.json();
        
        // Populate form fields with saved search data
        document.getElementById('searchPhrases').value = search.search_phrases.join(', ');
        document.getElementById('typicalPhrases').value = search.typical_phrases.join(', ');
        document.getElementById('feedbackThreshold').value = search.feedback_threshold;
        
        // Handle conditions checkboxes
        document.querySelectorAll('input[name="conditions"]').forEach(checkbox => {
            checkbox.checked = search.conditions.includes(checkbox.value);
        });
        
    } catch (error) {
        console.error('Error loading search details:', error);
        alert('Failed to load saved search details');
    }
}

// Add event listeners
document.addEventListener('DOMContentLoaded', () => {
    loadSavedSearches(); // Load saved searches when page loads
    document.getElementById('savedSearches').addEventListener('change', handleSavedSearchSelect);
});