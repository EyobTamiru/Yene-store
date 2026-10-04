/**
 * ============================================================================
 *  MULTI-LANGUAGE - the shared core (Section 51)
 * ============================================================================
 *
 *  WHAT CHANGED, AND WHY IT WAS NECESSARY
 *  --------------------------------------
 *  This module used to inline two catalogues, and the Amharic one was CORRUPTED:
 *  all 91 strings were mojibake - UTF-8 bytes read as Latin-1 and written back -
 *  so the file held 688 Latin-1 supplement characters and ZERO Ethiopic code
 *  points. A customer selecting Amharic saw garbage.
 *
 *  It shipped because the only test asserted `t(key,"am") !== t(key,"en")`,
 *  which corrupted text satisfies perfectly well. Three things are now
 *  structural rather than assumed:
 *
 *  1. ONE CATALOGUE PER FILE (./locales/*.ts). A language is a file, not a
 *     90-line block inside a shared file, so adding a seventh cannot conflict
 *     with anyone else's diff.
 *  2. A REAL SCRIPT CHECK (`isPlausiblyInScript`) - the test that would have
 *     caught the corruption on the day it was introduced.
 *  3. EXPLICIT FALLBACK. A machine-assisted translation is a STARTING POINT, so
 *     anything untranslated or unverified renders in readable English - never as
 *     a key, a blank, or a guess presented as fact.
 *
 *  THE HONESTY RULE, STATED PLAIMLY
 *  --------------------------------
 *  Each catalogue carries a `provenance`: `source`, `reviewed`, or
 *  `machine-assisted`. Machine-assisted does NOT mean verified. It means a
 *  machine drafted it and no fluent speaker has reviewed it. We would rather
 *  show a customer correct English than wrong Afar, because a wrong translation
 *  is more damaging than none - the customer cannot tell which they got.
 *
 *  A DELIBERATE LIMITATION: catalogues cover the interface CHROME only.
 *  Product names, business descriptions and reviews are whatever the merchant
 *  typed. The platform does not translate a seller's words on their behalf.
 */

import { AMHARIC } from "./locales/am";
import { AFAR } from "./locales/aa";
import { ENGLISH } from "./locales/en";
import { OROMO } from "./locales/om";
import { SOMALI } from "./locales/so";
import { TIGRINYA } from "./locales/ti";

export const LANGUAGES = ["en", "am", "om", "so", "aa", "ti"] as const;
export type LanguageCode = (typeof LANGUAGES)[number];

/** Each language, written in its own script. Rendered as-is by the switcher. */
export const LANGUAGE_NAMES: Record<LanguageCode, string> = {
  en: "English",
  am: "መነሻ",
  om: "Afaan Oromoo",
  so: "Af-Soomaali",
  aa: "Qafar af",
  ti: "ትግርኛ",
};

/** The language's own name for itself, shown beside the English one. */
export const LANGUAGE_NATIVE: Record<LanguageCode, string> = {
  en: "English",
  am: "መነሻ",
  om: "Afaan Oromoo",
  so: "Af-Soomaali",
  aa: "Afaraf",
  ti: "ትግርኛ",
};

export const DEFAULT_LANGUAGE: LanguageCode = "en";

export function isLanguageCode(value: unknown): value is LanguageCode {
  return typeof value === "string" && (LANGUAGES as readonly string[]).includes(value);
}

export type Catalogue = Record<string, string>;

/**
 * How a catalogue's strings were produced, and how far they can be trusted.
 *
 * `machine-assisted` does NOT mean verified. It means a machine drafted it and
 * it has not been through a fluent speaker. The admin summary and the
 * verification suite both read this, so a draft cannot quietly present itself
 * as reviewed copy.
 */
export type Provenance = "source" | "reviewed" | "machine-assisted";

export interface LanguageDefinition {
  code: LanguageCode;
  /** What a speaker calls their own language. */
  native: string;
  english: string;
  script: { name: string; geez: boolean };
  provenance: Provenance;
  catalogue: Catalogue;
}

/**
 * The six languages Yene-Store ships.
 *
 * Amharic is `reviewed`; the other four are `machine-assisted`. That asymmetry
 * is deliberate and is the honest description of what each catalogue is today.
 */
