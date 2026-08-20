/* PaperBridges engine tests: geometry, solver, generation. */
'use strict';
require('../js/engine.js');
var E = global.PBEngine;

var fail = 0;
function assert(ok, msg) { if (!ok) { console.log('FAIL: ' + msg); fail++; } }

// 1. clearLine / crosses geometry
var A = { x: 0, y: 0 }, B = { x: 3, y: 0 }, C = { x: 1, y: -2 }, D = { x: 1, y: 2 };
assert(E.clearLine(A, B, [A, B]) === true, 'aligned pair clear');
assert(E.clearLine(A, C, [A, C]) === false, 'diagonal not aligned');
assert(E.crosses(A, B, C, D) === true, 'cross detected');
assert(E.crosses(A, B, { x: 5, y: -2 }, { x: 5, y: 2 }) === false, 'no cross outside span');

// 2. tiny known puzzle: 2 islands, each n=1 -> exactly 1 solution
var p2 = [{ x: 0, y: 0, n: 1 }, { x: 2, y: 0, n: 1 }];
assert(E.countSolutions(p2, 2) === 1, 'pair n=1 unique');
var p3 = [{ x: 0, y: 0, n: 2 }, { x: 2, y: 0, n: 2 }];
assert(E.countSolutions(p3, 2) === 1, 'pair n=2 unique (double bridge)');
var p4 = [{ x: 0, y: 0, n: 1 }, { x: 2, y: 0, n: 2 }];
assert(E.countSolutions(p4, 2) === 0, 'mismatched degrees unsolvable');
// disconnected-by-degrees: 3 islands middle n=1 others n=1 -> 0 solutions
var p5 = [{ x: 0, y: 0, n: 1 }, { x: 2, y: 0, n: 1 }, { x: 4, y: 0, n: 1 }];
assert(E.countSolutions(p5, 2) === 0, 'chain 1-1-1 disconnected');

// 3. generation: 15 per level — valid, unique, connected, degrees, distinct
var lvl, k, hashes = {}, p, i, worst = 0, t0;
for (lvl = 1; lvl <= 4; lvl++) {
    for (k = 0; k < 15; k++) {
        t0 = Date.now();
        p = E.generate(lvl);
        var dt = Date.now() - t0;
        if (dt > worst) worst = dt;

        assert(p !== null, 'L' + lvl + ' #' + k + ' generated');
        if (!p) continue;
        assert(p.islands.length === E.LEVELS[lvl].isl, 'L' + lvl + ' island count');
        for (i = 0; i < p.islands.length; i++) {
            var n = p.islands[i].n;
            assert(n >= 1 && n <= 8, 'L' + lvl + ' island degree in 1..8, got ' + n);
        }
        // solution satisfies every degree
        var degs = [];
        for (i = 0; i < p.islands.length; i++) { degs[i] = 0; }
        var kk;
        for (kk in p.solution) {
            if (p.solution.hasOwnProperty(kk)) {
                var ends = kk.split('-');
                var ia = null, ib = null, j2;
                for (j2 = 0; j2 < p.islands.length; j2++) {
                    var xy = p.islands[j2].x + ',' + p.islands[j2].y;
                    if (ends[0] === xy) { ia = j2; }
                    if (ends[1] === xy) { ib = j2; }
                }
                degs[ia] += p.solution[kk];
                degs[ib] += p.solution[kk];
            }
        }
        for (i = 0; i < p.islands.length; i++) {
            assert(degs[i] === p.islands[i].n, 'L' + lvl + ' solution meets degree ' + i);
        }
        assert(E.countSolutions(p.islands, 2) === 1, 'L' + lvl + ' #' + k + ' unique');
        assert(!hashes[p.hash], 'hash distinct L' + lvl + ' #' + k);
        hashes[p.hash] = true;
    }
}
console.log('60 puzzles generated; worst ' + worst + 'ms');
assert(worst < 400, 'generation under 400ms, worst ' + worst + 'ms');

// 4. hash + seen list
assert(E.hashOf('1000') !== E.hashOf('0001'), 'hash sensitive');
var seen = [];
for (i = 0; i < 510; i++) { seen = E.appendSeen('h' + i, seen); }
assert(seen.length === E.SEEN_CAP, 'seen cap');
assert(seen[0] === 'h10', 'FIFO eviction');

console.log('bridges engine tests: ' + (fail ? fail + ' FAILURES' : 'all OK'));
process.exit(fail ? 1 : 0);
