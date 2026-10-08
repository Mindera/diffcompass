// Bind failure reporting before imports can outlive this iframe's mount.
const host = window.parent.diffCompassProductionHost?.forFile(new URLSearchParams(location.search).get("file"), window);
import("./app.mjs").catch(error => {
  document.getElementById("status").textContent = "Monaco could not load: " + error.message;
  host?.failed("Monaco could not load: " + error.message);
});
