/**
 * ====================================================================
 * PAPERBRIDGES APP — UI + game flow, ES5, zero dependencies.
 * Tap any cell on the line between two islands: cycles 0-1-2-0
 * bridges. Win: every island satisfied + all connected.
 * ====================================================================
 */
(function (env) { 'use strict';

    var E = env.PBEngine;
    var LEVEL_NAME = { 1: 'EASY', 2: 'MEDIUM', 3: 'HARD', 4: 'EXPERT' };
    var HINT_BUDGET = { 1: 3, 2: 2, 3: 1, 4: 0 };

    var store = {
        get: function (k, d) {
            try { var v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); }
            catch (e) { return d; }
        },
        set: function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
        del: function (k) { try { localStorage.removeItem(k); } catch (e) {} }
    };

    // ---------- state ----------
    var level = store.get('pb_level', 1);
    var W = 6, H = 6;
    var islands = [];        // [{x,y,n}]
    var islAt = {};          // "x,y" -> index
    var bridges = {};        // pairKey -> cnt 0/1/2 (user's)
    var hinted = {};         // pairKey -> true (locked)
    var badPairs = {};       // pairKey -> true (check flags)
    var undoStack = [];
    var solution = {};       // pairKey -> cnt (the unique solution)
    var hintsUsed = 0;
    var gameOver = false;
    var startTs = 0;
    var elapsedBase = 0;
    var cellPx = 48;

    var $ = function (id) { return document.getElementById(id); };
    var boardEl;
    var cells = {};          // "x,y" -> element
    var bridgeLayer = null;  // overlay div holding .bridge line elements
    var selLayer = null;      // overlay div holding .selmark direction markers
    var bridgeEls = {};      // pairKey -> [element, ...]
    var selIsland = -1;      // selected island index, -1 = none

    // ---------- keys ----------
    function pk(a, b) { return E.key(a, b); }
    function pairOfKey(k) {
        var ends = k.split('-');
        return [islAt[ends[0]], islAt[ends[1]]];
    }

    // ---------- screens ----------
    function showStart() {
        $('screen-start').className = 'screen';
        $('screen-play').className = 'screen hidden';
        var rows = $('lvl-list').children, i;
        for (i = 0; i < rows.length; i++) {
            rows[i].className = 'lvl-row' +
                (parseInt(rows[i].getAttribute('data-v'), 10) === level ? ' on' : '');
        }
        $('btn-resume').style.display = store.get('pb_save', null) ? 'block' : 'none';
        renderStartStats();
    }

    function renderStartStats() {
        var out = [], l, st;
        for (l = 1; l <= 4; l++) {
            st = store.get('pb_stat_' + l, null);
            if (st && st.solved > 0) {
                out.push(LEVEL_NAME[l].charAt(0) + LEVEL_NAME[l].slice(1).toLowerCase() +
                    ' ' + st.solved + '/' + st.played + ' best ' + fmtTime(st.best));
            }
        }
        $('start-stats').innerHTML = out.length ? out.join(' &middot; ') : '&nbsp;';
    }

    // ---------- board ----------
    function buildBoard() {
        boardEl = $('board');
        boardEl.innerHTML = '';
        cells = {};
        var x, y, el, i;
        for (y = 0; y < H; y++) {
            for (x = 0; x < W; x++) {
                el = document.createElement('div');
                el.className = 'bcell';
                el.style.left = (x * cellPx) + 'px';
                el.style.top = (y * cellPx) + 'px';
                el.style.width = cellPx + 'px';
                el.style.height = cellPx + 'px';
                (function (el2, x2, y2) {
                    el2.onclick = function () { onCell(x2, y2); };
                })(el, x, y);
                boardEl.appendChild(el);
                cells[x + ',' + y] = el;
            }
        }
        boardEl.style.width = (W * cellPx) + 'px';
        boardEl.style.height = (H * cellPx) + 'px';

        // overlay for bridge lines: appended after cells + z-index 1, so it
        // paints above plain cells but below islands (z-index 2). Taps pass
        // through via pointer-events:none; a delegated handler covers
        // browsers without pointer-events support.
        bridgeLayer = document.createElement('div');
        bridgeLayer.id = 'bridge-layer';
        selLayer = document.createElement('div');
        selLayer.id = 'sel-layer';
        var layerTap = function (ev) {
            var r = boardEl.getBoundingClientRect();
            var x = Math.floor((ev.clientX - r.left) / cellPx);
            var y = Math.floor((ev.clientY - r.top) / cellPx);
            if (x >= 0 && x < W && y >= 0 && y < H) { onCell(x, y); }
        };
        bridgeLayer.onclick = layerTap;
        selLayer.onclick = layerTap;
        boardEl.appendChild(bridgeLayer);
        boardEl.appendChild(selLayer);
        bridgeEls = {};
        selIsland = -1;

        for (i = 0; i < islands.length; i++) {
            paintIsland(i);
        }
        paintAllSegments();
    }

    function sizeBoard() {
        var vw = window.innerWidth || 480;
        // width-first sizing (screen caps at 560px): e-ink viewports
        // are tall enough that height never binds
        var size = Math.floor((Math.min(vw, 560) - 24) / Math.max(W, H));
        if (size < 36) size = 36;
        if (size > 66) size = 66;
        cellPx = size;
    }

    function paintIsland(i) {
        var isl = islands[i];
        var el = cells[isl.x + ',' + isl.y];
        if (!el) return;
        el.className = 'bcell isl';
        el.innerHTML = isl.n;
        el.style.lineHeight = (cellPx - 4) + 'px';
        el.style.fontSize = Math.floor(cellPx * 0.45) + 'px';
        var d = 0, k;
        for (k in bridges) {
            if (bridges[k] > 0) {
                var pr = pairOfKey(k);
                if (pr[0] === i || pr[1] === i) { d += bridges[k]; }
            }
        }
        if (d === isl.n && d > 0) { el.className += ' done'; }
        if (selIsland === i) { el.className += ' sel'; }
    }

    function paintAllSegments() {
        var k;
        if (!bridgeLayer) return;
        bridgeLayer.innerHTML = '';
        bridgeEls = {};
        for (k in bridges) {
            if (bridges[k] > 0) { paintBridge(k); }
        }
    }

    function removeBridgeEl(k) {
        var els = bridgeEls[k], i;
        if (els) {
            for (i = 0; i < els.length; i++) {
                if (els[i].parentNode) { els[i].parentNode.removeChild(els[i]); }
            }
        }
        delete bridgeEls[k];
    }

    /** Solid black line(s) from island A center to island B center. The
     *  islands (z-index 2, white circle bg) cover the overshoot, so each
     *  line visually meets the circle edge. Explicit width+height on real
     *  boxes — renders identically on every browser incl. old e-ink kits. */
    function paintBridge(k) {
        var pr = pairOfKey(k);
        if (pr[0] === undefined || pr[1] === undefined) return;
        if (!bridgeLayer) return;
        removeBridgeEl(k);
        var a = islands[pr[0]], b = islands[pr[1]];
        var cnt = bridges[k];
        var horiz = a.y === b.y;
        var thick = hinted[k] ? 3 : 2;
        var off = cnt === 2 ? 3 : Math.floor(thick / 2); // line center offsets
        var ax = a.x * cellPx + cellPx / 2, ay = a.y * cellPx + cellPx / 2;
        var bx = b.x * cellPx + cellPx / 2, by = b.y * cellPx + cellPx / 2;
        var els = [];
        var centers = cnt === 2 ? [-off, off] : [0];
        var i, el;
        for (i = 0; i < centers.length; i++) {
            el = document.createElement('div');
            el.className = 'bridge' + (badPairs[k] ? ' bad' : '');
            if (horiz) {
                el.style.left = Math.min(ax, bx) + 'px';
                el.style.width = Math.abs(bx - ax) + 'px';
                el.style.top = (ay + centers[i] - Math.floor(thick / 2)) + 'px';
                el.style.height = thick + 'px';
            } else {
                el.style.top = Math.min(ay, by) + 'px';
                el.style.height = Math.abs(by - ay) + 'px';
                el.style.left = (ax + centers[i] - Math.floor(thick / 2)) + 'px';
                el.style.width = thick + 'px';
            }
            bridgeLayer.appendChild(el);
            els.push(el);
        }
        bridgeEls[k] = els;
    }

    function clearBridgePaint(k) {
        removeBridgeEl(k);
    }

    // ---------- clock ----------
    function elapsedMs() {
        return gameOver ? elapsedBase : elapsedBase + (startTs ? (Date.now() - startTs) : 0);
    }
    function fmtTime(ms) {
        var s = Math.floor(ms / 1000), m = Math.floor(s / 60);
        s -= m * 60;
        return m + ':' + (s < 10 ? '0' : '') + s;
    }
    function renderClock() { $('clock').innerHTML = fmtTime(elapsedMs()); }

    // ---------- game ----------
    function newGame() {
        var p, tries = 0;
        var seen = store.get('pb_seen', []);
        do {
            p = E.generate(level);
            tries++;
        } while (p && E.isSeen(p.hash, seen) && tries < 10);
        if (!p) { return; }
        seen = E.appendSeen(p.hash, seen);
        store.set('pb_seen', seen);

        W = p.w; H = p.h;
        islands = p.islands;
        solution = p.solution;
        islAt = {};
        var i;
        for (i = 0; i < islands.length; i++) {
            islAt[islands[i].x + ',' + islands[i].y] = i;
        }
        bridges = {};
        hinted = {};
        badPairs = {};
        undoStack = [];
        hintsUsed = 0;
        gameOver = false;
        startTs = Date.now();
        elapsedBase = 0;
        var st = store.get('pb_stat_' + level, { played: 0, solved: 0, best: 0 });
        st.played++;
        store.set('pb_stat_' + level, st);
        showPlay();
        sizeBoard();
        buildBoard();
        renderClock();
        paintHintBtn();
        saveGame();
    }

    function showPlay() {
        $('screen-start').className = 'screen hidden';
        $('screen-play').className = 'screen';
        $('lvl-label').innerHTML = LEVEL_NAME[level];
    }

    function hintsLeft() { return HINT_BUDGET[level] - hintsUsed; }
    function paintHintBtn() {
        var hb = $('btn-hint');
        hb.disabled = hintsLeft() <= 0;
        hb.innerHTML = 'HINT' + (HINT_BUDGET[level] > 0 ? ' ' + hintsLeft() : '');
    }

    /** Which pair does tapping (x,y) refer to? Horizontal preferred. */
    function targetPair(x, y) {
        var i, a = null, b = null;
        for (i = x - 1; i >= 0; i--) {
            if (islAt[i + ',' + y] !== undefined) { a = islands[islAt[i + ',' + y]]; break; }
        }
        for (i = x + 1; i < W; i++) {
            if (islAt[i + ',' + y] !== undefined) { b = islands[islAt[i + ',' + y]]; break; }
        }
        if (a && b) { return [a, b]; }
        a = null; b = null;
        for (i = y - 1; i >= 0; i--) {
            if (islAt[x + ',' + i] !== undefined) { a = islands[islAt[x + ',' + i]]; break; }
        }
        for (i = y + 1; i < H; i++) {
            if (islAt[x + ',' + i] !== undefined) { b = islands[islAt[x + ',' + i]]; break; }
        }
        if (a && b) { return [a, b]; }
        return undefined;
    }

    /** Would a bridge on pair conflict with existing bridges? */
    function conflicts(a, b, ignoreKey) {
        var k;
        for (k in bridges) {
            if (bridges[k] === 0 || k === ignoreKey) continue;
            var pr = pairOfKey(k);
            if (E.crosses(a, b, islands[pr[0]], islands[pr[1]])) return true;
        }
        return 0 === 1;
    }

    function setBridge(a, b, cnt) {
        var k = pk(a, b);
        if (bridges[k]) { clearBridgePaint(k); }
        bridges[k] = cnt;
        badPairs[k] = false;
        if (cnt > 0) { paintBridge(k); }
        paintIsland(islAt[a.x + ',' + a.y]);
        paintIsland(islAt[b.x + ',' + b.y]);
    }

    /** Cycle pair's bridge count 0-1-2-0. When the next state is impossible
     *  (degree cap reached or crossing), falls back to removal so a bridge
     *  is never stuck. Returns true when something changed. */
    function tryCycle(a, b) {
        var k = pk(a, b);
        if (hinted[k]) return false;
        var cur = bridges[k] || 0;
        var next = (cur + 1) % 3;
        var ia = islAt[a.x + ',' + a.y], ib = islAt[b.x + ',' + b.y];
        if (next > 0) {
            var da = curDeg(ia) + next - cur, db = curDeg(ib) + next - cur;
            if (da > islands[ia].n || db > islands[ib].n || conflicts(a, b, k)) {
                next = 0;
            }
        }
        if (next === cur) return false;
        undoStack.push({ k: k, prev: cur });
        if (undoStack.length > 300) { undoStack.shift(); }
        setBridge(a, b, next);
        saveGame();
        checkWin();
        return 1 === 1;
    }

    /** Nearest island index strictly between (x,y) and the border in
     *  direction (dx,dy); null when none. */
    function firstInLine(x, y, dx, dy) {
        var cx = x + dx, cy = y + dy;
        while (cx >= 0 && cx < W && cy >= 0 && cy < H) {
            if (islAt[cx + ',' + cy] !== undefined) return islAt[cx + ',' + cy];
            cx += dx; cy += dy;
        }
        return undefined;
    }

    // ---------- selection (connect two specific islands) ----------

    /** Dotted preview lines from the selected island to each reachable
     *  neighbour. Drawn as a series of small solid divs (the rendering
     *  primitive proven to work everywhere); tapping anywhere on a dotted
     *  line cycles that pair's bridges 0-1-2-0. */
    function paintSelection() {
        var d, dirs, j, el;
        if (!selLayer) return;
        selLayer.innerHTML = '';
        if (selIsland < 0) return;
        var a = islands[selIsland];
        dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
        for (d = 0; d < 4; d++) {
            j = firstInLine(a.x, a.y, dirs[d][0], dirs[d][1]);
            if (j === null) continue;
            var b = islands[j];
            if ((bridges[pk(a, b)] || 0) > 0) continue;  // connected: no dots
            var horiz = a.y === b.y;
            // corridor spans from edge of A's cell to edge of B's cell
            var from = horiz ? Math.min(a.x, b.x) : Math.min(a.y, b.y);
            var to = horiz ? Math.max(a.x, b.x) : Math.max(a.y, b.y);
            var c0 = (from + 1) * cellPx;         // first pixel past A's cell
            var c1 = to * cellPx;                 // start of B's cell
            var center = (horiz ? a.y : a.x) * cellPx + cellPx / 2;
            var period = Math.floor(cellPx / 3);  // dash + gap period
            var dw = Math.max(8, Math.floor(period / 2)); // dash length
            var dh = 4;                           // dash thickness
            var pos, k = 0;
            for (pos = c0 + 2; pos + dw <= c1; pos += period, k++) {
                el = document.createElement('div');
                el.className = 'dash';
                if (horiz) {
                    el.style.left = pos + 'px';
                    el.style.top = (center - dh / 2) + 'px';
                    el.style.width = dw + 'px';
                    el.style.height = dh + 'px';
                } else {
                    el.style.top = pos + 'px';
                    el.style.left = (center - dh / 2) + 'px';
                    el.style.width = dh + 'px';
                    el.style.height = dw + 'px';
                }
                selLayer.appendChild(el);
            }
        }
    }

    function select(i) {
        if (selIsland === i) { deselect(); return; }
        var old = selIsland;
        selIsland = i;                 // repaint old AFTER clearing selIsland
        if (old >= 0) { paintIsland(old); }
        paintIsland(i);
        paintSelection();
    }

    function deselect() {
        var old = selIsland;
        selIsland = -1;
        if (old >= 0) { paintIsland(old); }
        paintSelection();
    }

    /** Brief invert-flash on islands involved in a rejected connection. */
    function flashErr(ia, ib) {
        var list = [ia], i;
        if (ib !== undefined) { list.push(ib); }
        for (i = 0; i < list.length; i++) {
            (function (idx) {
                var el = cells[islands[idx].x + ',' + islands[idx].y];
                if (!el || selIsland === idx) return;
                el.className += ' err';
                setTimeout(function () { paintIsland(idx); }, 350);
            })(list[i]);
        }
    }

    /** Tap on an island: purely selects it (markers then show which
     *  neighbouring cells to tap to connect). Never connects directly —
     *  that ambiguity caused accidental bridges when chaining pairs. */
    function onIsland(x, y) {
        select(islAt[x + ',' + y]);
    }

    function onCell(x, y) {
        if (gameOver) { renderClock(); return; }
        renderClock();
        if (islAt[x + ',' + y] !== undefined) { onIsland(x, y); return; }
        var pr = targetPair(x, y);
        if (!pr) {
            if (selIsland >= 0) { deselect(); }
            return;
        }
        // with a selected island, only toggle pairs it participates in
        if (selIsland >= 0) {
            var ia = islAt[pr[0].x + ',' + pr[0].y], ib = islAt[pr[1].x + ',' + pr[1].y];
            if (ia !== selIsland && ib !== selIsland) {
                flashErr(selIsland);
                deselect();
                return;
            }
            var a2 = islands[selIsland];
            var other = ia === selIsland ? pr[1] : pr[0];
            var done = tryCycle(a2, other);
            if (!done) {
                flashErr(selIsland, islAt[other.x + ',' + other.y]);
            } else if (!gameOver) {
                paintSelection();   // markers refresh (filled = has bridge)
            }
            return;
        }
        var ok = tryCycle(pr[0], pr[1]);
        if (!ok) { flashErr(islAt[pr[0].x + ',' + pr[0].y], islAt[pr[1].x + ',' + pr[1].y]); }
    }

    function curDeg(i) {
        var d = 0, k;
        for (k in bridges) {
            if (bridges[k] > 0) {
                var pr = pairOfKey(k);
                if (pr[0] === i || pr[1] === i) { d += bridges[k]; }
            }
        }
        return d;
    }

    function allConnected() {
        var par = [], i, k;
        for (i = 0; i < islands.length; i++) { par[i] = i; }
        function find(x) { while (par[x] !== x) { x = par[x]; } return x; }
        var links = 0;
        for (k in bridges) {
            if (bridges[k] > 0) {
                var pr = pairOfKey(k);
                var r1 = find(pr[0]), r2 = find(pr[1]);
                if (r1 !== r2) { par[r1] = r2; links++; }
            }
        }
        return links === islands.length - 1;
    }

    function checkWin() {
        if (gameOver) return;
        var i;
        for (i = 0; i < islands.length; i++) {
            if (curDeg(i) !== islands[i].n) return;
        }
        if (!allConnected()) return;
        gameOver = true;
        elapsedBase += startTs ? (Date.now() - startTs) : 0;
        startTs = 0;
        var st = store.get('pb_stat_' + level, { played: 0, solved: 0, best: 0 });
        st.solved++;
        if (!st.best || elapsedBase < st.best) { st.best = elapsedBase; }
        store.set('pb_stat_' + level, st);
        store.del('pb_save');
        deselect();
        $('win-body').innerHTML = LEVEL_NAME[level] + ' &middot; ' + fmtTime(elapsedBase) +
            (HINT_BUDGET[level] > 0 ? '<br>hints used: ' + hintsUsed + '/' + HINT_BUDGET[level] : '');
        $('win-pop').className = 'board-pop show';
    }

    // ---------- undo ----------
    function onUndo() {
        renderClock();
        if (gameOver || !undoStack.length) return;
        var e = undoStack.pop();
        if (hinted[e.k]) { delete hinted[e.k]; }
        if (e.hint) { hintsUsed--; paintHintBtn(); }
        var pr = pairOfKey(e.k);
        var a = islands[pr[0]], b = islands[pr[1]];
        var cur = bridges[e.k] || 0;
        if (cur) { clearBridgePaint(e.k); }
        bridges[e.k] = e.prev;
        badPairs[e.k] = false;
        if (e.prev > 0) { paintBridge(e.k); }
        paintIsland(pr[0]);
        paintIsland(pr[1]);
        paintSelection();
        saveGame();
    }

    // ---------- hint ----------
    function onHint() {
        renderClock();
        if (gameOver || hintsLeft() <= 0) return;
        // find a solution pair not yet at its count
        var k, best = null;
        for (k in solution) {
            var want = solution[k];
            var have = bridges[k] || 0;
            if (have < want) { best = k; break; }
        }
        if (!best) return;
        var pr = pairOfKey(best);
        var a = islands[pr[0]], b = islands[pr[1]];
        undoStack.push({ k: best, prev: bridges[best] || 0, hint: true });
        setBridge(a, b, solution[best]);
        hinted[best] = true;
        hintsUsed++;
        paintHintBtn();
        paintSelection();
        saveGame();
        checkWin();
    }

    // ---------- check ----------
    function onCheck() {
        renderClock();
        if (gameOver) return;
        var k, changed = false;
        var want = solutionMap();
        for (k in bridges) {
            if (!bridges[k]) continue;
            var okPair = want[k] !== undefined && bridges[k] === want[k];
            if (badPairs[k] !== !okPair) {
                badPairs[k] = !okPair;
                if (bridges[k] > 0) {
                    clearBridgePaint(k);
                    paintBridge(k);
                }
                changed = true;
            }
        }
        saveGame();
    }

    function solutionMap() { return solution; }

    // ---------- save ----------
    function saveGame() {
        if (gameOver) { store.del('pb_save'); return; }
        var bser = {}, k;
        for (k in bridges) { if (bridges[k] > 0) { bser[k] = bridges[k]; } }
        var hser = {};
        for (k in hinted) { if (hinted[k]) { hser[k] = 1; } }
        store.set('pb_save', {
            level: level, w: W, h: H,
            islands: islands,
            solution: solution,
            bridges: bser, hinted: hser,
            hintsUsed: hintsUsed,
            elapsed: elapsedMs(),
            undo: undoStack
        });
    }

    function resumeGame() {
        var s = store.get('pb_save', null);
        if (!s) { newGame(); return; }
        level = s.level;
        W = s.w; H = s.h;
        islands = s.islands;
        solution = s.solution || {};
        islAt = {};
        var i;
        for (i = 0; i < islands.length; i++) {
            islAt[islands[i].x + ',' + islands[i].y] = i;
        }
        bridges = s.bridges || {};
        hinted = s.hinted || {};
        hintsUsed = s.hintsUsed || 0;
        undoStack = s.undo || [];
        elapsedBase = s.elapsed || 0;
        startTs = Date.now();
        gameOver = false;
        badPairs = {};
        showPlay();
        sizeBoard();
        buildBoard();
        renderClock();
        paintHintBtn();
    }

    // ---------- init ----------
    function init() {
        var rows = $('lvl-list').children, i;
        for (i = 0; i < rows.length; i++) {
            (function (row) {
                row.onclick = function () {
                    level = parseInt(row.getAttribute('data-v'), 10);
                    store.set('pb_level', level);
                    var k;
                    for (k = 0; k < rows.length; k++) {
                        rows[k].className = 'lvl-row' + (rows[k] === row ? ' on' : '');
                    }
                };
            })(rows[i]);
        }

        $('btn-start').onclick = function () { newGame(); };
        $('btn-resume').onclick = function () { resumeGame(); };
        $('btn-undo').onclick = function () { onUndo(); };
        $('btn-hint').onclick = function () { onHint(); };
        $('btn-check').onclick = function () { onCheck(); };
        $('btn-menu').onclick = function () { deselect(); $('menu-modal').className = 'overlay'; renderClock(); };
        $('btn-close-menu').onclick = function () { $('menu-modal').className = 'overlay hidden'; };
        $('btn-new').onclick = function () {
            $('menu-modal').className = 'overlay hidden';
            newGame();
        };
        $('btn-exit').onclick = function () {
            $('menu-modal').className = 'overlay hidden';
            showStart();
        };
        $('btn-again').onclick = function () {
            $('win-pop').className = 'board-pop';
            newGame();
        };
        $('btn-close-win').onclick = function () {
            $('win-pop').className = 'board-pop';
        };

        window.onresize = function () { sizeBoard(); buildBoard(); };
        showStart();
    }

    if (typeof document !== 'undefined') {
        if (document.readyState === 'complete') { init(); }
        else { env.onload = init; }
    }

})(typeof window === 'object' ? window : global);