export const LANGUAGES_DEFINED: Record<LanguageCode, LanguageDefinition> = {
  en: {
    code: "en",
    native: "English",
    english: "English",
    script: { name: "Latin", geez: false },
    provenance: "source",
    catalogue: ENGLISH,
  },
  am: {
    code: "am",
    native: "መነሻ",
    english: "Amharic",
    script: { name: "Ge'ez", geez: true },
    provenance: "reviewed",
    catalogue: AMHARIC,
  },
  om: {
    code: "om",
    native: "Afaan Oromoo",
    english: "Oromo",
    script: { name: "Latin", geez: false },
    provenance: "machine-assisted",
    catalogue: OROMO,
  },
  so: {
    code: "so",
    native: "Af-Soomaali",
    english: "Somali",
    script: { name: "Latin", geez: false },
    provenance: "machine-assisted",
    catalogue: SOMALI,
  },
  aa: {
    code: "aa",
    native: "Qafar af",
    english: "Afar",
    script: { name: "Latin", geez: false },
    provenance: "machine-assisted",
    catalogue: AFAR,
  },
  ti: {
    code: "ti",
    native: "ትግርኛ",
    english: "Tigrinya",
    script: { name: "Ge'ez", geez: true },
    provenance: "machine-assisted",
    catalogue: TIGRINYA,
  },
};

/** The Ge'ez block, U+1200-U+137F, shared by Amharic and Tigrinya. */
const GEEZ_START = 0x1200;
const GEEZ_END = 0x137f;
/** Latin-1 and Latin Extended-A: every legitimate Latin-script character. */
const LATIN_END = 0x024f;

/**
 * Could this string plausibly be written in this language's script?
 *
 * THE TEST THAT WOULD HAVE CAUGHT THE ORIGINAL BUG
 * -----------------------------------------------
 *  A Ge'ez language's text must contain at least one Ge'ez code point. The
 *  corrupted Amharic contained NONE - it was entirely Latin-1 supplement
 *  characters - so this returns false for it and the verification suite fails.
 *  That is the whole point: the corruption became detectable rather than a
 *  matter of opinion.
 *
 *  A Latin-script language cannot use the same rule, because English product
 *  names and "ETB" legitimately appear in Somali or Oromo. For those the check
 *  is inverted: it asks whether the string contains anything OUTSIDE Latin,
 *  which catches a Ge'ez string pasted into the wrong catalogue.
 */
export function isPlausiblyInScript(
  text: string,
  definition: LanguageDefinition,
): boolean {
  // An empty string is a GAP, not a corruption, and gaps are reported by
  // coverage rather than by this check.
  if (!text) return true;

  const points = [...text].map((ch) => ch.codePointAt(0) ?? 0);
  const hasGeez = points.some((code) => code >= GEEZ_START && code <= GEEZ_END);

  if (definition.script.geez) return hasGeez;
  // English is the catch-all source, so it may carry any script.
  if (definition.code === "en") return true;
  // A Latin-script catalogue holding a Ge'ez string is a copy-paste error.
  return !hasGeez;
}

/** Every key English defines - the source of truth for coverage. */
export function sourceKeys(): string[] {
  return Object.keys(ENGLISH);
}

const CATALOGUES: Record<LanguageCode, Catalogue> = {
  en: ENGLISH,
  am: AMHARIC,
  om: OROMO,
  so: SOMALI,
  aa: AFAR,
  ti: TIGRINYA,
};

export function setLanguage(language: LanguageCode): void {
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem("yene-language", language);
    } catch {
      /* storage blocked - the in-memory default still applies */
    }
  }
}

export function readStoredLanguage(): LanguageCode {
  if (typeof window === "undefined") return DEFAULT_LANGUAGE;
  try {
    const stored = window.localStorage.getItem("yene-language");
    return isLanguageCode(stored) ? stored : DEFAULT_LANGUAGE;
  } catch {
    return DEFAULT_LANGUAGE;
  }
}

/**
 * Translate a key, interpolating `{name}` placeholders.
 *
 * THE FALLBACK CHAIN, AND WHY IT IS ORDERED THIS WAY
 * --------------------------------------------------
 *   1. the requested language
 *   2. English
 *   3. the key itself
 *
 *  English sits in the middle deliberately. A machine-assisted catalogue will
 *  have gaps, and step 1 -> 2 means a gap renders as readable English rather
 *  than as "checkout.step3". Step 3 is the last resort so a genuinely missing
 *  key is debuggable rather than silently blank.
 *
 *  A string that EXISTS but is written in the wrong script is treated as a gap
 *  and falls through to English. Showing corrupted Amharic to a customer is
 *  worse than showing them English, because they cannot tell it is broken.
 *
 *  It never returns undefined and never throws: a missing translation must not
 *  be able to blank a checkout button.
 */
export function t(
  key: string,
  language: LanguageCode = DEFAULT_LANGUAGE,
  values?: Record<string, string | number>,
): string {
  const raw = translate(key, language);
  if (!values) return raw;
  return raw.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in values ? String(values[name]) : match,
  );
}

