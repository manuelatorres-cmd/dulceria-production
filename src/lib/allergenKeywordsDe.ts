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
    "weizen", "roggen", "gerste", "hafer", "dinkel", "kamut", "gluten",
    "weizenmehl", "roggenmehl", "dinkelmehl", "gerstenmehl", "hafermehl",
    "weizenstärke", "weizengrieß", "weichweizen", "hartweizen", "graupen",
    "couscous", "bulgur", "seitan",
  ],
  crustaceans: ["krebstier", "garnele", "garnelen", "krabbe", "krabben", "hummer", "languste", "scampi", "shrimp"],
  eggs: ["ei ", "eier", "eigelb", "eiweiß", "eiweiss", "vollei", "trockenei", "eipulver", "hühnerei"],
  fish: ["fisch", "lachs", "thunfisch", "sardelle", "anchovis", "anchovi", "kabeljau", "forelle", "hering", "makrele"],
  peanuts: ["erdnuss", "erdnüsse", "erdnussöl", "erdnussbutter"],
  soybeans: ["soja", "sojabohne", "sojabohnen", "sojalecithin", "sojaprotein", "sojaöl", "tofu", "tempeh", "edamame"],
  milk: [
    "milch", "milchpulver", "magermilch", "vollmilch", "butter", "butterreinfett",
    "butterfett", "sahne", "rahm", "joghurt", "jogurt", "käse", "quark",
    "molke", "molkenpulver", "kasein", "casein", "milcheiweiß", "milcheiweiss",
    "kondensmilch", "buttermilch",
  ],
  lactose: ["laktose", "lactose", "milchzucker"],
  nuts: ["nuss", "nüsse", "nüssen", "nougat", "krokant"],
  nuts_almonds: ["mandel", "mandeln", "mandelmehl", "mandelmasse", "mandelpaste", "marzipan", "persipan", "amaretto"],
  nuts_hazelnuts: ["haselnuss", "haselnüsse", "haselnussmus", "haselnussmasse", "nougat", "gianduja"],
  nuts_walnuts: ["walnuss", "walnüsse"],
  nuts_cashews: ["cashew", "cashews", "cashewkern", "cashewkerne"],
  nuts_pecans: ["pekannuss", "pekannüsse", "pecan"],
  nuts_brazil: ["paranuss", "paranüsse"],
  nuts_pistachios: ["pistazie", "pistazien", "pistazienpaste"],
  nuts_macadamia: ["macadamia"],
  nuts_pine: ["pinienkern", "pinienkerne"],
  celery: ["sellerie", "selleriesamen"],
  mustard: ["senf", "senfkörner", "senfsaat"],
  sesame: ["sesam", "sesamsamen", "sesamöl", "tahin", "tahini"],
  sulphites: ["sulfit", "sulfite", "schwefeldioxid", "so2", "so₂"],
  lupin: ["lupin", "lupine", "lupinen", "lupinenmehl"],
  molluscs: ["weichtier", "muschel", "muscheln", "tintenfisch", "auster", "austern", "miesmuschel", "schnecke"],
  alcohol: ["alkohol", "rum", "kirsch", "kirschwasser", "weinbrand", "cognac", "likör", "wein", "bier", "amaretto", "grand marnier"],
  // US-specific
  shellfish: ["schalentier", "garnele", "garnelen", "krabbe", "krabben", "hummer"],
  wheat: ["weizen", "weizenmehl", "weizenstärke", "weizengrieß", "weichweizen", "hartweizen"],
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
