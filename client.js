document.getElementById('scanForm').addEventListener('submit', (event) => {
    event.preventDefault();
    const searchPhrases = document.getElementById('searchPhrases').value;
    const feedbackThreshold = document.getElementById('feedbackThreshold').value;
  
    fetch('/scan', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ searchPhrases, feedbackThreshold })
    })
    .then(response => response.json())
    .then(data => {
      console.log(data);
      document.getElementById('loading').style.display = 'block';
      checkResults();
    })
    .catch(error => {
      console.error('Error:', error);
      document.getElementById('error').style.display = 'block';
      document.getElementById('error').textContent = 'Error starting the scan: ' + error.message;
    });
  });

function checkResults() {
    fetch('/results')
        .then(response => response.json())
        .then(data => {
            // Update the log area
            updateLogArea(data.logMessages);

            if (data.status === 'complete') {
                document.getElementById('loading').style.display = 'none';
                document.getElementById('error').style.display = 'none';
                document.getElementById('results').style.display = 'block';
                updateResults(data);
            } else if (data.status === 'error') {
                document.getElementById('loading').style.display = 'none';
                document.getElementById('results').style.display = 'none';
                document.getElementById('error').style.display = 'block';
                document.getElementById('error').textContent = 'Error: ' + data.error;
            }
            setTimeout(checkResults, 2000);
        })
        .catch(error => {
            console.error('Error:', error);
            setTimeout(checkResults, 2000);
        });
}

function updateLogArea(logMessages) {
    const logArea = document.getElementById('logArea');
    logArea.innerHTML = logMessages
      .map(msg => '<div class="log-message">' + msg + '</div>')
      .join('');
    logArea.scrollTop = logArea.scrollHeight;
  }
  
  function updateResults(data) {
    document.getElementById('lastUpdated').textContent = data.lastUpdated.toLocaleString();
    document.getElementById('totalListings').textContent = data.totalListings;
  
    const resultTable = document.getElementById('resultTable');
    resultTable.innerHTML = data.listings.map(item => `
      <tr>
        <td>${item.title}</td>
        <td>${item.price}</td>
        <td>${item.currency}</td>
        <td>${item.seller}</td>
        <td>${item.feedbackScore}</td>
        <td><a href="${item.itemWebUrl}" target="_blank">View Listing</a></td>
      </tr>
    `).join('');
  }
  
  function downloadLogs() {
    window.location.href = '/download-logs';
  }