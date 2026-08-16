/**
 * Additive reference used by the deterministic scorer.
 *
 * Editorial rules for this file, which also protect IngreFit legally:
 *  - `basis` records a verifiable regulatory or classification fact, never our
 *    opinion about a manufacturer or a product.
 *  - `risk` is IngreFit's own scoring tier derived from that basis. The UI must
 *    always present it as IngreFit's classification, with the basis shown.
 *  - An additive that is simply authorised and uncontroversial is `low`. Absence
 *    from this table means "not classified", never "dangerous".
 *
 * Basis codes are translated in signalCatalog.ts (en/ru).
 */

export type AdditiveRisk = 'high' | 'moderate' | 'low';

export type AdditiveBasis =
  | 'eu_not_authorised'
  | 'eu_child_attention_warning'
  | 'iarc_2a'
  | 'iarc_2b'
  | 'efsa_group_adi'
  | 'efsa_adi_lowered'
  | 'mandatory_allergen_labelling'
  | 'use_restricted'
  | 'authorised_routine';

export interface AdditiveEntry {
  code: string;
  nameEn: string;
  nameRu: string;
  risk: AdditiveRisk;
  basis: AdditiveBasis;
}

const ENTRIES: AdditiveEntry[] = [
  // --- Not authorised in the EU as a food additive -------------------------
  { code: 'e171', nameEn: 'Titanium dioxide', nameRu: 'Диоксид титана', risk: 'high', basis: 'eu_not_authorised' },
  { code: 'e123', nameEn: 'Amaranth', nameRu: 'Амарант', risk: 'high', basis: 'use_restricted' },
  { code: 'e239', nameEn: 'Hexamethylenetetramine', nameRu: 'Гексаметилентетрамин', risk: 'high', basis: 'use_restricted' },
  { code: 'e284', nameEn: 'Boric acid', nameRu: 'Борная кислота', risk: 'high', basis: 'use_restricted' },
  { code: 'e285', nameEn: 'Sodium tetraborate', nameRu: 'Тетраборат натрия', risk: 'high', basis: 'use_restricted' },

  // --- EU-mandated warning about attention in children ---------------------
  { code: 'e102', nameEn: 'Tartrazine', nameRu: 'Тартразин', risk: 'high', basis: 'eu_child_attention_warning' },
  { code: 'e104', nameEn: 'Quinoline yellow', nameRu: 'Жёлтый хинолиновый', risk: 'high', basis: 'eu_child_attention_warning' },
  { code: 'e110', nameEn: 'Sunset yellow FCF', nameRu: 'Жёлтый «солнечный закат»', risk: 'high', basis: 'eu_child_attention_warning' },
  { code: 'e122', nameEn: 'Azorubine (carmoisine)', nameRu: 'Азорубин (кармуазин)', risk: 'high', basis: 'eu_child_attention_warning' },
  { code: 'e124', nameEn: 'Ponceau 4R', nameRu: 'Понсо 4R', risk: 'high', basis: 'eu_child_attention_warning' },
  { code: 'e129', nameEn: 'Allura red AC', nameRu: 'Красный очаровательный AC', risk: 'high', basis: 'eu_child_attention_warning' },

  // --- Nitrites and nitrates ----------------------------------------------
  { code: 'e249', nameEn: 'Potassium nitrite', nameRu: 'Нитрит калия', risk: 'high', basis: 'iarc_2a' },
  { code: 'e250', nameEn: 'Sodium nitrite', nameRu: 'Нитрит натрия', risk: 'high', basis: 'iarc_2a' },
  { code: 'e251', nameEn: 'Sodium nitrate', nameRu: 'Нитрат натрия', risk: 'high', basis: 'iarc_2a' },
  { code: 'e252', nameEn: 'Potassium nitrate', nameRu: 'Нитрат калия', risk: 'high', basis: 'iarc_2a' },

  // --- IARC group 2B ------------------------------------------------------
  { code: 'e951', nameEn: 'Aspartame', nameRu: 'Аспартам', risk: 'moderate', basis: 'iarc_2b' },
  { code: 'e320', nameEn: 'Butylated hydroxyanisole (BHA)', nameRu: 'Бутилгидроксианизол (BHA)', risk: 'moderate', basis: 'iarc_2b' },
  { code: 'e150c', nameEn: 'Ammonia caramel', nameRu: 'Карамель аммиачная', risk: 'moderate', basis: 'iarc_2b' },
  { code: 'e150d', nameEn: 'Sulphite ammonia caramel', nameRu: 'Карамель сульфитно-аммиачная', risk: 'moderate', basis: 'iarc_2b' },

  // --- Sweeteners with a defined or revised ADI ---------------------------
  { code: 'e950', nameEn: 'Acesulfame K', nameRu: 'Ацесульфам калия', risk: 'moderate', basis: 'efsa_group_adi' },
  { code: 'e952', nameEn: 'Cyclamate', nameRu: 'Цикламат', risk: 'moderate', basis: 'efsa_adi_lowered' },
  { code: 'e954', nameEn: 'Saccharin', nameRu: 'Сахарин', risk: 'moderate', basis: 'efsa_group_adi' },
  { code: 'e955', nameEn: 'Sucralose', nameRu: 'Сукралоза', risk: 'moderate', basis: 'efsa_group_adi' },
  { code: 'e962', nameEn: 'Aspartame-acesulfame salt', nameRu: 'Соль аспартама-ацесульфама', risk: 'moderate', basis: 'iarc_2b' },

  // --- Preservatives ------------------------------------------------------
  { code: 'e210', nameEn: 'Benzoic acid', nameRu: 'Бензойная кислота', risk: 'moderate', basis: 'efsa_group_adi' },
  { code: 'e211', nameEn: 'Sodium benzoate', nameRu: 'Бензоат натрия', risk: 'moderate', basis: 'efsa_group_adi' },
  { code: 'e212', nameEn: 'Potassium benzoate', nameRu: 'Бензоат калия', risk: 'moderate', basis: 'efsa_group_adi' },
  { code: 'e213', nameEn: 'Calcium benzoate', nameRu: 'Бензоат кальция', risk: 'moderate', basis: 'efsa_group_adi' },
  { code: 'e220', nameEn: 'Sulphur dioxide', nameRu: 'Диоксид серы', risk: 'moderate', basis: 'mandatory_allergen_labelling' },
  { code: 'e221', nameEn: 'Sodium sulphite', nameRu: 'Сульфит натрия', risk: 'moderate', basis: 'mandatory_allergen_labelling' },
  { code: 'e222', nameEn: 'Sodium bisulphite', nameRu: 'Гидросульфит натрия', risk: 'moderate', basis: 'mandatory_allergen_labelling' },
  { code: 'e223', nameEn: 'Sodium metabisulphite', nameRu: 'Метабисульфит натрия', risk: 'moderate', basis: 'mandatory_allergen_labelling' },
  { code: 'e224', nameEn: 'Potassium metabisulphite', nameRu: 'Метабисульфит калия', risk: 'moderate', basis: 'mandatory_allergen_labelling' },
  { code: 'e226', nameEn: 'Calcium sulphite', nameRu: 'Сульфит кальция', risk: 'moderate', basis: 'mandatory_allergen_labelling' },
  { code: 'e227', nameEn: 'Calcium bisulphite', nameRu: 'Гидросульфит кальция', risk: 'moderate', basis: 'mandatory_allergen_labelling' },
  { code: 'e228', nameEn: 'Potassium bisulphite', nameRu: 'Гидросульфит калия', risk: 'moderate', basis: 'mandatory_allergen_labelling' },
  { code: 'e319', nameEn: 'Tertiary butylhydroquinone (TBHQ)', nameRu: 'Трет-бутилгидрохинон (TBHQ)', risk: 'moderate', basis: 'efsa_group_adi' },
  { code: 'e321', nameEn: 'Butylated hydroxytoluene (BHT)', nameRu: 'Бутилгидрокситолуол (BHT)', risk: 'moderate', basis: 'efsa_group_adi' },
  { code: 'e385', nameEn: 'Calcium disodium EDTA', nameRu: 'ЭДТА кальция-динатрия', risk: 'moderate', basis: 'use_restricted' },

  // --- Flavour enhancers ---------------------------------------------------
  { code: 'e620', nameEn: 'Glutamic acid', nameRu: 'Глутаминовая кислота', risk: 'moderate', basis: 'efsa_group_adi' },
  { code: 'e621', nameEn: 'Monosodium glutamate', nameRu: 'Глутамат натрия', risk: 'moderate', basis: 'efsa_group_adi' },
  { code: 'e622', nameEn: 'Monopotassium glutamate', nameRu: 'Глутамат калия', risk: 'moderate', basis: 'efsa_group_adi' },
  { code: 'e623', nameEn: 'Calcium diglutamate', nameRu: 'Диглутамат кальция', risk: 'moderate', basis: 'efsa_group_adi' },
  { code: 'e624', nameEn: 'Monoammonium glutamate', nameRu: 'Глутамат аммония', risk: 'moderate', basis: 'efsa_group_adi' },
  { code: 'e625', nameEn: 'Magnesium diglutamate', nameRu: 'Диглутамат магния', risk: 'moderate', basis: 'efsa_group_adi' },
  { code: 'e627', nameEn: 'Disodium guanylate', nameRu: 'Гуанилат натрия', risk: 'moderate', basis: 'efsa_group_adi' },
  { code: 'e631', nameEn: 'Disodium inosinate', nameRu: 'Инозинат натрия', risk: 'moderate', basis: 'efsa_group_adi' },
  { code: 'e635', nameEn: 'Disodium ribonucleotides', nameRu: 'Рибонуклеотиды натрия', risk: 'moderate', basis: 'efsa_group_adi' },

  // --- Phosphates (EFSA group ADI, 2019) ----------------------------------
  { code: 'e338', nameEn: 'Phosphoric acid', nameRu: 'Ортофосфорная кислота', risk: 'moderate', basis: 'efsa_group_adi' },
  { code: 'e339', nameEn: 'Sodium phosphates', nameRu: 'Фосфаты натрия', risk: 'moderate', basis: 'efsa_group_adi' },
  { code: 'e340', nameEn: 'Potassium phosphates', nameRu: 'Фосфаты калия', risk: 'moderate', basis: 'efsa_group_adi' },
  { code: 'e341', nameEn: 'Calcium phosphates', nameRu: 'Фосфаты кальция', risk: 'moderate', basis: 'efsa_group_adi' },
  { code: 'e343', nameEn: 'Magnesium phosphates', nameRu: 'Фосфаты магния', risk: 'moderate', basis: 'efsa_group_adi' },
  { code: 'e450', nameEn: 'Diphosphates', nameRu: 'Дифосфаты', risk: 'moderate', basis: 'efsa_group_adi' },
  { code: 'e451', nameEn: 'Triphosphates', nameRu: 'Трифосфаты', risk: 'moderate', basis: 'efsa_group_adi' },
  { code: 'e452', nameEn: 'Polyphosphates', nameRu: 'Полифосфаты', risk: 'moderate', basis: 'efsa_group_adi' },

  // --- Other colours and additives with restrictions ----------------------
  { code: 'e127', nameEn: 'Erythrosine', nameRu: 'Эритрозин', risk: 'moderate', basis: 'use_restricted' },
  { code: 'e131', nameEn: 'Patent blue V', nameRu: 'Синий патентованный V', risk: 'moderate', basis: 'use_restricted' },
  { code: 'e132', nameEn: 'Indigotine', nameRu: 'Индигокармин', risk: 'moderate', basis: 'efsa_group_adi' },
  { code: 'e133', nameEn: 'Brilliant blue FCF', nameRu: 'Синий блестящий FCF', risk: 'moderate', basis: 'efsa_group_adi' },
  { code: 'e142', nameEn: 'Green S', nameRu: 'Зелёный S', risk: 'moderate', basis: 'efsa_group_adi' },
  { code: 'e151', nameEn: 'Brilliant black BN', nameRu: 'Чёрный блестящий BN', risk: 'moderate', basis: 'efsa_group_adi' },
  { code: 'e155', nameEn: 'Brown HT', nameRu: 'Коричневый HT', risk: 'moderate', basis: 'efsa_group_adi' },
  { code: 'e173', nameEn: 'Aluminium', nameRu: 'Алюминий', risk: 'moderate', basis: 'use_restricted' },
  { code: 'e174', nameEn: 'Silver', nameRu: 'Серебро', risk: 'moderate', basis: 'use_restricted' },
  { code: 'e407', nameEn: 'Carrageenan', nameRu: 'Каррагинан', risk: 'moderate', basis: 'efsa_group_adi' },
  { code: 'e407a', nameEn: 'Processed eucheuma seaweed', nameRu: 'Переработанные водоросли эухеума', risk: 'moderate', basis: 'efsa_group_adi' },
  { code: 'e512', nameEn: 'Stannous chloride', nameRu: 'Хлорид олова', risk: 'moderate', basis: 'use_restricted' },
  { code: 'e900', nameEn: 'Dimethylpolysiloxane', nameRu: 'Диметилполисилоксан', risk: 'moderate', basis: 'efsa_group_adi' },
  { code: 'e999', nameEn: 'Quillaia extract', nameRu: 'Экстракт квиллайи', risk: 'moderate', basis: 'use_restricted' },

  // --- Routine, well-characterised additives ------------------------------
  { code: 'e100', nameEn: 'Curcumin', nameRu: 'Куркумин', risk: 'low', basis: 'authorised_routine' },
  { code: 'e101', nameEn: 'Riboflavin', nameRu: 'Рибофлавин', risk: 'low', basis: 'authorised_routine' },
  { code: 'e160a', nameEn: 'Carotenes', nameRu: 'Каротины', risk: 'low', basis: 'authorised_routine' },
  { code: 'e160c', nameEn: 'Paprika extract', nameRu: 'Экстракт паприки', risk: 'low', basis: 'authorised_routine' },
  { code: 'e162', nameEn: 'Beetroot red', nameRu: 'Свекольный красный', risk: 'low', basis: 'authorised_routine' },
  { code: 'e170', nameEn: 'Calcium carbonate', nameRu: 'Карбонат кальция', risk: 'low', basis: 'authorised_routine' },
  { code: 'e200', nameEn: 'Sorbic acid', nameRu: 'Сорбиновая кислота', risk: 'low', basis: 'authorised_routine' },
  { code: 'e202', nameEn: 'Potassium sorbate', nameRu: 'Сорбат калия', risk: 'low', basis: 'authorised_routine' },
  { code: 'e260', nameEn: 'Acetic acid', nameRu: 'Уксусная кислота', risk: 'low', basis: 'authorised_routine' },
  { code: 'e270', nameEn: 'Lactic acid', nameRu: 'Молочная кислота', risk: 'low', basis: 'authorised_routine' },
  { code: 'e296', nameEn: 'Malic acid', nameRu: 'Яблочная кислота', risk: 'low', basis: 'authorised_routine' },
  { code: 'e300', nameEn: 'Ascorbic acid', nameRu: 'Аскорбиновая кислота', risk: 'low', basis: 'authorised_routine' },
  { code: 'e301', nameEn: 'Sodium ascorbate', nameRu: 'Аскорбат натрия', risk: 'low', basis: 'authorised_routine' },
  { code: 'e306', nameEn: 'Tocopherol-rich extract', nameRu: 'Экстракт токоферолов', risk: 'low', basis: 'authorised_routine' },
  { code: 'e322', nameEn: 'Lecithins', nameRu: 'Лецитины', risk: 'low', basis: 'authorised_routine' },
  { code: 'e325', nameEn: 'Sodium lactate', nameRu: 'Лактат натрия', risk: 'low', basis: 'authorised_routine' },
  { code: 'e330', nameEn: 'Citric acid', nameRu: 'Лимонная кислота', risk: 'low', basis: 'authorised_routine' },
  { code: 'e331', nameEn: 'Sodium citrates', nameRu: 'Цитраты натрия', risk: 'low', basis: 'authorised_routine' },
  { code: 'e332', nameEn: 'Potassium citrates', nameRu: 'Цитраты калия', risk: 'low', basis: 'authorised_routine' },
  { code: 'e333', nameEn: 'Calcium citrates', nameRu: 'Цитраты кальция', risk: 'low', basis: 'authorised_routine' },
  { code: 'e392', nameEn: 'Rosemary extract', nameRu: 'Экстракт розмарина', risk: 'low', basis: 'authorised_routine' },
  { code: 'e401', nameEn: 'Sodium alginate', nameRu: 'Альгинат натрия', risk: 'low', basis: 'authorised_routine' },
  { code: 'e406', nameEn: 'Agar', nameRu: 'Агар', risk: 'low', basis: 'authorised_routine' },
  { code: 'e410', nameEn: 'Locust bean gum', nameRu: 'Камедь рожкового дерева', risk: 'low', basis: 'authorised_routine' },
  { code: 'e412', nameEn: 'Guar gum', nameRu: 'Гуаровая камедь', risk: 'low', basis: 'authorised_routine' },
  { code: 'e414', nameEn: 'Acacia gum', nameRu: 'Гуммиарабик', risk: 'low', basis: 'authorised_routine' },
  { code: 'e415', nameEn: 'Xanthan gum', nameRu: 'Ксантановая камедь', risk: 'low', basis: 'authorised_routine' },
  { code: 'e422', nameEn: 'Glycerol', nameRu: 'Глицерин', risk: 'low', basis: 'authorised_routine' },
  { code: 'e440', nameEn: 'Pectins', nameRu: 'Пектины', risk: 'low', basis: 'authorised_routine' },
  { code: 'e471', nameEn: 'Mono- and diglycerides of fatty acids', nameRu: 'Моно- и диглицериды жирных кислот', risk: 'low', basis: 'authorised_routine' },
  { code: 'e500', nameEn: 'Sodium carbonates', nameRu: 'Карбонаты натрия', risk: 'low', basis: 'authorised_routine' },
  { code: 'e501', nameEn: 'Potassium carbonates', nameRu: 'Карбонаты калия', risk: 'low', basis: 'authorised_routine' },
  { code: 'e503', nameEn: 'Ammonium carbonates', nameRu: 'Карбонаты аммония', risk: 'low', basis: 'authorised_routine' },
  { code: 'e509', nameEn: 'Calcium chloride', nameRu: 'Хлорид кальция', risk: 'low', basis: 'authorised_routine' },
  { code: 'e551', nameEn: 'Silicon dioxide', nameRu: 'Диоксид кремния', risk: 'low', basis: 'authorised_routine' },
  { code: 'e948', nameEn: 'Oxygen', nameRu: 'Кислород', risk: 'low', basis: 'authorised_routine' },
  { code: 'e960', nameEn: 'Steviol glycosides', nameRu: 'Стевиолгликозиды', risk: 'low', basis: 'authorised_routine' },
  { code: 'e965', nameEn: 'Maltitol', nameRu: 'Мальтит', risk: 'low', basis: 'authorised_routine' },
  { code: 'e967', nameEn: 'Xylitol', nameRu: 'Ксилит', risk: 'low', basis: 'authorised_routine' },
  { code: 'e968', nameEn: 'Erythritol', nameRu: 'Эритрит', risk: 'low', basis: 'authorised_routine' },
];

