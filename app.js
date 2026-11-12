import { CONCURRENCY, DEFAULT_MODELS, DEFAULT_PROGRAMS } from "./config.js";
import { cells, FIELDS, PROGRAMS, RULES, startState, stepMessages, run as trueRun } from "./machine.js";
import { loadModels } from "./models.js";
import { chat, clearSession, completeSignIn, getSession, startSignIn } from "./pollen.js";
import { forcedStep, freeRun, score, summarize } from "./trial.js";
import { $, checked, el, money, notice, pool, renderModels, renderSession, SIGN_IN_PROBLEMS } from "./ui.js";

const state = { models: [], runs: new Map(), controller: null, shown: null };
const seed = () => Math.floor(Math.random() * 1e9);
const short = (name) => name.split("/").pop();
const key = (model, program) => `${model}\u0000${program}`;
const chosenPrograms = () => PROGRAMS.filter((p) => $(`#program-${p.id}`)?.checked);

const MODE_NOTES = {
    forced: "Every step is asked from the true state before it, so one mistake costs one step. This measures how well a model does a single step.",
    free: "The model's own answer is the state of the next step, and its own pc decides which instruction it is shown. One slip carries on into everything after it, as it would in a real run.",
};

function estimate() {
    const names = checked($("#models"));
    const programs = chosenPrograms();
    const steps = programs.reduce((sum, p) => sum + trueRun(p.code).length, 0);
    const cost = names.reduce((sum, name) => {
        const model = state.models.find((m) => m.name === name);
        const price = (key) => Number(model?.pricing?.[key] ?? 0);
        return sum + steps * (340 * price("promptTextTokens") + 70 * price("completionTextTokens"));
    }, 0);
    $("#mode-note").textContent = MODE_NOTES[$("#mode").value];
    $("#estimate").textContent =
        names.length && programs.length
            ? `${names.length * steps} requests (${steps} steps for each of ${names.length} models): about ${money(cost)} Pollen (a rough estimate; models that think out loud cost more).`
            : "Pick at least one model and one program.";
}

function renderMachine() {
    for (const rule of RULES) $("#rules").append(el("li", "", rule));
    for (const program of PROGRAMS) {
        const box = el("div", "program");
        const label = el("label", "check");
        const input = Object.assign(document.createElement("input"), {
            type: "checkbox",
            id: `program-${program.id}`,
            checked: DEFAULT_PROGRAMS.includes(program.id),
            onchange: estimate,
        });
        label.append(
            input,
            el("strong", "", program.title),
            el("span", "fine", ` ${trueRun(program.code).length} steps`),
        );
        box.append(label, el("div", "fine", program.about));
        box.append(el("pre", "code", program.code.map((line, i) => `${i}: ${line}`).join("\n")));
        $("#programs").append(box);
    }
    $("#prompt").textContent = stepMessages(startState(), PROGRAMS[0].code[0])[0].content;
}

/** The cells of a state as small boxes; the ones named in `wrong` are marked. */
function stateBoxes(s, wrong = []) {
    const row = el("div", "cells");
    if (!s) {
        row.append(el("span", "cell missing", "no usable state in the reply"));
        return row;
    }
    const values = cells(s);
    for (const field of FIELDS) {
        const box = el("span", `cell${wrong.includes(field) ? " off" : ""}`);
        box.append(el("i", "", field), String(values[field]));
        row.append(box);
    }
    return row;
}

function cellFor(run) {
    const { survived, total } = score(run.steps, run.total);
    const td = el("td", `slip-cell ${survived === total ? "ok" : survived === 0 ? "bad" : "mid"}`);
    const button = el("button", "linkish", `${survived}/${total}`);
    button.type = "button";
    button.onclick = () => showDetail(run.model, run.program);
    td.append(button);
    return td;
}

function renderSummary() {
    const rows = summarize([...state.runs.values()]);
    $("#summary").hidden = !rows.length;
    const table = $("#table");
    table.replaceChildren();
    const programs = chosenPrograms().filter((p) => rows.some((r) => r.runs.some((run) => run.program === p.id)));
    const head = el("tr");
    for (const title of ["Model", "Survived", "Perfect", "Right per step", ...programs.map((p) => p.title)])
        head.append(el("th", "", title));
    table.append(head);
    for (const row of rows) {
        const tr = el("tr");
        tr.append(
            el("td", "", row.model),
            el("td", "", `${row.survived} of ${row.total} (${Math.round((100 * row.survived) / row.total)}%)`),
            el("td", "", `${row.perfect} of ${row.programs}`),
            el("td", "", row.accuracy === null ? "" : `${Math.round(100 * row.accuracy)}%`),
        );
        for (const program of programs) {
            const run = row.runs.find((r) => r.program === program.id);
            tr.append(run ? cellFor(run) : el("td"));
        }
        table.append(tr);
    }
}

const SLIPS = {
    wrong: "answered a different state",
    unparsable: "did not reply with a usable state",
    failed: "the request failed",
    stopped: "the run stopped before the end",
};

