const axios = require('axios');

const URL = 'https://faizur-s6l3.onrender.com'; // Replace with your actual URL

function pingServer() {
    axios.get(URL)
        .then(() => console.log(`Pinged ${URL} at ${new Date().toLocaleTimeString()}`))
        .catch(error => console.error(`Error pinging ${URL}:`, error.message));
}

// Ping every 35 seconds
setInterval(pingServer, 35000);

console.log('Keep-alive script running...');