const BY_CODE = new Map(ENTRIES.map((entry) => [entry.code, entry]));

/** Normalize `en:e150d`, `E150d`, `e 150 d` and similar into `e150d`. */
export function normalizeAdditiveCode(value: string): string | null {
  const cleaned = value
    .toLowerCase()
    .replace(/^[a-z]{2}:/, '')
    .replace(/[^a-z0-9]/g, '');
  return /^e\d{3}[a-z]?$/.test(cleaned) ? cleaned : null;
}

export interface ClassifiedAdditive {
  code: string;
  nameEn: string;
  nameRu: string;
  risk: AdditiveRisk;
  basis: AdditiveBasis;
  known: boolean;
}

/**
 * Classify a raw additive tag. Unknown E-numbers are returned as `low` with
 * `known: false` so the UI can list them without implying a verdict.
 */
export function classifyAdditive(raw: string): ClassifiedAdditive | null {
  const code = normalizeAdditiveCode(raw);
  if (!code) return null;
  const entry = BY_CODE.get(code);
  if (entry) return { ...entry, known: true };
  const upper = code.toUpperCase();
  return { code, nameEn: upper, nameRu: upper, risk: 'low', basis: 'authorised_routine', known: false };
}

export function classifyAdditives(tags: string[]): ClassifiedAdditive[] {
  const seen = new Set<string>();
  const result: ClassifiedAdditive[] = [];
  for (const tag of tags) {
    const entry = classifyAdditive(tag);
    if (!entry || seen.has(entry.code)) continue;
    seen.add(entry.code);
    result.push(entry);
  }
  const order: Record<AdditiveRisk, number> = { high: 0, moderate: 1, low: 2 };
  return result.sort((left, right) => order[left.risk] - order[right.risk] || left.code.localeCompare(right.code));
}
