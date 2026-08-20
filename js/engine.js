/**
 * ====================================================================
 * PAPERBRIDGES ENGINE — Hashiwokakero, ES5, zero dependencies.
 * Islands {x,y,n} on WxH grid; bridges 1-2 between same-row/col
 * island pairs, no crossings; all islands connected. Generator
 * builds a connected bridge network, then verifies uniqueness by
 * solution counting. djb2 puzzle hash + seen list (no repeats).
 * ====================================================================
 */
(function (env) { 'use strict';

    // ---------- geometry helpers ----------

    /** True when islands a,b are aligned and no island strictly between. */
    function clearLine(a, b, islands) {
        var i, s;
        if (a.x === b.x) {
            s = a.y < b.y ? 1 : -1;
            for (i = 0; i < islands.length; i++) {
                if (islands[i] !== a && islands[i] !== b && islands[i].x === a.x &&
                    ((s === 1 && islands[i].y > a.y && islands[i].y < b.y) ||
                     (s === -1 && islands[i].y < a.y && islands[i].y > b.y))) { return false; }
            }
            return 1 === 1;
        }
        if (a.y === b.y) {
            s = a.x < b.x ? 1 : -1;
            for (i = 0; i < islands.length; i++) {
                if (islands[i] !== a && islands[i] !== b && islands[i].y === a.y &&
                    ((s === 1 && islands[i].x > a.x && islands[i].x < b.x) ||
                     (s === -1 && islands[i].x < a.x && islands[i].x > b.x))) { return false; }
            }
            return 1 === 1;
        }
        return 0 === 1;
    }

    /** True when segment ab crosses segment cd (no shared endpoints). */
    function crosses(a, b, c, d) {
        var h1 = a.y === b.y, h2 = c.y === d.y;
        if (h1 === h2) return false;          // parallel
        var hs, vs;
        if (h1) { hs = [a, b]; vs = [c, d]; } else { hs = [c, d]; vs = [a, b]; }
        var hxMin = Math.min(hs[0].x, hs[1].x), hxMax = Math.max(hs[0].x, hs[1].x);
        var vyMin = Math.min(vs[0].y, vs[1].y), vyMax = Math.max(vs[0].y, vs[1].y);
        var vx = vs[0].x, hy = hs[0].y;
        return vx > hxMin && vx < hxMax && hy > vyMin && hy < vyMax;
    }

    function key(a, b) { return a.x + ',' + a.y + '-' + b.x + ',' + b.y; }

    // ---------- solver: count solutions (cap limit) ----------

    /**
     * Count bridge completions (capped at limit). Island-oriented MRV:
     * branch on the island with fewest remaining options.
     */
    function countSolutions(islands, limit) {
        var pairs = [], i, j;
        for (i = 0; i < islands.length; i++) {
            for (j = i + 1; j < islands.length; j++) {
                if (clearLine(islands[i], islands[j], islands)) { pairs.push([i, j]); }
            }
        }
        // pairs touching each island
        var touching = [], k;
        for (i = 0; i < islands.length; i++) { touching[i] = []; }
        for (k = 0; k < pairs.length; k++) {
            touching[pairs[k][0]].push(k);
            touching[pairs[k][1]].push(k);
        }
        // crossing matrix
        var crossM = {};
        for (k = 0; k < pairs.length; k++) {
            for (j = k + 1; j < pairs.length; j++) {
                if (crosses(islands[pairs[k][0]], islands[pairs[k][1]],
                            islands[pairs[j][0]], islands[pairs[j][1]])) {
                    crossM[k + ':' + j] = 1;
                }
            }
        }

        var deg = [], used = [];
        for (i = 0; i < islands.length; i++) { deg[i] = 0; }
        for (k = 0; k < pairs.length; k++) { used[k] = 0; }
        var count = 0;

        function canUse(k, cnt) {
            var l;
            for (l = 0; l < pairs.length; l++) {
                if (!used[l]) continue;
                if (crossM[Math.min(k, l) + ':' + Math.max(k, l)]) return false;
            }
            if (deg[pairs[k][0]] + cnt > islands[pairs[k][0]].n) return false;
            if (deg[pairs[k][1]] + cnt > islands[pairs[k][1]].n) return false;
            return 1 === 1;
        }

        /** options for island i: untouched pairs ({k}) — each branch decides
         *  the pair's FINAL total (1 or 2), so states are never recounted. */
        function optionsFor(i) {
            var out = [], t = touching[i], m;
            for (m = 0; m < t.length; m++) {
                var k2 = t[m];
                if (used[k2] !== 0) continue;
                if (!canUse(k2, 1)) continue;
                out.push({ k: k2 });
            }
            return out;
        }

        function connectedAll() {
            var par = [], m, r1, r2;
            for (m = 0; m < islands.length; m++) { par[m] = m; }
            function find(x) { while (par[x] !== x) { x = par[x]; } return x; }
            var links = 0;
            for (m = 0; m < pairs.length; m++) {
                if (used[m]) {
                    r1 = find(pairs[m][0]); r2 = find(pairs[m][1]);
                    if (r1 !== r2) { par[r1] = r2; links++; }
                }
            }
            return links === islands.length - 1;
        }

        function rec() {
            if (count >= limit) return;
            var needI = -1, needOpts = null, i2;
            for (i2 = 0; i2 < islands.length; i2++) {
                var need = islands[i2].n - deg[i2];
                if (need <= 0) continue;
                var opts = optionsFor(i2);
                if (!opts.length) return;                 // dead island
                if (needOpts === null || opts.length < needOpts.length) {
                    needI = i2; needOpts = opts;
                    if (opts.length === 1) break;
                }
            }
            if (needI === -1) {
                if (connectedAll()) count++;
                return;
            }
            var m2;
            for (m2 = 0; m2 < needOpts.length; m2++) {
                var k3 = needOpts[m2].k;
                var c2 = 1;
                for (c2 = 1; c2 <= 2; c2++) {
                    if (!canUse(k3, c2)) break;
                    used[k3] = c2;
                    deg[pairs[k3][0]] += c2;
                    deg[pairs[k3][1]] += c2;
                    rec();
                    deg[pairs[k3][0]] -= c2;
                    deg[pairs[k3][1]] -= c2;
                    used[k3] = 0;
                    if (count >= limit) return;
                }
            }
        }

        rec();
        return count;
    }

    // ---------- generator ----------

    var LEVELS = {
        1: { name: 'Easy',   w: 6, h: 6, isl: 7  },
        2: { name: 'Medium', w: 7, h: 7, isl: 10 },
        3: { name: 'Hard',   w: 8, h: 8, isl: 12 },
        4: { name: 'Expert', w: 9, h: 9, isl: 14 }
    };
    var SEEN_CAP = 500;

    function shuffle(a, rand) {
        rand = rand || Math.random;
        var j, k, t;
        for (j = a.length - 1; j > 0; j--) {
            k = Math.floor(rand() * (j + 1));
            t = a[j]; a[j] = a[k]; a[k] = t;
        }
        return a;
    }

    /**
     * Generate puzzle for level 1..4.
     * Returns { w, h, islands, solution (map pairKey->cnt), hash, level }.
     */
    function generate(level, rand) {
        rand = rand || Math.random;
        var cfg = LEVELS[level] || LEVELS[1];
        var attempt, islands, i, j, a, b;

        for (attempt = 0; attempt < 400; attempt++) {
            var grown = growNetwork(cfg, rand);
            if (!grown) continue;
            islands = grown.islands;

            // tree solution; degrees from it
            var sol = grown.edges;
            for (i = 0; i < islands.length; i++) {
                islands[i].n = degOf(sol, i);
            }

            // degrees from sol
            for (i = 0; i < islands.length; i++) {
                islands[i].n = 0;
                for (j = 0; j < sol.length; j++) {
                    if (sol[j].a === i || sol[j].b === i) { islands[i].n += sol[j].cnt; }
                }
            }
            // all degrees must be 1..8
            var bad = false;
            for (i = 0; i < islands.length; i++) {
                if (islands[i].n < 1 || islands[i].n > 8) { bad = true; break; }
            }
            if (bad) continue;

            // uniqueness of the tree puzzle
            if (countSolutions(islands, 2) !== 1) continue;

            // double-bridge upgrades, each re-verified for uniqueness
            var upTry = Math.floor(islands.length / 3);
            shuffle(sol, rand);
            for (j = 0; j < sol.length && upTry > 0; j++) {
                if (sol[j].cnt !== 1) continue;
                if (islands[sol[j].a].n >= 8 || islands[sol[j].b].n >= 8) continue;
                sol[j].cnt = 2;
                islands[sol[j].a].n++;
                islands[sol[j].b].n++;
                if (countSolutions(islands, 2) === 1) {
                    upTry--;
                } else {
                    sol[j].cnt = 1;                      // revert
                    islands[sol[j].a].n--;
                    islands[sol[j].b].n--;
                }
            }

            var solMap = {};
            for (j = 0; j < sol.length; j++) {
                solMap[key(islands[sol[j].a], islands[sol[j].b])] = sol[j].cnt;
            }
            var gstr = gridString(islands, cfg);
            return {
                w: cfg.w, h: cfg.h, islands: islands,
                solution: solMap, hash: hashOf(gstr), level: level
            };
        }
        return null;   // should not happen statistically
    }

    function gridString(islands, cfg) {
        var g = [], r, c;
        for (r = 0; r < cfg.h; r++) {
            for (c = 0; c < cfg.w; c++) { g.push('0'); }
        }
        var i;
        for (i = 0; i < islands.length; i++) {
            g[islands[i].y * cfg.w + islands[i].x] = '' + islands[i].n;
        }
        return g.join('');
    }

    function degOf(edges, i) {
        var d = 0, k;
        for (k = 0; k < edges.length; k++) {
            if (edges[k].a === i || edges[k].b === i) { d += edges[k].cnt; }
        }
        return d;
    }

    /** Grow a connected island network: every new island extends the tree.
     *  Returns { islands, edges } or null. */
    function growNetwork(cfg, rand) {
        var islands = [], edges = [], taken = {};
        var MAXD = 3;

        function occupied(x, y) { return taken[x + ',' + y] === 1; }

        function orthoAdjacentToOther(x, y, skipIdx) {
            var i;
            for (i = 0; i < islands.length; i++) {
                if (i === skipIdx) continue;
                if (Math.abs(islands[i].x - x) + Math.abs(islands[i].y - y) === 1) return true;
            }
            return 0 === 1;
        }

        function bridgeCrossesAny(a, b) {
            var k;
            for (k = 0; k < edges.length; k++) {
                if (crosses(islands[a], islands[b], islands[edges[k].a], islands[edges[k].b])) {
                    return 1 === 1;
                }
            }
            return 0 === 1;
        }

        // seed island near center
        var sx = 1 + Math.floor(rand() * (cfg.w - 2));
        var sy = 1 + Math.floor(rand() * (cfg.h - 2));
        islands.push({ x: sx, y: sy, n: 0 });
        taken[sx + ',' + sy] = 1;

        var guard = 0;
        while (islands.length < cfg.isl && guard < 400) {
            guard++;
            var ai = Math.floor(rand() * islands.length);
            var A = islands[ai];
            if (degOf(edges, ai) >= 8) continue;
            var horiz = rand() < 0.5;
            var dist = 2 + Math.floor(rand() * (MAXD - 1));
            var dirn = rand() < 0.5 ? 1 : -1;
            var bx = horiz ? A.x + dirn * dist : A.x;
            var by = horiz ? A.y : A.y + dirn * dist;
            if (bx < 0 || bx >= cfg.w || by < 0 || by >= cfg.h) continue;
            if (occupied(bx, by)) continue;
            if (orthoAdjacentToOther(bx, by, ai)) continue;
            if (degOf(edges, ai) + 1 > 8) continue;
            var bi = islands.length;
            // line between A and B clear of islands?
            var steps = dist, st, clearOk = true;
            for (st = 1; st < steps; st++) {
                var cx = horiz ? A.x + dirn * st : A.x;
                var cy = horiz ? A.y : A.y + dirn * st;
                if (occupied(cx, cy)) { clearOk = false; break; }
            }
            if (!clearOk) continue;
            islands.push({ x: bx, y: by, n: 0 });
            taken[bx + ',' + by] = 1;
            if (bridgeCrossesAny(ai, bi)) {
                islands.pop();
                taken[bx + ',' + by] = 0;
                continue;
            }
            edges.push({ a: ai, b: bi, cnt: 1 });
        }

        if (islands.length < cfg.isl) return null;
        return { islands: islands, edges: edges };
    }

    // ---------- no-repeat ----------

    function hashOf(s) {
        var h = 5381, i;
        for (i = 0; i < s.length; i++) {
            h = (((h << 5) + h) + s.charCodeAt(i)) & 0x7FFFFFFF;
        }
        return h.toString(36);
    }

    function isSeen(hash, seenArray) {
        var i;
        if (!seenArray) return false;
        for (i = 0; i < seenArray.length; i++) {
            if (seenArray[i] === hash) return true;
        }
        return 0 === 1;
    }

    function appendSeen(hash, seenArray) {
        var a = seenArray || [];
        a.push(hash);
        while (a.length > SEEN_CAP) { a.shift(); }
        return a;
    }

    var api = {
        LEVELS: LEVELS, SEEN_CAP: SEEN_CAP,
        generate: generate, countSolutions: countSolutions,
        clearLine: clearLine, crosses: crosses, key: key, hashOf: hashOf,
        isSeen: isSeen, appendSeen: appendSeen
    };

    env.PBEngine = api;
    if (typeof module === 'object' && module.exports) { module.exports = api; }

})(typeof window === 'object' ? window : global);
