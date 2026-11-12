// Small page helpers shared by the app's scripts: elements, the notice bar, sign-in buttons,
// model check boxes and a concurrency-limited runner.
import { getSession } from "./pollen.js";

export const $ = (selector) => document.querySelector(selector);

export function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

export function notice(message, kind = "info") {
    const box = $("#notice");
    box.hidden = !message;
    box.className = `notice ${kind === "error" ? "error" : ""}`;
    box.textContent = message ?? "";
}

export function renderSession() {
    const session = getSession();
    $("#whoami").hidden = !session;
    $("#sign-out").hidden = !session;
    $("#sign-in").hidden = Boolean(session);
}

export const SIGN_IN_PROBLEMS = {
    denied: "Sign-in was cancelled.",
    "bad-state": "That sign-in did not match this page. Try again.",
    "bad-key": "The sign-in returned something unexpected. Try again.",
    "no-storage": "This browser blocks the storage the sign-in needs.",
};

/** Check boxes for models in `box`; `preset` names are ticked and listed first. */
export function renderModels(box, models, preset, onChange) {
    box.replaceChildren();
    const presets = new Set(preset);
    const sorted = [...models].sort((a, b) => presets.has(b.name) - presets.has(a.name));
    for (const model of sorted) {
        const label = el("label");
        const input = Object.assign(document.createElement("input"), {
            type: "checkbox",
            value: model.name,
            checked: presets.has(model.name),
            onchange: onChange,
        });
        const out = model.pricing.completionTextTokens;
        const rate = Number(out ?? model.pricing.promptTextTokens ?? 0) * 1e6;
        const price = `$${rate.toFixed(2)}/M ${out === undefined ? "in" : "out"}${model.paidOnly ? " · paid" : ""}`;
        label.append(input, el("span", "", model.name), el("span", "price", price));
        box.append(label);
    }
}

export const checked = (box) => [...box.querySelectorAll("input:checked")].map((input) => input.value);

/** Runs `worker(item)` over `items`, `limit` at a time, until done or `signal` aborts. */
export async function pool(items, limit, worker, signal) {
    let next = 0;
    const lanes = Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (next < items.length && !signal?.aborted) await worker(items[next++]);
    });
    await Promise.all(lanes);
}

export const money = (pollen) => (pollen < 0.001 ? "under 0.001" : pollen.toFixed(3));
