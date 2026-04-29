// Recipe pattern templates — derived from Chef Jungstedt's recipe files.
// Slot acceptance uses the app's INGREDIENT_CATEGORIES strings so live
// ingredients from the user's own pantry feed the dropdowns.

export type RecipeCategoryId =
  | "ganache"
  | "caramel-ganache"
  | "nutganache"
  | "gianduja"
  | "crunchy"
  | "cookie-layer"
  | "caramel"
  | "fruit-gel"
  | "marshmallow";

export interface RecipeSlot {
  role: string;
  /** ingredient categories that satisfy this slot (must match `Ingredient.category`) */
  acceptCategories: string[];
  /** %-of-total band */
  min: number;
  max: number;
  required: boolean;
  hint: string;
}

export interface RecipeStep {
  stage: string;
  /** target temperature in °C, if applicable */
  temperatureC?: number;
  instruction: string;
}

export interface RecipeTemplate {
  id: RecipeCategoryId;
  name: string;
  summary: string;
  defaultBatchG: number;
  slots: RecipeSlot[];
  /** optional ordered process — guides the user, validated as a checklist */
  steps?: RecipeStep[];
  /** typical AW range as a sanity hint */
  awHint?: string;
  /** structural validation extras */
  notes?: string[];
}

// ── Common slot accept-lists ──────────────────────────────────────────────
const LIQUID = ["Liquids"];
const SUGAR = ["Sugars"];
const CHOCOLATE = ["Chocolate"];
const FAT = ["Fats"];
const FAT_OR_CHOC = ["Fats", "Chocolate"]; // cacao butter sits in either depending on setup
const PRALINE = ["Nuts / Nut Pastes / Pralines"];
const ALCOHOL = ["Alcohol"];
const FLAVOUR = ["Flavors & Additives", "Extra", "Infusions", "Essential Oils"];
const ACID = ["Flavors & Additives", "Extra", "Liquids"]; // malic acid solution / lemon juice

