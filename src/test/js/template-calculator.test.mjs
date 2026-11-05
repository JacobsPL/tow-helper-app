import test from "node:test";
import assert from "node:assert/strict";
import {createFormation, classifyBase, calculateHits} from "../../main/resources/public/template-calculator.mjs";

const settings = {files: 5, ranks: 5, alive: 25, baseWidth: 25, baseDepth: 25};
const centered = (inches) => ({x: 62.5, y: 62.5, radius: inches * 25.4 / 2});

test("true 3-inch and 5-inch templates cover a centered 5 by 5 unit", () => {
    const formation = createFormation(settings);
    const small = calculateHits(formation, centered(3));
    assert.equal(small.full, 1);
    assert.equal(small.partial, 12);
    assert.equal(small.total, 13);
    const large = calculateHits(formation, centered(5));
    assert.equal(large.full, 9);
    assert.equal(large.partial, 16);
    assert.equal(large.total, 25);
});

test("three casualties in the last rank are marked and excluded from both template sizes", () => {
    const formation = createFormation({...settings, alive: 22});
    assert.deepEqual(formation.map((base, index) => !base.alive ? index : -1).filter((index) => index >= 0), [22, 23, 24]);
    const small = calculateHits(formation, centered(3));
    assert.equal(small.removed, 3);
    assert.equal(small.full, 1);
    assert.equal(small.partial, 11);
    const large = calculateHits(formation, centered(5));
    assert.equal(large.full, 9);
    assert.equal(large.partial, 13);
    assert.equal(large.total, 22);
});

test("casualties can be placed on either flank of an incomplete rear rank", () => {
    const right = createFormation({...settings, alive: 22, missingFrom: "right"});
    const left = createFormation({...settings, alive: 22, missingFrom: "left"});
    const circle = {x: 5, y: 120, radius: 10};
    assert.equal(calculateHits(right, circle).total, 1);
    assert.equal(calculateHits(left, circle).total, 0);
    assert.equal(left.filter((base) => base.alive).length, 22);
});

test("empty trailing ranks and a completely destroyed unit never score hits", () => {
    for (const alive of [0, 1, 5, 6, 10]) {
        const result = calculateHits(createFormation({...settings, alive}), {x: 62.5, y: 62.5, radius: 500});
        assert.equal(result.full, alive);
        assert.equal(result.partial, 0);
        assert.equal(result.removed, 25 - alive);
    }
});

test("a scattered template can miss the whole unit", () => {
    const result = calculateHits(createFormation(settings), {x: -100, y: -100, radius: 38.1});
    assert.equal(result.total, 0);
    assert.equal(result.miss, 25);
});

test("intersection detects circles inside large rectangular bases and across edges", () => {
    const base = {x: 0, y: 0, width: 50, height: 100, alive: true};
    assert.equal(classifyBase(base, {x: 25, y: 50, radius: 5}), "partial");
    assert.equal(classifyBase(base, {x: 25, y: -1, radius: 2}), "partial");
    assert.equal(classifyBase(base, {x: 25, y: 50, radius: 60}), "full");
});

test("external tangency has no covered area; internal corner tangency is full coverage", () => {
    const base = {x: 0, y: 0, width: 20, height: 20, alive: true};
    assert.equal(classifyBase(base, {x: -10, y: 10, radius: 10}), "miss");
    assert.equal(classifyBase(base, {x: 10, y: 10, radius: Math.sqrt(200)}), "full");
});

test("rectangular formations keep front ranks full and conserve every living model", () => {
    for (const files of [1, 3, 6]) {
        for (const alive of [0, 1, files, files * 4 - 1, files * 4]) {
            const formation = createFormation({files, ranks: 4, alive, baseWidth: 30, baseDepth: 60});
            assert.equal(formation.filter((base) => base.alive).length, alive);
            for (const template of [3, 5]) {
                const result = calculateHits(formation, {x: 45, y: 90, radius: template * 25.4 / 2});
                assert.equal(result.full + result.partial + result.miss, alive);
                assert.equal(result.total + result.miss + result.removed, files * 4);
            }
        }
    }
});

test("invalid model counts and dimensions are rejected", () => {
    for (const override of [{alive: -1}, {alive: 26}, {files: 0}, {ranks: 1.5}, {baseWidth: 0}, {baseDepth: NaN}]) {
        assert.throws(() => createFormation({...settings, ...override}), RangeError);
    }
});
