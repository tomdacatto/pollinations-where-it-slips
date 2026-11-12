import assert from "node:assert/strict";
import test from "node:test";
import {
    cells,
    diff,
    FIELDS,
    PROGRAMS,
    parseInstruction,
    parseState,
    run,
    startState,
    stateText,
    step,
    stepMessages,
} from "./machine.js";

const last = (program) => run(program).at(-1).after;

test("each instruction does what its rule says, and leaves its input alone", () => {
    const s = { ...startState(), A: 5, B: 3 };
    assert.deepEqual(step(s, "ADD A,B"), { ...s, A: 8, pc: 1, Z: 0 });
    assert.deepEqual(step(s, "SUB B,A"), { ...s, B: 254, pc: 1, Z: 0 });
    assert.deepEqual(step(s, "MOV C,A"), { ...s, C: 5, pc: 1 });
    assert.deepEqual(step(s, "LOAD D,200"), { ...s, D: 200, pc: 1 });
    assert.equal(step(s, "INC A").A, 6);
    assert.equal(step(s, "DEC A").A, 4);
    assert.deepEqual(step(s, "STORE A,3").M, [0, 0, 0, 5, 0, 0, 0, 0]);
    assert.equal(step({ ...s, M: [0, 9, 0, 0, 0, 0, 0, 0] }, "LOADM C,1").C, 9);
    assert.equal(step(s, "HALT").pc, 0);
    assert.equal(s.A, 5);
    assert.equal(s.pc, 0);
});

test("the zero flag is set by arithmetic only, and JNZ reads it", () => {
    const s = { ...startState(), A: 1 };
    const zero = step(s, "DEC A");
    assert.equal(zero.Z, 1);
    assert.equal(step(zero, "LOAD B,7").Z, 1);
    assert.equal(step(zero, "MOV B,A").Z, 1);
    assert.equal(step(zero, "INC A").Z, 0);
    assert.equal(step({ ...zero, pc: 4 }, "JNZ 1").pc, 5);
    assert.equal(step({ ...zero, Z: 0, pc: 4 }, "JNZ 1").pc, 1);
});

test("values wrap between 0 and 255", () => {
    const s = { ...startState(), A: 255, B: 1 };
    assert.deepEqual([step(s, "ADD A,B").A, step(s, "ADD A,B").Z], [0, 1]);
    assert.equal(step({ ...s, A: 0 }, "DEC A").A, 255);
    assert.throws(() => step(s, "LOAD A,300"), /Bad number/);
});

test("instructions that are not in the set are refused", () => {
    assert.throws(() => parseInstruction("JMP 3"), /Unknown/);
    assert.throws(() => parseInstruction("ADD A"), /operands/);
    assert.throws(() => parseInstruction("ADD A,E"), /register/);
    assert.throws(() => parseInstruction("STORE A,8"), /Bad number/);
    assert.deepEqual(parseInstruction("ADD  B , A").args, ["B", "A"]);
});

test("the offered programs end in HALT and compute what they say", () => {
    for (const p of PROGRAMS) assert.equal(p.code.at(-1), "HALT", p.id);
    const by = Object.fromEntries(PROGRAMS.map((p) => [p.id, p.code]));
    assert.equal(last(by.countdown).A, 0);
    assert.equal(run(by.countdown).length, 10);
    assert.equal(last(by.sum).M[0], 10);
    assert.equal(last(by.multiply).M[0], 12);
    const fib = last(by.fibonacci);
    assert.deepEqual([fib.A, fib.B, fib.M[0]], [3, 5, 3]);
    assert.deepEqual(last(by.memory).M.slice(2, 4), [7, 14]);
    const doubling = run(by.doubling);
    assert.equal(doubling.length, 30);
    assert.deepEqual([doubling.at(-1).after.A, doubling.at(-1).after.D], [0, 0]);
    assert.equal(doubling[2 + 3 * 7].after.A, 0);
    const wrap = run(by.wrap);
    assert.equal(wrap[2].after.A, 255);
    assert.equal(wrap[3].after.A, 254);
    assert.equal(wrap.at(-1).after.Z, 1);
});

test("a run records every step and stops at HALT, which keeps pc", () => {
    const trace = run(["LOAD A,1", "HALT"]);
    assert.equal(trace.length, 2);
    assert.equal(trace[1].after.pc, 1);
    assert.equal(trace[1].instruction, "HALT");
});

test("diff names the cells that differ, and a missing answer differs everywhere", () => {
    const truth = { ...startState(), A: 4, M: [0, 0, 7, 0, 0, 0, 0, 0] };
    assert.deepEqual(diff(truth, truth), []);
    assert.deepEqual(diff(truth, { ...truth, A: 5, M: [0, 0, 7, 1, 0, 0, 0, 0] }), ["A", "M3"]);
    assert.deepEqual(diff(truth, null), FIELDS);
    assert.equal(cells(truth).M2, 7);
});

test("a state is read from the last complete JSON object in a reply, and nothing else counts", () => {
    const good = '{"pc":1,"A":2,"B":3,"C":4,"D":5,"Z":0,"M":[0,0,0,0,0,0,0,9]}';
    assert.equal(parseState(good).M[7], 9);
    assert.equal(parseState(`Sure:\n\`\`\`json\n${good}\n\`\`\``).A, 2);
    assert.equal(parseState(`{"pc":9} then ${good}`).pc, 1);
    assert.equal(parseState('{"pc":1,"A":2}'), null);
    assert.equal(parseState('{"pc":1,"A":2,"B":3,"C":4,"D":5,"Z":0,"M":[0,0]}'), null);
    assert.equal(parseState('{"pc":-1,"A":2,"B":3,"C":4,"D":5,"Z":0,"M":[0,0,0,0,0,0,0,0]}'), null);
    assert.equal(parseState('{"pc":"1","A":2,"B":3,"C":4,"D":5,"Z":0,"M":[0,0,0,0,0,0,0,0]}'), null);
    assert.equal(parseState("no json here"), null);
    assert.equal(parseState(undefined), null);
});

test("the step prompt names the state, the instruction and every rule", () => {
    const content = stepMessages({ ...startState(), A: 3 }, "ADD A,B")[0].content;
    assert.ok(content.includes('"A":3'));
    assert.ok(content.includes("Instruction at pc: ADD A,B"));
    for (const op of ["LOAD", "MOV", "ADD", "SUB", "INC", "DEC", "LOADM", "STORE", "JNZ", "HALT"])
        assert.ok(content.includes(`- ${op}`), op);
    assert.equal(stateText(startState()), "pc=0 A=0 B=0 C=0 D=0 Z=0 M=[0,0,0,0,0,0,0,0]");
});
