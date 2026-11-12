// One model playing the machine, checked step by step against the real one. `ask(messages)` is the model call
// (a string reply or a thrown error), so these rules run without a network.
import { diff, parseInstruction, parseState, stepMessages } from "./machine.js";

/**
 * Asks the model for the state after `instruction` run in `given`, and checks it against `truth`.
 * Returns {instruction, given, truth, answer, wrong, error?}: `wrong` lists the fields that differ.
 */
export async function askStep(ask, given, instruction, truth) {
    const step = { instruction, given, truth, answer: null, wrong: [] };
    try {
        step.reply = await ask(stepMessages(given, instruction));
    } catch (error) {
        if (error.name === "AbortError") throw error;
        step.error = error;
        step.wrong = diff(truth, null);
        return step;
    }
    step.answer = parseState(step.reply);
    step.wrong = diff(truth, step.answer);
    return step;
}

/** Teacher forcing: every step is asked from the true state before it, so mistakes cannot pile up. */
export const forcedStep = (ask, trace, i) => askStep(ask, trace[i].before, trace[i].instruction, trace[i].after);

/**
 * Free running: the model's own answer is the state of the next step, and the instruction is whatever its pc
 * points at. Stops at HALT, at an answer it cannot use, or when the true run has ended. Returns the steps taken.
 */
export async function freeRun(ask, program, trace) {
    const steps = [];
    let given = trace[0].before;
    while (steps.length < trace.length) {
        const instruction = program[given.pc];
        if (instruction === undefined) break;
        const step = await askStep(ask, given, instruction, trace[steps.length].after);
        steps.push(step);
        if (!step.answer || parseInstruction(instruction).op === "HALT") break;
        given = step.answer;
    }
    return steps;
}

/**
 * How far a run got. `survived` counts the steps right from the start before the first slip; `slip` says how it
 * slipped: "wrong" (a different state), "unparsable" (no state in the reply), "failed" (the request failed),
 * "stopped" (free running ended early), or null when every step was right.
 */
export function score(steps, total) {
    let survived = 0;
    while (survived < steps.length && steps[survived].wrong.length === 0) survived++;
    const first = steps[survived];
    let slip = null;
    if (survived < total) {
        if (!first) slip = "stopped";
        else if (first.error) slip = "failed";
        else if (!first.answer) slip = "unparsable";
        else slip = "wrong";
    }
    const correct = steps.filter((s) => s.wrong.length === 0).length;
    return { survived, total, slip, correct, answered: steps.length };
}

/** One row per model from its runs ({model, program, steps, total}): steps survived, perfect programs, accuracy. */
export function summarize(runs) {
    const models = [...new Set(runs.map((r) => r.model))];
    return models
        .map((model) => {
            const mine = runs.filter((r) => r.model === model).map((r) => ({ ...r, ...score(r.steps, r.total) }));
            const total = mine.reduce((s, r) => s + r.total, 0);
            const survived = mine.reduce((s, r) => s + r.survived, 0);
            const correct = mine.reduce((s, r) => s + r.correct, 0);
            const answered = mine.reduce((s, r) => s + r.answered, 0);
            return {
                model,
                runs: mine,
                survived,
                total,
                perfect: mine.filter((r) => r.survived === r.total).length,
                programs: mine.length,
                accuracy: answered ? correct / answered : null,
            };
        })
        .sort((a, b) => b.survived / b.total - a.survived / a.total || b.perfect - a.perfect);
}
