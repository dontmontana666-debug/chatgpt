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
    lastFocused: null,
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

  function truncate(s, n) {
    s = String(s || "");
    return s.length > n ? s.slice(0, n - 1).replace(/\s+\S*$/, "") + "…" : s;
  }

  function plural(n, word) {
    return n + " " + word + (n === 1 ? "" : "s");
  }

  // Claims may be plain strings (legacy) or {text, sourceIds, perspective|evidence}.
  function claimText(c) { return typeof c === "string" ? c : (c.text || ""); }
  function claimSourceIds(c) { return typeof c === "string" ? [] : (c.sourceIds || []); }
  function claimTag(c) { return typeof c === "string" ? "" : (c.perspective || c.evidence || ""); }
  function gradeClass(g) {
    return "ev-" + (("AB".indexOf(g) > -1) ? "good" : ("CD".indexOf(g) > -1) ? "mid" : "low");
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
      " · " + plural(state.topics.length, "topic");

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
          '" data-cat="' + esc(c.id) + '"' + style +
          ' aria-pressed="' + active + '">' + esc(c.label) + "</button>"
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
        (t.actors || []).join(" "),
        (t.competingNarratives || []).map(claimText).join(" "),
        (t.documentedFacts || []).map(claimText).join(" "),
        (t.sources || []).map(function (s) { return s.label; }).join(" "),
      ].join(" ").toLowerCase();
      return hay.indexOf(q) !== -1;
    });

    list.sort(function (a, b) {
      // Featured (priority) topics are always pinned to the top.
      if (!!a.featured !== !!b.featured) return a.featured ? -1 : 1;
      if (state.sort === "controversy") return b.controversyScore - a.controversyScore;
      if (state.sort === "chrono") return eraStart(a.era) - eraStart(b.era);
      return a.title.localeCompare(b.title);
    });
    return list;
  }

  function hasActiveFilters() {
    return state.activeCategory !== "all" || state.query.trim() !== "";
  }

  /* ---------- render ---------- */
  function render() {
    var list = filtered();
    var none = list.length === 0;

    el.grid.innerHTML = list.map(cardHTML).join("");
    el.empty.hidden = !none;
    if (none) {
      el.empty.innerHTML =
        "No topics match your filters." +
        (hasActiveFilters() ? ' <button type="button" class="link-btn" id="reset-filters">Reset filters</button>' : "");
      var rb = document.getElementById("reset-filters");
      if (rb) rb.addEventListener("click", resetFilters);
    }

    el.resultCount.textContent =
      plural(list.length, "topic") +
      (state.activeCategory === "all" ? "" : " in " + catLabel(state.activeCategory)) +
      (state.query.trim() ? ' matching "' + state.query.trim() + '"' : "");

    Array.prototype.forEach.call(el.grid.querySelectorAll(".card"), function (c) {
      c.addEventListener("click", function () { openTopic(c.getAttribute("data-id"), c); });
    });
  }

  function cardHTML(t) {
    var pct = Math.round((t.controversyScore / 10) * 100);
    var nSrc = (t.sources || []).length;
    var nViews = (t.competingNarratives || []).length;
    return (
      '<article class="card' + (t.featured ? " featured" : "") +
        '" data-id="' + esc(t.id) + '" tabindex="0" role="button" aria-label="' +
        esc(t.title) + '">' +
        (t.featured ? '<span class="featured-badge">★ Priority topic</span>' : "") +
        '<div class="card-top">' +
          '<span class="card-cat" style="background:' + catColor(t.category) + '">' +
            esc(catLabel(t.category)) + "</span>" +
          '<span class="card-era">' + esc(t.era) + "</span>" +
        "</div>" +
        "<h3>" + esc(t.title) + "</h3>" +
        '<p class="card-summary">' + esc(truncate(t.summary, 160)) + "</p>" +
        '<div class="card-tags">' +
          "<span>🔗 " + plural(nSrc, "source") + "</span>" +
          "<span>⚖ " + plural(nViews, "viewpoint") + "</span>" +
        "</div>" +
        '<div class="meter">' +
          '<span class="meter-label">Controversy</span>' +
          '<span class="meter-bar"><span class="meter-fill" style="width:' + pct + '%"></span></span>' +
          '<span class="meter-score">' + t.controversyScore + "/10</span>" +
          (t.evidence ? '<span class="ev-pill ' + gradeClass(t.evidence.grade) +
            '" title="Evidence Strength: how well-sourced this entry is">' +
            "Evidence " + esc(t.evidence.grade) + "</span>" : "") +
        "</div>" +
      "</article>"
    );
  }

  /* ---------- modal ---------- */
  function openTopic(id, trigger) {
    var t = state.topics.find(function (x) { return x.id === id; });
    if (!t) return;

    state.lastFocused = trigger || document.activeElement;

    // Number the sources so claims can cite them [1], [2], … and link straight out.
    var srcMap = {};
    (t.sources || []).forEach(function (s, i) {
      if (s.id) srcMap[s.id] = { n: i + 1, url: s.url, label: s.label };
    });

    var ev = t.evidence;
    var html =
      (t.featured ? '<span class="featured-badge modal-badge">★ Priority topic</span>' : "") +
      '<h2 id="modal-title">' + esc(t.title) + "</h2>" +
      '<div class="modal-meta">' +
        '<span class="card-cat" style="background:' + catColor(t.category) + '">' + esc(catLabel(t.category)) + "</span>" +
        "<span>" + esc(t.era) + "</span>" +
        '<span class="meter-score">Controversy ' + t.controversyScore + "/10</span>" +
        (ev ? '<span class="ev-pill ' + gradeClass(ev.grade) + '">Evidence ' + esc(ev.grade) + " (" + ev.score + ")</span>" : "") +
      "</div>" +
      block("Summary", "<p>" + esc(t.summary) + "</p>") +
      block("The mainstream account", "<p>" + esc(t.mainstreamAccount) + "</p>") +
      block("Competing narratives", claimsHTML(t.competingNarratives, srcMap)) +
      block("Documented facts", claimsHTML(t.documentedFacts, srcMap)) +
      block("What remains contested / under-reported", "<p>" + esc(t.stillContested) + "</p>", true) +
      (t.actors && t.actors.length ? block("Key actors", actorsHTML(t.actors)) : "") +
      (t.relatedTopics && t.relatedTopics.length ? block("Related cases", relatedHTML(t.relatedTopics)) : "") +
      block("Sources", sourcesHTML(t.sources)) +
      (ev ? evidenceHTML(ev) : "");

    el.modalContent.innerHTML = html;
    // Related-case buttons navigate to that topic (deep-links via the hash).
    Array.prototype.forEach.call(el.modalContent.querySelectorAll(".related-link"), function (b) {
      b.addEventListener("click", function () { openTopic(b.getAttribute("data-id"), b); });
    });

    el.backdrop.hidden = false;
    document.body.style.overflow = "hidden";
    el.modal.scrollTop = 0;
    el.backdrop.scrollTop = 0;
    el.modalClose.focus();
    if (history.replaceState) history.replaceState(null, "", "#" + t.id);
  }

  function block(title, inner, contested) {
    return (
      '<div class="section-block' + (contested ? " contested" : "") + '">' +
      "<h4>" + esc(title) + "</h4>" + inner + "</div>"
    );
  }

  function claimsHTML(arr, srcMap) {
    if (!arr || !arr.length) return "<p>—</p>";
    return "<ul class=\"claims\">" + arr.map(function (c) {
      var tag = claimTag(c);
      var cites = claimSourceIds(c).map(function (id) {
        var s = srcMap[id];
        if (!s) return "";
        return '<a class="cite" href="' + esc(s.url) + '" target="_blank" rel="noopener noreferrer" ' +
          'title="' + esc(s.label) + '">[' + s.n + "]</a>";
      }).join("");
      return "<li>" +
        (tag ? '<span class="claim-tag">' + esc(tag) + "</span> " : "") +
        esc(claimText(c)) +
        (cites ? ' <sup class="cites">' + cites + "</sup>" : "") +
        "</li>";
    }).join("") + "</ul>";
  }

  function actorsHTML(actors) {
    return '<div class="actor-chips">' +
      actors.map(function (a) { return '<span class="actor-chip">' + esc(a) + "</span>"; }).join("") +
      "</div>";
  }

  function relatedHTML(rels) {
    var byId = {};
    state.topics.forEach(function (t) { byId[t.id] = t; });
    return '<ul class="related-list">' + rels.map(function (r) {
      var target = byId[r.id];
      if (!target) return "";
      return '<li><button type="button" class="related-link" data-id="' + esc(r.id) + '">' +
        '<span class="rel-tag">' + esc(r.relation || "related") + "</span>" +
        '<span class="rel-title">' + esc(target.title) + "</span>" +
        (r.note ? '<span class="rel-note">' + esc(r.note) + "</span>" : "") +
        "</button></li>";
    }).join("") + "</ul>";
  }

  function evidenceHTML(ev) {
    var order = ["authority", "diversity", "citationCoverage", "corroboration", "balance"];
    var labels = {
      authority: "Source authority", diversity: "Source diversity",
      citationCoverage: "Citation coverage", corroboration: "Corroboration", balance: "Balance",
    };
    var rows = order.map(function (k) {
      var got = ev.components[k], max = ev.maxComponents[k];
      var pct = max ? Math.round((got / max) * 100) : 0;
      return '<div class="ev-row">' +
        '<span class="ev-name">' + labels[k] + "</span>" +
        '<span class="ev-track"><span class="ev-bar" style="width:' + pct + '%"></span></span>' +
        '<span class="ev-num">' + got + "/" + max + "</span></div>";
    }).join("");
    return '<details class="evidence-block"><summary>' +
      '<span class="ev-pill ' + gradeClass(ev.grade) + '">Evidence ' + esc(ev.grade) + " (" + ev.score + "/100)</span>" +
      " &mdash; how this score is built" +
      "</summary>" + rows +
      '<p class="ev-disclaimer">Measures how well-sourced <em>this entry</em> is — its sourcing, ' +
      "diversity and corroboration — <strong>not</strong> whether the claims are true. " +
      "Computed deterministically from the data; run <code>cli.py score</code> to reproduce.</p>" +
      "</details>";
  }

  function sourcesHTML(arr) {
    if (!arr || !arr.length) return "<p>—</p>";
    return (
      '<ol class="sources-list">' +
      arr.map(function (s) {
        var meta = [s.type, s.publisher, s.date].filter(Boolean).join(" · ");
        return '<li><a href="' + esc(s.url) + '" target="_blank" rel="noopener noreferrer">' +
          esc(s.label) + "</a>" +
          (meta ? '<span class="src-meta">' + esc(meta) + "</span>" : "") + "</li>";
      }).join("") +
      "</ol>"
    );
  }

  function closeModal() {
    if (el.backdrop.hidden) return;
    el.backdrop.hidden = true;
    document.body.style.overflow = "";
    if (history.replaceState) history.replaceState(null, "", location.pathname + location.search);
    if (state.lastFocused && typeof state.lastFocused.focus === "function") {
      state.lastFocused.focus();
    }
    state.lastFocused = null;
  }

  // Keep Tab focus inside the open modal.
  function trapFocus(e) {
    if (e.key !== "Tab" || el.backdrop.hidden) return;
    var focusable = el.modal.querySelectorAll(
      'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'
    );
    if (!focusable.length) return;
    var first = focusable[0];
    var last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  function maybeOpenFromHash() {
    var id = (location.hash || "").replace(/^#/, "");
    if (id) openTopic(id);
  }

  function resetFilters() {
    state.query = "";
    state.activeCategory = "all";
    el.search.value = "";
    buildCategoryChips();
    render();
    el.search.focus();
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
      if (el.backdrop.hidden) return;
      if (e.key === "Escape") closeModal();
      else trapFocus(e);
    });
    // Open a card with Enter or Space (it is role="button").
    el.grid.addEventListener("keydown", function (e) {
      if (e.key !== "Enter" && e.key !== " " && e.key !== "Spacebar") return;
      var card = e.target.closest(".card");
      if (card) {
        e.preventDefault();
        openTopic(card.getAttribute("data-id"), card);
      }
    });
    // Support manual hash navigation (e.g. shared deep links pasted into the bar).
    window.addEventListener("hashchange", function () {
      var id = (location.hash || "").replace(/^#/, "");
      if (!id) closeModal();
      else if (state.topics.some(function (t) { return t.id === id; })) openTopic(id);
    });
  }

  load();
})();
