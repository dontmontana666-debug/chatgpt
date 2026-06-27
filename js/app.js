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
    view: "cards",
    lastFocused: null,
  };

  var el = {
    tagline: document.getElementById("tagline"),
    disclaimer: document.getElementById("disclaimer"),
    search: document.getElementById("search"),
    catFilters: document.getElementById("category-filters"),
    sortSelect: document.getElementById("sort-select"),
    grid: document.getElementById("topic-grid"),
    graph: document.getElementById("graph-view"),
    timeline: document.getElementById("timeline-view"),
    viewToggle: document.getElementById("view-toggle"),
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

  function shortLabel(t) {
    var s = t.title.split(":")[0].replace(/^The\s+/, "");
    return s.length > 26 ? s.slice(0, 25).replace(/\s+\S*$/, "") + "…" : s;
  }

  /* ---------- render ---------- */
  function render() {
    var list = filtered();
    var none = list.length === 0;

    el.grid.hidden = state.view !== "cards";
    el.graph.hidden = state.view !== "graph";
    el.timeline.hidden = state.view !== "timeline";

    if (state.view === "cards") renderCards(list);
    else if (state.view === "graph") renderGraph(list);
    else renderTimeline(list);

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
  }

  function renderCards(list) {
    el.grid.innerHTML = list.map(cardHTML).join("");
    Array.prototype.forEach.call(el.grid.querySelectorAll(".card"), function (c) {
      c.addEventListener("click", function () { openTopic(c.getAttribute("data-id"), c); });
    });
  }

  function renderTimeline(list) {
    var sorted = list.slice().sort(function (a, b) { return eraStart(a.era) - eraStart(b.era); });
    el.timeline.innerHTML = "<ol class=\"tl\">" + sorted.map(function (t) {
      var yr = eraStart(t.era);
      return '<li class="tl-item" data-id="' + esc(t.id) + '" tabindex="0" role="button" aria-label="' + esc(t.title) + '">' +
        '<span class="tl-year">' + esc(yr === 9999 ? "—" : String(yr)) + "</span>" +
        '<span class="tl-dot" style="background:' + catColor(t.category) + '"></span>' +
        '<span class="tl-body">' +
          '<span class="tl-title">' + esc(t.title) + (t.featured ? ' <span class="tl-star">★</span>' : "") + "</span>" +
          '<span class="tl-meta">' + esc(t.era) + " · " + esc(catLabel(t.category)) +
            " · Controversy " + t.controversyScore + "/10" +
            (t.evidence ? " · Evidence " + esc(t.evidence.grade) : "") + "</span>" +
        "</span></li>";
    }).join("") + "</ol>";
    Array.prototype.forEach.call(el.timeline.querySelectorAll(".tl-item"), function (li) {
      li.addEventListener("click", function () { openTopic(li.getAttribute("data-id"), li); });
    });
  }

  function renderGraph(list) {
    var W = 1000, H = 620, pad = 70;
    if (!list.length) { el.graph.innerHTML = ""; return; }

    var nodes = list.map(function (t, i) {
      var ang = (i / list.length) * Math.PI * 2;
      return { id: t.id, t: t, x: W / 2 + Math.cos(ang) * 220, y: H / 2 + Math.sin(ang) * 180, deg: 0 };
    });
    var idx = {};
    nodes.forEach(function (n) { idx[n.id] = n; });

    var seen = {}, edges = [];
    list.forEach(function (t) {
      (t.relatedTopics || []).forEach(function (r) {
        if (!idx[r.id]) return;
        var key = [t.id, r.id].sort().join("|");
        if (seen[key]) return;
        seen[key] = true;
        edges.push({ a: idx[t.id], b: idx[r.id], rel: r.relation });
        idx[t.id].deg++; idx[r.id].deg++;
      });
    });

    // Fruchterman–Reingold style force layout (deterministic: circle init, no RNG).
    var k = Math.sqrt((W * H) / nodes.length) * 0.52;
    for (var it = 0; it < 320; it++) {
      var temp = 1 - it / 320;
      nodes.forEach(function (a) { a.vx = 0; a.vy = 0; });
      for (var i = 0; i < nodes.length; i++) {
        for (var j = i + 1; j < nodes.length; j++) {
          var a = nodes[i], b = nodes[j];
          var dx = a.x - b.x, dy = a.y - b.y;
          var d = Math.sqrt(dx * dx + dy * dy) || 0.01;
          var rep = (k * k) / d;
          var ux = dx / d, uy = dy / d;
          a.vx += ux * rep; a.vy += uy * rep;
          b.vx -= ux * rep; b.vy -= uy * rep;
        }
      }
      edges.forEach(function (e) {
        var dx = e.a.x - e.b.x, dy = e.a.y - e.b.y;
        var d = Math.sqrt(dx * dx + dy * dy) || 0.01;
        var att = (d * d) / k;
        var fx = (dx / d) * att, fy = (dy / d) * att;
        e.a.vx -= fx; e.a.vy -= fy; e.b.vx += fx; e.b.vy += fy;
      });
      nodes.forEach(function (a) {
        a.vx += (W / 2 - a.x) * 0.03; a.vy += (H / 2 - a.y) * 0.03;
        var disp = Math.sqrt(a.vx * a.vx + a.vy * a.vy) || 0.01;
        var lim = Math.min(disp, 28 * temp + 1);
        a.x += (a.vx / disp) * lim; a.y += (a.vy / disp) * lim;
      });
    }

    // Fit to viewBox.
    var xs = nodes.map(function (n) { return n.x; });
    var ys = nodes.map(function (n) { return n.y; });
    var minx = Math.min.apply(null, xs), maxx = Math.max.apply(null, xs);
    var miny = Math.min.apply(null, ys), maxy = Math.max.apply(null, ys);
    var s = Math.min((W - 2 * pad) / Math.max(1, maxx - minx), (H - 2 * pad) / Math.max(1, maxy - miny));
    nodes.forEach(function (n) {
      n.x = pad + (n.x - minx) * s;
      n.y = pad + (n.y - miny) * s;
    });

    var edgeSvg = edges.map(function (e) {
      return '<line class="g-edge" data-a="' + esc(e.a.id) + '" data-b="' + esc(e.b.id) + '" ' +
        'x1="' + e.a.x.toFixed(1) + '" y1="' + e.a.y.toFixed(1) + '" ' +
        'x2="' + e.b.x.toFixed(1) + '" y2="' + e.b.y.toFixed(1) + '"><title>' + esc(e.rel || "related") + "</title></line>";
    }).join("");

    var nodeSvg = nodes.map(function (n) {
      var r = 7 + n.deg * 1.7;
      return '<g class="g-node" data-id="' + esc(n.id) + '" tabindex="0" role="button" aria-label="' + esc(n.t.title) + '">' +
        '<circle cx="' + n.x.toFixed(1) + '" cy="' + n.y.toFixed(1) + '" r="' + r.toFixed(1) + '" fill="' + catColor(n.t.category) + '">' +
        "<title>" + esc(n.t.title) + "</title></circle>" +
        '<text x="' + n.x.toFixed(1) + '" y="' + (n.y - r - 5).toFixed(1) + '">' + esc(shortLabel(n.t)) + "</text>" +
        "</g>";
    }).join("");

    el.graph.innerHTML =
      '<svg viewBox="0 0 ' + W + " " + H + '" class="graph-svg" role="img" aria-label="Relationship graph">' +
      '<g class="g-edges">' + edgeSvg + "</g><g class=\"g-nodes\">" + nodeSvg + "</g></svg>" +
      '<p class="graph-hint">Node size = number of links · colour = category · click a node to open it</p>';

    bindGraph();
  }

  function bindGraph() {
    var svg = el.graph.querySelector("svg");
    if (!svg) return;
    Array.prototype.forEach.call(svg.querySelectorAll(".g-node"), function (g) {
      var id = g.getAttribute("data-id");
      g.addEventListener("click", function () { openTopic(id, g); });
      g.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openTopic(id, g); }
      });
      g.addEventListener("mouseenter", function () { highlightNode(svg, id); });
      g.addEventListener("mouseleave", function () { svg.classList.remove("focusing"); });
    });
  }

  function highlightNode(svg, id) {
    svg.classList.add("focusing");
    var hot = {};
    hot[id] = true;
    Array.prototype.forEach.call(svg.querySelectorAll(".g-edge"), function (e) {
      var a = e.getAttribute("data-a"), b = e.getAttribute("data-b");
      var on = a === id || b === id;
      e.classList.toggle("hot", on);
      if (on) { hot[a] = true; hot[b] = true; }
    });
    Array.prototype.forEach.call(svg.querySelectorAll(".g-node"), function (g) {
      g.classList.toggle("hot", !!hot[g.getAttribute("data-id")]);
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
    el.viewToggle.addEventListener("click", function (e) {
      var btn = e.target.closest(".vbtn");
      if (!btn) return;
      state.view = btn.getAttribute("data-view");
      Array.prototype.forEach.call(el.viewToggle.querySelectorAll(".vbtn"), function (b) {
        var on = b === btn;
        b.classList.toggle("active", on);
        b.setAttribute("aria-pressed", on);
      });
      render();
    });
    el.timeline.addEventListener("keydown", function (e) {
      if (e.key !== "Enter" && e.key !== " ") return;
      var li = e.target.closest(".tl-item");
      if (li) { e.preventDefault(); openTopic(li.getAttribute("data-id"), li); }
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