export const RECIPE_TEMPLATES: RecipeTemplate[] = [
  {
    id: "ganache",
    name: "Ganache",
    summary: "Cream/fruit + sugars + chocolate + butter (+cacao butter for white). Balanced via the ganache calculator.",
    defaultBatchG: 500,
    awHint: "0.78–0.83 stable",
    slots: [
      { role: "Base liquid", acceptCategories: LIQUID, min: 15, max: 35, required: true, hint: "Cream, fruit purée, or water — the continuous phase." },
      { role: "Glucose", acceptCategories: SUGAR, min: 2, max: 20, required: false, hint: "Glucose DE 43 — softens, lowers AW slightly." },
      { role: "Invert sugar", acceptCategories: SUGAR, min: 1, max: 12, required: false, hint: "Lowers AW, adds softness." },
      { role: "Sorbitol", acceptCategories: SUGAR, min: 1, max: 8, required: false, hint: "Use when water > 22%. Strong humectant." },
      { role: "Primary chocolate", acceptCategories: CHOCOLATE, min: 35, max: 70, required: true, hint: "Carries flavour + sets the ganache." },
      { role: "Cacao butter", acceptCategories: FAT_OR_CHOC, min: 0, max: 8, required: false, hint: "Add for white/milk ganaches to firm them up without sweetness." },
      { role: "Butter", acceptCategories: FAT, min: 5, max: 20, required: false, hint: "Soft, creamy texture. Replace with coconut oil for vegan." },
      { role: "Salt", acceptCategories: FLAVOUR, min: 0, max: 1, required: false, hint: "A pinch, balances sweetness." },
    ],
  },
  {
    id: "caramel-ganache",
    name: "Caramel ganache",
    summary: "Caramelise sugar → add warm liquid → cook to 104°C → emulsify with chocolate + cacao butter + butter. Add 1% silk at 32.5°C.",
    defaultBatchG: 600,
    awHint: "0.73–0.77",
    slots: [
      { role: "Sugar (to caramelise)", acceptCategories: SUGAR, min: 18, max: 30, required: true, hint: "Sugar (caster) only — glucose interferes with caramelisation." },
      { role: "Cream / fruit purée", acceptCategories: LIQUID, min: 20, max: 50, required: true, hint: "Warm before adding to caramel." },
      { role: "Glucose", acceptCategories: SUGAR, min: 5, max: 18, required: true, hint: "Prevents recrystallisation." },
      { role: "Salt", acceptCategories: FLAVOUR, min: 0, max: 2, required: false, hint: "Salty caramels sit at ~0.6%." },
      { role: "Butter", acceptCategories: FAT, min: 4, max: 15, required: false, hint: "Adds smoothness. Optional in fruit caramel ganaches." },
      { role: "Chocolate", acceptCategories: CHOCOLATE, min: 18, max: 35, required: true, hint: "Sets the ganache after caramel cools." },
      { role: "Cacao butter", acceptCategories: FAT_OR_CHOC, min: 0, max: 15, required: false, hint: "Up to 15% for white-chocolate caramel ganaches." },
      { role: "Acid", acceptCategories: ACID, min: 0, max: 2, required: false, hint: "Lemon juice or malic acid — for fruit caramels." },
    ],
    steps: [
      { stage: "Heat liquids", temperatureC: 60, instruction: "Warm cream/fruit + glucose + butter + salt." },
      { stage: "Caramelise sugar", temperatureC: 185, instruction: "Dry method or with golden syrup — bring to 175–185°C." },
      { stage: "Combine", instruction: "Pour warm liquid onto caramel little by little." },
      { stage: "Cook", temperatureC: 104, instruction: "Cook to 104°C (110–114°C for thicker caramels)." },
      { stage: "Cool", temperatureC: 80, instruction: "Cool to <80°C, add chocolate + cacao butter, emulsify." },
      { stage: "Pre-crystallise", temperatureC: 32.5, instruction: "Cool to 32.5°C, add 1% cacao butter silk, blend, pipe." },
    ],
  },
  {
    id: "nutganache",
    name: "Nut ganache",
    summary: "Cream + glucose + nut praliné + chocolate (± spirits). Pattern ratio ≈ cream 30 / glucose 10 / praliné 35 / chocolate 25.",
    defaultBatchG: 330,
    awHint: "0.68–0.81 (lower with spirits)",
    slots: [
      { role: "Cream / coconut cream", acceptCategories: LIQUID, min: 18, max: 35, required: true, hint: "UHT cream is preferred for shelf life." },
      { role: "Glucose", acceptCategories: SUGAR, min: 3, max: 25, required: true, hint: "More glucose with spirits to keep AW down." },
      { role: "Nut praliné", acceptCategories: PRALINE, min: 25, max: 40, required: true, hint: "Hazelnut, almond 60/40, pistachio." },
      { role: "Chocolate", acceptCategories: CHOCOLATE, min: 18, max: 35, required: true, hint: "Choose to match the praliné nut." },
      { role: "Cacao butter", acceptCategories: FAT_OR_CHOC, min: 0, max: 5, required: false, hint: "Vegan versions need a little cacao butter to firm up." },
      { role: "Spirits", acceptCategories: ALCOHOL, min: 0, max: 12, required: false, hint: "Adds depth, lowers AW. Bourbon / whisky." },
    ],
  },
  {
    id: "gianduja",
    name: "Gianduja",
    summary: "Praliné + chocolate + a touch of cacao butter + salt. Tempered like chocolate. No water.",
    defaultBatchG: 520,
    slots: [
      { role: "Praliné", acceptCategories: PRALINE, min: 55, max: 70, required: true, hint: "60–70% praliné for hazelnut, ~58% for almond/pistachio." },
      { role: "Chocolate", acceptCategories: CHOCOLATE, min: 28, max: 42, required: true, hint: "Match nut: hazelnut+dark, pistachio+white, etc." },
      { role: "Cacao butter", acceptCategories: FAT_OR_CHOC, min: 2, max: 6, required: true, hint: "~4% — gives setting strength without dulling flavour." },
      { role: "Salt", acceptCategories: FLAVOUR, min: 0, max: 1, required: false, hint: "A pinch to lift the nut." },
    ],
    notes: ["No water. Treat as chocolate — temper before piping.", "Vegan-ready by swapping chocolate."],
  },
  {
    id: "crunchy",
    name: "Crunchy filling",
    summary: "Gianduja base + crunchy inclusion (cacao nibs, cornflakes, candied petals).",
    defaultBatchG: 580,
    slots: [
      { role: "Praliné", acceptCategories: PRALINE, min: 45, max: 65, required: true, hint: "Same nut as the chocolate." },
      { role: "Chocolate", acceptCategories: CHOCOLATE, min: 25, max: 40, required: true, hint: "Carries the gianduja base." },
      { role: "Cacao butter", acceptCategories: FAT_OR_CHOC, min: 2, max: 6, required: true, hint: "~4% structural fat." },
      { role: "Crunchy inclusion", acceptCategories: FLAVOUR, min: 8, max: 18, required: true, hint: "Caramelised nibs, pulsed cornflakes, candied rose, etc." },
      { role: "Salt", acceptCategories: FLAVOUR, min: 0, max: 1, required: false, hint: "A pinch." },
    ],
  },
  {
    id: "cookie-layer",
    name: "Cookie layer (pipeable)",
    summary: "Praliné/caramel choc + cookie crumbles + cacao butter + (browned) butter. Pipe at 29°C with 2% silk.",
    defaultBatchG: 270,
    slots: [
      { role: "Praliné or caramel chocolate", acceptCategories: [...PRALINE, ...CHOCOLATE], min: 40, max: 55, required: true, hint: "Almond praliné for nut version, Bionda 36% for nut-free." },
      { role: "Cookie crumbles", acceptCategories: FLAVOUR, min: 18, max: 45, required: true, hint: "Pulsed in a food processor." },
      { role: "Cacao butter", acceptCategories: FAT_OR_CHOC, min: 5, max: 12, required: true, hint: "Sets the layer firm enough to slice." },
      { role: "Chocolate", acceptCategories: CHOCOLATE, min: 12, max: 22, required: false, hint: "Optional — Bionda or white." },
      { role: "Browned butter", acceptCategories: FAT, min: 0, max: 12, required: false, hint: "Used in the nut-free version — water-evaporated for shelf life." },
      { role: "Salt", acceptCategories: FLAVOUR, min: 0, max: 1, required: false, hint: "Powder form." },
    ],
    steps: [
      { stage: "Melt", temperatureC: 40, instruction: "Melt chocolate + cacao butter to 40°C." },
      { stage: "Combine", instruction: "Blend everything with a spatula until smooth." },
      { stage: "Pre-crystallise", temperatureC: 32, instruction: "At 32°C add 2% silk, blend." },
      { stage: "Pipe", temperatureC: 29, instruction: "Pipe at 29°C." },
    ],
  },
  {
    id: "caramel",
    name: "Caramel (filling on its own)",
    summary: "Caramelise sugar → add warm liquids → cook to 110–114°C (firmer if higher) → emulsify chocolate.",
    defaultBatchG: 1050,
    slots: [
      { role: "Sugar", acceptCategories: SUGAR, min: 22, max: 35, required: true, hint: "Caster sugar to caramelise. Muscovado for coconut caramel." },
      { role: "Cream / fruit / coconut cream", acceptCategories: LIQUID, min: 22, max: 45, required: true, hint: "The liquid that arrests the caramel." },
      { role: "Glucose", acceptCategories: SUGAR, min: 8, max: 20, required: true, hint: "Anti-crystallisation." },
      { role: "Butter", acceptCategories: FAT, min: 0, max: 15, required: false, hint: "Cream-based caramels include butter." },
      { role: "Salt", acceptCategories: FLAVOUR, min: 0, max: 1.5, required: false, hint: "Salty caramels at ~0.6–1%." },
      { role: "Chocolate", acceptCategories: CHOCOLATE, min: 3, max: 10, required: false, hint: "A touch of caramel chocolate adds body." },
      { role: "Acid", acceptCategories: ACID, min: 0, max: 1, required: false, hint: "Malic acid for fruit caramels." },
    ],
    steps: [
      { stage: "Warm liquids", temperatureC: 60, instruction: "Cream + glucose + butter + salt warmed together." },
      { stage: "Caramelise", temperatureC: 175, instruction: "Sugar (dry method or wet) to 175–185°C." },
      { stage: "Combine", instruction: "Pour warm liquid into caramel slowly." },
      { stage: "Cook", temperatureC: 110, instruction: "110°C = soft, 114°C = firmer." },
      { stage: "Add chocolate", temperatureC: 80, instruction: "Cool to <80°C, add chocolate, emulsify." },
      { stage: "Pipe", temperatureC: 26, instruction: "Pipe at 24–28°C." },
    ],
  },
  {
    id: "fruit-gel",
    name: "Fruit gel",
    summary: "Fruit + sugar + pectin + glucose, cooked to 104–106°C, then malic acid solution at the end for set.",
    defaultBatchG: 460,
    awHint: "0.73–0.79",
    slots: [
      { role: "Fruit purée", acceptCategories: LIQUID, min: 35, max: 50, required: true, hint: "Citrus/passion for high-acid, raspberry/mango for fibrous." },
      { role: "Pectin", acceptCategories: FLAVOUR, min: 0.4, max: 1.5, required: true, hint: "0.4–1.2% of the recipe. Higher for citrus, lower for fibrous fruits." },
      { role: "Sugar (mixed with pectin)", acceptCategories: SUGAR, min: 8, max: 16, required: true, hint: "Sift sugar with pectin to prevent lumps." },
      { role: "Sugar (main)", acceptCategories: SUGAR, min: 25, max: 40, required: true, hint: "Bulk of the sweetness + AW depression." },
      { role: "Invert sugar", acceptCategories: SUGAR, min: 0, max: 8, required: false, hint: "Adds tenderness, lowers AW further." },
      { role: "Glucose", acceptCategories: SUGAR, min: 5, max: 12, required: true, hint: "Anti-crystallisation." },
      { role: "Malic acid solution 60/40", acceptCategories: ACID, min: 1, max: 3, required: true, hint: "Add at the end — triggers pectin set." },
    ],
    steps: [
      { stage: "Mix dry", instruction: "Whisk pectin into 50–60g of sugar (dry)." },
      { stage: "Heat fruit", temperatureC: 40, instruction: "Warm purée + invert sugar to 40°C, then whisk in pectin/sugar mix." },
      { stage: "Add sugars", instruction: "Add main sugar + glucose, whisk smooth." },
      { stage: "Cook", temperatureC: 105, instruction: "Cook to 104–106°C (lower for less-firm gels)." },
      { stage: "Acid + pour", instruction: "Off heat, whisk in malic acid solution. Pour immediately." },
    ],
  },
  {
    id: "marshmallow",
    name: "Marshmallow",
    summary: "Bloomed gelatin + cooked sugar syrup, whipped cold. Plain / chocolate / fruit variants share a 100/58/62.5/12.5 sugar/dextrose/glucose/invert backbone.",
    defaultBatchG: 280,
    awHint: "0.6–0.7 (very stable)",
    slots: [
      { role: "Gelatin", acceptCategories: FLAVOUR, min: 3, max: 6, required: true, hint: "Bloom in cold water before melting in." },
      { role: "Sugar", acceptCategories: SUGAR, min: 30, max: 40, required: true, hint: "Caster — the bulk." },
      { role: "Dextrose", acceptCategories: SUGAR, min: 16, max: 22, required: true, hint: "Reduces stickiness." },
      { role: "Liquid (water / fruit)", acceptCategories: LIQUID, min: 10, max: 18, required: true, hint: "Strawberry purée for fruit version." },
      { role: "Lemon juice", acceptCategories: LIQUID, min: 2, max: 5, required: true, hint: "Stabilises foam, brightens flavour." },
      { role: "Glucose", acceptCategories: SUGAR, min: 18, max: 25, required: true, hint: "Anti-crystallisation, structural." },
      { role: "Invert sugar", acceptCategories: SUGAR, min: 3, max: 6, required: true, hint: "Tenderness." },
      { role: "Cacao powder (optional)", acceptCategories: FLAVOUR, min: 0, max: 12, required: false, hint: "For chocolate marshmallows." },
    ],
  },
];

export const RECIPE_TEMPLATE_BY_ID: Record<RecipeCategoryId, RecipeTemplate> = Object.fromEntries(
  RECIPE_TEMPLATES.map((t) => [t.id, t]),
) as Record<RecipeCategoryId, RecipeTemplate>;
