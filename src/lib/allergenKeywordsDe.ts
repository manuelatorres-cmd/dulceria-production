/**
 * German keyword map per allergen ID — used to decide which sub-ingredient
 * name actually carries the parent's allergen.
 *
 * When a parent ingredient flattens into multiple sub-ingredient names, only
 * the sub whose name signals the allergen should be emphasised on the label
 * (EU FIC 1169/2011 Annex II — emphasise the substance, not its siblings).
 *
 * Keyword match is case-insensitive substring on the sub-ingredient name.
 * Unknown allergen IDs match nothing (fail closed) — better to under-bold
 * than to over-bold non-allergens, which is what this map fixes.
 *
 * Conservative: only includes keywords that uniquely imply the allergen.
 * "Mehl" alone is excluded from gluten because Mandelmehl/Reismehl exist.
 */

const DE_ALLERGEN_KEYWORDS: Record<string, string[]> = {
  gluten: [
    // DE
    "weizen", "roggen", "gerste", "hafer", "dinkel", "kamut", "gluten",
    "weizenmehl", "roggenmehl", "dinkelmehl", "gerstenmehl", "hafermehl",
    "weizenstärke", "weizengrieß", "weichweizen", "hartweizen", "graupen",
    "couscous", "bulgur", "seitan", "khorasan",
    // EN
    "wheat", "rye", "barley", "oats", "spelt",
  ],
  crustaceans: [
    "krebstier", "garnele", "garnelen", "krabbe", "krabben", "hummer", "languste", "scampi", "shrimp",
    "crustacean", "prawn", "crab", "lobster", "crayfish",
  ],
  eggs: ["ei ", "eier", "eigelb", "eiweiß", "eiweiss", "vollei", "trockenei", "eipulver", "hühnerei", "egg"],
  fish: [
    "fisch", "lachs", "thunfisch", "sardelle", "anchovis", "anchovi", "kabeljau", "forelle", "hering", "makrele",
    "fish", "salmon", "tuna", "cod",
  ],
  peanuts: ["erdnuss", "erdnüsse", "erdnussöl", "erdnussbutter", "peanut"],
  soybeans: [
    "soja", "sojabohne", "sojabohnen", "sojalecithin", "sojaprotein", "sojaöl", "tofu", "tempeh", "edamame",
    "soy", "soybean",
  ],
  milk: [
    // DE
    "milch", "milchpulver", "magermilch", "vollmilch", "butter", "butterreinfett",
    "butterfett", "sahne", "rahm", "joghurt", "jogurt", "käse", "quark",
    "molke", "molkenpulver", "kasein", "casein", "milcheiweiß", "milcheiweiss",
    "kondensmilch", "buttermilch",
    // EN
    "milk", "cream", "yogurt", "yoghurt", "cheese", "whey", "lactose",
  ],
  lactose: ["laktose", "lactose", "milchzucker"],
  nuts: ["nuss", "nüsse", "nüssen", "nougat", "krokant", "tree nut"],
  nuts_almonds: [
    "mandel", "mandeln", "mandelmehl", "mandelmasse", "mandelpaste", "marzipan", "persipan", "amaretto",
    "almond",
  ],
  nuts_hazelnuts: [
    "haselnuss", "haselnüsse", "haselnussmus", "haselnussmasse", "nougat", "gianduja",
    "hazelnut",
  ],
  nuts_walnuts: ["walnuss", "walnüsse", "walnut"],
  nuts_cashews: ["cashew", "cashews", "cashewkern", "cashewkerne"],
  nuts_pecans: ["pekannuss", "pekannüsse", "pecan"],
  nuts_brazil: ["paranuss", "paranüsse", "brazil nut"],
  nuts_pistachios: ["pistazie", "pistazien", "pistazienpaste", "pistachio"],
  nuts_macadamia: ["macadamia", "queensland"],
  nuts_pine: ["pinienkern", "pinienkerne", "pine nut"],
  celery: ["sellerie", "selleriesamen", "celery", "celeriac"],
  mustard: ["senf", "senfkörner", "senfsaat", "mustard"],
  sesame: ["sesam", "sesamsamen", "sesamöl", "tahin", "tahini", "sesame"],
  sulphites: [
    "sulfit", "sulfite", "schwefeldioxid", "so2", "so₂",
    "sulphite", "sulfite", "sulphur dioxide",
  ],
  lupin: ["lupin", "lupine", "lupinen", "lupinenmehl"],
  molluscs: [
    "weichtier", "muschel", "muscheln", "tintenfisch", "auster", "austern", "miesmuschel", "schnecke",
    "mollusc", "mollusk", "mussel", "oyster", "squid", "snail", "scallop", "clam",
  ],
  alcohol: [
    "alkohol", "rum", "kirsch", "kirschwasser", "weinbrand", "cognac", "likör", "wein", "bier",
    "amaretto", "grand marnier",
    "alcohol", "wine", "beer", "liqueur",
  ],
  // US-specific
  shellfish: ["schalentier", "garnele", "garnelen", "krabbe", "krabben", "hummer", "shellfish", "shrimp"],
  wheat: ["weizen", "weizenmehl", "weizenstärke", "weizengrieß", "weichweizen", "hartweizen", "wheat"],
};

/**
 * Returns true when the German `name` plausibly contains the allergen with
 * the given ID. Case-insensitive substring match against a curated keyword
 * list. Unknown IDs return false (fail closed).
 */
export function nameMatchesAllergenDe(name: string, allergenId: string): boolean {
  const keywords = DE_ALLERGEN_KEYWORDS[allergenId];
  if (!keywords || keywords.length === 0) return false;
  const lower = name.toLowerCase();
  return keywords.some((kw) => lower.includes(kw));
}

/**
 * Returns true when `label` contains a keyword for ANY known allergen.
 *
 * Used to decide visual emphasis on customer-facing ingredient labels
 * independently of the parent ingredient's `allergens` flag — so an entry
 * named "Zucker" never bolds even if its parent compound was tagged with
 * almonds, and "Mandeln" always bolds even if the parent flag is missing.
 */
export function containsAllergen(label: string): boolean {
  const lower = label.toLowerCase();
  for (const keywords of Object.values(DE_ALLERGEN_KEYWORDS)) {
    for (const kw of keywords) {
      if (lower.includes(kw)) return true;
    }
  }
  return false;
}
