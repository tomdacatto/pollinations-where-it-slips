// A tiny real computer, written in plain code: the ground truth a model is checked against.
// 4 registers (A-D), 8 memory cells, a program counter and a zero flag. Every value is 0 to 255 and wraps.
// No DOM and no network, so it can be tested alone.

export const REGISTERS = ["A", "B", "C", "D"];
export const MEMORY_SIZE = 8;
export const FIELDS = ["pc", ...REGISTERS, "Z", ...Array.from({ length: MEMORY_SIZE }, (_, i) => `M${i}`)];

/** The state a machine starts in. */
export const startState = () => ({ pc: 0, A: 0, B: 0, C: 0, D: 0, Z: 0, M: Array(MEMORY_SIZE).fill(0) });

const wrap = (n) => ((n % 256) + 256) % 256;

/** Instruction table: how many operands, what each does. `run` gets the state (already copied) and the operands. */
const OPS = {
    LOAD: { args: ["reg", "num"], run: (s, [r, n]) => next(put(s, r, wrap(n))) },
    MOV: { args: ["reg", "reg"], run: (s, [r, t]) => next(put(s, r, s[t])) },
    ADD: { args: ["reg", "reg"], run: (s, [r, t]) => alu(s, r, s[r] + s[t]) },
    SUB: { args: ["reg", "reg"], run: (s, [r, t]) => alu(s, r, s[r] - s[t]) },
    INC: { args: ["reg"], run: (s, [r]) => alu(s, r, s[r] + 1) },
    DEC: { args: ["reg"], run: (s, [r]) => alu(s, r, s[r] - 1) },
    LOADM: { args: ["reg", "addr"], run: (s, [r, a]) => next(put(s, r, s.M[a])) },
    STORE: { args: ["reg", "addr"], run: (s, [r, a]) => next(putMem(s, a, s[r])) },
    JNZ: { args: ["num"], run: (s, [t]) => put(s, "pc", s.Z === 0 ? t : s.pc + 1) },
    HALT: { args: [], run: (s) => s },
};

function put(s, field, value) {
    s[field] = value;
    return s;
}

function putMem(s, address, value) {
    s.M[address] = value;
    return s;
}

function next(s) {
    s.pc += 1;
    return s;
}

// ADD, SUB, INC and DEC are the only instructions that set the zero flag.
function alu(s, reg, value) {
    s[reg] = wrap(value);
    s.Z = s[reg] === 0 ? 1 : 0;
    return next(s);
}

/** The instruction set, in words, for the model's prompt. One source for the emulator's rules. */
export const RULES = [
    "LOAD r,n: r = n",
    "MOV r,s: r = s",
    "ADD r,s: r = r + s",
    "SUB r,s: r = r - s",
    "INC r: r = r + 1",
    "DEC r: r = r - 1",
    "LOADM r,a: r = M[a]",
    "STORE r,a: M[a] = r",
    "JNZ t: if Z is 0, pc = t, otherwise pc = pc + 1",
    "HALT: nothing changes",
];

export const copyState = (s) => ({ ...s, M: [...s.M] });

/** "ADD B,A" -> {op, args, text}, or throws on anything that is not in the instruction set. */
export function parseInstruction(text) {
    const match = String(text)
        .trim()
        .match(/^([A-Z]+)\s*(.*)$/);
    const op = match && OPS[match[1]];
    if (!op) throw new Error(`Unknown instruction: ${text}`);
    const parts = match[2] ? match[2].split(",").map((p) => p.trim()) : [];
    if (parts.length !== op.args.length) throw new Error(`${match[1]} takes ${op.args.length} operands`);
    const args = parts.map((part, i) => {
        const kind = op.args[i];
        if (kind === "reg") {
            if (!REGISTERS.includes(part)) throw new Error(`Not a register: ${part}`);
            return part;
        }
        const n = Number(part);
        const limit = kind === "addr" ? MEMORY_SIZE - 1 : 255;
        if (!/^\d+$/.test(part) || n > limit) throw new Error(`Bad number: ${part}`);
        return n;
    });
    return { op: match[1], args, text: `${match[1]}${parts.length ? ` ${parts.join(",")}` : ""}` };
}

/** One step: the state after running `instruction` (text) in `state`. The input is not changed. */
export function step(state, instruction) {
    const { op, args } = parseInstruction(instruction);
    return OPS[op].run(copyState(state), args);
}

/** A program is a list of instruction texts. Runs it to HALT (or `limit` steps) and returns every step. */
export function run(program, limit = 200) {
    const trace = [];
    let state = startState();
    while (trace.length < limit) {
        const instruction = program[state.pc];
        if (instruction === undefined) break;
        const after = step(state, instruction);
        trace.push({ instruction, before: state, after });
        if (parseInstruction(instruction).op === "HALT") break;
        state = after;
    }
    return trace;
}

