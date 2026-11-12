// The live text model list: public, no key needed.
const LIST = "https://gen.pollinations.ai/text/models";

/** Text models with their prices, cheapest first. `vision` marks the ones that can look at a picture. */
export async function loadModels() {
    const res = await fetch(LIST);
    if (!res.ok) throw new Error(`The model list answered ${res.status}.`);
    const body = await res.json();
    return (body.data ?? body)
        .filter((model) => model.output_modalities?.includes("text") && !model.pricing?.promptTextTokens === false)
        .map((model) => ({
            name: model.name,
            title: model.title ?? model.name,
            pricing: model.pricing,
            vision: Boolean(model.input_modalities?.includes("image")),
            paidOnly: Boolean(model.paid_only),
        }))
        .sort((a, b) => Number(a.pricing.completionTextTokens) - Number(b.pricing.completionTextTokens));
}
