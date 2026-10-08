import("./app.mjs").catch(error => {
  document.getElementById("status").textContent = "Monaco could not load: " + error.message;
  window.parent.diffCompassProductionHost?.failed("Monaco could not load: " + error.message, new URLSearchParams(location.search).get("file"));
});
