// Utility script to clear authentication data
// Run this in the browser console to clear invalid tokens

console.log('Clearing authentication data...');

// Clear localStorage
localStorage.removeItem('token');
localStorage.removeItem('user');

// Clear sessionStorage
sessionStorage.clear();

// Clear any cookies related to auth
document.cookie.split(";").forEach(function(c) { 
  document.cookie = c.replace(/^ +/, "").replace(/=.*/, "=;expires=" + new Date().toUTCString() + ";path=/"); 
});

console.log('Authentication data cleared. Please refresh the page.');

// Optional: Reload the page
// window.location.reload(); 