/** The programs the app offers. Each ends in HALT; the expected result is checked in the tests. */
export const PROGRAMS = [
    {
        id: "countdown",
        title: "Countdown",
        about: "Count 4 down to 0 with a loop.",
        code: ["LOAD A,4", "DEC A", "JNZ 1", "HALT"],
    },
    {
        id: "sum",
        title: "Sum",
        about: "Add 4+3+2+1 into B and store it.",
        code: ["LOAD A,4", "LOAD B,0", "ADD B,A", "DEC A", "JNZ 2", "STORE B,0", "HALT"],
    },
    {
        id: "multiply",
        title: "Multiply",
        about: "Multiply by adding 3 four times.",
        code: ["LOAD A,3", "LOAD B,4", "LOAD C,0", "ADD C,A", "DEC B", "JNZ 3", "STORE C,0", "HALT"],
    },
    {
        id: "fibonacci",
        title: "Fibonacci",
        about: "Four rounds of the Fibonacci step in registers A and B.",
        code: [
            "LOAD A,0",
            "LOAD B,1",
            "LOAD D,4",
            "MOV C,A",
            "ADD C,B",
            "MOV A,B",
            "MOV B,C",
            "DEC D",
            "JNZ 3",
            "STORE A,0",
            "HALT",
        ],
    },
    {
        id: "doubling",
        title: "Doubling",
        about: "Double A nine times, from 1: it wraps past 255 on the way, and the loop counter owns the zero flag.",
        code: ["LOAD A,1", "LOAD D,9", "ADD A,A", "DEC D", "JNZ 2", "HALT"],
    },
    {
        id: "memory",
        title: "Memory",
        about: "Store 7, read it back, double it, store it.",
        code: ["LOAD A,7", "STORE A,2", "LOADM B,2", "ADD B,B", "STORE B,3", "HALT"],
    },
    {
        id: "wrap",
        title: "Wrap",
        about: "1 minus 2 is 255, and 255 plus 255 is 254, with the zero flag set along the way.",
        code: ["LOAD A,1", "LOAD B,2", "SUB A,B", "ADD A,A", "LOAD C,0", "ADD C,C", "HALT"],
    },
];

/** The state as one line, for showing and for the prompt. */
export const stateText = (s) => `pc=${s.pc} A=${s.A} B=${s.B} C=${s.C} D=${s.D} Z=${s.Z} M=[${s.M.join(",")}]`;

/** Every cell of a state as {field: value}, for comparing and showing. */
export const cells = (s) =>
    Object.fromEntries(FIELDS.map((f) => [f, /^M\d$/.test(f) ? s.M[Number(f.slice(1))] : s[f]]));

/** The fields where `given` differs from `truth`. A missing answer differs everywhere. */
export function diff(truth, given) {
    if (!given) return [...FIELDS];
    const a = cells(truth);
    const b = cells(given);
    return FIELDS.filter((f) => a[f] !== b[f]);
}

/** The messages that ask a model to be the machine for one step. */
export function stepMessages(state, instruction) {
    const prompt = [
        "You are a tiny computer. Execute one instruction exactly.",
        "State: pc is the index of the next instruction; A, B, C and D are registers; Z is a flag; M is 8 memory cells M[0] to M[7].",
        "Every value is a whole number from 0 to 255 and wraps: 256 becomes 0 and 0 - 1 becomes 255.",
        "ADD, SUB, INC and DEC set Z to 1 when the result is 0 and to 0 otherwise. No other instruction changes Z.",
        "Every instruction except JNZ moves pc forward by 1 (HALT changes nothing, not even pc).",
        "",
        "Instructions:",
        ...RULES.map((rule) => `- ${rule}`),
        "",
        `State now: ${JSON.stringify(stateObject(state))}`,
        `Instruction at pc: ${instruction}`,
        "",
        'Reply with the state after the instruction as one JSON object with the same keys ("pc", "A", "B", "C", "D", "Z", "M"), and nothing else.',
    ].join("\n");
    return [{ role: "user", content: prompt }];
}

const stateObject = (s) => ({ pc: s.pc, A: s.A, B: s.B, C: s.C, D: s.D, Z: s.Z, M: s.M });

const isCount = (n) => Number.isInteger(n) && n >= 0;

/** Reads a state out of a model's reply, or null. The last JSON object in the reply that has every key counts. */
export function parseState(reply) {
    const objects = String(reply ?? "").match(/\{[^{}]*\}/g) ?? [];
    for (const text of objects.reverse()) {
        try {
            const s = JSON.parse(text);
            const numbers = ["pc", ...REGISTERS, "Z"].every((k) => isCount(s[k]));
            if (numbers && Array.isArray(s.M) && s.M.length === MEMORY_SIZE && s.M.every(isCount))
                return { pc: s.pc, A: s.A, B: s.B, C: s.C, D: s.D, Z: s.Z, M: [...s.M] };
        } catch {}
    }
    return null;
}
