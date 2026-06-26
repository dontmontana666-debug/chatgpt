/* Sri Lankan Politics — Controversy Archive
 * Vanilla JS, no build step. Loads archive/topics.json and renders an explorer.
 */
(function () {
  "use strict";

  var DATA_URL = "archive/topics.json";
  var state = {
    topics: [],
    categories: [],
    catMap: {},
    activeCategory: "all",
    query: "",
    sort: "controversy",
  };

  var el = {
    tagline: document.getElementById("tagline"),
    disclaimer: document.getElementById("disclaimer"),
    search: document.getElementById("search"),
    catFilters: document.getElementById("category-filters"),
    sortSelect: document.getElementById("sort-select"),
    grid: document.getElementById("topic-grid"),
    empty: document.getElementById("empty-state"),
    resultCount: document.getElementById("result-count"),
    footerMeta: document.getElementById("footer-meta"),
    backdrop: document.getElementById("modal-backdrop"),
    modal: document.getElementById("modal"),
    modalContent: document.getElementById("modal-content"),
    modalClose: document.getElementById("modal-close"),
  };

  /* ---------- helpers ---------- */
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function eraStart(era) {
    var m = String(era).match(/\d{4}/);
    return m ? parseInt(m[0], 10) : 9999;
  }

  function catColor(id) {
    return (state.catMap[id] && state.catMap[id].color) || "#888";
  }
  function catLabel(id) {
    return (state.catMap[id] && state.catMap[id].label) || id;
  }

  /* ---------- data load ---------- */
  function load() {
    fetch(DATA_URL)
      .then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      })
      .then(init)
      .catch(function (err) {
        el.grid.innerHTML =
          '<p class="empty">Could not load the archive (' +
          esc(err.message) +
          ").<br/>If you opened this file directly, run a local server instead — see the README.</p>";
      });
  }

  function init(data) {
    state.topics = data.topics || [];
    state.categories = data.categories || [];
    state.categories.forEach(function (c) { state.catMap[c.id] = c; });

    el.tagline.textContent = data.meta.description;
    el.disclaimer.textContent = data.meta.disclaimer;
    el.footerMeta.textContent =
      data.meta.title + " · v" + data.meta.version + " · updated " + data.meta.lastUpdated +
      " · " + state.topics.length + " topics";

    buildCategoryChips();
    bindEvents();
    render();
    maybeOpenFromHash();
  }

  function buildCategoryChips() {
    var chips = [{ id: "all", label: "All", color: "#58a6ff" }].concat(state.categories);
    el.catFilters.innerHTML = chips
      .map(function (c) {
        var active = c.id === state.activeCategory;
        var style = active ? ' style="background:' + c.color + '"' : "";
        return (
          '<button class="chip' + (active ? " active" : "") +
          '" data-cat="' + esc(c.id) + '"' + style + ">" + esc(c.label) + "</button>"
        );
      })
      .join("");
  }

  /* ---------- filtering + sorting ---------- */
  function filtered() {
    var q = state.query.trim().toLowerCase();
    var list = state.topics.filter(function (t) {
      if (state.activeCategory !== "all" && t.category !== state.activeCategory) return false;
      if (!q) return true;
      var hay = [
        t.title, t.summary, t.era, t.mainstreamAccount, t.stillContested,
        (t.competingNarratives || []).join(" "),
        (t.documentedFacts || []).join(" "),
        (t.sources || []).map(function (s) { return s.label; }).join(" "),
      ].join(" ").toLowerCase();
      return hay.indexOf(q) !== -1;
    });

    list.sort(function (a, b) {
      if (state.sort === "controversy") return b.controversyScore - a.controversyScore;
      if (state.sort === "chrono") return eraStart(a.era) - eraStart(b.era);
      return a.title.localeCompare(b.title);
    });
    return list;
  }

  /* ---------- render ---------- */
  function render() {
    var list = filtered();
    el.empty.hidden = list.length !== 0;
    el.resultCount.textContent =
      list.length + (list.length === 1 ? " topic" : " topics") +
      (state.activeCategory === "all" ? "" : " in " + catLabel(state.activeCategory)) +
      (state.query ? ' matching "' + state.query + '"' : "");

    el.grid.innerHTML = list.map(cardHTML).join("");
    Array.prototype.forEach.call(el.grid.querySelectorAll(".card"), function (c) {
      c.addEventListener("click", function () { openTopic(c.getAttribute("data-id")); });
    });
  }

  function cardHTML(t) {
    var pct = Math.round((t.controversyScore / 10) * 100);
    return (
      '<article class="card" data-id="' + esc(t.id) + '" tabindex="0">' +
        '<div class="card-top">' +
          '<span class="card-cat" style="background:' + catColor(t.category) + '">' +
            esc(catLabel(t.category)) + "</span>" +
          '<span class="card-era">' + esc(t.era) + "</span>" +
        "</div>" +
        "<h3>" + esc(t.title) + "</h3>" +
        '<p class="card-summary">' + esc(truncate(t.summary, 160)) + "</p>" +
        '<div class="meter">' +
          '<span class="meter-label">Controversy</span>' +
          '<span class="meter-bar"><span class="meter-fill" style="width:' + pct + '%"></span></span>' +
          '<span class="meter-score">' + t.controversyScore + "/10</span>" +
        "</div>" +
      "</article>"
    );
  }

  function truncate(s, n) {
    s = String(s || "");
    return s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s;
  }

  /* ---------- modal ---------- */
  function openTopic(id) {
    var t = state.topics.find(function (x) { return x.id === id; });
    if (!t) return;

    var html =
      "<h2>" + esc(t.title) + "</h2>" +
      '<div class="modal-meta">' +
        '<span class="card-cat" style="background:' + catColor(t.category) + '">' + esc(catLabel(t.category)) + "</span>" +
        "<span>" + esc(t.era) + "</span>" +
        '<span class="meter-score">Controversy ' + t.controversyScore + "/10</span>" +
      "</div>" +
      block("Summary", "<p>" + esc(t.summary) + "</p>") +
      block("The mainstream account", "<p>" + esc(t.mainstreamAccount) + "</p>") +
      block("Competing narratives", listHTML(t.competingNarratives)) +
      block("Documented facts", listHTML(t.documentedFacts)) +
      block("What remains contested / under-reported", "<p>" + esc(t.stillContested) + "</p>", true) +
      block("Sources", sourcesHTML(t.sources));

    el.modalContent.innerHTML = html;
    el.backdrop.hidden = false;
    document.body.style.overflow = "hidden";
    el.modal.focus();
    if (history.replaceState) history.replaceState(null, "", "#" + t.id);
  }

  function block(title, inner, contested) {
    return (
      '<div class="section-block' + (contested ? " contested" : "") + '">' +
      "<h4>" + esc(title) + "</h4>" + inner + "</div>"
    );
  }
  function listHTML(arr) {
    if (!arr || !arr.length) return "<p>—</p>";
    return "<ul>" + arr.map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("") + "</ul>";
  }
  function sourcesHTML(arr) {
    if (!arr || !arr.length) return "<p>—</p>";
    return (
      '<ul class="sources-list">' +
      arr.map(function (s) {
        return '<li><a href="' + esc(s.url) + '" target="_blank" rel="noopener noreferrer">' + esc(s.label) + "</a></li>";
      }).join("") +
      "</ul>"
    );
  }

  function closeModal() {
    el.backdrop.hidden = true;
    document.body.style.overflow = "";
    if (history.replaceState) history.replaceState(null, "", location.pathname + location.search);
  }

  function maybeOpenFromHash() {
    var id = (location.hash || "").replace(/^#/, "");
    if (id) openTopic(id);
  }

  /* ---------- events ---------- */
  function bindEvents() {
    el.search.addEventListener("input", function () {
      state.query = el.search.value;
      render();
    });
    el.sortSelect.addEventListener("change", function () {
      state.sort = el.sortSelect.value;
      render();
    });
    el.catFilters.addEventListener("click", function (e) {
      var btn = e.target.closest(".chip");
      if (!btn) return;
      state.activeCategory = btn.getAttribute("data-cat");
      buildCategoryChips();
      render();
    });
    el.modalClose.addEventListener("click", closeModal);
    el.backdrop.addEventListener("click", function (e) {
      if (e.target === el.backdrop) closeModal();
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && !el.backdrop.hidden) closeModal();
    });
    // keyboard open on cards
    el.grid.addEventListener("keydown", function (e) {
      if (e.key === "Enter") {
        var card = e.target.closest(".card");
        if (card) openTopic(card.getAttribute("data-id"));
      }
    });
  }

  load();
})();