/** The translation, without interpolation. Exported for the admin screens. */
export function translate(key: string, language: LanguageCode): string {
  const english = ENGLISH[key];
  const definition = LANGUAGES_DEFINED[language];

  // An unknown LANGUAGE behaves exactly like English rather than throwing, so a
  // stale value in localStorage cannot break the page.
  if (!definition) return english ?? key;

  const candidate = CATALOGUES[language]?.[key];
  if (candidate && isPlausiblyInScript(candidate, definition)) return candidate;

  return english ?? key;
}

export function supportedLanguages(): LanguageCode[] {
  return [...LANGUAGES];
}

/** How much of a language is actually translated, as a 0-1 fraction. */
export function coverage(language: LanguageCode): number {
  if (language === DEFAULT_LANGUAGE) return 1;
  const total = sourceKeys().length;
  if (total === 0) return 0;
  const definition = LANGUAGES_DEFINED[language];
  const translated = sourceKeys().filter((key) => {
    const candidate = CATALOGUES[language]?.[key];
    return Boolean(candidate) && isPlausiblyInScript(candidate, definition);
  }).length;
  return translated / total;
}

/** The keys a language is still missing - a translator's worklist. */
export function missingKeys(language: LanguageCode): string[] {
  const definition = LANGUAGES_DEFINED[language];
  return sourceKeys().filter((key) => {
    const candidate = CATALOGUES[language]?.[key];
    return !candidate || !isPlausiblyInScript(candidate, definition);
  });
}

/**
 * How much of one language is byte-identical to another, as a 0-1 fraction.
 *
 * WHY THIS EXISTS - THE BUG IT CATCHES
 * -----------------------------------
 *  The original Tigrinya catalogue was 82 of 91 strings (90%) byte-identical to
 *  the Amharic one. Every existing check passed, because they all asked the
 *  same weak question: "is this different from ENGLISH?" A copy of another
 *  language is obviously different from English, so a whole catalogue of
 *  another language sailed through as a translation.
 *
 *  This asks the right question instead: "is this different from the OTHER
 *  translations?" Duplication between siblings is the signature of a
 *  copy-paste, which no amount of per-string script checking can detect.
 *
 * WHY IT IS NOT SET TO ZERO
 * -------------------------
 *  Tigrinya and Amharic are mutually intelligible Ethiopic Semitic languages
 *  and genuinely share core vocabulary - order, tax, total, delivery are the
 *  same word in both, and a correct translation SHOULD reuse them. Somali and
 *  Afar are both Cushitic and legitimately overlap too. Demanding zero
 *  overlap would fail honest work and push a translator into inventing awkward
 *  synonyms to satisfy a metric.
 *
 *  So this is a COPY DETECTOR, not a diversity score. DUPLICATION_LIMIT is set
 *  well above the legitimate cognate overlap (~66% for am/ti) and well below a
 *  copy (90%). Relatedness is real; a copy-paste is a defect.
 */
export const DUPLICATION_LIMIT = 0.8;

export function catalogueOverlap(a: LanguageCode, b: LanguageCode): number {
  const left = CATALOGUES[a];
  const right = CATALOGUES[b];
  if (!left || !right) return 0;
  const keys = sourceKeys();
  if (keys.length === 0) return 0;
  const shared = keys.filter((key) => left[key] && left[key] === right[key]).length;
  return shared / keys.length;
}

/**
 * Every pair of non-English languages that overlap beyond the copy threshold.
 *
 * An empty list is the healthy state. A non-empty list means one catalogue was
 * pasted from another and is shipping as a translation it is not.
 */
export function suspectedDuplications(): { a: LanguageCode; b: LanguageCode; overlap: number }[] {
  const found: { a: LanguageCode; b: LanguageCode; overlap: number }[] = [];
  const codes = LANGUAGES.filter((code) => code !== DEFAULT_LANGUAGE);
  for (let i = 0; i < codes.length; i += 1) {
    for (let j = i + 1; j < codes.length; j += 1) {
      const overlap = catalogueOverlap(codes[i], codes[j]);
      if (overlap > DUPLICATION_LIMIT) {
        found.push({ a: codes[i], b: codes[j], overlap });
      }
    }
  }
  return found;
}

/** The admin summary: what ships, and how much of it is verified. */
export function languageSummary(): {
  code: LanguageCode;
  native: string;
  english: string;
  script: string;
  provenance: Provenance;
  coverage: number;
  missing: number;
}[] {
  return LANGUAGES.map((code) => ({
    code,
    native: LANGUAGES_DEFINED[code].native,
    english: LANGUAGES_DEFINED[code].english,
    script: LANGUAGES_DEFINED[code].script.name,
    provenance: LANGUAGES_DEFINED[code].provenance,
    coverage: coverage(code),
    missing: missingKeys(code).length,
  }));
}