function showDetail(model, programId) {
    state.shown = { model, programId };
    const run = state.runs.get(key(model, programId));
    if (!run) return;
    const program = PROGRAMS.find((p) => p.id === programId);
    const { survived, total, slip } = score(run.steps, run.total);
    $("#detail").hidden = false;
    $("#detail-title").textContent = `${short(model)} on "${program.title}"`;
    const first = run.steps[survived];
    $("#detail-lead").textContent = slip
        ? `Right for ${survived} of ${total} steps, then slipped at step ${survived + 1}${first ? ` (${first.instruction})` : ""}: ${SLIPS[slip]}${first?.error ? ` (${first.error.message})` : ""}. ${
              first?.wrong.length && first.answer ? `Wrong cells: ${first.wrong.join(", ")}.` : ""
          }`
        : `Right at all ${total} steps.`;
    const table = $("#steps");
    table.replaceChildren();
    const head = el("tr");
    for (const title of ["Step", "Instruction", "State it was given", "Real machine after", "The model's answer"])
        head.append(el("th", "", title));
    table.append(head);
    run.steps.forEach((step, i) => {
        const tr = el("tr", step.wrong.length ? "slipped" : "");
        const truth = el("td");
        truth.append(stateBoxes(step.truth));
        const answer = el("td");
        answer.append(stateBoxes(step.answer, step.wrong));
        const given = el("td");
        given.append(stateBoxes(step.given));
        tr.append(el("td", "", String(i + 1)), el("td", "mono", step.instruction), given, truth, answer);
        table.append(tr);
    });
    $("#detail").scrollIntoView({ block: "nearest" });
}

/** A model call for one model, with the rules for failures: only a real out-of-Pollen or sign-in problem stops the run. */
function askFor(model, signal, blocked, fatal) {
    const paidOnly = state.models.find((m) => m.name === model)?.paidOnly;
    return async (messages) => {
        if (blocked.has(model)) throw blocked.get(model);
        try {
            return await chat(model, messages, { signal, seed: seed(), temperature: 0 });
        } catch (error) {
            if (signal.aborted) throw Object.assign(new Error("stopped"), { name: "AbortError" });
            if (error.status === 402 && paidOnly) {
                // This model needs paid Pollen: skip it, and let the others carry on.
                blocked.set(model, error);
            } else if (error.status === 401 || error.status === 402) {
                fatal.error = error;
                state.controller.abort();
            }
            throw error;
        }
    };
}

async function run() {
    if (!getSession()) return startSignIn();
    const names = checked($("#models"));
    const programs = chosenPrograms();
    if (!names.length || !programs.length) return notice("Pick at least one model and one program.", "error");
    const mode = $("#mode").value;
    state.runs = new Map();
    state.shown = null;
    $("#detail").hidden = true;
    notice(null);
    state.controller = new AbortController();
    const { signal } = state.controller;
    const blocked = new Map();
    const fatal = {};
    $("#run").disabled = true;
    $("#stop").hidden = false;

    const traces = new Map(programs.map((p) => [p.id, trueRun(p.code)]));
    const jobs = [];
    for (const model of names) {
        for (const program of programs) {
            const trace = traces.get(program.id);
            const record = { model, program: program.id, total: trace.length, steps: [], byIndex: [] };
            state.runs.set(key(model, program.id), record);
            if (mode === "free") jobs.push({ record, program, trace });
            else for (let i = 0; i < trace.length; i++) jobs.push({ record, program, trace, i });
        }
    }
    let done = 0;
    const totalSteps = jobs.length;
    const progress = () =>
        ($("#progress").textContent =
            mode === "free" ? `${done} of ${totalSteps} runs done` : `${done} of ${totalSteps} steps done`);
    progress();
    const refresh = () => {
        renderSummary();
        if (state.shown) showDetail(state.shown.model, state.shown.programId);
    };
    await pool(
        jobs,
        CONCURRENCY,
        async (job) => {
            const ask = askFor(job.record.model, signal, blocked, fatal);
            try {
                if (mode === "free") job.record.steps = await freeRun(ask, job.program.code, job.trace);
                else {
                    job.record.byIndex[job.i] = await forcedStep(ask, job.trace, job.i);
                    job.record.steps = job.record.byIndex.filter(Boolean);
                }
            } catch (error) {
                if (error.name !== "AbortError") throw error;
                return;
            }
            done++;
            progress();
            refresh();
        },
        signal,
    );
    $("#run").disabled = false;
    $("#stop").hidden = true;
    refresh();
    const problems = [];
    if (fatal.error) problems.push(fatal.error.message);
    for (const [model, error] of blocked)
        problems.push(`${short(model)} needs paid Pollen and was skipped (${error.message})`);
    const failed = [...state.runs.values()]
        .flatMap((r) => r.steps)
        .filter((s) => s.error && s.error.status !== 402).length;
    if (failed) problems.push(`${failed} requests failed for other reasons and count as slips ("the request failed").`);
    if (problems.length) notice(problems.join(" "), "error");
    renderSession();
}

// Start.
$("#sign-in").onclick = () => startSignIn();
$("#sign-out").onclick = () => {
    clearSession();
    renderSession();
};
$("#run").onclick = run;
$("#stop").onclick = () => state.controller?.abort();
$("#mode").onchange = estimate;
renderMachine();

const outcome = completeSignIn();
if (outcome && outcome !== "ok") notice(SIGN_IN_PROBLEMS[outcome], "error");
renderSession();
loadModels()
    .then((models) => {
        state.models = models;
        renderModels($("#models"), models, DEFAULT_MODELS, estimate);
        estimate();
    })
    .catch((error) => notice(`Could not load the model list: ${error.message}`, "error"));
