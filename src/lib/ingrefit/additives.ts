/**
 * Additive reference used by the deterministic scorer.
 *
 * Editorial rules for this file, which also protect IngreFit legally:
 *  - This file holds codes, risk tiers and regulatory basis only. Names are
 *    translated content and live in `catalog/additives/<language>.json`.
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

/**
 * Structural, language-neutral facts about an additive. Display names live in
 * `catalog/additives/<language>.json` so they can be translated without
 * touching this file, exactly like the rest of the assessment wording.
 */
export interface AdditiveEntry {
  code: string;
  risk: AdditiveRisk;
  basis: AdditiveBasis;
}

const ENTRIES: AdditiveEntry[] = [
  // --- Not authorised in the EU as a food additive -------------------------
  { code: 'e171', risk: 'high', basis: 'eu_not_authorised' },
  { code: 'e123', risk: 'high', basis: 'use_restricted' },
  { code: 'e239', risk: 'high', basis: 'use_restricted' },
  { code: 'e284', risk: 'high', basis: 'use_restricted' },
  { code: 'e285', risk: 'high', basis: 'use_restricted' },

  // --- EU-mandated warning about attention in children ---------------------
  { code: 'e102', risk: 'high', basis: 'eu_child_attention_warning' },
  { code: 'e104', risk: 'high', basis: 'eu_child_attention_warning' },
  { code: 'e110', risk: 'high', basis: 'eu_child_attention_warning' },
  { code: 'e122', risk: 'high', basis: 'eu_child_attention_warning' },
  { code: 'e124', risk: 'high', basis: 'eu_child_attention_warning' },
  { code: 'e129', risk: 'high', basis: 'eu_child_attention_warning' },

  // --- Nitrites and nitrates ----------------------------------------------
  { code: 'e249', risk: 'high', basis: 'iarc_2a' },
  { code: 'e250', risk: 'high', basis: 'iarc_2a' },
  { code: 'e251', risk: 'high', basis: 'iarc_2a' },
  { code: 'e252', risk: 'high', basis: 'iarc_2a' },

  // --- IARC group 2B ------------------------------------------------------
  { code: 'e951', risk: 'moderate', basis: 'iarc_2b' },
  { code: 'e320', risk: 'moderate', basis: 'iarc_2b' },
  { code: 'e150c', risk: 'moderate', basis: 'iarc_2b' },
  { code: 'e150d', risk: 'moderate', basis: 'iarc_2b' },

  // --- Sweeteners with a defined or revised ADI ---------------------------
  { code: 'e950', risk: 'moderate', basis: 'efsa_group_adi' },
  { code: 'e952', risk: 'moderate', basis: 'efsa_adi_lowered' },
  { code: 'e954', risk: 'moderate', basis: 'efsa_group_adi' },
  { code: 'e955', risk: 'moderate', basis: 'efsa_group_adi' },
  { code: 'e962', risk: 'moderate', basis: 'iarc_2b' },

  // --- Preservatives ------------------------------------------------------
  { code: 'e210', risk: 'moderate', basis: 'efsa_group_adi' },
  { code: 'e211', risk: 'moderate', basis: 'efsa_group_adi' },
  { code: 'e212', risk: 'moderate', basis: 'efsa_group_adi' },
  { code: 'e213', risk: 'moderate', basis: 'efsa_group_adi' },
  { code: 'e220', risk: 'moderate', basis: 'mandatory_allergen_labelling' },
  { code: 'e221', risk: 'moderate', basis: 'mandatory_allergen_labelling' },
  { code: 'e222', risk: 'moderate', basis: 'mandatory_allergen_labelling' },
  { code: 'e223', risk: 'moderate', basis: 'mandatory_allergen_labelling' },
  { code: 'e224', risk: 'moderate', basis: 'mandatory_allergen_labelling' },
  { code: 'e226', risk: 'moderate', basis: 'mandatory_allergen_labelling' },
  { code: 'e227', risk: 'moderate', basis: 'mandatory_allergen_labelling' },
  { code: 'e228', risk: 'moderate', basis: 'mandatory_allergen_labelling' },
  { code: 'e319', risk: 'moderate', basis: 'efsa_group_adi' },
  { code: 'e321', risk: 'moderate', basis: 'efsa_group_adi' },
  { code: 'e385', risk: 'moderate', basis: 'use_restricted' },

  // --- Flavour enhancers ---------------------------------------------------
  { code: 'e620', risk: 'moderate', basis: 'efsa_group_adi' },
  { code: 'e621', risk: 'moderate', basis: 'efsa_group_adi' },
  { code: 'e622', risk: 'moderate', basis: 'efsa_group_adi' },
  { code: 'e623', risk: 'moderate', basis: 'efsa_group_adi' },
  { code: 'e624', risk: 'moderate', basis: 'efsa_group_adi' },
  { code: 'e625', risk: 'moderate', basis: 'efsa_group_adi' },
  { code: 'e627', risk: 'moderate', basis: 'efsa_group_adi' },
  { code: 'e631', risk: 'moderate', basis: 'efsa_group_adi' },
  { code: 'e635', risk: 'moderate', basis: 'efsa_group_adi' },

  // --- Phosphates (EFSA group ADI, 2019) ----------------------------------
  { code: 'e338', risk: 'moderate', basis: 'efsa_group_adi' },
  { code: 'e339', risk: 'moderate', basis: 'efsa_group_adi' },
  { code: 'e340', risk: 'moderate', basis: 'efsa_group_adi' },
  { code: 'e341', risk: 'moderate', basis: 'efsa_group_adi' },
  { code: 'e343', risk: 'moderate', basis: 'efsa_group_adi' },
  { code: 'e450', risk: 'moderate', basis: 'efsa_group_adi' },
  { code: 'e451', risk: 'moderate', basis: 'efsa_group_adi' },
  { code: 'e452', risk: 'moderate', basis: 'efsa_group_adi' },

  // --- Other colours and additives with restrictions ----------------------
  { code: 'e127', risk: 'moderate', basis: 'use_restricted' },
  { code: 'e131', risk: 'moderate', basis: 'use_restricted' },
  { code: 'e132', risk: 'moderate', basis: 'efsa_group_adi' },
  { code: 'e133', risk: 'moderate', basis: 'efsa_group_adi' },
  { code: 'e142', risk: 'moderate', basis: 'efsa_group_adi' },
  { code: 'e151', risk: 'moderate', basis: 'efsa_group_adi' },
  { code: 'e155', risk: 'moderate', basis: 'efsa_group_adi' },
  { code: 'e173', risk: 'moderate', basis: 'use_restricted' },
  { code: 'e174', risk: 'moderate', basis: 'use_restricted' },
  { code: 'e407', risk: 'moderate', basis: 'efsa_group_adi' },
  { code: 'e407a', risk: 'moderate', basis: 'efsa_group_adi' },
  { code: 'e512', risk: 'moderate', basis: 'use_restricted' },
  { code: 'e900', risk: 'moderate', basis: 'efsa_group_adi' },
  { code: 'e999', risk: 'moderate', basis: 'use_restricted' },

  // --- Routine, well-characterised additives ------------------------------
  { code: 'e100', risk: 'low', basis: 'authorised_routine' },
  { code: 'e101', risk: 'low', basis: 'authorised_routine' },
  { code: 'e160a', risk: 'low', basis: 'authorised_routine' },
  { code: 'e160c', risk: 'low', basis: 'authorised_routine' },
  { code: 'e162', risk: 'low', basis: 'authorised_routine' },
  { code: 'e170', risk: 'low', basis: 'authorised_routine' },
  { code: 'e200', risk: 'low', basis: 'authorised_routine' },
  { code: 'e202', risk: 'low', basis: 'authorised_routine' },
  { code: 'e260', risk: 'low', basis: 'authorised_routine' },
  { code: 'e270', risk: 'low', basis: 'authorised_routine' },
  { code: 'e296', risk: 'low', basis: 'authorised_routine' },
  { code: 'e300', risk: 'low', basis: 'authorised_routine' },
  { code: 'e301', risk: 'low', basis: 'authorised_routine' },
  { code: 'e306', risk: 'low', basis: 'authorised_routine' },
  { code: 'e322', risk: 'low', basis: 'authorised_routine' },
  { code: 'e325', risk: 'low', basis: 'authorised_routine' },
  { code: 'e330', risk: 'low', basis: 'authorised_routine' },
  { code: 'e331', risk: 'low', basis: 'authorised_routine' },
  { code: 'e332', risk: 'low', basis: 'authorised_routine' },
  { code: 'e333', risk: 'low', basis: 'authorised_routine' },
  { code: 'e392', risk: 'low', basis: 'authorised_routine' },
  { code: 'e401', risk: 'low', basis: 'authorised_routine' },
  { code: 'e406', risk: 'low', basis: 'authorised_routine' },
  { code: 'e410', risk: 'low', basis: 'authorised_routine' },
  { code: 'e412', risk: 'low', basis: 'authorised_routine' },
  { code: 'e414', risk: 'low', basis: 'authorised_routine' },
  { code: 'e415', risk: 'low', basis: 'authorised_routine' },
  { code: 'e422', risk: 'low', basis: 'authorised_routine' },
  { code: 'e440', risk: 'low', basis: 'authorised_routine' },
  { code: 'e471', risk: 'low', basis: 'authorised_routine' },
  { code: 'e500', risk: 'low', basis: 'authorised_routine' },
  { code: 'e501', risk: 'low', basis: 'authorised_routine' },
  { code: 'e503', risk: 'low', basis: 'authorised_routine' },
  { code: 'e509', risk: 'low', basis: 'authorised_routine' },
  { code: 'e551', risk: 'low', basis: 'authorised_routine' },
  { code: 'e948', risk: 'low', basis: 'authorised_routine' },
  { code: 'e960', risk: 'low', basis: 'authorised_routine' },
  { code: 'e965', risk: 'low', basis: 'authorised_routine' },
  { code: 'e967', risk: 'low', basis: 'authorised_routine' },
  { code: 'e968', risk: 'low', basis: 'authorised_routine' },
  // --- Extended EU list -----------------------------------------------------
  // Everything below is an authorised additive that appears routinely on labels.
  // Most are `low`: listing them by name is what makes an ingredient panel
  // readable, and an unnamed E-number reads as more alarming than it should.
  { code: 'e120', risk: 'moderate', basis: 'efsa_group_adi' },
  { code: 'e140', risk: 'low', basis: 'authorised_routine' },
  { code: 'e141', risk: 'low', basis: 'authorised_routine' },
  { code: 'e150a', risk: 'low', basis: 'authorised_routine' },
  { code: 'e150b', risk: 'low', basis: 'authorised_routine' },
  { code: 'e153', risk: 'low', basis: 'use_restricted' },
  { code: 'e160b', risk: 'moderate', basis: 'efsa_group_adi' },
  { code: 'e160d', risk: 'low', basis: 'authorised_routine' },
  { code: 'e160e', risk: 'moderate', basis: 'efsa_group_adi' },
  { code: 'e161b', risk: 'low', basis: 'authorised_routine' },
  { code: 'e161g', risk: 'moderate', basis: 'use_restricted' },
  { code: 'e163', risk: 'low', basis: 'authorised_routine' },
  { code: 'e172', risk: 'low', basis: 'authorised_routine' },
  { code: 'e175', risk: 'low', basis: 'use_restricted' },
  { code: 'e180', risk: 'moderate', basis: 'use_restricted' },
  { code: 'e181', risk: 'low', basis: 'authorised_routine' },
  { code: 'e201', risk: 'low', basis: 'authorised_routine' },
  { code: 'e203', risk: 'low', basis: 'authorised_routine' },
  { code: 'e214', risk: 'moderate', basis: 'efsa_group_adi' },
  { code: 'e215', risk: 'moderate', basis: 'efsa_group_adi' },
  { code: 'e216', risk: 'high', basis: 'eu_not_authorised' },
  { code: 'e217', risk: 'high', basis: 'eu_not_authorised' },
  { code: 'e218', risk: 'moderate', basis: 'efsa_group_adi' },
  { code: 'e219', risk: 'moderate', basis: 'efsa_group_adi' },
  { code: 'e234', risk: 'low', basis: 'use_restricted' },
  { code: 'e235', risk: 'moderate', basis: 'use_restricted' },
  { code: 'e242', risk: 'moderate', basis: 'use_restricted' },
  { code: 'e261', risk: 'low', basis: 'authorised_routine' },
  { code: 'e262', risk: 'low', basis: 'authorised_routine' },
  { code: 'e263', risk: 'low', basis: 'authorised_routine' },
  { code: 'e280', risk: 'moderate', basis: 'efsa_group_adi' },
  { code: 'e281', risk: 'moderate', basis: 'efsa_group_adi' },
  { code: 'e282', risk: 'moderate', basis: 'efsa_group_adi' },
  { code: 'e283', risk: 'moderate', basis: 'efsa_group_adi' },
  { code: 'e290', risk: 'low', basis: 'authorised_routine' },
  { code: 'e297', risk: 'low', basis: 'authorised_routine' },
  { code: 'e302', risk: 'low', basis: 'authorised_routine' },
  { code: 'e304', risk: 'low', basis: 'authorised_routine' },
  { code: 'e307', risk: 'low', basis: 'authorised_routine' },
  { code: 'e308', risk: 'low', basis: 'authorised_routine' },
  { code: 'e309', risk: 'low', basis: 'authorised_routine' },
  { code: 'e310', risk: 'moderate', basis: 'efsa_group_adi' },
  { code: 'e311', risk: 'moderate', basis: 'efsa_group_adi' },
  { code: 'e312', risk: 'moderate', basis: 'efsa_group_adi' },
  { code: 'e315', risk: 'low', basis: 'authorised_routine' },
  { code: 'e316', risk: 'low', basis: 'authorised_routine' },
  { code: 'e326', risk: 'low', basis: 'authorised_routine' },
  { code: 'e327', risk: 'low', basis: 'authorised_routine' },
  { code: 'e334', risk: 'low', basis: 'authorised_routine' },
  { code: 'e335', risk: 'low', basis: 'authorised_routine' },
  { code: 'e336', risk: 'low', basis: 'authorised_routine' },
  { code: 'e337', risk: 'low', basis: 'authorised_routine' },
  { code: 'e350', risk: 'low', basis: 'authorised_routine' },
  { code: 'e351', risk: 'low', basis: 'authorised_routine' },
  { code: 'e352', risk: 'low', basis: 'authorised_routine' },
  { code: 'e353', risk: 'low', basis: 'authorised_routine' },
  { code: 'e354', risk: 'low', basis: 'authorised_routine' },
  { code: 'e355', risk: 'low', basis: 'authorised_routine' },
  { code: 'e363', risk: 'low', basis: 'authorised_routine' },
  { code: 'e380', risk: 'low', basis: 'authorised_routine' },
  { code: 'e400', risk: 'low', basis: 'authorised_routine' },
  { code: 'e402', risk: 'low', basis: 'authorised_routine' },
  { code: 'e403', risk: 'low', basis: 'authorised_routine' },
  { code: 'e404', risk: 'low', basis: 'authorised_routine' },
  { code: 'e405', risk: 'low', basis: 'authorised_routine' },
  { code: 'e413', risk: 'low', basis: 'authorised_routine' },
  { code: 'e416', risk: 'low', basis: 'authorised_routine' },
  { code: 'e417', risk: 'low', basis: 'authorised_routine' },
  { code: 'e418', risk: 'low', basis: 'authorised_routine' },
  { code: 'e420', risk: 'low', basis: 'authorised_routine' },
  { code: 'e421', risk: 'low', basis: 'authorised_routine' },
  { code: 'e425', risk: 'moderate', basis: 'use_restricted' },
  { code: 'e426', risk: 'low', basis: 'authorised_routine' },
  { code: 'e427', risk: 'low', basis: 'authorised_routine' },
  { code: 'e431', risk: 'moderate', basis: 'efsa_group_adi' },
  { code: 'e432', risk: 'moderate', basis: 'efsa_group_adi' },
  { code: 'e433', risk: 'moderate', basis: 'efsa_group_adi' },
  { code: 'e434', risk: 'moderate', basis: 'efsa_group_adi' },
  { code: 'e435', risk: 'moderate', basis: 'efsa_group_adi' },
  { code: 'e436', risk: 'moderate', basis: 'efsa_group_adi' },
  { code: 'e441', risk: 'low', basis: 'authorised_routine' },
  { code: 'e442', risk: 'moderate', basis: 'efsa_group_adi' },
  { code: 'e444', risk: 'moderate', basis: 'use_restricted' },
  { code: 'e445', risk: 'moderate', basis: 'use_restricted' },
  { code: 'e459', risk: 'low', basis: 'authorised_routine' },
  { code: 'e460', risk: 'low', basis: 'authorised_routine' },
  { code: 'e461', risk: 'low', basis: 'authorised_routine' },
  { code: 'e463', risk: 'low', basis: 'authorised_routine' },
  { code: 'e464', risk: 'low', basis: 'authorised_routine' },
  { code: 'e465', risk: 'low', basis: 'authorised_routine' },
  { code: 'e466', risk: 'low', basis: 'authorised_routine' },
  { code: 'e468', risk: 'low', basis: 'authorised_routine' },
  { code: 'e469', risk: 'low', basis: 'authorised_routine' },
  { code: 'e470a', risk: 'low', basis: 'authorised_routine' },
  { code: 'e470b', risk: 'low', basis: 'authorised_routine' },
  { code: 'e472a', risk: 'low', basis: 'authorised_routine' },
  { code: 'e472b', risk: 'low', basis: 'authorised_routine' },
  { code: 'e472c', risk: 'low', basis: 'authorised_routine' },
  { code: 'e472d', risk: 'low', basis: 'authorised_routine' },
  { code: 'e472e', risk: 'low', basis: 'authorised_routine' },
  { code: 'e472f', risk: 'low', basis: 'authorised_routine' },
  { code: 'e473', risk: 'moderate', basis: 'efsa_group_adi' },
  { code: 'e474', risk: 'moderate', basis: 'efsa_group_adi' },
  { code: 'e475', risk: 'low', basis: 'authorised_routine' },
  { code: 'e476', risk: 'low', basis: 'authorised_routine' },
  { code: 'e477', risk: 'low', basis: 'authorised_routine' },
  { code: 'e479b', risk: 'moderate', basis: 'use_restricted' },
  { code: 'e481', risk: 'low', basis: 'authorised_routine' },
  { code: 'e482', risk: 'low', basis: 'authorised_routine' },
  { code: 'e483', risk: 'low', basis: 'authorised_routine' },
  { code: 'e491', risk: 'moderate', basis: 'efsa_group_adi' },
  { code: 'e492', risk: 'moderate', basis: 'efsa_group_adi' },
  { code: 'e493', risk: 'moderate', basis: 'efsa_group_adi' },
  { code: 'e494', risk: 'moderate', basis: 'efsa_group_adi' },
  { code: 'e495', risk: 'moderate', basis: 'efsa_group_adi' },
  { code: 'e504', risk: 'low', basis: 'authorised_routine' },
  { code: 'e507', risk: 'low', basis: 'authorised_routine' },
  { code: 'e508', risk: 'low', basis: 'authorised_routine' },
  { code: 'e511', risk: 'low', basis: 'authorised_routine' },
  { code: 'e513', risk: 'low', basis: 'authorised_routine' },
  { code: 'e514', risk: 'low', basis: 'authorised_routine' },
  { code: 'e515', risk: 'low', basis: 'authorised_routine' },
  { code: 'e516', risk: 'low', basis: 'authorised_routine' },
  { code: 'e517', risk: 'low', basis: 'authorised_routine' },
  { code: 'e520', risk: 'moderate', basis: 'use_restricted' },
  { code: 'e521', risk: 'moderate', basis: 'use_restricted' },
  { code: 'e524', risk: 'low', basis: 'authorised_routine' },
  { code: 'e525', risk: 'low', basis: 'authorised_routine' },
  { code: 'e526', risk: 'low', basis: 'authorised_routine' },
  { code: 'e527', risk: 'low', basis: 'authorised_routine' },
  { code: 'e528', risk: 'low', basis: 'authorised_routine' },
  { code: 'e529', risk: 'low', basis: 'authorised_routine' },
  { code: 'e530', risk: 'low', basis: 'authorised_routine' },
  { code: 'e535', risk: 'moderate', basis: 'use_restricted' },
  { code: 'e536', risk: 'moderate', basis: 'use_restricted' },
  { code: 'e538', risk: 'moderate', basis: 'use_restricted' },
  { code: 'e541', risk: 'moderate', basis: 'use_restricted' },
  { code: 'e552', risk: 'low', basis: 'authorised_routine' },
  { code: 'e553a', risk: 'low', basis: 'authorised_routine' },
  { code: 'e553b', risk: 'low', basis: 'authorised_routine' },
  { code: 'e554', risk: 'moderate', basis: 'use_restricted' },
  { code: 'e555', risk: 'moderate', basis: 'use_restricted' },
  { code: 'e556', risk: 'moderate', basis: 'use_restricted' },
  { code: 'e558', risk: 'low', basis: 'authorised_routine' },
  { code: 'e559', risk: 'moderate', basis: 'use_restricted' },
  { code: 'e570', risk: 'low', basis: 'authorised_routine' },
  { code: 'e574', risk: 'low', basis: 'authorised_routine' },
  { code: 'e575', risk: 'low', basis: 'authorised_routine' },
  { code: 'e576', risk: 'low', basis: 'authorised_routine' },
  { code: 'e577', risk: 'low', basis: 'authorised_routine' },
  { code: 'e578', risk: 'low', basis: 'authorised_routine' },
  { code: 'e579', risk: 'low', basis: 'authorised_routine' },
  { code: 'e585', risk: 'low', basis: 'authorised_routine' },
  { code: 'e626', risk: 'moderate', basis: 'efsa_group_adi' },
  { code: 'e628', risk: 'moderate', basis: 'efsa_group_adi' },
  { code: 'e629', risk: 'moderate', basis: 'efsa_group_adi' },
  { code: 'e630', risk: 'moderate', basis: 'efsa_group_adi' },
  { code: 'e632', risk: 'moderate', basis: 'efsa_group_adi' },
  { code: 'e633', risk: 'moderate', basis: 'efsa_group_adi' },
  { code: 'e634', risk: 'moderate', basis: 'efsa_group_adi' },
  { code: 'e636', risk: 'low', basis: 'authorised_routine' },
  { code: 'e637', risk: 'low', basis: 'authorised_routine' },
  { code: 'e640', risk: 'low', basis: 'authorised_routine' },
  { code: 'e650', risk: 'low', basis: 'authorised_routine' },
  { code: 'e901', risk: 'low', basis: 'authorised_routine' },
  { code: 'e902', risk: 'low', basis: 'authorised_routine' },
  { code: 'e903', risk: 'low', basis: 'authorised_routine' },
  { code: 'e904', risk: 'low', basis: 'authorised_routine' },
  { code: 'e905', risk: 'low', basis: 'authorised_routine' },
  { code: 'e907', risk: 'low', basis: 'authorised_routine' },
  { code: 'e912', risk: 'low', basis: 'use_restricted' },
  { code: 'e914', risk: 'low', basis: 'use_restricted' },
  { code: 'e920', risk: 'low', basis: 'authorised_routine' },
  { code: 'e927b', risk: 'low', basis: 'authorised_routine' },
  { code: 'e938', risk: 'low', basis: 'authorised_routine' },
  { code: 'e939', risk: 'low', basis: 'authorised_routine' },
  { code: 'e941', risk: 'low', basis: 'authorised_routine' },
  { code: 'e942', risk: 'low', basis: 'authorised_routine' },
  { code: 'e943a', risk: 'low', basis: 'authorised_routine' },
  { code: 'e944', risk: 'low', basis: 'authorised_routine' },
  { code: 'e949', risk: 'low', basis: 'authorised_routine' },
  { code: 'e953', risk: 'low', basis: 'authorised_routine' },
  { code: 'e957', risk: 'low', basis: 'authorised_routine' },
  { code: 'e959', risk: 'moderate', basis: 'efsa_group_adi' },
  { code: 'e961', risk: 'moderate', basis: 'efsa_group_adi' },
  { code: 'e964', risk: 'low', basis: 'authorised_routine' },
  { code: 'e966', risk: 'low', basis: 'authorised_routine' },
  { code: 'e969', risk: 'moderate', basis: 'efsa_group_adi' },
  { code: 'e1103', risk: 'low', basis: 'authorised_routine' },
  { code: 'e1105', risk: 'moderate', basis: 'mandatory_allergen_labelling' },
  { code: 'e1200', risk: 'low', basis: 'authorised_routine' },
  { code: 'e1201', risk: 'low', basis: 'authorised_routine' },
  { code: 'e1202', risk: 'low', basis: 'authorised_routine' },
  { code: 'e1203', risk: 'low', basis: 'use_restricted' },
  { code: 'e1204', risk: 'low', basis: 'use_restricted' },
  { code: 'e1205', risk: 'low', basis: 'use_restricted' },
  { code: 'e1404', risk: 'low', basis: 'authorised_routine' },
  { code: 'e1410', risk: 'low', basis: 'authorised_routine' },
  { code: 'e1412', risk: 'low', basis: 'authorised_routine' },
  { code: 'e1413', risk: 'low', basis: 'authorised_routine' },
  { code: 'e1414', risk: 'low', basis: 'authorised_routine' },
  { code: 'e1420', risk: 'low', basis: 'authorised_routine' },
  { code: 'e1422', risk: 'low', basis: 'authorised_routine' },
  { code: 'e1440', risk: 'low', basis: 'authorised_routine' },
  { code: 'e1442', risk: 'low', basis: 'authorised_routine' },
  { code: 'e1450', risk: 'low', basis: 'authorised_routine' },
  { code: 'e1451', risk: 'low', basis: 'authorised_routine' },
  { code: 'e1452', risk: 'moderate', basis: 'use_restricted' },
  { code: 'e1505', risk: 'low', basis: 'authorised_routine' },
  { code: 'e1517', risk: 'low', basis: 'authorised_routine' },
  { code: 'e1518', risk: 'low', basis: 'authorised_routine' },
  { code: 'e1519', risk: 'moderate', basis: 'efsa_group_adi' },
  { code: 'e1520', risk: 'moderate', basis: 'efsa_group_adi' },
  { code: 'e1521', risk: 'low', basis: 'use_restricted' },
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
  return { code, risk: 'low', basis: 'authorised_routine', known: false };
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
