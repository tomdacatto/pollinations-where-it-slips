import assert from "node:assert/strict";
import test from "node:test";
import { PROGRAMS, run, step } from "./machine.js";
import { forcedStep, freeRun, score, summarize } from "./trial.js";

const code = PROGRAMS.find((p) => p.id === "sum").code;
const trace = run(code);

// A model that is the machine, for a perfect run; `flaw(n, after)` lets it change its n-th answer.
function fake(flaw = (_n, after) => after) {
    let calls = 0;
    return async (messages) => {
        const text = messages[0].content;
        const state = JSON.parse(text.match(/State now: (.*)/)[1]);
        const instruction = text.match(/Instruction at pc: (.*)/)[1];
        const after = flaw(calls++, step(state, instruction));
        if (after === "words") return "I think it is fine.";
        if (after === "fail") throw new Error("503");
        return JSON.stringify(after);
    };
}

test("a perfect model survives every step in both modes", async () => {
    const ask = fake();
    const forced = [];
    for (let i = 0; i < trace.length; i++) forced.push(await forcedStep(ask, trace, i));
    assert.deepEqual(score(forced, trace.length), {
        survived: trace.length,
        total: trace.length,
        slip: null,
        correct: trace.length,
        answered: trace.length,
    });
    const free = await freeRun(ask, code, trace);
    assert.equal(free.length, trace.length);
    assert.equal(score(free, trace.length).slip, null);
});

test("forced: one wrong step costs one step; the others stay right", async () => {
    const ask = fake((n, after) => (n === 3 ? { ...after, B: after.B + 1 } : after));
    const steps = [];
    for (let i = 0; i < trace.length; i++) steps.push(await forcedStep(ask, trace, i));
    const result = score(steps, trace.length);
    assert.equal(result.survived, 3);
    assert.equal(result.slip, "wrong");
    assert.equal(result.correct, trace.length - 1);
    assert.deepEqual(steps[3].wrong, ["B"]);
});

test("free running: the model's own pc picks the next instruction, so a slip carries on", async () => {
    const ask = fake((n, after) => (n === 3 ? { ...after, pc: 2 } : after));
    const steps = await freeRun(ask, code, trace);
    const result = score(steps, trace.length);
    assert.equal(result.survived, 3);
    assert.equal(result.slip, "wrong");
    assert.ok(steps[3].wrong.includes("pc"));
    assert.equal(steps[4].instruction, "ADD B,A");
});

test("unparsable replies and failed requests are separate kinds of slip", async () => {
    const unparsable = await freeRun(
        fake((n, after) => (n === 2 ? "words" : after)),
        code,
        trace,
    );
    assert.equal(score(unparsable, trace.length).slip, "unparsable");
    assert.equal(score(unparsable, trace.length).survived, 2);
    const failed = await freeRun(
        fake((n, after) => (n === 1 ? "fail" : after)),
        code,
        trace,
    );
    assert.equal(score(failed, trace.length).slip, "failed");
    assert.equal(failed.length, 2);
});

test("a free run that is cut short reports stopped", () => {
    assert.equal(score([], 5).slip, "stopped");
    assert.equal(score([], 5).survived, 0);
});

test("summarize ranks models by the share of steps survived", () => {
    const right = { wrong: [], answer: {}, instruction: "x" };
    const wrong = { wrong: ["A"], answer: {}, instruction: "x" };
    const rows = summarize([
        { model: "weak", program: "p", steps: [right, wrong, wrong], total: 3 },
        { model: "strong", program: "p", steps: [right, right, right], total: 3 },
        { model: "strong", program: "q", steps: [right, wrong], total: 2 },
        { model: "weak", program: "q", steps: [right, right], total: 2 },
    ]);
    assert.deepEqual(
        rows.map((r) => [r.model, r.survived, r.total, r.perfect]),
        [
            ["strong", 4, 5, 1],
            ["weak", 3, 5, 1],
        ],
    );
    assert.equal(rows[0].accuracy, 4 / 5);
});
