const money = (amount, currency) => new Intl.NumberFormat(undefined, { style: "currency", currency }).format(amount);

async function boot() {
  const [loadResponse, configResponse] = await Promise.all([fetch("/api/loads"), fetch("/api/config")]);
  const { loads } = await loadResponse.json();
  const config = await configResponse.json();
  document.querySelector("#maps-status").textContent = config.mapsEnabled
    ? "Google Maps adapter enabled."
    : "Map preview mode — Google Maps key and paid services are not active.";
  document.querySelector("#loads").innerHTML = loads.map(load => `
    <article class="load">
      <div class="load-top"><b>✓ VERIFIED SHIPPER</b><span>${load.id}</span></div>
      <div class="route">${load.origin}<span>→</span>${load.destination}</div>
      <dl><div><dt>EQUIPMENT</dt><dd>${load.equipment}</dd></div><div><dt>LOADED DISTANCE</dt><dd>${load.distanceKm} km</dd></div><div><dt>DEADHEAD</dt><dd>${load.deadheadKm} km</dd></div><div><dt>RATE</dt><dd>${money(load.rate, load.currency)}</dd></div></dl>
      <div class="profit"><span>PROJECTED NET<br><small>before tax</small></span><strong>${money(load.economics.netProfit, load.currency)}</strong></div>
    </article>`).join("");
}

boot().catch(() => {
  document.querySelector("#loads").innerHTML = "<p>Marketplace data is temporarily unavailable.</p>";
});
